const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.IO
initSocket(server, process.env.CORS_ORIGIN || 'http://localhost:3000');

// Initialize Baileys WhatsApp Multi-Device connection (only if active session already exists)
const baileysService = require('./modules/whatsapp/baileys.service');
let startupRetry;
let stopping = false;
async function restoreWhatsApp() {
  try {
    await baileysService.initWhatsAppIfSessionExists();
  } catch (err) {
    console.error('[Baileys] Session recovery failed; retrying in 10s:', err.message);
    if (!stopping) startupRetry = setTimeout(restoreWhatsApp, 10000);
  }
}
restoreWhatsApp();

server.listen(PORT, () => {
  console.log(`[Express API Server] Running on http://localhost:${PORT}`);
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(startupRetry);
  server.close();
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  try {
    await baileysService.shutdown();
    process.exit(0);
  } catch (error) {
    console.error('[Baileys] Shutdown failed:', error.message);
    process.exit(1);
  }
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

