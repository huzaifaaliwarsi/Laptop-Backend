const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireSalesOrAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');
const RepairService = require('../repairs/repairs.service');
const {
  buildTrackingResponseTemplate,
  buildApprovalConfirmationTemplate,
  buildDeclineConfirmationTemplate,
  buildAdditionalWorkApprovedTemplate,
  buildAdditionalWorkDeclinedTemplate
} = require('./whatsapp.templates');

router.use(authenticateToken);

// Smart Repair Job Lookup
async function findRepairJob(queryStr, contact, client = db) {
  const raw = String(queryStr || '').trim();
  if (!raw) return null;

  // 1. Direct exact match on tracking_id or id
  let res = await client.query(
    `SELECT * FROM repair_jobs 
     WHERE UPPER(tracking_id) = UPPER($1) 
        OR UPPER(id) = UPPER($1) 
        OR UPPER(tracking_id) = UPPER($2) 
        OR UPPER(id) = UPPER($2)`,
    [raw, `RPR-${raw}`]
  );
  if (res.rows.length > 0) return res.rows[0];

  // 2. Pattern match (e.g. "RPR-00004", "REP-00004", "RPR 00004", "RPR-2026-00004")
  const match = raw.match(/(?:RPR|REP)[- ]?(?:2026[- ]?)?([0-9]+)/i);
  if (match) {
    const numPart = match[1];
    const padded5 = String(numPart).padStart(5, '0');
    res = await client.query(
      `SELECT * FROM repair_jobs 
       WHERE tracking_id = $1 OR id = $2 OR tracking_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [`RPR-${padded5}`, `REP-${padded5}`, `RPR-${numPart}`]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  // 3. Numeric ID (e.g. user entered "4" or "00004")
  const numOnly = raw.replace(/[^0-9]/g, '');
  if (numOnly && numOnly.length >= 1 && numOnly.length <= 6) {
    const padded5 = String(numOnly).padStart(5, '0');
    res = await client.query(
      `SELECT * FROM repair_jobs 
       WHERE tracking_id = $1 OR id = $2 OR tracking_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [`RPR-${padded5}`, `REP-${padded5}`, `RPR-${numOnly}`]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  // 4. Try lookup by phone number
  if (contact) {
    const cleanPhone = String(contact).replace(/[^0-9]/g, '');
    if (cleanPhone.length >= 7) {
      res = await client.query(
        `SELECT * FROM repair_jobs 
         WHERE contact LIKE $1 OR contact LIKE $2 
         ORDER BY created_at DESC LIMIT 1`,
        [`%${cleanPhone}%`, `%${cleanPhone.slice(-7)}%`]
      );
      if (res.rows.length > 0) return res.rows[0];
    }
  }

  return null;
}

// Helper for bot logic
async function processBotReply(input, conv, client = db) {
  const raw = String(input || '').trim();
  const t = raw.toLowerCase();

  // 1. Direct or State-Machine Repair Approval Handler
  const isApproveCmd = /^(?:1|approve|approved|proceed|yes|haan|ok)\b/i.test(t) || t.startsWith('approve');
  const isDeclineCmd = /^(?:2|decline|declined|cancel|no|nahi)\b/i.test(t) || t.startsWith('decline');

  if (isApproveCmd || isDeclineCmd || conv.bot_state === 'additional_work_approval' || conv.bot_state === 'repair_approval') {
    let targetTrackingId = conv.approval_tracking_id;
    // Check if tracking ID was typed along with command e.g. "APPROVE RPR-00001"
    const matchedTrack = raw.match(/(?:RPR|REP)[- ]?[0-9]+/i);
    if (matchedTrack) targetTrackingId = matchedTrack[0];

    // Priority A: Check for Active Pending Additional Work Request
    let pendingWorkReq = null;
    let jobForWorkReq = null;

    if (targetTrackingId) {
      const wrRes = await client.query(
        `SELECT * FROM repair_additional_work_requests 
         WHERE UPPER(tracking_id) = UPPER($1) AND status = 'Pending Approval' 
         ORDER BY created_at DESC LIMIT 1`,
        [targetTrackingId]
      );
      if (wrRes.rows.length > 0) {
        pendingWorkReq = wrRes.rows[0];
        const jRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [pendingWorkReq.repair_job_id]);
        if (jRes.rows.length > 0) jobForWorkReq = jRes.rows[0];
      }
    }

    if (!pendingWorkReq && conv.contact) {
      const cleanPhone = String(conv.contact).replace(/[^0-9]/g, '');
      const wrRes = await client.query(
        `SELECT awr.* FROM repair_additional_work_requests awr
         JOIN repair_jobs rj ON awr.repair_job_id = rj.id
         WHERE (rj.contact LIKE $1 OR rj.contact LIKE $2) AND awr.status = 'Pending Approval'
         ORDER BY awr.created_at DESC LIMIT 1`,
        [`%${cleanPhone}%`, `%${cleanPhone.slice(-7)}%`]
      );
      if (wrRes.rows.length > 0) {
        pendingWorkReq = wrRes.rows[0];
        const jRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [pendingWorkReq.repair_job_id]);
        if (jRes.rows.length > 0) jobForWorkReq = jRes.rows[0];
      }
    }

    if (pendingWorkReq && jobForWorkReq) {
      if (isApproveCmd) {
        const result = await RepairService.approveAdditionalWorkRequest(
          pendingWorkReq.repair_job_id,
          pendingWorkReq.id,
          { name: 'WhatsApp Customer' },
          'WhatsApp',
          'Customer approved additional work via WhatsApp'
        );
        await client.query('UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1', [conv.id]);
        return buildAdditionalWorkApprovedTemplate({ job: result.job, workRequest: result.request });
      }

      if (isDeclineCmd) {
        const result = await RepairService.declineAdditionalWorkRequest(
          pendingWorkReq.repair_job_id,
          pendingWorkReq.id,
          { name: 'WhatsApp Customer' },
          'WhatsApp',
          'Customer declined additional work via WhatsApp'
        );
        await client.query('UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1', [conv.id]);
        return buildAdditionalWorkDeclinedTemplate({ job: result.job, workRequest: result.request });
      }
    }

    // Priority B: Check for Active Diagnosis Quotation Approval
    let job = null;
    if (targetTrackingId) {
      const jRes = await client.query('SELECT * FROM repair_jobs WHERE UPPER(tracking_id) = UPPER($1) OR id = $1', [targetTrackingId]);
      if (jRes.rows.length > 0) job = jRes.rows[0];
    }

    if (!job && conv.contact) {
      const cleanPhone = String(conv.contact).replace(/[^0-9]/g, '');
      const jRes = await client.query(
        `SELECT * FROM repair_jobs 
         WHERE (contact LIKE $1 OR contact LIKE $2) AND status = 'Waiting for Customer Approval' 
         ORDER BY created_at DESC LIMIT 1`,
        [`%${cleanPhone}%`, `%${cleanPhone.slice(-7)}%`]
      );
      if (jRes.rows.length > 0) job = jRes.rows[0];
    }

    if (job && job.status === 'Waiting for Customer Approval') {
      if (isApproveCmd) {
        const approvedJob = await RepairService.approveQuote(job.id, { name: 'WhatsApp Customer' }, 'WhatsApp');
        await client.query('UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1', [conv.id]);
        return buildApprovalConfirmationTemplate(approvedJob);
      }

      if (isDeclineCmd) {
        const declinedJob = await RepairService.declineQuote(job.id, { name: 'WhatsApp Customer' }, 'WhatsApp');
        await client.query('UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1', [conv.id]);
        return buildDeclineConfirmationTemplate(declinedJob);
      }
    }
  }

  // 2. Direct Tracking Query (e.g. "RPR-00004", "REP-00004", "track RPR-00004", "check status 4")
  const isDirectTrackPattern = /^(?:rpr|rep)[- ]?[0-9]+/i.test(raw) || 
                              /\b(?:rpr|rep)[- ][0-9]+/i.test(raw) ||
                              (/\btrack\b/i.test(raw) && /[0-9]+/.test(raw));

  if (conv.bot_state === 'track_id' || isDirectTrackPattern) {
    const job = await findRepairJob(raw, conv.contact, client);

    if (!job) {
      await client.query('UPDATE whatsapp_conversations SET bot_state = NULL WHERE id = $1', [conv.id]);
      return `📋 Tracking ID Not Found\n\nWe could not find any active repair job matching "${raw}".\n\nPlease send your tracking ID (e.g. RPR-00001).`;
    }

    if (job.status === 'Waiting for Customer Approval') {
      await client.query("UPDATE whatsapp_conversations SET bot_state = 'repair_approval', approval_tracking_id = $1 WHERE id = $2", [job.tracking_id, conv.id]);
    } else {
      await client.query('UPDATE whatsapp_conversations SET bot_state = NULL WHERE id = $1', [conv.id]);
    }

    return buildTrackingResponseTemplate({ job, safeNote: job.final_remarks });
  }

  // 3. Menu Options
  if (t === '1' || t === 'buy' || t.includes('buy laptop') || t.includes('inventory')) {
    const prodRes = await client.query(
      `SELECT brand, model, product_name, expected_sale_price, condition 
       FROM products WHERE current_stock > 0 ORDER BY date_added DESC LIMIT 6`
    );
    if (prodRes.rows.length === 0) return 'No laptops or products are currently available in inventory.';
    return '📱 Available Laptops in Stock:\n\n' + 
      prodRes.rows.map((p, i) => `${i + 1}. ${p.brand} ${p.model || p.product_name} — PKR ${parseFloat(p.expected_sale_price).toLocaleString('en-PK')} (${p.condition})`).join('\n') +
      '\n\nReply 4 to search by budget or 6 to speak with our sales agent.';
  }

  if (t === '2' || t.includes('repair service') || t.includes('repair issue')) {
    await client.query("UPDATE whatsapp_conversations SET bot_state = 'repair_problem', lead_type = 'Repair Lead' WHERE id = $1", [conv.id]);
    return '🔧 Repair Service Booking\n\nPlease describe the issue with your laptop/device (e.g. No power, Display broken, Water damaged, Motherboard heating, Windows reinstall):';
  }

  if (conv.bot_state === 'repair_problem') {
    await client.query("UPDATE whatsapp_conversations SET bot_state = NULL, status = 'Human Handoff', lead_type = 'Repair Lead' WHERE id = $1", [conv.id]);
    return '✅ Inquiry Received!\n\nThank you! Your repair inquiry has been logged. A customer service technician will assist you with pricing and drop-off instructions shortly.';
  }

  if (t === '3' || t === 'track' || t.includes('track repair') || t.includes('track laptop') || t.includes('status')) {
    // Check if customer already has a job under their phone number
    const existingJob = await findRepairJob(null, conv.contact, client);
    if (existingJob) {
      await client.query("UPDATE whatsapp_conversations SET bot_state = 'track_id' WHERE id = $1", [conv.id]);
      return buildTrackingResponseTemplate({ job: existingJob, safeNote: existingJob.final_remarks });
    }

    await client.query("UPDATE whatsapp_conversations SET bot_state = 'track_id' WHERE id = $1", [conv.id]);
    return '📋 Live Repair Tracking\n\nPlease enter your Repair Tracking ID (e.g. RPR-00001) to check real-time bench status:';
  }

  if (t === '4' || t.includes('quotation') || t.includes('budget')) {
    await client.query("UPDATE whatsapp_conversations SET bot_state = 'quote_budget', lead_type = 'Quotation' WHERE id = $1", [conv.id]);
    return '💰 *Get Laptop Quotation / Price Match*\n\nPlease enter your approximate budget in PKR (e.g. 50000 or 80000):';
  }

  if (conv.bot_state === 'quote_budget') {
    const budget = parseFloat(raw.replace(/[^\d.]/g, '') || 0);
    const prodRes = await client.query(
      `SELECT brand, model, product_name, expected_sale_price, specifications 
       FROM products WHERE current_stock > 0 AND expected_sale_price <= $1 
       ORDER BY expected_sale_price DESC LIMIT 5`,
      [budget || 999999]
    );

    await client.query("UPDATE whatsapp_conversations SET bot_state = NULL WHERE id = $1", [conv.id]);

    if (prodRes.rows.length === 0) {
      return `No laptops matching your budget of PKR ${budget.toLocaleString('en-PK')} were found.\n\nReply *6* to talk to an agent for customized options.`;
    }

    return `💻 *Matching Laptops Within PKR ${budget.toLocaleString('en-PK')}:*\n\n` +
      prodRes.rows.map((p, i) => `${i + 1}. *${p.brand} ${p.model || p.product_name}* — PKR ${parseFloat(p.expected_sale_price).toLocaleString('en-PK')}`).join('\n') +
      '\n\nReply *6* to reserve or talk to our sales agent.';
  }

  if (t === '5' || t.includes('location') || t.includes('address')) {
    const setRes = await client.query('SELECT shop_location FROM whatsapp_settings WHERE id = 1');
    const loc = setRes.rows.length > 0 ? setRes.rows[0].shop_location : null;
    return `📍 *Shop Location:*\n${loc || 'Main Boulevard Computer Plaza, Lahore.'}\n\n🕒 *Timings:* Mon - Sat (11:00 AM - 9:00 PM)`;
  }

  if (t === '6' || t.includes('agent') || t.includes('human') || t.includes('help')) {
    await client.query("UPDATE whatsapp_conversations SET status = 'Human Handoff' WHERE id = $1", [conv.id]);
    return '🙋‍♂️ *Human Agent Requested*\n\nOur customer support representative has been notified and will reply to you here shortly.';
  }

  const welcomeRes = await client.query('SELECT welcome_message FROM whatsapp_settings WHERE id = 1');
  const customWelcome = welcomeRes.rows.length > 0 && welcomeRes.rows[0].welcome_message ? welcomeRes.rows[0].welcome_message : null;

  return (customWelcome || 
    '👋 *Welcome to Retail & Laptop Repair Management!*\n\n' +
    'How can we help you today? Please reply with a number:\n\n' +
    '1️⃣ *Buy Laptop* (Browse Inventory)\n' +
    '2️⃣ *Repair Service* (Book a Repair)\n' +
    '3️⃣ *Track Repair* (Live Status of your Laptop)\n' +
    '4️⃣ *Get Quotation* (Find by Budget)\n' +
    '5️⃣ *Shop Location & Hours*\n' +
    '6️⃣ *Talk to Human Agent*');
}

