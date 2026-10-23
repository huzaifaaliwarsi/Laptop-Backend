const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Explicit opt-in. All tables are TEMP tables in one rolled-back transaction;
// no customer data, WhatsApp credentials, messages, or production schema change.
test('Vercel worker SQL: ownership, branch status, command claim, completion and expiry',
  { skip: process.env.RUN_WA_DB_TESTS !== '1' }, async () => {
    const manager = require('../../config/branchManager');
    const client = await manager.masterPool.connect();
    await client.query('BEGIN');
    try {
      const pool = { query: (sql, args) => client.query(sql.replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS'), args) };
      const context = {
        require: name => name === '../../config/branchManager' ? { masterPool: pool } : require(name),
        module: { exports: {} }, process: { env: {} }, setTimeout
      };
      vm.runInNewContext(fs.readFileSync(require.resolve('./worker-store'), 'utf8'), context);
      const store = context.module.exports;
      await store.ensureSchema();
      assert.equal(await store.acquireWorker('worker-a'), true);
      assert.equal(await store.acquireWorker('worker-b'), false);
      assert.equal(await store.renewWorker('worker-b'), false);
      await store.saveStatus(1, { branchId: 1, connected: true, updatedAt: 10 }, 'worker-a');
      assert.equal((await store.getStatus(1)).connected, true);
      assert.equal((await store.getStatus(2)).connected, false);
      await store.saveStatus(1, { branchId: 1, connected: false, updatedAt: 20 }, 'worker-b');
      assert.equal((await store.getStatus(1)).connected, true, 'non-owner cannot publish');
      const id = require('node:crypto').randomUUID();
      await pool.query('INSERT INTO whatsapp_worker_commands(id,branch_id,action,payload) VALUES($1,1,$2,$3)', [id, 'text', '{"text":"test-only"}']);
      const command = await store.claim();
      assert.equal(command.id, id);
      assert.equal(await store.claim(), undefined, 'claimed sends are never automatically replayed');
      await store.finish(id, { success: true });
      const completed = (await pool.query('SELECT state,payload,result FROM whatsapp_worker_commands WHERE id=$1', [id])).rows[0];
      assert.equal(completed.state, 'done'); assert.deepEqual(completed.payload, {});
      await pool.query("UPDATE whatsapp_worker_commands SET state='pending',expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [id]);
      assert.equal(await store.claim(), undefined);
      assert.equal((await pool.query('SELECT state FROM whatsapp_worker_commands WHERE id=$1', [id])).rows[0].state, 'failed');
      await store.releaseWorker('worker-a');
      assert.equal((await store.getStatus(1)).connected, false, 'dead worker cannot report connected');
      assert.equal(await store.acquireWorker('worker-b'), true);
    } finally {
      await client.query('ROLLBACK');
      client.release(true);
      await manager.masterPool.end();
    }
  });
