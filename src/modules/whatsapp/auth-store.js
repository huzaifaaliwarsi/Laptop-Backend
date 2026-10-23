const fs = require('node:fs/promises');
const path = require('node:path');

const schema = `CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  branch_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (branch_id, key)
)`;
const fileKey = key => key.replace(/\//g, '__').replace(/:/g, '-');

async function hasSavedSession(pool, branchId) {
  await pool.query(schema);
  const { rows } = await pool.query(
    "SELECT value FROM whatsapp_auth_state WHERE branch_id = $1 AND key = 'creds.json'", [branchId]);
  if (!rows.length) return null; // Allows a one-time import from the old file store.
  const creds = JSON.parse(rows[0].value);
  return Boolean(creds.me?.id || creds.registered);
}

// A dedicated connection owns the advisory lock for the entire socket lifetime.
// Use direct PostgreSQL or session pooling, never transaction pooling.
async function openAuthStore(pool, branchId, authDir, baileys, onFailure) {
  await pool.query(schema);
  const client = await pool.connect();
  let closed = false;
  let queue = Promise.resolve();
  const fail = error => { if (!closed) onFailure(error); };
  client.on('error', fail);
  const close = async () => {
    if (closed) return;
    closed = true;
    await queue.catch(() => {});
    client.release(true); // Destroy connection, releasing its advisory lock.
  };
  const run = task => {
    if (closed) return Promise.reject(new Error('WhatsApp auth store is closed'));
    const result = queue.then(task);
    queue = result.catch(fail);
    return result;
  };
  const put = (key, value) => client.query(
    `INSERT INTO whatsapp_auth_state (branch_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`, [branchId, key, value]);
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(782451, $1) AS acquired', [branchId]);
    if (!lock.rows[0].acquired) {
      const error = new Error('WhatsApp session is owned by another server instance');
      error.code = 'WA_SESSION_BUSY';
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
      await client.query('BEGIN');
      try {
        for (const file of files.filter(file => file.endsWith('.json'))) {
          const value = await fs.readFile(path.join(authDir, file), 'utf8');
          JSON.parse(value);
          await put(file, value);
        }
        await put('_migrated', 'true');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      ({ rows } = await client.query('SELECT key, value FROM whatsapp_auth_state WHERE branch_id = $1', [branchId]));
    }
    const decode = value => JSON.parse(value, baileys.BufferJSON.reviver);
    const encode = value => JSON.stringify(value, baileys.BufferJSON.replacer);
    const stored = rows.find(row => row.key === 'creds.json');
    const previous = stored ? decode(stored.value) : null;
    // Logout leaves an empty tombstone, not usable pairing credentials.
    const creds = previous && Object.keys(previous).length ? previous : baileys.initAuthCreds();
    return {
      state: {
        creds,
        keys: {
          get: (type, ids) => run(async () => {
            const result = await client.query(
              'SELECT key, value FROM whatsapp_auth_state WHERE branch_id = $1 AND key = ANY($2::text[])',
              [branchId, ids.map(id => fileKey(`${type}-${id}.json`))]);
            const values = new Map(result.rows.map(row => [row.key, decode(row.value)]));
            return Object.fromEntries(ids.map(id => {
              let value = values.get(fileKey(`${type}-${id}.json`));
              if (value && type === 'app-state-sync-key') value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
              return [id, value];
            }));
          }),
          set: data => {
            const entries = Object.entries(data).flatMap(([type, values]) =>
              Object.entries(values).map(([id, value]) => [fileKey(`${type}-${id}.json`), value == null ? null : encode(value)]));
            return run(async () => {
              await client.query('BEGIN');
              try {
                for (const [key, value] of entries) {
                  if (value === null) await client.query('DELETE FROM whatsapp_auth_state WHERE branch_id = $1 AND key = $2', [branchId, key]);
                  else await put(key, value);
                }
                await client.query('COMMIT');
              } catch (error) {
                await client.query('ROLLBACK');
                throw error;
              }
            });
          }
        }
      },
      saveCreds: () => { const value = encode(creds); return run(() => put('creds.json', value)); },
      flush: () => queue,
      clear: () => run(async () => {
        await client.query('BEGIN');
        try {
          await client.query('DELETE FROM whatsapp_auth_state WHERE branch_id = $1', [branchId]);
          await put('creds.json', '{}');
          await put('_migrated', 'true');
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }),
      close
    };
  } catch (error) { await close(); throw error; }
}

module.exports = { openAuthStore, hasSavedSession };
