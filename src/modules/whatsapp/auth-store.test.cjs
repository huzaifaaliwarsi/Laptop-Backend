const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openAuthStore, hasSavedSession } = require('./auth-store');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Exercise persistence through the actual adapter, without touching customer DBs.
function database() {
  let rows = new Map(), locked = false, snapshot;
  const query = async (sql, values = []) => {
    const [branch, key, value] = values;
    if (sql.startsWith('CREATE')) return { rows: [] };
    if (sql === 'BEGIN') { snapshot = new Map(rows); return {}; }
    if (sql === 'COMMIT') { snapshot = null; return {}; }
    if (sql === 'ROLLBACK') { rows = snapshot; snapshot = null; return {}; }
    if (sql.startsWith('INSERT')) { rows.set(`${branch}:${key}`, { key, value }); return {}; }
    if (sql.startsWith('DELETE')) {
      for (const k of rows.keys()) if (k.startsWith(`${branch}:`) && (key === undefined || k === `${branch}:${key}`)) rows.delete(k);
      return {};
    }
    if (sql.startsWith('SELECT')) return { rows: [...rows.entries()].filter(([k, row]) =>
      k.startsWith(`${branch}:`) && (!sql.includes("key = 'creds.json'") || row.key === 'creds.json') &&
      (!Array.isArray(key) || key.includes(row.key))).map(([, row]) => row) };
    throw Error(sql);
  };
  return { query, connect: async () => {
    const client = new EventEmitter(); let owner = false;
    client.query = async (sql, values) => {
      if (sql.includes('pg_try_advisory_lock')) { owner = !locked; if (owner) locked = true; return { rows: [{ acquired: owner }] }; }
      return query(sql, values);
    };
    client.release = () => { if (owner) locked = false; };
    return client;
  } };
}
const baileys = {
  initAuthCreds: () => ({ registered: false, noiseKey: { fresh: true } }),
  BufferJSON: { replacer: (key, value) => value, reviver: (key, value) => value?.type === 'Buffer' ? Buffer.from(value.data) : value },
  proto: { Message: { AppStateSyncKeyData: { fromObject: value => ({ ...value, restored: true }) } } }
};

test('credentials and Signal keys survive store restart, deletes persist, and logout prevents legacy reimport', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-auth-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'creds.json'), JSON.stringify({ registered: true, me: { id: 'legacy' } }));
  await fs.writeFile(path.join(dir, 'session-old.json'), JSON.stringify({ imported: true }));
  const pool = database();
  let store = await openAuthStore(pool, 1, dir, baileys, error => { throw error; });
  assert.equal(store.state.creds.me.id, 'legacy');
  assert.equal((await store.state.keys.get('session', ['old'])).old.imported, true);
  store.state.creds.me.id = 'saved'; await store.saveCreds();
  await store.state.keys.set({ 'app-state-sync-key': { one: { keyData: Buffer.from([1, 2, 3]) } }, session: { old: null } });
  await store.close();
  store = await openAuthStore(pool, 1, dir, baileys, error => { throw error; });
  assert.equal(store.state.creds.me.id, 'saved');
  const keys = await store.state.keys.get('app-state-sync-key', ['one']);
  assert.deepEqual(keys.one.keyData, Buffer.from([1, 2, 3])); assert.equal(keys.one.restored, true);
  assert.equal((await store.state.keys.get('session', ['old'])).old, undefined);
  assert.equal(await hasSavedSession(pool, 1), true);
  await store.clear(); await store.close();
  assert.equal(await hasSavedSession(pool, 1), false);
  store = await openAuthStore(pool, 1, dir, baileys, error => { throw error; });
  assert.equal(store.state.creds.me, undefined);
  assert.equal(store.state.creds.noiseKey.fresh, true);
  await store.close();
});
test('second process cannot own the same session; ownership transfers after close', async () => {
  const pool = database(), dir = path.join(os.tmpdir(), 'nonexistent-wa-auth-dir');
  const first = await openAuthStore(pool, 1, dir, baileys, () => {});
  await assert.rejects(openAuthStore(pool, 1, dir, baileys, () => {}), { code: 'WA_SESSION_BUSY' });
  await first.close();
  const second = await openAuthStore(pool, 1, dir, baileys, () => {}); await second.close();
});
