const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const schema = `CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  branch_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (branch_id, key)
)`;
const fileKey = key => key.replace(/\//g, '__').replace(/:/g, '-');
const leaseSchema = `CREATE TABLE IF NOT EXISTS whatsapp_auth_leases (
  branch_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
)`;

async function hasSavedSession(pool, branchId) {
  await pool.query(schema);
  const { rows } = await pool.query(
    "SELECT value FROM whatsapp_auth_state WHERE branch_id = $1 AND key = 'creds.json'", [branchId]);
  if (!rows.length) return null; // Allows a one-time import from the old file store.
  const creds = JSON.parse(rows[0].value);
  return Boolean(creds.me?.id || creds.registered);
}

// Ownership lives in a row, so it works through transaction-pooling proxies.
// Each operation fences the owner inside its transaction before touching keys.
async function openAuthStore(pool, branchId, authDir, baileys, onFailure) {
  await pool.query(schema);
  await pool.query(leaseSchema);
  const client = await pool.connect();
  const owner = randomUUID();
  let heartbeat;
  let closed = false;
  let queue = Promise.resolve();
  const fail = error => { if (!closed) onFailure(error); };
  client.on('error', fail);
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    await queue.catch(() => {});
    try {
      await client.query('DELETE FROM whatsapp_auth_leases WHERE branch_id = $1 AND owner = $2', [branchId, owner]);
    } finally { client.release(true); }
  };
  const run = task => {
    if (closed) return Promise.reject(new Error('WhatsApp auth store is closed'));
    const result = queue.then(async () => {
      await client.query('BEGIN');
      try {
        const lease = await client.query(`UPDATE whatsapp_auth_leases SET expires_at = NOW() + INTERVAL '60 seconds'
          WHERE branch_id = $1 AND owner = $2 AND expires_at > NOW() RETURNING owner`, [branchId, owner]);
        if (!lease.rows.length) {
          const error = new Error('WhatsApp session ownership expired');
          error.code = 'WA_SESSION_BUSY';
          throw error;
        }
        const value = await task();
        await client.query('COMMIT');
        return value;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    });
    queue = result.catch(fail);
    return result;
  };
  const put = (key, value) => client.query(
    `INSERT INTO whatsapp_auth_state (branch_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`, [branchId, key, value]);
  try {
    const lock = await client.query(`INSERT INTO whatsapp_auth_leases (branch_id, owner, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '60 seconds') ON CONFLICT (branch_id) DO UPDATE
      SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
      WHERE whatsapp_auth_leases.expires_at <= NOW() RETURNING owner`, [branchId, owner]);
    if (!lock.rows.length) {
      const activeLease = await client.query(`SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW())))) AS seconds
        FROM whatsapp_auth_leases WHERE branch_id = $1`, [branchId]);
      const error = new Error('WhatsApp session is owned by another server instance');
      error.code = 'WA_SESSION_BUSY';
      error.retryAfterMs = Math.min(60000, Math.max(1000, Number(activeLease.rows[0]?.seconds || 1) * 1000));
      throw error;
    }
    let { rows } = await client.query(
      'SELECT key, value FROM whatsapp_auth_state WHERE branch_id = $1', [branchId]);
    if (!rows.length) {
      // Import credentials AND Signal keys atomically. A tombstone prevents
      // old files restoring a session after explicit logout.
      const files = await fs.readdir(authDir).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      await run(async () => {
        for (const file of files.filter(file => file.endsWith('.json'))) {
          const value = await fs.readFile(path.join(authDir, file), 'utf8');
          JSON.parse(value);
          await put(file, value);
        }
        await put('_migrated', 'true');
      });
      ({ rows } = await client.query('SELECT key, value FROM whatsapp_auth_state WHERE branch_id = $1', [branchId]));
    }
    const decode = value => JSON.parse(value, baileys.BufferJSON.reviver);
    const encode = value => JSON.stringify(value, baileys.BufferJSON.replacer);
    const stored = rows.find(row => row.key === 'creds.json');
    const previous = stored ? decode(stored.value) : null;
    // Logout leaves an empty tombstone, not usable pairing credentials.
    const creds = previous && Object.keys(previous).length ? previous : baileys.initAuthCreds();
    const keyCache = new Map(rows.map(row => [row.key, row.value]));
    heartbeat = setInterval(() => { run(async () => {}).catch(() => {}); }, 15000);
    heartbeat.unref?.();
    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            await queue;
            if (closed) throw new Error('WhatsApp auth store is closed');
            return Object.fromEntries(ids.map(id => {
              const encoded = keyCache.get(fileKey(`${type}-${id}.json`));
              let value = encoded === undefined ? undefined : decode(encoded);
              if (value && type === 'app-state-sync-key') value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
              return [id, value];
            }));
          },
          set: data => {
            const entries = Object.entries(data).flatMap(([type, values]) =>
              Object.entries(values).map(([id, value]) => [fileKey(`${type}-${id}.json`), value == null ? null : encode(value)]));
            return run(async () => {
              const writes = entries.filter(([, value]) => value !== null);
              const deletes = entries.filter(([, value]) => value === null).map(([key]) => key);
              if (writes.length) await client.query(
                `INSERT INTO whatsapp_auth_state (branch_id, key, value)
                 SELECT $1, item.key, item.value FROM UNNEST($2::text[], $3::text[]) AS item(key, value)
                 ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`,
                [branchId, writes.map(([key]) => key), writes.map(([, value]) => value)]);
              if (deletes.length) await client.query(
                'DELETE FROM whatsapp_auth_state WHERE branch_id = $1 AND key = ANY($2::text[])', [branchId, deletes]);
            }).then(() => {
              for (const [key, value] of entries) {
                if (value === null) keyCache.delete(key);
                else keyCache.set(key, value);
              }
            });
          }
        }
      },
      saveCreds: () => { const value = encode(creds); return run(() => put('creds.json', value)); },
      flush: () => queue,
      clear: () => run(async () => {
          await client.query('DELETE FROM whatsapp_auth_state WHERE branch_id = $1', [branchId]);
          await put('creds.json', '{}');
          await put('_migrated', 'true');
      }),
      close
    };
  } catch (error) { await close(); throw error; }
}

module.exports = { openAuthStore, hasSavedSession };
