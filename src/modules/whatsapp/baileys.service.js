const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const authStore = require('./auth-store');
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

// Do not race the first socket against a background version fetch. An old
// protocol version can close with 428 before WhatsApp ever emits a QR.
let versionRequest = null;
let versionExpiresAt = 0;
async function getWhatsAppVersion() {
  if (!versionRequest || Date.now() >= versionExpiresAt) {
    versionExpiresAt = Date.now() + 15 * 60 * 1000;
    versionRequest = (async () => {
      const b = await getBaileys();
      const result = await (b.fetchLatestWaWebVersion
        ? b.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(10000) })
        : b.fetchLatestBaileysVersion({ signal: AbortSignal.timeout(10000) }));
      if (!result?.version || result.error || result.isLatest === false) {
        throw new Error('Could not obtain the current WhatsApp Web version');
      }
      return result.version;
    })().catch(error => { versionRequest = null; throw error; });
  }
  return versionRequest;
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
    this.isLinking = false;
    this.connectedUser = null;
    this.reconnectTimer = null;
    this.generation = 0;
    this.auth = null;
    this.reuseAuth = false;
    this.updatedAt = Date.now();
    this.retryCount = 0;
    this.stopped = false;
    this.requiresRelink = false;
    this.lastError = null;
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

  async hasSavedSession(branchId = 1) {
    const branchManager = require('../../config/branchManager');
    const pool = await branchManager.getBranchPool(branchId);
    const saved = await authStore.hasSavedSession(pool, branchId);
    if (saved !== null) return saved;
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
    if (process.env.VERCEL) return;
    if (targetBranchId) {
      const bId = parseInt(targetBranchId, 10);
      if (await this.hasSavedSession(bId)) {
        console.log(`[Baileys] Active WhatsApp session found for Branch ${bId}. Connecting...`);
        return this.initWhatsApp(bId, false);
      }
      return;
    }

    try {
      const branchManager = require('../../config/branchManager');
      const branches = await branchManager.listBranches();
      for (const b of branches) {
        if (this.getSession(b.id).stopped) continue;
        if (await this.hasSavedSession(b.id)) {
          console.log(`[Baileys] Active WhatsApp session found for Branch ${b.id} (${b.branch_name}). Connecting...`);
          await this.initWhatsApp(b.id, false);
        } else {
          console.log(`[Baileys] No active WhatsApp session for Branch ${b.id} (${b.branch_name}). Idle.`);
        }
      }
    } catch (e) {
      if (await this.hasSavedSession(1)) {
        await this.initWhatsApp(1, false);
      }
    }
  }

  initWhatsApp(branchId = 1, forceNew = false, forceAcquire = false) {
    const session = this.getSession(branchId);
    if (forceNew) {
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
      if (session.sock) this.retireSocket(session);
      session.isConnecting = false;
    }
    if (session.initializing) return session.initializing;
    session.initializing = this.initializeSocket(branchId, forceAcquire || forceNew).finally(() => { session.initializing = null; });
    return session.initializing;
  }

  async isCurrentBranchConnected() { return this.isConnected; }

  async initializeSocket(branchId = 1, force = false) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);

    // If not forcing, connect is idempotent and NEVER erases authentication.
    if (!force && (session.sock || session.isConnecting)) return;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    session.stopped = false;
    session.lastError = null;
    const generation = ++session.generation;
    const current = () => generation === session.generation && !session.stopped;
    session.isConnecting = true;
    this.emitStatus(bId);

    const authDir = getAuthDir(bId);
    try {
      const baileys = await getBaileys();
      const version = await getWhatsAppVersion();
      if (!current()) return;
      const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
      const {
        DisconnectReason,
        makeCacheableSignalKeyStore,
        Browsers
      } = baileys;

      const branchManager = require('../../config/branchManager');
      const pool = await branchManager.getBranchPool(bId);
      let auth = session.reuseAuth ? session.auth : null;
      if (!auth) auth = await authStore.openAuthStore(pool, bId, authDir, baileys, error => {
        if (session.stopped || session.auth !== auth) return;
        session.lastError = 'Session storage unavailable; retrying safely.';
        console.error(`[Baileys] Branch ${bId} auth storage failure:`, error.message);
        this.retireSocket(session);
        this.scheduleReconnect(bId);
      }, true);
      if (!current()) { await auth.close(); return; }
      session.auth = auth;
      session.reuseAuth = false;
      const { state, saveCreds } = auth;
      session.connectedUser = state.creds.me || null;
      await saveCreds();
      if (!current()) return;

      session.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        browser: Browsers.windows('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 250,
        getMessage: async () => ({ conversation: '' })
      });

      const sock = session.sock;
      sock.ev.on('creds.update', () => {
        if (current()) saveCreds().catch(error => console.error(`[Baileys] Credential save failed for ${bId}:`, error.message));
      });

      sock.ev.on('connection.update', (update) => {
        handleConnection(update).catch(error => {
          if (!current()) return;
          console.error(`[Baileys] Branch ${bId} connection handler failed:`, error.message);
          this.retireSocket(session);
          this.scheduleReconnect(bId);
        });
      });
      const handleConnection = async (update) => {
        if (!current()) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 5 });
            if (!current() || session.isConnected) return;
            session.qrCodeDataUrl = dataUrl;
            session.requiresRelink = false;
            session.isConnected = false;
            session.isConnecting = false;
            session.isLinking = false;
            this.emitStatus(bId);
            console.log(`[Baileys] ⚡ Live WhatsApp QR Code ready for Branch ${bId}! Scan with mobile device.`);
          } catch (err) {
            console.error(`[Baileys] Error generating QR data URL for branch ${bId}:`, err);
          }
        }

        if (connection === 'connecting') {
          session.isConnecting = true;
          this.emitStatus(bId);
        }

        if (connection === 'open') {
          await saveCreds();
          if (!current()) return;
          session.retryCount = 0;
          session.requiresRelink = false;
          session.lastError = null;
          session.isConnected = true;
          session.isConnecting = false;
          session.isLinking = false;
          session.qrCodeDataUrl = null;
          session.connectedUser = session.sock.user;
          this.emitStatus(bId);
          console.log(`[Baileys] ✅ WhatsApp Multi-Device connection established for Branch ${bId}:`, session.sock.user);

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
          const code = lastDisconnect?.error?.output?.statusCode;
          const registered = Boolean(state.creds.registered || state.creds.me?.id);
          const hadQr = Boolean(session.qrCodeDataUrl);
          const restart = code === DisconnectReason.restartRequired;
          console.log(`[Baileys] Branch ${bId} connection closed (Code: ${code})`);
          if (code === 428) { versionRequest = null; versionExpiresAt = 0; }
          // Retire first: late events from this socket must never affect its replacement.
          this.retireSocket(session);
          const closingGeneration = session.generation;
          session.isConnecting = true;
          session.isLinking = restart;
          this.emitStatus(bId);
          await auth.flush();
          if (closingGeneration !== session.generation) return;
          if (restart) {
            // Pairing needs a fresh socket, not a fresh database lease.
            session.reuseAuth = true;
            session.isConnecting = false;
            this.scheduleReconnect(bId, 0);
            return;
          }
          try {
          if (code === DisconnectReason.loggedOut) {
            // WhatsApp revoked these credentials. Do not retry invalid credentials.
            session.stopped = true;
            session.requiresRelink = true;
            session.connectedUser = null;
            session.lastError = 'WhatsApp revoked this linked session. Link the device again.';
            await auth.clear();
          } else if ([DisconnectReason.connectionReplaced, DisconnectReason.badSession,
                      DisconnectReason.multideviceMismatch, DisconnectReason.forbidden].includes(code)) {
            session.stopped = true;
            session.requiresRelink = true;
            session.lastError = `WhatsApp rejected the connection (${code}). Check linked devices before reconnecting.`;
          }
          } catch (error) {
            session.stopped = true;
            session.lastError = 'Could not update session storage. Check the backend database before reconnecting.';
            console.error(`[Baileys] Branch ${bId} session cleanup failed:`, error.message);
          } finally { await auth.close(); }
          if (closingGeneration !== session.generation) return;
          if (session.auth === auth) session.auth = null;
          session.isConnecting = false;
          session.isLinking = restart;
          if (!session.stopped && (registered || restart || (!hadQr && session.retryCount < 4))) {
            this.scheduleReconnect(bId, restart ? 300 : undefined);
          } else if (!session.stopped && !hadQr) {
            session.lastError = 'WhatsApp could not generate a QR. Check the backend connection and try Generate QR Code again.';
          }
          this.emitStatus(bId);
        }
      };

      // Handle Incoming Messages for this specific branch
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (!current()) return;
        for (const msg of messages) {
          if (!msg.message) continue;

          const senderJid = msg.key.remoteJid;
          if (!senderJid || senderJid.endsWith('@g.us') || senderJid.endsWith('@broadcast') || senderJid.endsWith('@newsletter')) continue;

          // Check if user is messaging from their own phone to test (supports both Phone and LID)
          const myPhone = session.connectedUser?.id ? session.connectedUser.id.split(':')[0].split('@')[0] : null;
          const myLid = session.connectedUser?.lid ? session.connectedUser.lid.split(':')[0].split('@')[0] : null;
          const isSelfChat = Boolean(
            (myPhone && senderJid.includes(myPhone)) ||
            (myLid && senderJid.includes(myLid))
          );

          const text = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            ''
          ).trim();

          console.log(`[Baileys] 📥 Message event received (Branch ${bId}):`, {
            fromMe: msg.key.fromMe,
            senderJid,
            isSelfChat,
            text: text.slice(0, 30)
          });

          // If fromMe: only allow if it's a self-test chat, otherwise ignore outgoing messages
          if (msg.key.fromMe) {
            if (!isSelfChat) continue;

            // Prevent infinite loop if this text was sent by bot itself
            if (session.lastBotReply && (session.lastBotReply === text || session.lastBotReply.includes(text.slice(0, 30)))) {
              continue;
            }
          }

          await this.handleIncomingMessage(bId, msg);
        }
      });

    } catch (error) {
      if (!current()) return;
      this.retireSocket(session);
      if (session.auth) { await session.auth.close(); session.auth = null; }
      session.lastError = error.code === 'WA_SESSION_BUSY'
        ? `Waiting for the previous WhatsApp connection to release its lock. Retrying in ${Math.ceil((error.retryAfterMs || 5000) / 1000)} seconds.`
        : 'Connection interrupted. Retrying with saved credentials.';
      console.error(`[Baileys] Branch ${bId} initialization failed:`, error.message);
      this.scheduleReconnect(bId, error.code === 'WA_SESSION_BUSY' ? (error.retryAfterMs || 5000) + 250 : undefined);
    }
  }

  retireSocket(session) {
    ++session.generation;
    const sock = session.sock;
    session.sock = null;
    session.isConnected = false;
    session.isConnecting = false;
    session.isLinking = false;
    session.qrCodeDataUrl = null;
    if (sock) {
      sock.ev?.removeAllListeners?.();
      try { sock.end?.(new Error('Socket retired')); } catch (_) {}
    }
  }

  scheduleReconnect(branchId, delay) {
    const session = this.getSession(branchId);
    if (session.stopped || session.reconnectTimer) return;
    session.isConnecting = true;
    const generation = session.generation;
    const wait = delay ?? Math.min(60000, 1000 * (2 ** Math.min(session.retryCount++, 6)));
    session.reconnectTimer = setTimeout(async () => {
      session.reconnectTimer = null;
      if (session.stopped || generation !== session.generation) return;
      if (session.auth && !session.reuseAuth) { await session.auth.close(); session.auth = null; }
      if (session.stopped || generation !== session.generation) return;
      session.isConnecting = false;
      await this.initWhatsApp(branchId);
    }, wait);
    this.emitStatus(branchId);
  }

  async shutdown() {
    await Promise.all([...this.sessions.values()].map(async session => {
      session.stopped = true;
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
      this.retireSocket(session);
      if (session.initializing) await session.initializing;
      if (session.auth) { await session.auth.close(); session.auth = null; }
    }));
  }

  async handleIncomingMessage(arg1, arg2 = null) {
    try {
      const branchId = arg2 !== null ? (parseInt(arg1, 10) || 1) : 1;
      const msg = arg2 !== null ? arg2 : arg1;
      if (!msg || !msg.key) return;

      const senderJid = msg.key.remoteJid;
      if (!senderJid || senderJid.endsWith('@g.us') || senderJid.endsWith('@broadcast') || senderJid.endsWith('@newsletter')) return; // Ignore groups/broadcasts/newsletters

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

      // Determine reply target JID (strip device suffix for standard delivery)
      const [jidUser, jidServer] = senderJid.split('@');
      const cleanUser = (jidUser || '').split(':')[0].replace(/[^0-9]/g, '');
      const replyJid = (cleanUser && jidServer) ? `${cleanUser}@${jidServer}` : senderJid;

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

  async ensureConnected(branchId = 1, timeoutMs = 12000) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);
    if (session.sock && session.isConnected) return true;

    // Check if branch has saved credentials in PostgreSQL
    const hasSaved = await this.hasSavedSession(bId);
    if (!hasSaved) return false;

    // Trigger connection if idle
    if (!session.sock && !session.isConnecting) {
      this.initWhatsApp(bId, false).catch(err => {
        console.warn(`[Baileys] Auto-connect for Branch ${bId} failed:`, err.message);
      });
    }

    // Wait up to timeoutMs for connection to become open
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (session.sock && session.isConnected) return true;
      if (session.stopped || session.requiresRelink) return false;
      await new Promise(r => setTimeout(r, 250));
    }

    return Boolean(session.sock && session.isConnected);
  }

  async sendRawMessage(jid, text, branchId = 1) {
    await this.ensureConnected(branchId);
    const session = this.getSession(branchId);
    if (!session.sock || !session.isConnected) {
      throw new Error(`WhatsApp is connecting or not paired for Branch ${branchId}. Please ensure the device is linked in WhatsApp Settings.`);
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

    await this.ensureConnected(branchId);
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

    await this.ensureConnected(branchId);
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
      updatedAt: session.updatedAt,
      connected: session.isConnected,
      connecting: session.isConnecting,
      linking: Boolean(session.isLinking),
      qr: session.qrCodeDataUrl,
      phone: phone,
      name: session.connectedUser?.name || 'Connected WhatsApp Multi-Device',
      authenticated: !session.requiresRelink && Boolean(session.isConnected || session.auth?.state.creds.registered || session.connectedUser),
      reconnecting: session.isConnecting && !session.isLinking && Boolean(session.connectedUser || session.auth?.state.creds.registered),
      requiresRelink: session.requiresRelink,
      error: session.lastError
    };
  }

  emitStatus(branchId = 1) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);
    session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
    const status = this.getStatus(bId);
    if (this.publishWorkerStatus) this.publishWorkerStatus(bId, status);
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

  async waitForQrOrStatus(branchId = 1, timeoutMs = 15000, force = true) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);
    if (!force && session.isConnected) return this.getStatus(bId);
    if (!force && session.isLinking) return this.getStatus(bId);

    if (force || (!session.sock && !session.isConnecting)) {
      session.retryCount = 0;
      await this.initWhatsApp(bId, force, force);
    }
    if (session.qrCodeDataUrl) return this.getStatus(bId);

    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (session.qrCodeDataUrl || session.isConnected || session.isLinking || session.lastError || (Date.now() - startTime > timeoutMs)) {
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
    session.isLinking = false;
    session.connectedUser = null;
    session.qrCodeDataUrl = null;
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
  }

  async disconnect(branchId = 1) {
    const bId = parseInt(branchId, 10) || 1;
    const session = this.getSession(bId);
    session.stopped = true;
    ++session.generation;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    if (session.initializing) await session.initializing;

    let auth = session.auth;
    if (!auth) {
      try {
        const branchManager = require('../../config/branchManager');
        const pool = await branchManager.getBranchPool(bId);
        auth = await authStore.openAuthStore(pool, bId, getAuthDir(bId), await getBaileys(), () => {}, true);
      } catch (_) {}
    }

    const sock = session.sock;
    if (sock) {
      sock.ev?.removeAllListeners?.();
      try { await sock.logout(); } catch (error) { console.warn(`[Baileys] Logout error for ${bId}:`, error.message); }
    }
    this.retireSocket(session);

    if (auth) {
      try { await auth.clear(); } catch (_) {}
      try { await auth.close(); } catch (_) {}
      if (session.auth === auth) session.auth = null;
    }
    this.clearAuthSession(bId);

    // Guaranteed Direct Database Reset
    try {
      const branchManager = require('../../config/branchManager');
      const pool = await branchManager.getBranchPool(bId);
      await pool.query('DELETE FROM whatsapp_auth_state WHERE branch_id = $1', [bId]);
      await pool.query('DELETE FROM whatsapp_auth_leases WHERE branch_id = $1', [bId]);
      await pool.query(
        `UPDATE whatsapp_settings 
         SET connected = FALSE, is_connected = FALSE, number = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [bId]
      );
    } catch (dbErr) {
      console.error('[Baileys] Error resetting whatsapp_settings on disconnect:', dbErr.message);
    }

    session.requiresRelink = false;
    session.lastError = null;
    session.isConnected = false;
    session.isConnecting = false;
    session.qrCodeDataUrl = null;
    session.connectedUser = null;

    this.emitStatus(bId);
    return { success: true, message: `WhatsApp session for Branch ${bId} disconnected & logged out` };
  }

}

const baileysInstance = new BaileysService();
module.exports = process.env.WHATSAPP_REMOTE_WORKER === '1'
  ? require('./remote.service') : baileysInstance;
