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
        if (type !== 'notify') return;
        for (const msg of messages) {
          if (!msg.key.fromMe && msg.message) {
            await this.handleIncomingMessage(bId, msg);
          }
        }
      });

    } catch (error) {
      session.isConnecting = false;
      session.isConnected = false;
      this.emitStatus(bId);
      console.error(`[Baileys] Branch ${bId} WhatsApp initialization error:`, error);
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

  async sendRawMessage(jid, text, branchId = 1) {
    const session = this.getSession(branchId);
    if (!session.sock || !session.isConnected) {
      throw new Error(`WhatsApp is not connected for Branch ${branchId}. Please scan the QR code first.`);
    }
    return await session.sock.sendMessage(jid, { text });
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
