const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const db = require('../../config/db');
const { emitEvent } = require('../../config/socket');
const { getNextEntityId } = require('../../utils/codeGenerator');

// Silence internal libsignal-node noisy debug outputs
const origStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  if (typeof chunk === 'string' && chunk.includes('Closing session: SessionEntry')) {
    if (typeof callback === 'function') callback();
    return true;
  }
  return origStdout(chunk, encoding, callback);
};

// Baileys is an ESM module; dynamically load it on demand
let baileysModule = null;
async function getBaileys() {
  if (!baileysModule) {
    baileysModule = await import('@whiskeysockets/baileys');
  }
  return baileysModule;
}

function getAuthDir(branchId = 1) {
  const bId = parseInt(branchId, 10) || 1;
  const base = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
    ? path.join('/tmp', 'whatsapp_auth_session')
    : (process.env.WHATSAPP_AUTH_DIR || path.join(__dirname, '../../../.whatsapp_session'));
  return path.join(base, `branch_${bId}`);
}

const {
  buildTrackingResponseTemplate,
  buildApprovalConfirmationTemplate,
  buildDeclineConfirmationTemplate,
  buildAdditionalWorkApprovedTemplate,
  buildAdditionalWorkDeclinedTemplate
} = require('./whatsapp.templates');
const RepairService = require('../repairs/repairs.service');

class BranchSession {
  constructor(branchId) {
    this.branchId = parseInt(branchId, 10) || 1;
    this.sock = null;
    this.qrCodeDataUrl = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.connectedUser = null;
  }
}

class BaileysService {
  constructor() {
    this.sessions = new Map();
    this.logger = pino({ level: 'silent' });
  }

  getSession(branchId = 1) {
    const bId = parseInt(branchId, 10) || 1;
    if (!this.sessions.has(bId)) {
      this.sessions.set(bId, new BranchSession(bId));
    }
    return this.sessions.get(bId);
  }

  isBranchConnected(branchId = 1) {
    const session = this.getSession(branchId);
    return Boolean(session && session.isConnected);
  }

  get isConnected() {
    try {
      const { branchStorage } = require('../../middleware/branchContext');
      const store = branchStorage.getStore();
      const bId = (store && store.branchId) ? store.branchId : 1;
      return this.isBranchConnected(bId);
    } catch (e) {
      return this.isBranchConnected(1);
    }
  }

