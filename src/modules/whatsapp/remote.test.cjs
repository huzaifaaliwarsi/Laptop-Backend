const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Vercel facade routes branch-scoped QR, text, document and logout commands', async () => {
  const calls = [];
  const store = { request: async (...args) => { calls.push(args); return { success: true }; }, getStatus: async id => ({ branchId: id, connected: id === 7 }) };
  const context = { module: { exports: {} }, Buffer,
    require: name => name === './worker-store' ? store : { getBranchStore: () => ({ branchId: 7 }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('./remote.service'), 'utf8'), context);
  const remote = context.module.exports;
  assert.equal(await remote.isCurrentBranchConnected(), true);
  assert.equal(await remote.isBranchConnected(8), false);
  await remote.waitForQrOrStatus(7);
  await remote.sendTextMessage('03000000000', 'test');
  await remote.sendTextMessage(8, '03000000000', 'test');
  await remote.sendDocumentMessage(7, '03000000000', Buffer.from('test-pdf'), 'invoice.pdf', 'test');
  await remote.disconnect(7);
  assert.deepEqual(calls.map(call => [call[0], call[1]]), [[7, 'connect'], [7, 'text'], [8, 'text'], [7, 'document'], [7, 'disconnect']]);
  assert.equal(Buffer.from(calls[3][2].document, 'base64').toString(), 'test-pdf');
});
