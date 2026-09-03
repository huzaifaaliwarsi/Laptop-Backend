const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const db = require('../../config/db');
const { emitEvent } = require('../../config/socket');

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

const AUTH_DIR = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  ? path.join('/tmp', 'whatsapp_auth_session')
  : path.join(__dirname, '../../../whatsapp_auth_session');

const {
  buildTrackingResponseTemplate,
  buildApprovalConfirmationTemplate,
  buildDeclineConfirmationTemplate,
  buildAdditionalWorkApprovedTemplate,
  buildAdditionalWorkDeclinedTemplate
} = require('./whatsapp.templates');
const RepairService = require('../repairs/repairs.service');

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
    if (this.isConnecting && !forceNew) return;
    if (this.isConnected && !forceNew) return;

    if (forceNew) {
      if (this.sock) {
        try {
          this.sock.ev?.removeAllListeners?.();
          this.sock.end?.();
          this.sock = null;
        } catch (e) {}
      }
      this.clearAuthSession();
    }

    this.isConnecting = true;
    this.emitStatus();

    try {
      const baileys = await getBaileys();
      const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
      const {
        DisconnectReason,
        useMultiFileAuthState,
        fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore,
        Browsers
      } = baileys;

      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      // Guarantee initial creds file exists
      await saveCreds().catch(() => {});

      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1043857760] }));

      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: true,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        browser: Browsers.windows('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 250,
        getMessage: async () => ({ conversation: '' })
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
            this.isConnected = false;
            this.isConnecting = false;
            this.emitStatus();
            console.log('[Baileys] WhatsApp QR Code generated successfully!');
          } catch (err) {
            console.error('[Baileys] Error generating QR data URL:', err);
          }
        }

        if (connection === 'connecting') {
          this.isConnecting = true;
          this.emitStatus();
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.isConnecting = false;
          this.qrCodeDataUrl = null;
          this.connectedUser = this.sock.user;
          console.log('[Baileys] WhatsApp Multi-Device connection established:', this.sock.user);

          const phone = this.sock.user?.id ? this.sock.user.id.split(':')[0].split('@')[0] : '';

          try {
            await db.query(
              `UPDATE whatsapp_settings SET connected = TRUE, is_connected = TRUE, number = COALESCE(NULLIF(number, ''), $1), updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
              [phone]
            );
          } catch (dbErr) {
            console.error('[Baileys] DB update settings error:', dbErr);
          }

          this.emitStatus();
        }

        if (connection === 'close') {
          this.isConnected = false;
          this.isConnecting = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[Baileys] WhatsApp connection closed (Code: ${statusCode}, Reconnect: ${shouldReconnect})`);

          try {
            await db.query(`UPDATE whatsapp_settings SET connected = FALSE, is_connected = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = 1`);
          } catch (e) {}

          this.emitStatus();

          if (shouldReconnect) {
            // Code 515 (restartRequired) is sent by WhatsApp right after successful QR scan to initiate MD session
            const delay = statusCode === DisconnectReason.restartRequired ? 1200 : 3000;
            setTimeout(() => this.initWhatsApp(), delay);
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
      this.emitStatus();
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

      const branchManager = require('../../config/branchManager');
      const { branchStorage } = require('../../middleware/branchContext');
      const branches = await branchManager.listBranches();

      // 1. Check if tracking query (e.g., RPR-10001, 10001, rpr 10001, or BR01-RPR-00001)
      const isPureNumber = /^\d{4,6}$/.test(text.trim());
      const trackingMatch = text.match(/(?:(?:BR0?1|BR0?2)[-\s]?)?(?:RPR|REP)[-\s]?(\d+)/i) || 
                            (text.toUpperCase().includes('RPR') ? [text] : null) ||
                            (isPureNumber ? [text.trim()] : null);
      if (trackingMatch) {
        const queryTerm = text.trim();
        const extractedNum = text.replace(/[^0-9]/g, '');
        let matchedJob = null;
        let matchedBranch = null;
        let isPhoneVerified = false;
        
        for (const b of branches) {
          try {
            const pool = await branchManager.getBranchPool(b.id);
            const jRes = await pool.query(
              `SELECT * FROM repair_jobs 
               WHERE UPPER(tracking_id) = UPPER($1) 
                  OR UPPER(id) = UPPER($1) 
                  OR UPPER(tracking_id) = UPPER($2)
                  OR UPPER(id) = UPPER($2)
                  OR (LENGTH($3) >= 4 AND (tracking_id LIKE $4 OR id LIKE $4))
               LIMIT 1`,
              [
                queryTerm,
                `RPR-${extractedNum}`,
                extractedNum,
                `%${extractedNum}%`
              ]
            );

            if (jRes.rows.length > 0) {
              const job = jRes.rows[0];
              matchedJob = job;
              matchedBranch = b;

              // Verify sender phone number against registered job contact
              const cleanJobContact = String(job.contact || '').replace(/[^0-9]/g, '');
              const cleanSender = String(senderPhone).replace(/[^0-9]/g, '');
              if (cleanJobContact && cleanSender && (cleanJobContact.includes(cleanSender.slice(-8)) || cleanSender.includes(cleanJobContact.slice(-8)))) {
                isPhoneVerified = true;
                const formattedReport = buildTrackingResponseTemplate({ job, safeNote: job.final_remarks });
                await this.sendRawMessage(senderJid, formattedReport);
                return;
              }
            }
          } catch (e) {
            console.warn(`[Baileys] Error checking tracking in branch ${b.id}:`, e.message);
          }
        }

        // If job was found but phone did not match
        if (matchedJob && !isPhoneVerified) {
          await this.sendRawMessage(
            senderJid,
            `🔒 *Security Notice*\n\nRepair Job *${matchedJob.tracking_id}* was found in *${matchedBranch?.branch_name || 'System'}*, but your WhatsApp number is not registered for this job.\n\nFor privacy & security, please message from your registered phone number or contact branch support directly.`
          );
          return;
        }
      }

      // 2. Check if Approval reply (APPROVE / DECLINE / 1 / 2)
      const upper = text.toUpperCase();
      const isApprove = ['APPROVE', '1', 'YES', 'OK', 'ACCEPT'].includes(upper);
      const isDecline = ['DECLINE', '2', 'NO', 'CANCEL'].includes(upper);

      if (isApprove || isDecline) {
        for (const b of branches) {
          try {
            const pool = await branchManager.getBranchPool(b.id);
            
            // Priority A: Check for Active Additional Work Request for this sender's phone
            const pendingWorkRes = await pool.query(
              `SELECT awr.*, rj.contact FROM repair_additional_work_requests awr
               JOIN repair_jobs rj ON awr.repair_job_id = rj.id
               WHERE (rj.contact LIKE $1 OR rj.contact LIKE $2) AND awr.status = 'Pending Approval'
               ORDER BY awr.created_at DESC LIMIT 1`,
              [`%${senderPhone.slice(-9)}%`, `%${senderPhone}%`]
            );

            if (pendingWorkRes.rows.length > 0) {
              const pReq = pendingWorkRes.rows[0];
              
              let resultTemplate = null;
              await branchStorage.run({ branchId: b.id, pool }, async () => {
                if (isApprove) {
                  const res = await RepairService.approveAdditionalWorkRequest(
                    pReq.repair_job_id,
                    pReq.id,
                    { name: 'WhatsApp Customer' },
                    'WhatsApp',
                    'Customer approved additional work via WhatsApp'
                  );
                  resultTemplate = buildAdditionalWorkApprovedTemplate({ job: res.job, workRequest: res.request });
                } else if (isDecline) {
                  const res = await RepairService.declineAdditionalWorkRequest(
                    pReq.repair_job_id,
                    pReq.id,
                    { name: 'WhatsApp Customer' },
                    'WhatsApp',
                    'Customer declined additional work via WhatsApp'
                  );
                  resultTemplate = buildAdditionalWorkDeclinedTemplate({ job: res.job, workRequest: res.request });
                }
              });

              if (resultTemplate) {
                await this.sendRawMessage(senderJid, resultTemplate);
                return;
              }
            }

            // Priority B: Check for Diagnosis Job Quotation Approval
            const pendingJob = await pool.query(
              `SELECT * FROM repair_jobs 
               WHERE (contact LIKE $1 OR contact LIKE $2) AND status = 'Waiting for Customer Approval' 
               ORDER BY created_at DESC LIMIT 1`,
              [`%${senderPhone.slice(-9)}%`, `%${senderPhone}%`]
            );

            if (pendingJob.rows.length > 0) {
              const job = pendingJob.rows[0];
              let resultTemplate = null;
              
              await branchStorage.run({ branchId: b.id, pool }, async () => {
                if (isApprove) {
                  const approvedJob = await RepairService.approveQuote(job.id, { name: 'WhatsApp Customer' }, 'WhatsApp');
                  resultTemplate = buildApprovalConfirmationTemplate(approvedJob);
                } else if (isDecline) {
                  const declinedJob = await RepairService.declineQuote(job.id, { name: 'WhatsApp Customer' }, 'WhatsApp');
                  resultTemplate = buildDeclineConfirmationTemplate(declinedJob);
                }
              });

              if (resultTemplate) {
                await this.sendRawMessage(senderJid, resultTemplate);
                return;
              }
            }
          } catch (bErr) {
            console.warn(`[Baileys] Error processing approval in branch ${b.id}:`, bErr.message);
          }
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

  emitStatus() {
    const status = this.getStatus();
    try {
      const { getIO } = require('../../config/socket');
      const io = getIO();
      if (io) {
        io.emit('whatsapp:status', status);
        if (status.qr) {
          io.emit('whatsapp:qr', { qr: status.qr });
        }
      }
    } catch (e) {}
    emitEvent('whatsapp:status', status);
  }

  async waitForQrOrStatus(timeoutMs = 9000) {
    if (this.isConnected) return this.getStatus();
    if (!this.sock || !this.isConnecting) {
      await this.initWhatsApp(true);
    }
    if (this.qrCodeDataUrl) return this.getStatus();

    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (this.qrCodeDataUrl || this.isConnected || (Date.now() - startTime > timeoutMs)) {
          clearInterval(interval);
          resolve(this.getStatus());
        }
      }, 300);
    });
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
    this.isConnecting = false;
    this.connectedUser = null;
    this.qrCodeDataUrl = null;
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.ev?.removeAllListeners?.();
        this.sock.end?.();
        this.sock = null;
      }
    } catch (e) {}
    this.clearAuthSession();
    this.emitStatus();
    return { success: true, message: 'WhatsApp session disconnected & logged out' };
  }
}

const baileysInstance = new BaileysService();
module.exports = baileysInstance;
