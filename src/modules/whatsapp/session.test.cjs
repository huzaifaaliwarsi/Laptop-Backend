const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(versionGate = null, versionResult = null) {
  const sockets = [], timers = new Map();
  let deleted = 0, closed = 0, opened = 0, saved = 0;
  const creds = { registered: true, me: { id: '923001234567:1@s.whatsapp.net' } };
  const auth = { state: { creds, keys: {} }, saveCreds: async () => { saved++; },
    flush: async () => {}, clear: async () => { deleted++; creds.registered = false; delete creds.me; },
    close: async () => { closed++; } };
  const b = {
    default: options => {
      assert.deepEqual(Array.from(options.version), [2, 3000, 1]);
      const sock = { ev: new EventEmitter(), user: creds.me, end() {}, logout: async () => {} };
      sockets.push(sock); return sock;
    },
    DisconnectReason: { loggedOut: 401, restartRequired: 515, connectionReplaced: 440, badSession: 500, forbidden: 403, multideviceMismatch: 411 },
    makeCacheableSignalKeyStore: keys => keys, Browsers: { windows: () => [] },
    fetchLatestWaWebVersion: async () => { if (versionGate) await versionGate; return versionResult || { version: [2, 3000, 1], isLatest: true }; }
  };
  const manager = { getBranchPool: async () => ({ query: async () => ({ rows: [] }) }), listBranches: async () => [{ id: 1 }] };
  const requires = {
    qrcode: { toDataURL: async () => 'data:qr' }, pino: () => ({}), path: require('node:path'),
    fs: { existsSync: () => false }, './auth-store': { openAuthStore: async () => { opened++; return auth; }, hasSavedSession: async () => true },
    '../../config/db': {}, '../../config/socket': { emitEvent() {}, getIO: () => null },
    '../../utils/codeGenerator': {}, './whatsapp.templates': {}, '../repairs/repairs.service': {},
    '../../config/branchManager': manager
  };
  const context = { require: name => { if (!(name in requires)) throw Error(name); return requires[name]; },
    module: { exports: {} }, __dirname, process: { env: {}, stdout: { write() {} } }, console: { log() {}, error() {}, warn() {} },
    setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval, clearInterval, AbortSignal, baileys: b };
  const source = fs.readFileSync(require.resolve('./baileys.service'), 'utf8').replace("await import('@whiskeysockets/baileys')", 'baileys');
  vm.runInNewContext(source, context);
  return { service: context.module.exports, sockets, timers, creds,
    counts: () => ({ deleted, closed, opened, saved }),
    async update(update) { sockets.at(-1).ev.emit('connection.update', update); await tick(); },
    async retry() { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); await tick(); } };
}

test('blocked version fetch reports backend access failure and retries without touching credentials', async () => {
  const result = { version: [2, 3000, 1], isLatest: false, error: { message: 'fetch failed', cause: { code: 'EACCES' } } };
  const f = fixture(null, result);
  await f.service.initWhatsApp(1);
  assert.match(f.service.getStatus(1).error, /backend internet\/firewall/);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.counts().opened, 0);
  assert.equal(f.counts().deleted, 0);
  assert.equal(f.timers.size, 1);
  result.isLatest = true; delete result.error;
  await f.retry(); await f.update({ qr: 'live-qr' });
  assert.equal(f.service.getStatus(1).qr, 'data:qr');
  assert.equal(f.service.getStatus(1).error, null);
});

test('parallel connect requests create one socket without clearing credentials', async () => {
  const f = fixture(); await Promise.all([f.service.initWhatsApp(1), f.service.initWhatsApp(1, true)]);
  assert.equal(f.sockets.length, 1); assert.equal(f.counts().deleted, 0);
});
test('network drop restores saved login and ignores stale socket events', async () => {
  const f = fixture(); await f.service.initWhatsApp(1); await f.update({ connection: 'open' });
  const stale = f.sockets[0].ev.listeners('connection.update')[0];
  await f.update({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  assert.equal(f.service.getStatus(1).reconnecting, true); assert.equal(f.counts().deleted, 0);
  await f.retry(); await f.update({ connection: 'open' });
  stale({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); await tick();
  assert.equal(f.service.getStatus(1).connected, true); assert.equal(f.counts().deleted, 0);
});
test('515 after QR scan creates replacement socket without deleting login', async () => {
  const f = fixture(); await f.service.initWhatsApp(1);
  await f.update({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  assert.equal(f.service.getStatus(1).linking, true); await f.retry();
  assert.equal(f.sockets.length, 2); assert.equal(f.counts().deleted, 0);
  assert.equal(f.counts().opened, 1, 'pairing restart must reuse database ownership');
  assert.equal(f.counts().closed, 0, 'pairing restart must not release its lease');
});
test('explicit logout cancels pending reconnect and clears saved credentials', async () => {
  const f = fixture(); await f.service.initWhatsApp(1);
  await f.update({ connection: 'close' }); assert.equal(f.timers.size, 1);
  await f.service.disconnect(1);
  assert.equal(f.timers.size, 0); assert.equal(f.counts().deleted, 1); assert.equal(f.service.getStatus(1).authenticated, false);
});
test('revoked credentials stop retry and request relinking', async () => {
  const f = fixture(); await f.service.initWhatsApp(1);
  await f.update({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(f.timers.size, 0); assert.equal(f.counts().deleted, 1); assert.equal(f.service.getStatus(1).requiresRelink, true);
});
test('connection replaced does not erase credentials or fight the other connection', async () => {
  const f = fixture(); await f.service.initWhatsApp(1);
  await f.update({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } } });
  assert.equal(f.timers.size, 0); assert.equal(f.counts().deleted, 0);
});

test('shutdown flushes auth without logout and stops reconnect timers', async () => {
  const f = fixture(); await f.service.initWhatsApp(1); await f.update({ connection: 'open' });
  await f.service.shutdown();
  assert.equal(f.counts().deleted, 0); assert.equal(f.counts().closed, 1);
  assert.equal(f.timers.size, 0); assert.equal(f.service.getStatus(1).connected, false);
});
test('logout while initialization is in progress cannot resurrect the socket', async () => {
  const f = fixture(); const initializing = f.service.initWhatsApp(1);
  await f.service.disconnect(1); await initializing;
  assert.equal(f.service.getStatus(1).connected, false);
  assert.equal(f.counts().deleted, 1); assert.equal(f.timers.size, 0);
});

test('first QR socket waits for current Web version instead of using stale fallback', async () => {
  let resolveVersion;
  const gate = new Promise(resolve => { resolveVersion = resolve; });
  const f = fixture(gate);
  const initializing = f.service.initWhatsApp(1);
  await tick(); assert.equal(f.sockets.length, 0);
  resolveVersion(); await initializing;
  assert.equal(f.sockets.length, 1);
  await f.update({ qr: 'live-qr' });
  assert.equal(f.service.getStatus(1).qr, 'data:qr');
});
test('428 before QR retries unregistered credentials without erasing them', async () => {
  const f = fixture(); f.creds.registered = false; delete f.creds.me;
  await f.service.initWhatsApp(1);
  await f.update({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 } } } });
  assert.equal(f.timers.size, 1); await f.retry();
  await f.update({ qr: 'live-qr' });
  assert.equal(f.service.getStatus(1).qr, 'data:qr'); assert.equal(f.counts().deleted, 0);
});