  formatPhoneJid(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/[^0-9]/g, '');
    if (clean.startsWith('0092')) {
      clean = clean.slice(2);
    } else if (clean.startsWith('03')) {
      clean = '92' + clean.slice(1);
    } else if (clean.length === 10 && clean.startsWith('3')) {
      clean = '92' + clean;
    }
    if (!clean) return null;
    return `${clean}@s.whatsapp.net`;
  }

  hasSavedSession(branchId = 1) {
    try {
      const authDir = getAuthDir(branchId);
      const credsPath = path.join(authDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const raw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(raw);
      return Boolean(creds && (creds.me?.id || creds.registered === true));
    } catch (e) {
      return false;
    }
  }

  async initWhatsAppIfSessionExists(targetBranchId = null) {
    if (targetBranchId) {
      const bId = parseInt(targetBranchId, 10);
      if (this.hasSavedSession(bId)) {
        console.log(`[Baileys] Active WhatsApp session found for Branch ${bId}. Connecting...`);
        return this.initWhatsApp(bId, false);
      }
      return;
    }

    try {
      const branchManager = require('../../config/branchManager');
      const branches = await branchManager.listBranches();
      for (const b of branches) {
        if (this.hasSavedSession(b.id)) {
          console.log(`[Baileys] Active WhatsApp session found for Branch ${b.id} (${b.branch_name}). Connecting...`);
          await this.initWhatsApp(b.id, false);
        } else {
          console.log(`[Baileys] No active WhatsApp session for Branch ${b.id} (${b.branch_name}). Idle.`);
        }
      }
    } catch (e) {
      if (this.hasSavedSession(1)) {
        await this.initWhatsApp(1, false);
      }
    }
  }

  async initWhatsApp(branchId = 1, forceNew = false) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);

    if (session.isConnecting && !forceNew) return;
    if (session.isConnected && !forceNew) return;

    if (forceNew) {
      if (session.sock) {
        try {
          session.sock.ev?.removeAllListeners?.();
          session.sock.end?.();
          session.sock = null;
        } catch (e) {}
      }
      this.clearAuthSession(bId);
    }

    session.isConnecting = true;
    this.emitStatus(bId);

    const authDir = getAuthDir(bId);
    try {
      const baileys = await getBaileys();
      const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
      const {
        DisconnectReason,
        useMultiFileAuthState,
        fetchLatestBaileysVersion,
        fetchLatestWaWebVersion,
        makeCacheableSignalKeyStore,
        Browsers
      } = baileys;

      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      await saveCreds().catch(() => {});

      let version = [2, 3000, 1046914108];
      try {
        const vData = await (fetchLatestWaWebVersion ? fetchLatestWaWebVersion() : fetchLatestBaileysVersion());
        if (vData && vData.version) version = vData.version;
      } catch (e) {}

      session.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 250,
        getMessage: async () => ({ conversation: '' })
      });

      session.sock.ev.on('creds.update', saveCreds);

      session.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const isInitial = !session.qrCodeDataUrl;
            session.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
            session.isConnected = false;
            session.isConnecting = false;
            this.emitStatus(bId);
            if (isInitial) {
              console.log(`[Baileys] Live WhatsApp QR Code ready for Branch ${bId}! Scan with mobile device.`);
            }
          } catch (err) {
            console.error(`[Baileys] Error generating QR data URL for branch ${bId}:`, err);
          }
        }

        if (connection === 'connecting') {
          session.isConnecting = true;
          this.emitStatus(bId);
        }

        if (connection === 'open') {
          session.isConnected = true;
          session.isConnecting = false;
          session.qrCodeDataUrl = null;
          session.connectedUser = session.sock.user;
          console.log(`[Baileys] WhatsApp Multi-Device connection established for Branch ${bId}:`, session.sock.user);

          const phone = session.sock.user?.id ? session.sock.user.id.split(':')[0].split('@')[0] : '';

          try {
            const branchManager = require('../../config/branchManager');
            const pool = await branchManager.getBranchPool(bId);
            await pool.query(
              `UPDATE whatsapp_settings SET connected = TRUE, is_connected = TRUE, number = COALESCE(NULLIF(number, ''), $1), updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
              [phone]
            );
          } catch (dbErr) {
            console.error(`[Baileys] DB update settings error for branch ${bId}:`, dbErr.message);
          }

          this.emitStatus(bId);
        }

        if (connection === 'close') {
          session.isConnected = false;
          session.isConnecting = false;
          session.qrCodeDataUrl = null;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired;

          console.log(`[Baileys] Branch ${bId} WhatsApp connection closed (Code: ${statusCode})`);

          try {
            const branchManager = require('../../config/branchManager');
            const pool = await branchManager.getBranchPool(bId);
            await pool.query(`UPDATE whatsapp_settings SET connected = FALSE, is_connected = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = 1`);
          } catch (e) {}

          this.emitStatus(bId);

          // 1. Logged out explicitly -> clear auth and stop
          if (isLoggedOut) {
            console.log(`[Baileys] Branch ${bId} session logged out. Cleaning auth files...`);
            this.clearAuthSession(bId);
            this.emitStatus(bId);
            return;
          }

          // 2. Restart required immediately after QR scan to establish Multi-Device session (Code 515)
          if (isRestartRequired) {
            console.log(`[Baileys] Branch ${bId} restart required after QR scan. Finalizing connection...`);
            setTimeout(() => this.initWhatsApp(bId, false), 1200);
            return;
          }

          // 3. Auto-reconnect ONLY if we had an already authenticated/registered session
          if (this.hasSavedSession(bId)) {
            console.log(`[Baileys] Temporary connection drop for Branch ${bId}. Reconnecting in 5s...`);
            setTimeout(() => {
              if (this.hasSavedSession(bId)) {
                this.initWhatsApp(bId, false);
              }
            }, 5000);
            return;
          }

          // 4. If we were waiting for QR scan and it timed out / connection closed:
          console.log(`[Baileys] Branch ${bId} QR session expired. Idle until user clicks "Generate QR Code".`);
          this.clearAuthSession(bId);
          if (session.sock) {
            try {
              session.sock.ev?.removeAllListeners?.();
              session.sock = null;
            } catch (e) {}
          }
          this.emitStatus(bId);
        }
      });

      // Handle Incoming Messages for this specific branch
      session.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
          if (!msg.message) continue;

          const senderJid = msg.key.remoteJid;
          if (!senderJid || senderJid.endsWith('@g.us') || senderJid.endsWith('@broadcast')) continue;

          // Check if user is messaging from their own phone to test
          const myPhone = session.connectedUser?.id ? session.connectedUser.id.split(':')[0].split('@')[0] : null;
          const isSelfChat = myPhone && senderJid.includes(myPhone);

          // If fromMe: only allow if it's a self-test chat, otherwise ignore outgoing messages
          if (msg.key.fromMe) {
            if (!isSelfChat) continue;

            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            // Prevent infinite loop if this text was sent by bot itself
            if (session.lastBotReply && (session.lastBotReply === text || session.lastBotReply.includes(text.slice(0, 30)))) {
              continue;
            }
          }

          await this.handleIncomingMessage(bId, msg);
        }
      });

    } catch (error) {
      session.isConnecting = false;
      session.isConnected = false;
      this.emitStatus(bId);
      console.error(`[Baileys] Branch ${bId} WhatsApp initialization error:`, error);
    }
  }

  async handleIncomingMessage(arg1, arg2 = null) {
    try {
      const branchId = arg2 !== null ? (parseInt(arg1, 10) || 1) : 1;
      const msg = arg2 !== null ? arg2 : arg1;
      if (!msg || !msg.key) return;

      const senderJid = msg.key.remoteJid;
      if (!senderJid || senderJid.endsWith('@g.us') || senderJid.endsWith('@broadcast')) return; // Ignore groups/broadcasts

      const rawText = msg.message?.conversation ||
                      msg.message?.extendedTextMessage?.text ||
                      msg.message?.imageMessage?.caption ||
                      msg.message?.buttonsResponseMessage?.selectedButtonId ||
                      msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                      msg.message?.templateButtonReplyMessage?.selectedId || '';
      const text = rawText.trim();
      if (!text) return;

      // Extract clean phone number (strip :device suffix)
      let cleanPhone = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      if (senderJid.endsWith('@lid') && msg.key.participant) {
        cleanPhone = msg.key.participant.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      }

      console.log(`[Baileys] 📩 Received WhatsApp message from ${cleanPhone || senderJid}: "${text}"`);

      // Determine reply target JID
      let replyJid = senderJid;
      if (!senderJid.endsWith('@lid') && cleanPhone) {
        replyJid = `${cleanPhone}@s.whatsapp.net`;
      }

      const branchManager = require('../../config/branchManager');
      const { branchStorage } = require('../../middleware/branchContext');
      const pool = await branchManager.getBranchPool(branchId);

      await branchStorage.run({ branchId, pool }, async () => {
        // 1. Check whatsapp_settings
        const sRes = await pool.query('SELECT * FROM whatsapp_settings WHERE id = 1');
        const settings = sRes.rows[0] || {};
        if (settings.bot_enabled === false) {
          console.log('[Baileys] WhatsApp bot is disabled in settings. Skipping automated reply.');
          return;
        }

        // 2. Find or create conversation in whatsapp_conversations
        let conv = null;
        const convRes = await pool.query(
          'SELECT * FROM whatsapp_conversations WHERE contact = $1 OR contact LIKE $2 ORDER BY updated_at DESC LIMIT 1',
          [cleanPhone, `%${cleanPhone.slice(-10)}%`]
        );

        if (convRes.rows.length > 0) {
          conv = convRes.rows[0];
        } else {
          const convId = await getNextEntityId('whatsapp_conversations', 'id', 'CONV', 4, pool);
          const insRes = await pool.query(
            `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
             VALUES ($1, $2, $3, 'Bot Active', 'General') RETURNING *`,
            [convId, cleanPhone || 'WhatsApp User', msg.pushName || 'WhatsApp Customer']
          );
          conv = insRes.rows[0];
        }

        // 3. Log incoming customer message in CRM
        await pool.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'in', $2, 'customer')`,
          [conv.id, text]
        );
        await pool.query(
          `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [text, conv.id]
        );
        emitEvent('whatsapp.message_added', { conversationId: conv.id, text, direction: 'in' });
        emitEvent('whatsapp.conversation_updated', { conversationId: conv.id });

        // 4. If conversation was handed off to a human agent, do not auto-reply
        if (conv.status === 'Human Handoff' && text !== '1' && text !== '2' && text !== '3' && text !== '4' && text !== '5' && text.toLowerCase() !== 'menu') {
          console.log(`[Baileys] Conversation ${conv.id} is in Human Handoff mode. Message logged in CRM for staff.`);
          return;
        }

        // 5. Generate intelligent bot response via unified processBotReply
        const whatsappRoutes = require('./whatsapp.routes');
        let replyText = null;
        if (typeof whatsappRoutes.processBotReply === 'function') {
          replyText = await whatsappRoutes.processBotReply(text, conv, pool);
        }

        if (!replyText) {
          replyText = settings.welcome_message || 
            `👋 Welcome to *${settings.business_name || 'Retail & Repair Management'}*!\n\n` +
            `How can we help you today? Please reply with a number:\n\n` +
            `1️⃣ *Buy Laptop* (Browse Inventory)\n` +
            `2️⃣ *Repair Service* (Book a Repair)\n` +
            `3️⃣ *Track Repair* (Live Status of your Laptop)\n` +
            `4️⃣ *Get Quotation* (Find by Budget)\n` +
            `5️⃣ *Shop Location & Hours*\n` +
            `6️⃣ *Talk to Human Agent*`;
        }

        // 6. Record bot reply text to avoid self-echo and send live via WhatsApp
        const session = this.getSession(branchId);
        session.lastBotReply = replyText.trim();

        await this.sendRawMessage(replyJid, replyText, branchId);
        console.log(`[Baileys] 🤖 Successfully sent automated reply to ${replyJid}: "${replyText.slice(0, 40)}..."`);

        // 7. Log outgoing bot message in CRM
        await pool.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, 'bot')`,
          [conv.id, replyText]
        );
        await pool.query(
          `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [replyText, conv.id]
        );
        emitEvent('whatsapp.message_added', { conversationId: conv.id, text: replyText, direction: 'out' });
        emitEvent('whatsapp.conversation_updated', { conversationId: conv.id });
      });
    } catch (err) {
      console.error('[Baileys] Error handling incoming WhatsApp message:', err);
    }
  }

  async sendRawMessage(jid, text, branchId = 1) {
    const session = this.getSession(branchId);
    if (!session.sock || !session.isConnected) {
      throw new Error(`WhatsApp is not connected for Branch ${branchId}. Please scan the QR code first.`);
    }

    let targetJid = jid;
    if (targetJid && !targetJid.includes('@g.us') && !targetJid.includes('@lid')) {
      const clean = targetJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      if (clean) {
        targetJid = `${clean}@s.whatsapp.net`;
      }
    }

    return await session.sock.sendMessage(targetJid, { text });
  }

  async sendTextMessage(arg1, arg2, arg3 = null) {
    let branchId = 1;
    let phone = null;
    let text = null;

    if (arg3 !== null) {
      branchId = parseInt(arg1, 10) || 1;
      phone = arg2;
      text = arg3;
    } else {
      phone = arg1;
      text = arg2;
      try {
        const { branchStorage } = require('../../middleware/branchContext');
        const store = branchStorage.getStore();
        if (store && store.branchId) {
          branchId = parseInt(store.branchId, 10) || 1;
        }
      } catch (e) {}
    }

    const session = this.getSession(branchId);
    if (!session.sock || !session.isConnected) {
      throw new Error(`WhatsApp is not connected for Branch ${branchId}. Please scan QR code in Branch ${branchId} settings first.`);
    }

    const jid = this.formatPhoneJid(phone);
    if (!jid) throw new Error(`Invalid phone number: "${phone}"`);
    return await session.sock.sendMessage(jid, { text });
  }

  /**
   * Send PDF or document attachment with optional caption via Baileys WhatsApp
   */
  async sendDocumentMessage(arg1, arg2, arg3 = null, arg4 = '', arg5 = null) {
    let branchId = 1;
    let phone = null;
    let documentBuffer = null;
    let fileName = 'Document.pdf';
    let caption = '';

    if (arg5 !== null) {
      // (branchId, phone, documentBuffer, fileName, caption)
      branchId = parseInt(arg1, 10) || 1;
      phone = arg2;
      documentBuffer = arg3;
      fileName = arg4 || 'Invoice.pdf';
      caption = arg5 || '';
    } else {
      // (phone, documentBuffer, fileName, caption, branchIdOpt)
      phone = arg1;
      documentBuffer = arg2;
      fileName = arg3 || 'Invoice.pdf';
      caption = arg4 || '';
      try {
        const { branchStorage } = require('../../middleware/branchContext');
        const store = branchStorage.getStore();
        if (store && store.branchId) {
          branchId = parseInt(store.branchId, 10) || 1;
        }
      } catch (e) {}
    }

    const session = this.getSession(branchId);
    if (!session.sock || !session.isConnected) {
      throw new Error(`WhatsApp is not connected for Branch ${branchId}. Please scan QR code first.`);
    }

    const jid = this.formatPhoneJid(phone);
    if (!jid) throw new Error(`Invalid phone number: "${phone}"`);

    return await session.sock.sendMessage(jid, {
      document: documentBuffer,
      mimetype: 'application/pdf',
      fileName: fileName,
      caption: caption || undefined
    });
  }

  getStatus(branchId = 1) {
    const session = this.getSession(branchId);
    const phone = session.connectedUser?.id ? session.connectedUser.id.split(':')[0].split('@')[0] : null;
    return {
      branchId: session.branchId,
      connected: session.isConnected,
      connecting: session.isConnecting,
      qr: session.qrCodeDataUrl,
      phone: phone,
      name: session.connectedUser?.name || 'Connected WhatsApp Multi-Device',
      authenticated: session.isConnected
    };
  }

  emitStatus(branchId = 1) {
    const bId = parseInt(branchId, 10) || 1;
    const status = this.getStatus(bId);
    try {
      const { getIO } = require('../../config/socket');
      const io = getIO();
      if (io) {
        io.to(`branch_${bId}`).emit('whatsapp:status', status);
        io.emit('whatsapp:status', status);
        if (status.qr) {
          io.to(`branch_${bId}`).emit('whatsapp:qr', { qr: status.qr, branchId: bId });
          io.emit('whatsapp:qr', { qr: status.qr, branchId: bId });
        }
      }
    } catch (e) {}
    emitEvent('whatsapp:status', status);
  }

  async waitForQrOrStatus(branchId = 1, timeoutMs = 15000) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);
    if (session.isConnected) return this.getStatus(bId);
    if (!session.sock || !session.isConnecting) {
      await this.initWhatsApp(bId, true);
    }
    if (session.qrCodeDataUrl) return this.getStatus(bId);

    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (session.qrCodeDataUrl || session.isConnected || (Date.now() - startTime > timeoutMs)) {
          clearInterval(interval);
          resolve(this.getStatus(bId));
        }
      }, 300);
    });
  }

  clearAuthSession(branchId = 1) {
    const bId = parseInt(branchId, 10) || 1;
    const authDir = getAuthDir(bId);
    try {
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[Baileys] Error removing auth directory for branch ${bId}:`, err);
    }
    const session = this.getSession(bId);
    session.isConnected = false;
    session.isConnecting = false;
    session.connectedUser = null;
    session.qrCodeDataUrl = null;
  }

  async disconnect(branchId = 1) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);
    try {
      if (session.sock) {
        await session.sock.logout().catch(() => {});
        session.sock.ev?.removeAllListeners?.();
        session.sock.end?.();
        session.sock = null;
      }
    } catch (e) {}
    this.clearAuthSession(bId);
    try {
      const branchManager = require('../../config/branchManager');
      const pool = await branchManager.getBranchPool(bId);
      await pool.query(`UPDATE whatsapp_settings SET connected = FALSE, is_connected = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = 1`);
    } catch (e) {}
    this.emitStatus(bId);
    return { success: true, message: `WhatsApp session for Branch ${bId} disconnected & logged out` };
  }
}

const baileysInstance = new BaileysService();
module.exports = baileysInstance;
