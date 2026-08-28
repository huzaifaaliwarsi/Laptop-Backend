const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.IO
initSocket(server, process.env.CORS_ORIGIN || 'http://localhost:3000');

// Initialize Baileys WhatsApp Multi-Device connection
const baileysService = require('./modules/whatsapp/baileys.service');
baileysService.initWhatsApp().catch(err => console.error('[Baileys] WhatsApp initialization error:', err));

server.listen(PORT, () => {
  console.log(`[Express API Server] Running on http://localhost:${PORT}`);
});

