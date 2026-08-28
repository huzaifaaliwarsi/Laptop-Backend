const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const db = require('../../config/db');
const { emitEvent } = require('../../config/socket');

const AUTH_DIR = path.join(__dirname, '../../../whatsapp_auth_session');

class BaileysService {
  constructor() {
    this.sock = null;
    this.qrCodeDataUrl = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.connectedUser = null;
    this.logger = pino({ level: 'silent' });
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

  async initWhatsApp(forceNew = false) {
    if (this.isConnecting) return;
    if (this.isConnected && !forceNew) return;

    this.isConnecting = true;
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: true,
        auth: state,
        browser: ['Repair Management POS', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: false,
        retryRequestDelayMs: 250
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
            this.isConnected = false;
            this.isConnecting = false;
            emitEvent('whatsapp:qr', { qr: this.qrCodeDataUrl });
            emitEvent('whatsapp:status', this.getStatus());
            console.log('[Baileys] WhatsApp QR Code generated successfully!');
          } catch (err) {
            console.error('[Baileys] Error generating QR data URL:', err);
          }
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.isConnecting = false;
          this.qrCodeDataUrl = null;
          this.connectedUser = this.sock.user;
          console.log('[Baileys] WhatsApp Multi-Device connection established:', this.sock.user);

          const phone = this.sock.user?.id ? this.sock.user.id.split(':')[0].split('@')[0] : '';
          const name = this.sock.user?.name || 'Shop WhatsApp Business';

          try {
            await db.query(
              `UPDATE whatsapp_settings SET is_connected = TRUE, number = COALESCE(NULLIF(number, ''), $1), updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
              [phone]
            );
          } catch (dbErr) {
            console.error('[Baileys] DB update settings error:', dbErr);
          }

          emitEvent('whatsapp:status', this.getStatus());
        }

        if (connection === 'close') {
          this.isConnected = false;
          this.isConnecting = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[Baileys] WhatsApp connection closed (Code: ${statusCode}, Reconnect: ${shouldReconnect})`);

          try {
            await db.query(`UPDATE whatsapp_settings SET is_connected = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = 1`);
          } catch (e) {}

          emitEvent('whatsapp:status', this.getStatus());

          if (shouldReconnect) {
            setTimeout(() => this.initWhatsApp(), 3000);
          } else {
            console.log('[Baileys] Session logged out. Cleaning auth files...');
            this.clearAuthSession();
            setTimeout(() => this.initWhatsApp(true), 2000);
          }
        }
      });

