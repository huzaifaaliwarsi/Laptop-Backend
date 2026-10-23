const { randomUUID } = require('node:crypto');
const pool = require('../../config/branchManager').masterPool;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ready;
function ensureSchema() {
  if (!ready) ready = pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_worker_status (
      branch_id INTEGER PRIMARY KEY, status JSONB NOT NULL, worker_id TEXT NOT NULL, heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS whatsapp_worker_control (
      id INTEGER PRIMARY KEY CHECK (id=1), owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS whatsapp_worker_commands (
      id UUID PRIMARY KEY, branch_id INTEGER NOT NULL, action TEXT NOT NULL, payload JSONB NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', result JSONB, error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '50 seconds',
      started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS whatsapp_worker_pending ON whatsapp_worker_commands (state, created_at);
  `).catch(error => { ready = null; throw error; });
  return ready;
}

async function acquireWorker(owner) {
  await ensureSchema();
  const { rows } = await pool.query(`INSERT INTO whatsapp_worker_control (id,owner,expires_at) VALUES (1,$1,NOW()+INTERVAL '30 seconds')
    ON CONFLICT (id) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at
    WHERE whatsapp_worker_control.expires_at <= NOW() RETURNING owner`, [owner]);
  return rows.length > 0;
}
async function renewWorker(owner) {
  const { rowCount } = await pool.query(`UPDATE whatsapp_worker_control SET expires_at=NOW()+INTERVAL '30 seconds'
    WHERE id=1 AND owner=$1 AND expires_at>NOW()`, [owner]);
  return rowCount === 1;
}
async function releaseWorker(owner) {
  await pool.query('DELETE FROM whatsapp_worker_control WHERE id=1 AND owner=$1', [owner]);
}
async function saveStatus(branchId, status, owner) {
  await ensureSchema();
  await pool.query(`INSERT INTO whatsapp_worker_status (branch_id,status,worker_id,heartbeat)
    SELECT $1,$2,$3,NOW() WHERE EXISTS (SELECT 1 FROM whatsapp_worker_control WHERE id=1 AND owner=$3 AND expires_at>NOW())
    ON CONFLICT (branch_id) DO UPDATE SET status=EXCLUDED.status, worker_id=EXCLUDED.worker_id, heartbeat=NOW()
    WHERE COALESCE((whatsapp_worker_status.status->>'updatedAt')::bigint,0) <= ($2::jsonb->>'updatedAt')::bigint`,
  [branchId, JSON.stringify(status), owner]);
}

async function getStatus(branchId) {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return { branchId, connected: false, connecting: false, qr: null, updatedAt: Date.now(),
      error: 'WhatsApp daemon is available on the production deployment only.' };
  }
  await ensureSchema();
  const { rows } = await pool.query(`SELECT status, heartbeat > NOW() - INTERVAL '20 seconds'
    AND EXISTS (SELECT 1 FROM whatsapp_worker_control c WHERE c.id=1 AND c.owner=worker_id AND c.expires_at>NOW()) AS fresh
    FROM whatsapp_worker_status WHERE branch_id=$1`, [branchId]);
  if (rows[0]?.fresh) return { ...rows[0].status, updatedAt: Date.now() };
  const previous = rows[0]?.status || {};
  return { ...previous, branchId, connected: false, connecting: false, linking: false, qr: null,
    reconnecting: Boolean(previous.authenticated), authenticated: Boolean(previous.authenticated),
    updatedAt: Date.now(), error: 'WhatsApp worker is starting or unavailable. Check the Vercel whatsapp daemon logs.' };
}

async function request(branchId, action, payload = {}) {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    throw new Error('WhatsApp daemon commands are available on the production deployment only.');
  }
  await ensureSchema();
  const id = randomUUID();
  await pool.query('INSERT INTO whatsapp_worker_commands (id,branch_id,action,payload) VALUES ($1,$2,$3,$4)',
    [id, branchId, action, JSON.stringify(payload)]);
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const { rows } = await pool.query('SELECT state,result,error FROM whatsapp_worker_commands WHERE id=$1', [id]);
    const row = rows[0];
    if (row?.state === 'done') return row.result;
    if (row?.state === 'failed') throw new Error(row.error || 'WhatsApp worker command failed');
    await sleep(500);
  }
  await pool.query(`UPDATE whatsapp_worker_commands SET state='failed',error='Request expired before execution',payload='{}',finished_at=NOW()
    WHERE id=$1 AND state='pending'`, [id]);
  const error = new Error('WhatsApp worker did not respond in time. Check daemon logs before retrying a send.');
  error.code = 'WA_WORKER_TIMEOUT';
  throw error;
}

async function claim() {
  await ensureSchema();
  // A claimed send is never replayed automatically: delivery may already have happened.
  await pool.query(`UPDATE whatsapp_worker_commands SET state='failed', payload='{}',
    error='Worker stopped or command expired; delivery may be unknown', finished_at=NOW()
    WHERE (state='pending' AND expires_at < NOW()) OR (state='running' AND started_at < NOW() - INTERVAL '2 minutes')`);
  const { rows } = await pool.query(`UPDATE whatsapp_worker_commands SET state='running',started_at=NOW()
    WHERE id=(SELECT id FROM whatsapp_worker_commands WHERE state='pending' AND expires_at>NOW()
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
  return rows[0];
}

async function finish(id, result, error) {
  await pool.query(`UPDATE whatsapp_worker_commands SET state=$2,result=$3,error=$4,payload='{}',finished_at=NOW()
    WHERE id=$1 AND state='running'`, [id, error ? 'failed' : 'done', JSON.stringify(result ?? null), error?.message || null]);
}
async function cleanup() {
  await pool.query("DELETE FROM whatsapp_worker_commands WHERE finished_at < NOW() - INTERVAL '1 hour'");
}
module.exports = { ensureSchema, acquireWorker, renewWorker, releaseWorker, saveStatus, getStatus, request, claim, finish, cleanup, sleep };
