const fs = require('fs');
const path = require('path');

// 1. MUST load dotenv before ANY app/db modules are imported
const envCandidates = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env.cpanel'),
  path.join(__dirname, '..', '.env.cpanel'),
  '/home/isywouhn/api.saadcomm.isywarecloud.com/.env',
  '/home/isywouhn/api.saadcomm.isywarecloud.com/.env.cpanel'
];
for (const p of envCandidates) {
  try {
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p });
    }
  } catch (_) { }
}
require('dotenv').config();

const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');

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
require('./config/db').ready.then(() => {
  restoreWhatsApp();

  server.listen(PORT, () => console.log('[Express API Server] Listening on port ' + PORT));
}).catch(error => {
  console.warn('[Startup] Database startup check note:', error.message);
  restoreWhatsApp();
  server.listen(PORT, () => console.log('[Express API Server] Listening on port ' + PORT));
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
