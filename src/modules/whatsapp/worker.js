// This process runs as a Vercel Daemon, never as an HTTP function.
process.env.WHATSAPP_WORKER = '1';
const service = require('./baileys.service');
const store = require('./worker-store');
const manager = require('../../config/branchManager');
const workerId = require('node:crypto').randomUUID();
let stopping = false;
let publishing = Promise.resolve();

service.publishWorkerStatus = (branchId, status) => {
  publishing = publishing.then(() => store.saveStatus(branchId, status, workerId))
    .catch(error => console.error('[WhatsApp worker] Status save failed:', error.message));
};

async function execute(command) {
  const { branch_id: branchId, action, payload } = command;
  const branch = await manager.getBranchById(branchId);
  if (!branch || branch.status === 'Inactive') throw new Error('Branch is unavailable');
  switch (action) {
    case 'connect': return service.waitForQrOrStatus(branchId, 15000);
    case 'disconnect': return service.disconnect(branchId);
    case 'text': {
      const result = await service.sendTextMessage(branchId, payload.phone, payload.text);
      return { success: true, messageId: result?.key?.id || null };
    }
    case 'document': {
      const result = await service.sendDocumentMessage(branchId, payload.phone, Buffer.from(payload.document, 'base64'), payload.fileName, payload.caption || '');
      return { success: true, messageId: result?.key?.id || null };
    }
    default: throw new Error('Unsupported WhatsApp action');
  }
}

async function main() {
  await store.ensureSchema();
  while (!stopping && !(await store.acquireWorker(workerId))) await store.sleep(2000);
  if (stopping) return;
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      if (!(await store.renewWorker(workerId))) throw new Error('Worker ownership expired');
      for (const [id] of service.sessions) service.publishWorkerStatus(id, service.getStatus(id));
    } catch (error) {
      console.error('[WhatsApp worker] Lease lost:', error.message);
      stopping = true;
      await service.shutdown();
    } finally { renewing = false; }
  }, 5000);
  let nextCleanup = Date.now() + 60000;
  try {
    await service.initWhatsAppIfSessionExists();
    while (!stopping) {
      try {
        const command = await store.claim();
        if (command) {
          try { await store.finish(command.id, await execute(command)); }
          catch (error) { await store.finish(command.id, null, error); }
        } else await store.sleep(500);
        if (Date.now() > nextCleanup) { await store.cleanup(); nextCleanup = Date.now() + 60000; }
      } catch (error) {
        console.error('[WhatsApp worker] Queue error:', error.message);
        await store.sleep(2000);
      }
    }
  } finally {
    clearInterval(heartbeat);
    await service.shutdown();
    for (const [id] of service.sessions) service.publishWorkerStatus(id, service.getStatus(id));
    await publishing;
    await store.releaseWorker(workerId);
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  stopping = true;
  setTimeout(() => process.exit(1), 55000).unref();
});
if (require.main === module) main().then(() => process.exit(0)).catch(error => {
  console.error('[WhatsApp worker] Startup failed:', error.message); process.exit(1);
});
module.exports = { execute };