// GET /api/whatsapp/settings
router.get('/settings', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM whatsapp_settings WHERE id = 1');
    return res.json({
      success: true,
      data: result.rows[0] || {}
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/whatsapp/settings
router.put('/settings', async (req, res, next) => {
  try {
    const { connected, number, businessName, botEnabled, humanHandoff, salesAccess, autoStatusNotifications, welcomeMessage, shopLocation } = req.body;

    const updateRes = await db.query(
      `UPDATE whatsapp_settings SET
        connected = COALESCE($1, connected),
        number = COALESCE($2, number),
        business_name = COALESCE($3, business_name),
        bot_enabled = COALESCE($4, bot_enabled),
        human_handoff = COALESCE($5, human_handoff),
        sales_access = COALESCE($6, sales_access),
        auto_status_notifications = COALESCE($7, auto_status_notifications),
        welcome_message = COALESCE($8, welcome_message),
        shop_location = COALESCE($9, shop_location),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
      [connected, number, businessName, botEnabled, humanHandoff, salesAccess, autoStatusNotifications, welcomeMessage, shopLocation]
    );

    emitEvent('whatsapp.settings_updated', updateRes.rows[0]);

    return res.json({
      success: true,
      message: 'WhatsApp settings updated successfully',
      data: updateRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/whatsapp/conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const convRes = await db.query('SELECT * FROM whatsapp_conversations ORDER BY updated_at DESC');
    const conversations = [];

    for (const conv of convRes.rows) {
      const msgRes = await db.query(
        'SELECT * FROM whatsapp_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conv.id]
      );
      conversations.push({
        id: conv.id,
        contact: conv.contact,
        name: conv.name,
        status: conv.status,
        botState: conv.bot_state,
        leadType: conv.lead_type,
        lastMessage: conv.last_message,
        updatedAt: conv.updated_at,
        messages: msgRes.rows.map(m => ({
          id: m.id,
          direction: m.direction,
          text: m.text,
          tag: m.tag,
          at: m.created_at
        }))
      });
    }

    return res.json({
      success: true,
      data: conversations
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/whatsapp/conversations/simulate - Create simulated customer conversation
router.post('/conversations/simulate', async (req, res, next) => {
  try {
    const { name, contact, message } = req.body;
    if (!name || !contact) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Name and contact are required.'
      });
    }

    const cleanContact = String(contact).trim();
    const cleanName = String(name).trim();

    let conv = null;
    const existing = await db.query('SELECT * FROM whatsapp_conversations WHERE contact = $1', [cleanContact]);
    if (existing.rows.length > 0) {
      conv = existing.rows[0];
    } else {
      const convId = await getNextEntityId('whatsapp_conversations', 'id', 'CONV', 4);
      const ins = await db.query(
        `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
         VALUES ($1, $2, $3, 'Bot Active', 'General')
         RETURNING *`,
        [convId, cleanContact, cleanName]
      );
      conv = ins.rows[0];
    }

    const text = message || 'Assalamualaikum';

    // Insert customer message
    await db.query(
      `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'in', $2, 'customer')`,
      [conv.id, text]
    );

    // Bot reply
    const replyText = await processBotReply(text, conv);
    if (replyText) {
      await db.query(
        `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, 'bot')`,
        [conv.id, replyText]
      );
      await db.query(
        `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [replyText, conv.id]
      );
    }

    emitEvent('whatsapp.conversation_updated', { conversationId: conv.id });

    return res.status(201).json({
      success: true,
      message: 'Conversation simulated successfully',
      data: { conversationId: conv.id }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/whatsapp/messages/send - Agent sends message / template
router.post('/messages/send', async (req, res, next) => {
  try {
    const { conversationId, text, tag } = req.body;
    if (!conversationId || !text) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Conversation ID and message text are required.'
      });
    }

    await db.query(
      `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, $3)`,
      [conversationId, text.trim(), tag || 'agent']
    );

    await db.query(
      `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [text.trim(), conversationId]
    );

    emitEvent('whatsapp.message_added', { conversationId, text: text.trim() });

    return res.json({
      success: true,
      message: 'Message sent'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/whatsapp/messages/customer-input - Simulate customer typing in chat
router.post('/messages/customer-input', async (req, res, next) => {
  try {
    const { conversationId, text } = req.body;
    if (!conversationId || !text) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Conversation ID and text are required.'
      });
    }

    const convRes = await db.query('SELECT * FROM whatsapp_conversations WHERE id = $1', [conversationId]);
    if (convRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Conversation not found.'
      });
    }
    const conv = convRes.rows[0];

    // Record incoming customer message
    await db.query(
      `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'in', $2, 'customer')`,
      [conversationId, text.trim()]
    );

    // If bot is active
    if (conv.status !== 'Human Handoff') {
      const reply = await processBotReply(text, conv);
      if (reply) {
        await db.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, 'bot')`,
          [conversationId, reply]
        );
        await db.query(
          `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [reply, conversationId]
        );
      }
    } else {
      await db.query(
        `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [text.trim(), conversationId]
      );
    }

    emitEvent('whatsapp.conversation_updated', { conversationId });

    return res.json({
      success: true,
      message: 'Message processed'
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/whatsapp/conversations/:id/handoff - Toggle human handoff
router.patch('/conversations/:id/handoff', async (req, res, next) => {
  try {
    const { id } = req.params;
    const convRes = await db.query('SELECT status FROM whatsapp_conversations WHERE id = $1', [id]);
    if (convRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Conversation not found.'
      });
    }

    const currentStatus = convRes.rows[0].status;
    const newStatus = currentStatus === 'Human Handoff' ? 'Bot Active' : 'Human Handoff';

    await db.query('UPDATE whatsapp_conversations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStatus, id]);
    emitEvent('whatsapp.conversation_updated', { conversationId: id, status: newStatus });

    return res.json({
      success: true,
      message: `Conversation switched to ${newStatus}`,
      data: { status: newStatus }
    });
  } catch (error) {
    next(error);
  }
});

// Baileys WhatsApp Connection Routes
const baileys = require('./baileys.service');

// GET /api/whatsapp/status - Live multi-device connection status & QR code
router.get('/status', (req, res) => {
  const status = baileys.getStatus();
  return res.json({
    success: true,
    data: status
  });
});

// POST /api/whatsapp/connect - Force generate QR code & start connection
router.post('/connect', async (req, res, next) => {
  try {
    await baileys.initWhatsApp(true);
    return res.json({
      success: true,
      message: 'WhatsApp multi-device connection initiated. Scan the QR code with WhatsApp on your phone.',
      data: baileys.getStatus()
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/whatsapp/disconnect - Disconnect & logout
router.post('/disconnect', async (req, res, next) => {
  try {
    const result = await baileys.disconnect();
    return res.json({
      success: true,
      message: 'WhatsApp session disconnected & logged out',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/whatsapp/send-test - Send test message
router.post('/send-test', async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'Phone number and message text are required.' });
    }
    await baileys.sendTextMessage(phone, message);
    return res.json({
      success: true,
      message: `Test WhatsApp message successfully sent to ${phone}!`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to send WhatsApp message. Is WhatsApp connected?'
    });
  }
});

module.exports = router;

