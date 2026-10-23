const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openAuthStore, hasSavedSession } = require('./auth-store');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Exercise persistence through the actual adapter, without touching customer DBs.
function database() {
  const calls = [];
  let rows = new Map(), leases = new Map(), snapshot;
  const query = async (sql, values = []) => {
    calls.push(sql);
    const [branch, key, value] = values;
    if (sql.startsWith('CREATE')) return { rows: [] };
    if (sql.includes('whatsapp_auth_leases')) {
      if (sql.startsWith('INSERT')) {
        if (leases.has(branch)) return { rows: [] };
        leases.set(branch, key); return { rows: [{ owner: key }] };
      }
      if (sql.startsWith('UPDATE')) return { rows: leases.get(branch) === key ? [{ owner: key }] : [] };
      if (sql.startsWith('DELETE')) { if (leases.get(branch) === key) leases.delete(branch); return {}; }
      if (sql.startsWith('SELECT')) return { rows: leases.has(branch) ? [{ seconds: 12 }] : [] };
    }
    if (sql === 'BEGIN') { snapshot = new Map(rows); return {}; }
    if (sql === 'COMMIT') { snapshot = null; return {}; }
    if (sql === 'ROLLBACK') { rows = snapshot; snapshot = null; return {}; }
    if (sql.startsWith('INSERT')) {
      if (Array.isArray(key)) key.forEach((item, index) => rows.set(`${branch}:${item}`, { key: item, value: value[index] }));
      else rows.set(`${branch}:${key}`, { key, value });
      return {};
    }
    if (sql.startsWith('DELETE')) {
      for (const k of rows.keys()) if (k.startsWith(`${branch}:`) && (key === undefined || (Array.isArray(key) ? key.some(item => k === `${branch}:${item}`) : k === `${branch}:${key}`))) rows.delete(k);
      return {};
    }
    if (sql.startsWith('SELECT')) return { rows: [...rows.entries()].filter(([k, row]) =>
      k.startsWith(`${branch}:`) && (!sql.includes("key = 'creds.json'") || row.key === 'creds.json') &&
      (!Array.isArray(key) || key.includes(row.key))).map(([, row]) => row) };
    throw Error(sql);
  };
  return { query, calls, connect: async () => {
    const client = new EventEmitter();
    client.query = query;
    client.release = () => {};
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
  await assert.rejects(openAuthStore(pool, 1, dir, baileys, () => {}), { code: 'WA_SESSION_BUSY', retryAfterMs: 12000 });
  await first.close();
  const second = await openAuthStore(pool, 1, dir, baileys, () => {}); await second.close();
});

test('812 initial pairing keys use one batch write and no per-key database reads', async () => {
  const pool = database();
  const store = await openAuthStore(pool, 1, path.join(os.tmpdir(), 'nonexistent-wa-auth-dir'), baileys, () => {});
  pool.calls.length = 0;
  const keys = Object.fromEntries(Array.from({ length: 812 }, (_, id) => [String(id), { public: Buffer.from([id % 256]) }]));
  await store.state.keys.set({ 'pre-key': keys });
  assert.equal(pool.calls.filter(sql => sql.startsWith('INSERT INTO whatsapp_auth_state')).length, 1);
  const beforeReads = pool.calls.length;
  const restored = await store.state.keys.get('pre-key', Object.keys(keys));
  assert.equal(Object.keys(restored).length, 812);
  assert.equal(pool.calls.length, beforeReads);
  await store.close();
});
