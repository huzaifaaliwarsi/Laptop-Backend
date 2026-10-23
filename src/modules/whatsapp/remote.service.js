const store = require('./worker-store');
function currentBranch() {
  return require('../../middleware/branchContext').getBranchStore()?.branchId || 1;
}
module.exports = {
  getStatus: (branchId = currentBranch()) => store.getStatus(branchId),
  isBranchConnected: async branchId => (await store.getStatus(branchId)).connected,
  isCurrentBranchConnected: async () => (await store.getStatus(currentBranch())).connected,
  waitForQrOrStatus: (branchId = currentBranch()) => store.request(branchId, 'connect'),
  disconnect: (branchId = currentBranch()) => store.request(branchId, 'disconnect'),
  sendTextMessage: (arg1, arg2, arg3 = null) => store.request(arg3 === null ? currentBranch() : arg1, 'text', {
    phone: arg3 === null ? arg1 : arg2, text: arg3 === null ? arg2 : arg3
  }),
  sendDocumentMessage: (branchId, phone, buffer, fileName, caption) => {
    if (!Buffer.isBuffer(buffer) || buffer.length > 20 * 1024 * 1024) throw new Error('WhatsApp document must be a buffer up to 20 MB');
    return store.request(branchId, 'document', { phone, document: buffer.toString('base64'), fileName, caption });
  },
  // Branch deletion must stop the worker before removing its auth state.
  clearAuthSession: branchId => store.request(branchId, 'disconnect'),
  initWhatsAppIfSessionExists: async () => {},
  shutdown: async () => {}
};