      // Handle Incoming Messages (Bot Auto-Replies & Status Tracker)
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          if (!msg.key.fromMe && msg.message) {
            await this.handleIncomingMessage(msg);
          }
        }
      });

    } catch (error) {
      this.isConnecting = false;
      this.isConnected = false;
      console.error('[Baileys] WhatsApp initialization error:', error);
    }
  }

  async handleIncomingMessage(msg) {
    try {
      const senderJid = msg.key.remoteJid;
      if (!senderJid || senderJid.endsWith('@g.us')) return; // Ignore groups

      const rawText = msg.message?.conversation ||
                      msg.message?.extendedTextMessage?.text ||
                      msg.message?.imageMessage?.caption || '';
      const text = rawText.trim();
      if (!text) return;

      const senderPhone = senderJid.split('@')[0];
      console.log(`[Baileys] Received WhatsApp message from ${senderPhone}: "${text}"`);

      // 1. Check if tracking query (e.g., RPR-1234 or REP1234)
      const trackingMatch = text.match(/(?:RPR|REP)[-\s]?(\d+)/i) || (text.toUpperCase().startsWith('RPR-') ? [text] : null);
      if (trackingMatch) {
        const queryTerm = text.trim();
        const jRes = await db.query(
          `SELECT * FROM repair_jobs WHERE UPPER(tracking_id) = UPPER($1) OR id = $1 LIMIT 1`,
          [queryTerm]
        );

        if (jRes.rows.length > 0) {
          const job = jRes.rows[0];
          const formattedReport = this.generateLiveReport(job);
          await this.sendRawMessage(senderJid, formattedReport);
          return;
        }
      }

      // 2. Check if Approval reply (APPROVE / DECLINE / 1 / 2)
      const upper = text.toUpperCase();
      if (['APPROVE', '1', 'YES', 'OK', 'ACCEPT'].includes(upper)) {
        const pendingJob = await db.query(
          `SELECT * FROM repair_jobs WHERE (contact LIKE $1 OR contact LIKE $2) AND status = 'Waiting for Customer Approval' ORDER BY created_at DESC LIMIT 1`,
          [`%${senderPhone.slice(-9)}%`, `%${senderPhone}%`]
        );
        if (pendingJob.rows.length > 0) {
          const job = pendingJob.rows[0];
          await db.query(
            `UPDATE repair_jobs SET status = 'Repair Approved', approval_status = 'Approved', approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [job.id]
          );
          await db.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by) VALUES ($1, 'Repair Approved', 'Customer approved repair quotation via WhatsApp', 'Customer (WhatsApp)')`,
            [job.id]
          );
          await this.sendRawMessage(senderJid, `✅ *Quotation Approved!*\n\nThank you! Your approval for job *${job.tracking_id}* has been confirmed. Our technicians have queued your device on the workstation for repair.`);
          return;
        }
      }

      // 3. Fallback automated welcome message
      const sRes = await db.query('SELECT * FROM whatsapp_settings WHERE id = 1');
      const settings = sRes.rows[0] || {};
      if (settings.bot_enabled !== false) {
        const welcome = settings.welcome_message || 
          `👋 Welcome to *${settings.business_name || 'Laptop Repairing Center'}*!\n\nTo check your repair status, please reply with your *Tracking ID* (e.g. *RPR-00123*).\n\n📍 *Shop Address:* ${settings.shop_location || 'Main Market'}\n📞 *Support:* ${settings.number || ''}`;
        await this.sendRawMessage(senderJid, welcome);
      }
    } catch (err) {
      console.error('[Baileys] Error handling incoming WhatsApp message:', err);
    }
  }

  generateLiveReport(job) {
    const total = parseFloat(job.total || 0);
    const paid = parseFloat(job.paid || 0);
    const remaining = Math.max(0, total - paid);
    const payStatus = remaining <= 0.005 ? '✅ Paid in Full' : paid > 0 ? '⚠️ Partial Advance' : '❌ Unpaid';
    const device = [job.brand, job.model].filter(Boolean).join(' ') || job.product_type || 'Laptop';
    const expected = job.expected_completion ? new Date(job.expected_completion).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: '2-digit' }) : 'Under Diagnostic Review';

    return [
      `*━━━━━━━━━━━━━━━━━━━━━*`,
      `🔧 *LIVE REPAIR STATUS REPORT*`,
      `*━━━━━━━━━━━━━━━━━━━━━*`,
      `📌 *Tracking ID:* ${job.tracking_id}`,
      `💻 *Device:* ${device}`,
      `👤 *Customer:* ${job.customer_name || 'Customer'}`,
      `⚡ *Defect:* ${job.problem || 'Hardware fault'}`,
      `📊 *Current Status:* *${job.status}*`,
      job.diagnosed_issue ? `🔬 *Diagnosed Issue:* ${job.diagnosed_issue}` : null,
      job.recommended_solution ? `💡 *Solution:* ${job.recommended_solution}` : null,
      `👨‍🔧 *Technician:* ${job.technician_name || 'Senior Specialist'}`,
      `📅 *Expected Date:* ${expected}`,
      `*─────────────────────*`,
      `💰 *Bill:* PKR ${total.toLocaleString('en-PK')} | Paid: PKR ${paid.toLocaleString('en-PK')} | *Bal:* PKR ${remaining.toLocaleString('en-PK')}`,
      `*Status:* ${payStatus}`,
      `*━━━━━━━━━━━━━━━━━━━━━*`
    ].filter(Boolean).join('\n');
  }

  async sendRawMessage(jid, text) {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp is not connected. Please scan the QR code first.');
    }
    return await this.sock.sendMessage(jid, { text });
  }

  async sendTextMessage(phone, text) {
    const jid = this.formatPhoneJid(phone);
    if (!jid) throw new Error(`Invalid phone number: "${phone}"`);
    return await this.sendRawMessage(jid, text);
  }

  getStatus() {
    const phone = this.connectedUser?.id ? this.connectedUser.id.split(':')[0].split('@')[0] : null;
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      qr: this.qrCodeDataUrl,
      phone: phone,
      name: this.connectedUser?.name || 'Connected WhatsApp Multi-Device',
      authenticated: this.isConnected
    };
  }

  clearAuthSession() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[Baileys] Error removing auth directory:', err);
    }
    this.isConnected = false;
    this.connectedUser = null;
    this.qrCodeDataUrl = null;
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end?.();
        this.sock = null;
      }
    } catch (e) {}
    this.clearAuthSession();
    emitEvent('whatsapp:status', this.getStatus());
    return { success: true, message: 'WhatsApp session disconnected & logged out' };
  }
}

const baileysInstance = new BaileysService();
module.exports = baileysInstance;
