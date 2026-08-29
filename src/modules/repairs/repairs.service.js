const db = require('../../config/db');
const { getNextTrackingId, getNextEntityId, getNextInvoiceNo } = require('../../utils/codeGenerator');
const { validateOutflow } = require('../../utils/financialFormulas');
const InventoryService = require('../inventory/inventory.service');
const { emitEvent } = require('../../config/socket');

function simpleRepairStatus(status) {
  if (['Job Received', 'Diagnosis Received'].includes(status)) return 'Received';
  if (['Diagnosis in Progress', 'Diagnosis Completed'].includes(status)) return 'Checking';
  if (status === 'Waiting for Customer Approval') return 'Waiting for Approval';
  if (['Repair Approved', 'Work in Progress'].includes(status)) return 'Repair in Progress';
  if (status === 'Waiting for Parts') return 'Waiting for Part';
  if (['Work Completed', 'Ready for Delivery'].includes(status)) return 'Ready for Delivery';
  if (status === 'Delivered & Closed') return 'Delivered';
  if (['Repair Declined', 'Returned Without Repair', 'Cancelled'].includes(status)) return 'Cancelled';
  return status || 'Received';
}

function simpleRepairType(job) {
  if (typeof job === 'string') return job === 'Diagnosis Job' ? 'Diagnosis Job' : 'Service Job';
  const isDiag = job.job_type === 'Diagnosis Job' || job.origin_job_type === 'Diagnosis Job' || !!job.approval_status || job.status === 'Repair Approved';
  return isDiag ? 'Diagnosis Job' : 'Service Job';
}

class RepairService {
  /**
   * Recalculates and synchronizes linked invoice and receivable accounts
   */
  static async syncLinkedInvoice(repairId, client = db) {
    const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
    if (jobRes.rows.length === 0) return;
    const job = jobRes.rows[0];

    const linesRes = await client.query('SELECT * FROM repair_job_lines WHERE repair_job_id = $1', [repairId]);
    const partsRes = await client.query('SELECT * FROM repair_parts_used WHERE repair_job_id = $1', [repairId]);

    const setRes = await client.query('SELECT adjust_diagnosis_fee FROM business_settings WHERE id = 1');
    const adjustDiagnosisFee = setRes.rows.length > 0 && setRes.rows[0].adjust_diagnosis_fee === true;

    const isDiagOrigin = job.origin_job_type === 'Diagnosis Job' || job.job_type === 'Diagnosis Job';
    const isApproved = job.approval_status === 'Approved' || ['Repair Approved', 'Work in Progress', 'Waiting for Parts', 'Work Completed', 'Ready for Delivery', 'Delivered & Closed'].includes(job.status);

    let serviceTotal = 0;
    if (isDiagOrigin && isApproved && adjustDiagnosisFee) {
      // Diagnosis fee waived / adjusted into approved repair
      const nonDiagLines = linesRes.rows.filter(l => l.line_type !== 'diagnosis');
      serviceTotal = nonDiagLines.reduce((sum, line) => sum + (parseFloat(line.charges || 0) * parseInt(line.quantity || 1, 10)), 0) + parseFloat(job.extra_charges || 0);
    } else {
      serviceTotal = linesRes.rows.reduce((sum, line) => sum + (parseFloat(line.charges || 0) * parseInt(line.quantity || 1, 10)), 0) + parseFloat(job.extra_charges || 0);
    }

    const partsTotal = partsRes.rows.reduce((sum, part) => sum + (parseInt(part.quantity || 1, 10) * parseFloat(part.customer_charge || 0)), 0);
    const total = serviceTotal + partsTotal;
    const paid = Math.min(total, parseFloat(job.paid || 0));
    const balance = Math.max(0, total - paid);
    const payStatus = balance <= 0.005 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';

    // Update repair job total & paid
    await client.query(
      `UPDATE repair_jobs SET total = $1, paid = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [total, paid, repairId]
    );

    // Check or create linked invoice
    let invoiceId = job.invoice_id;
    const invoiceType = job.job_type === 'Diagnosis Job' && !isApproved ? 'Diagnosis Invoice' : 'Repair Invoice';
    const invoiceKey = job.job_type === 'Diagnosis Job' && !isApproved ? 'diagnosis' : 'repair';

    if (!invoiceId) {
      invoiceId = await getNextEntityId('invoices', 'id', 'RINV', 5, client);
      await client.query(
        `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          payment_status, is_voided, repair_job_id, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, 'Customer', $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, FALSE, $17, $18, $19
        )`,
        [
          invoiceId, job.tracking_id, invoiceType, invoiceKey, job.date, job.customer_id, job.customer_name, job.contact,
          partsTotal, serviceTotal, total, paid, paid, balance, job.payment_method || 'Cash',
          payStatus, repairId, job.created_by, job.created_by_name
        ]
      );
      await client.query('UPDATE repair_jobs SET invoice_id = $1 WHERE id = $2', [invoiceId, repairId]);
    } else {
      await client.query(
        `UPDATE invoices SET
          type = $1,
          type_key = $2,
          product_total = $3,
          service_total = $4,
          total = $5,
          paid = $6,
          balance = $7,
          payment_status = $8,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [
          invoiceType, invoiceKey,
          partsTotal, serviceTotal, total, paid, balance, payStatus, invoiceId
        ]
      );
    }

    // Refresh invoice items
    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);

    for (const line of linesRes.rows) {
      let lineDesc = line.condition || line.name;
      if (line.line_type === 'diagnosis') lineDesc = `Inspection & Diagnosis: ${line.name}`;
      if (line.line_type === 'approved_repair') lineDesc = `Approved Repair: ${line.name}`;

      const unitCharge = parseFloat(line.charges || 0);
      const qty = parseInt(line.quantity || 1, 10);
      const lineTotal = unitCharge * qty;

      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_type, service_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'service', $2, $3, $4, $5, $6, $7, 0.00, $8)`,
        [invoiceId, line.service_id, line.service_id || (line.line_type === 'diagnosis' ? 'DIAG' : 'SERVICE'), line.name, lineDesc, qty, unitCharge, lineTotal]
      );
    }

    if (parseFloat(job.extra_charges || 0) > 0) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_type, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'service', 'EXTRA', $2, $3, 1, $4, 0.00, $5)`,
        [invoiceId, `Extra Charge — ${job.extra_reason || 'Additional Work'}`, job.extra_reason || 'Extra Charge', parseFloat(job.extra_charges), parseFloat(job.extra_charges)]
      );
    }

    for (const part of partsRes.rows) {
      const qty = parseInt(part.quantity || 1, 10);
      const charge = parseFloat(part.customer_charge || 0);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [invoiceId, part.product_id, part.product_code, part.name, `Replacement Part: ${part.name}`, qty, charge, parseFloat(part.cost_price_snapshot || 0), qty * charge]
      );
    }

    // Sync Customer Receivable in accounts
    const accRes = await client.query('SELECT * FROM accounts WHERE invoice_id = $1 AND type = $2', [invoiceId, 'Customer Receivable']);
    if (balance > 0) {
      if (accRes.rows.length > 0) {
        await client.query(
          `UPDATE accounts SET amount = $1, remaining = $2, status = 'Open' WHERE id = $3`,
          [total, balance, accRes.rows[0].id]
        );
      } else {
        const accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
        await client.query(
          `INSERT INTO accounts (id, type, party_type, party_id, party_name, invoice_id, invoice_no, amount, remaining, status, date)
           VALUES ($1, 'Customer Receivable', 'Customer', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
          [accId, job.customer_id, job.customer_name, invoiceId, job.tracking_id, total, balance, job.date]
        );
      }
    } else if (accRes.rows.length > 0) {
      await client.query(`UPDATE accounts SET remaining = 0, status = 'Settled' WHERE id = $1`, [accRes.rows[0].id]);
    }
  }

  /**
   * Helper to append automated WhatsApp message to conversation
   */
  static async sendAutomatedWhatsapp(job, customUpdate = '', client = db) {
    try {
      const settingsRes = await client.query('SELECT auto_status_notifications FROM whatsapp_settings WHERE id = 1');
      if (settingsRes.rows.length > 0 && settingsRes.rows[0].auto_status_notifications === false) {
        return;
      }

      const cleanContact = String(job.contact || '').trim();
      if (!cleanContact) return;

      // Find or create conversation
      let convId = null;
      const convRes = await client.query('SELECT id FROM whatsapp_conversations WHERE contact = $1', [cleanContact]);
      if (convRes.rows.length > 0) {
        convId = convRes.rows[0].id;
      } else {
        convId = await getNextEntityId('whatsapp_conversations', 'id', 'CONV', 4, client);
        await client.query(
          `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
           VALUES ($1, $2, $3, 'Bot Active', 'Repair Notification')`,
          [convId, cleanContact, job.customer_name]
        );
      }

      const total = parseFloat(job.total || 0);
      const paid = parseFloat(job.paid || 0);
      const remaining = Math.max(0, total - paid);
      const payStatus = remaining <= 0.005 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
      const expected = job.expected_completion ? new Date(job.expected_completion).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: '2-digit' }) : (job.duration || 'Not specified');

      const device = [job.brand, job.model || job.product_name].filter(Boolean).join(' ') || job.product_type || 'Laptop/Device';
      let messageText = 
        `🔧 *LAPTOP REPAIR UPDATE*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 *Tracking ID:* ${job.tracking_id}\n` +
        `💻 *Device:* ${device}\n` +
        `⚡ *Problem:* ${job.problem || 'Hardware diagnosis'}\n` +
        `📊 *Status:* ${simpleRepairStatus(job.status)}\n` +
        `📅 *Expected Completion:* ${expected}\n` +
        `💰 *Total Bill:* PKR ${total.toLocaleString('en-PK', { maximumFractionDigits: 2 })}\n` +
        `💵 *Paid Advance:* PKR ${paid.toLocaleString('en-PK', { maximumFractionDigits: 2 })}\n` +
        `💳 *Balance Due:* PKR ${remaining.toLocaleString('en-PK', { maximumFractionDigits: 2 })} (${payStatus})\n`;

      if (customUpdate) {
        messageText += `📝 *Latest Note:* ${customUpdate}\n`;
      }

      messageText += 
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *Live Tracking:* Reply *3* or send *${job.tracking_id}* anytime to track live bench progress!`;

      await client.query(
        `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
         VALUES ($1, 'out', $2, 'tracking')`,
        [convId, messageText]
      );

      await client.query(
        `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [messageText, convId]
      );

      emitEvent('whatsapp.message_added', { conversationId: convId, text: messageText });
    } catch (err) {
      console.error('[WhatsApp Auto Notify Error]:', err);
    }
  }

  /**
   * Create Repair Job (Service Job vs Diagnosis Job)
   */
  static async createJob(jobData, user) {
    return await db.withTransaction(async (client) => {
      const {
        jobType, technicianId, priority, date, expectedCompletion, customerName, contact,
        categoryId, categoryName: reqCatName, productType, brand, model, serial, problem, lines, extraEnabled, extraCharges,
        extraReason, paid: reqPaid, paymentMethod, paymentReference, remarks, duration,
        // Diagnosis specific fields
        diagnosisServiceId, diagnosisServiceName, diagnosisFee, diagnosisDuration
      } = jobData;

      if (!customerName || !contact || !problem || !String(customerName).trim() || !String(contact).trim() || !String(problem).trim()) {
        const error = new Error('Customer name, contact and reported problem are required.');
        error.status = 400;
        throw error;
      }

      // 1. Validate Category (Required for both Service Job and Diagnosis Job)
      if (!categoryId) {
        const error = new Error('Repair Category is required.');
        error.status = 400;
        throw error;
      }

      const catRes = await client.query('SELECT id, name FROM repair_categories WHERE id = $1', [categoryId]);
      if (catRes.rows.length === 0) {
        const error = new Error('Selected repair category does not exist in the database.');
        error.status = 400;
        throw error;
      }
      const categoryName = catRes.rows[0].name;

      const isDiag = jobType === 'Diagnosis Job';
      let cleanLines = [];
      let total = 0;
      let extraAmt = 0;
      let diagFee = 0;

      if (isDiag) {
        // Diagnosis Intake
        let catalogDiagPrice = 1000.00;
        if (diagnosisServiceId) {
          const srvRes = await client.query('SELECT charges, name, duration FROM repair_services WHERE id = $1', [diagnosisServiceId]);
          if (srvRes.rows.length > 0) {
            catalogDiagPrice = parseFloat(srvRes.rows[0].charges || 0);
          }
        }

        if (diagnosisFee !== undefined && diagnosisFee !== null && diagnosisFee !== '') {
          diagFee = parseFloat(diagnosisFee);
        } else {
          diagFee = catalogDiagPrice;
        }

        if (isNaN(diagFee) || diagFee < 0) {
          const error = new Error('Diagnosis fee must be a valid non-negative number.');
          error.status = 400;
          throw error;
        }

        total = diagFee;
        cleanLines = [{
          serviceId: diagnosisServiceId || null,
          name: diagnosisServiceName ? diagnosisServiceName.trim() : 'Standard Laptop Diagnosis & Inspection',
          catalogPriceSnapshot: catalogDiagPrice,
          charges: diagFee,
          quantity: 1,
          duration: diagnosisDuration ? diagnosisDuration.trim() : '1-2 Hours',
          condition: 'Initial fault inspection & diagnostic testing',
          lineType: 'diagnosis'
        }];
      } else {
        // Service Job Intake
        if (!lines || !Array.isArray(lines) || lines.length === 0) {
          const error = new Error('Service Job requires at least one repair service line.');
          error.status = 400;
          throw error;
        }

        for (const l of lines) {
          const lineName = (l.name || '').trim();
          const unitCharge = parseFloat(l.charges !== undefined && l.charges !== null ? l.charges : (l.charge || 0));
          const qty = parseInt(l.quantity || 1, 10);
          let catalogPrice = l.catalogPriceSnapshot !== undefined ? parseFloat(l.catalogPriceSnapshot) : null;

          if (!lineName) {
            const error = new Error('All repair service lines must have a valid service name.');
            error.status = 400;
            throw error;
          }

          if (isNaN(unitCharge) || unitCharge < 0) {
            const error = new Error(`Invalid charged price for "${lineName}". Price must be a non-negative number.`);
            error.status = 400;
            throw error;
          }

          if (isNaN(qty) || qty <= 0) {
            const error = new Error(`Invalid quantity for "${lineName}". Quantity must be at least 1.`);
            error.status = 400;
            throw error;
          }

          // If catalog service selected, obtain master catalog price snapshot
          if (l.serviceId && catalogPrice === null) {
            const srvRes = await client.query('SELECT charges FROM repair_services WHERE id = $1', [l.serviceId]);
            if (srvRes.rows.length > 0) {
              catalogPrice = parseFloat(srvRes.rows[0].charges || 0);
            }
          }
          if (catalogPrice === null || isNaN(catalogPrice)) {
            catalogPrice = unitCharge;
          }

          cleanLines.push({
            serviceId: l.serviceId || null,
            name: lineName,
            catalogPriceSnapshot: catalogPrice,
            charges: unitCharge,
            quantity: qty,
            duration: (l.duration || '').trim(),
            condition: (l.condition || '').trim(),
            lineType: 'repair'
          });
        }

        extraAmt = extraEnabled === 'Yes' ? parseFloat(extraCharges || 0) : 0;
        if (extraEnabled === 'Yes' && (isNaN(extraAmt) || extraAmt <= 0 || !extraReason || !String(extraReason).trim())) {
          const error = new Error('Valid extra charge amount and reason are required when extra charges are enabled.');
          error.status = 400;
          throw error;
        }

        const linesTotal = cleanLines.reduce((sum, l) => sum + (l.charges * l.quantity), 0);
        total = linesTotal + extraAmt;
      }

      const numPaid = reqPaid === undefined || reqPaid === null || reqPaid === '' ? 0 : parseFloat(reqPaid);
      if (isNaN(numPaid) || numPaid < 0) {
        const error = new Error('Paid advance cannot be negative.');
        error.status = 400;
        throw error;
      }

      if (numPaid > total + 0.005) {
        const error = new Error(`Paid amount (PKR ${numPaid.toFixed(2)}) cannot exceed total bill amount of PKR ${total.toFixed(2)}.`);
        error.status = 400;
        throw error;
      }
      const paid = numPaid;

      const cleanName = customerName.trim();
      const cleanContact = contact.trim();

      // Ensure customer
      let customerId = null;
      const custRes = await client.query(
        `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
        [cleanName, cleanContact]
      );
      if (custRes.rows.length > 0) {
        customerId = custRes.rows[0].id;
      } else {
        customerId = await getNextEntityId('customers', 'id', 'CUS', 4, client);
        await client.query(`INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`, [customerId, cleanName, cleanContact]);
      }

      let techName = 'Unassigned';
      if (technicianId) {
        const techRes = await client.query('SELECT name FROM users WHERE id = $1', [technicianId]);
        if (techRes.rows.length > 0) {
          techName = techRes.rows[0].name;
        }
      }

      const trackingId = await getNextTrackingId(client);
      const repairId = await getNextEntityId('repair_jobs', 'id', 'REP', 5, client);
      const initialStatus = isDiag ? 'Diagnosis Received' : 'Job Received';

      const jobRes = await client.query(
        `INSERT INTO repair_jobs (
          id, tracking_id, job_type, origin_job_type, date, customer_id, customer_name, contact,
          technician_id, technician_name, priority, category_id, category_name, product_type, brand, model, serial, problem,
          extra_charges, extra_reason, total, paid, initial_paid, payment_method, payment_reference,
          remarks, status, duration, expected_completion, diagnosis_fee, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30, $31, $32
        ) RETURNING *`,
        [
          repairId, trackingId, isDiag ? 'Diagnosis Job' : 'Service Job', isDiag ? 'Diagnosis Job' : 'Service Job', date || new Date(),
          customerId, cleanName, cleanContact, technicianId || null, techName, priority || 'Normal',
          categoryId, categoryName, productType || categoryName, brand || null, model || null, serial || null, problem.trim(),
          extraAmt, isDiag ? null : (extraReason ? extraReason.trim() : null), total, paid, paid, paymentMethod || 'Cash',
          paymentReference ? paymentReference.trim() : null, remarks ? remarks.trim() : null, initialStatus,
          isDiag ? (cleanLines[0]?.duration || '1-2 Hours') : (duration || null), expectedCompletion || null,
          isDiag ? diagFee : 0, user.id, user.name
        ]
      );

      // Insert service lines with catalog snapshot, charges, and quantity
      for (const line of cleanLines) {
        await client.query(
          `INSERT INTO repair_job_lines (repair_job_id, service_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [repairId, line.serviceId || null, line.name, line.catalogPriceSnapshot, line.charges, line.quantity, line.duration || null, line.condition || null, line.lineType || 'repair']
        );
      }

      // Insert initial history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [repairId, initialStatus, isDiag ? `Diagnosis Job received for ${categoryName} and assigned to ${techName}` : `Service Job created for ${categoryName} and assigned to ${techName}`, user.id, user.name]
      );

      // If initial payment paid
      if (paid > 0) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes,
            affects_money, is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, 'Customer', $3, $4, 'Customer Receivable',
            'Received', $5, $6, $7, $8, $9,
            TRUE, TRUE, $10, $11
          )`,
          [
            payId, trackingId, customerId, cleanName,
            paid, date || new Date(), paymentMethod || 'Cash', paymentReference || null,
            isDiag ? 'Diagnosis fee advance payment' : 'Initial repair job advance payment',
            user.id, user.name
          ]
        );
      }

      // Sync linked invoice & receivables
      await RepairService.syncLinkedInvoice(repairId, client);

      const finalJobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      const createdJob = finalJobRes.rows[0];
      await RepairService.sendAutomatedWhatsapp(createdJob, isDiag ? 'Device received for technical diagnosis and quotation.' : 'Job created and received at repair desk.', client);

      emitEvent('repair.created', createdJob);

      return createdJob;
    });
  }

  /**
   * Technician technical update
   */
  static async technicalUpdate(repairId, updateData, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      const {
        status: reqStatus, expectedCompletion, workProgress, quotationAmount, diagnosedIssue,
        recommendedSolution, technicalNotes, testingResult, warrantyDays, finalRemarks,
        updateNote, partId, partQty, partCharge
      } = updateData;

      if (!updateNote || String(updateNote).trim() === '') {
        const error = new Error('Short update note is required.');
        error.status = 400;
        throw error;
      }

      let newStatus = reqStatus || job.status;
      const isOriginalDiag = job.origin_job_type === 'Diagnosis Job' || job.job_type === 'Diagnosis Job';
      const isApproved = job.approval_status === 'Approved' || ['Repair Approved', 'Work in Progress', 'Waiting for Parts', 'Work Completed', 'Ready for Delivery', 'Delivered & Closed'].includes(job.status);

      // APPROVAL BARRIER: Backend strictly blocks advancing diagnosis jobs into repair phases before approval
      if (isOriginalDiag && !isApproved && ['Work in Progress', 'Repair Approved', 'Waiting for Parts', 'Testing & Quality Check', 'Work Completed', 'Ready for Delivery', 'Delivered & Closed'].includes(newStatus)) {
        const error = new Error('Customer quotation approval is required before repair work can begin.');
        error.status = 400;
        throw error;
      }

      if (newStatus === 'Waiting for Customer Approval') {
        const issue = diagnosedIssue || job.diagnosed_issue;
        const solution = recommendedSolution || job.recommended_solution;
        const estimate = parseFloat(quotationAmount || job.quotation_amount || 0);

        if (!issue || !solution || isNaN(estimate) || estimate <= 0) {
          const error = new Error('Diagnosed issue, recommended solution, and valid quotation amount (> PKR 0) are required before requesting customer approval.');
          error.status = 400;
          throw error;
        }
      }

      // If technician consumed a spare part
      if (partId && String(partId).trim() !== '') {
        if (isOriginalDiag && !isApproved) {
          const error = new Error('Spare parts cannot be issued or consumed before customer quotation approval.');
          error.status = 400;
          throw error;
        }

        const qty = parseInt(partQty || 1, 10);
        if (isNaN(qty) || qty <= 0) {
          const error = new Error('Issued spare part quantity must be at least 1.');
          error.status = 400;
          throw error;
        }
        let charge = parseFloat(partCharge || 0);
        if (isNaN(charge) || charge < 0) charge = 0;

        // 1. Check dedicated repair_parts first
        const partRes = await client.query('SELECT * FROM repair_parts WHERE id = $1 FOR UPDATE', [partId]);
        if (partRes.rows.length > 0) {
          const part = partRes.rows[0];
          if (qty > part.current_stock) {
            const error = new Error(`Insufficient stock for spare part ${part.code} (${part.name}). Available: ${part.current_stock}, Requested: ${qty}`);
            error.status = 400;
            error.code = 'INSUFFICIENT_STOCK';
            throw error;
          }

          // Deduct repair_parts current_stock
          await client.query(
            'UPDATE repair_parts SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [qty, part.id]
          );

          if (charge === 0 && parseFloat(part.selling_price || 0) > 0) {
            charge = parseFloat(part.selling_price || 0);
          }

          // Record in repair_parts_used
          await client.query(
            `INSERT INTO repair_parts_used (
              repair_job_id, part_id, product_code, name, quantity, customer_charge,
              cost_price_snapshot, added_by, added_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              job.id, part.id, part.code,
              part.name,
              qty, charge, parseFloat(part.cost_price || 0), user.id, user.name
            ]
          );
        } else {
          // 2. Legacy fallback to products if matching product
          const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [partId]);
          if (prodRes.rows.length === 0) {
            const error = new Error('Selected replacement spare part not found.');
            error.status = 404;
            throw error;
          }
          const product = prodRes.rows[0];
          if (qty > product.current_stock) {
            const error = new Error(`Insufficient stock for ${product.code}. Available: ${product.current_stock}, Requested: ${qty}`);
            error.status = 400;
            error.code = 'INSUFFICIENT_STOCK';
            throw error;
          }

          await InventoryService.adjustStock({
            productId: product.id,
            direction: 'OUT',
            quantity: qty,
            reason: `Repair part used — ${job.tracking_id}`,
            refType: 'Repair Job',
            refId: job.id,
            date: new Date(),
            user
          }, client);

          await client.query(
            `INSERT INTO repair_parts_used (
              repair_job_id, product_id, product_code, name, quantity, customer_charge,
              cost_price_snapshot, added_by, added_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              job.id, product.id, product.code,
              `${product.brand} ${product.model || product.product_name || ''}`.trim(),
              qty, charge, parseFloat(product.cost_price || 0), user.id, user.name
            ]
          );
        }
      }

      let approvalStatus = job.approval_status;
      let approvalRequestedAt = job.approval_requested_at;

      if (newStatus === 'Waiting for Customer Approval') {
        approvalStatus = 'Pending';
        approvalRequestedAt = new Date();
      }

      // Update repair job
      const updateRes = await client.query(
        `UPDATE repair_jobs SET
          status = $1,
          expected_completion = COALESCE($2, expected_completion),
          work_progress = COALESCE($3, work_progress),
          quotation_amount = COALESCE($4, quotation_amount),
          diagnosed_issue = COALESCE($5, diagnosed_issue),
          recommended_solution = COALESCE($6, recommended_solution),
          technical_notes = COALESCE($7, technical_notes),
          testing_result = COALESCE($8, testing_result),
          warranty_days = COALESCE($9, warranty_days),
          final_remarks = COALESCE($10, final_remarks),
          approval_status = $11,
          approval_requested_at = $12,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $13
         RETURNING *`,
        [
          newStatus,
          expectedCompletion || null,
          workProgress !== undefined ? parseInt(workProgress, 10) : null,
          quotationAmount !== undefined && quotationAmount !== '' ? parseFloat(quotationAmount) : null,
          diagnosedIssue ? diagnosedIssue.trim() : null,
          recommendedSolution ? recommendedSolution.trim() : null,
          technicalNotes ? technicalNotes.trim() : null,
          testingResult || null,
          warrantyDays !== undefined ? parseInt(warrantyDays, 10) : null,
          finalRemarks ? finalRemarks.trim() : null,
          approvalStatus,
          approvalRequestedAt,
          repairId
        ]
      );

      // Log status history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [repairId, newStatus, updateNote.trim(), user.id, user.name]
      );

      // Recalculate linked invoice
      await RepairService.syncLinkedInvoice(repairId, client);

      const updatedJob = updateRes.rows[0];
      await RepairService.sendAutomatedWhatsapp(updatedJob, finalRemarks || updateNote, client);

      emitEvent('repair.updated', updatedJob);

      return updatedJob;
    });
  }

  /**
   * Approve Diagnosis Job Quotation
   */
  static async approveQuote(repairId, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];
      const quoteAmt = parseFloat(job.quotation_amount || 0);

      // Convert to active service job
      await client.query(
        `UPDATE repair_jobs SET
          job_type = 'Service Job',
          status = 'Repair Approved',
          approval_status = 'Approved',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = $1,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [user?.name || 'Customer / Sales', repairId]
      );

      // Add approved repair line if quotation amount > 0
      if (quoteAmt > 0) {
        const checkLine = await client.query('SELECT id FROM repair_job_lines WHERE repair_job_id = $1 AND (is_approved_repair_line = TRUE OR line_type = $2)', [repairId, 'approved_repair']);
        if (checkLine.rows.length === 0) {
          await client.query(
            `INSERT INTO repair_job_lines (repair_job_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type, is_approved_repair_line)
             VALUES ($1, $2, $3, $3, 1, $4, 'Approved repair service after diagnosis', 'approved_repair', TRUE)`,
            [repairId, job.recommended_solution || 'Approved Repair Work', quoteAmt, job.duration || '1-2 Days']
          );
        }
      }

      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Repair Approved', 'Customer approved the quotation. Hardware repair work may now proceed.', $2, $3)`,
        [repairId, user?.id || null, user?.name || 'Customer']
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], 'Quotation approved. Repair work has been queued on the technician workbench.', client);

      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Decline Diagnosis Job Quotation
   */
  static async declineQuote(repairId, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }

      await client.query(
        `UPDATE repair_jobs SET
          status = 'Repair Declined',
          approval_status = 'Declined',
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [repairId]
      );

      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Repair Declined', 'Customer declined the repair quotation. Only diagnostic inspection charges apply.', $2, $3)`,
        [repairId, user?.id || null, user?.name || 'Customer']
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], 'Repair quote was declined. The device is assembled and ready for counter collection after diagnosis fee.', client);

      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Collect Repair Payment installment
   */
  static async collectPayment(repairId, paymentData, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      const { amount: reqAmt, paymentMethod, reference, note, date } = paymentData;
      const payAmount = parseFloat(reqAmt || 0);
      const remaining = Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0));

      if (payAmount <= 0 || payAmount > remaining + 0.005) {
        const error = new Error(`Payment amount must be between PKR 1 and remaining balance of PKR ${remaining.toFixed(2)}.`);
        error.status = 400;
        throw error;
      }

      const pMethod = paymentMethod || 'Cash';
      const newPaid = parseFloat(job.paid || 0) + payAmount;
      const newRemaining = Math.max(0, parseFloat(job.total || 0) - newPaid);

      await client.query(
        `UPDATE repair_jobs SET paid = $1, payment_method = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [newPaid, pMethod, repairId]
      );

      // Record payment
      const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
      await client.query(
        `INSERT INTO payments (
          id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
          direction, amount, date, payment_method, reference_id, notes, affects_money,
          is_initial_settlement, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
          'Received', $6, $7, $8, $9, $10, TRUE, FALSE, $11, $12
        )`,
        [
          payId, job.invoice_id, job.tracking_id, job.customer_id, job.customer_name,
          payAmount, date || new Date(), pMethod, reference || null, note || 'Repair installment payment',
          user.id, user.name
        ]
      );

      // Log history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId, job.status,
          `Payment received: PKR ${payAmount.toLocaleString('en-PK', { maximumFractionDigits: 2 })} via ${pMethod}. Remaining: PKR ${newRemaining.toLocaleString('en-PK', { maximumFractionDigits: 2 })}.`,
          user.id, user.name
        ]
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], `Payment received: PKR ${payAmount.toFixed(2)}. Remaining balance: PKR ${newRemaining.toFixed(2)}.`, client);

      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Atomic Pay & Deliver Handover
   */
  static async payAndDeliver(repairId, paymentData, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];
      const remaining = Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0));

      // If remaining balance exists, collect it
      if (remaining > 0.005) {
        const payAmount = paymentData?.amount ? parseFloat(paymentData.amount) : remaining;
        if (payAmount < remaining - 0.005) {
          const error = new Error(`Cannot deliver device with outstanding balance. Full payment of PKR ${remaining.toFixed(2)} is required.`);
          error.status = 400;
          throw error;
        }

        const pMethod = paymentData?.paymentMethod || 'Cash';
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);

        await client.query(
          `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
            'Received', $6, CURRENT_DATE, $7, $8, 'Final clearance payment before delivery', TRUE, FALSE, $9, $10
          )`,
          [
            payId, job.invoice_id, job.tracking_id, job.customer_id, job.customer_name,
            remaining, pMethod, paymentData?.reference || null, user.id, user.name
          ]
        );

        await client.query('UPDATE repair_jobs SET paid = total WHERE id = $1', [repairId]);
      }

      // Mark delivered & closed
      await client.query(
        `UPDATE repair_jobs SET status = 'Delivered & Closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [repairId]
      );

      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Delivered & Closed', 'Product handed over to customer. Payment balance fully cleared and repair closed.', $2, $3)`,
        [repairId, user.id, user.name]
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], 'Product delivered and repair job successfully closed. Thank you!', client);

      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Add / Issue a spare part to a repair job
   */
  static async addUsedPart(repairId, partData, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];
      const isOriginalDiag = job.origin_job_type === 'Diagnosis Job';
      const isApproved = !isOriginalDiag || job.approval_status === 'Approved' || ['Repair Approved', 'Work in Progress', 'Waiting for Parts', 'Work Completed', 'Ready for Delivery', 'Delivered & Closed'].includes(job.status);

      if (isOriginalDiag && !isApproved) {
        const error = new Error('Spare parts cannot be issued or consumed before customer quotation approval.');
        error.status = 400;
        throw error;
      }

      const { partId, quantity, customerCharge } = partData;
      if (!partId) {
        const error = new Error('Spare part selection is required.');
        error.status = 400;
        throw error;
      }

      const qty = parseInt(quantity || 1, 10);
      if (isNaN(qty) || qty <= 0) {
        const error = new Error('Issued spare part quantity must be at least 1.');
        error.status = 400;
        throw error;
      }

      let charge = customerCharge !== undefined && customerCharge !== null && customerCharge !== '' ? parseFloat(customerCharge) : 0;
      if (isNaN(charge) || charge < 0) charge = 0;

      // Check repair_parts first
      const partRes = await client.query('SELECT * FROM repair_parts WHERE id = $1 FOR UPDATE', [partId]);
      if (partRes.rows.length > 0) {
        const part = partRes.rows[0];
        if (qty > part.current_stock) {
          const error = new Error(`Insufficient stock for spare part ${part.code} (${part.name}). In stock: ${part.current_stock}, Requested: ${qty}`);
          error.status = 400;
          throw error;
        }

        // Deduct current_stock
        await client.query(
          'UPDATE repair_parts SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [qty, part.id]
        );

        if (charge === 0 && parseFloat(part.selling_price || 0) > 0) {
          charge = parseFloat(part.selling_price || 0);
        }

        await client.query(
          `INSERT INTO repair_parts_used (
            repair_job_id, part_id, product_code, name, quantity, customer_charge,
            cost_price_snapshot, added_by, added_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            job.id, part.id, part.code,
            part.name,
            qty, charge, parseFloat(part.cost_price || 0), user?.id || null, user?.name || 'Technician'
          ]
        );

        await client.query(
          `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            repairId, job.status,
            `Spare part issued: ${part.name} (Qty: ${qty}, Charge: PKR ${charge.toFixed(2)})`,
            user?.id || null, user?.name || 'Technician'
          ]
        );
      } else {
        // Fallback to products
        const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [partId]);
        if (prodRes.rows.length === 0) {
          const error = new Error('Spare part not found in inventory catalog.');
          error.status = 404;
          throw error;
        }
        const product = prodRes.rows[0];
        if (qty > product.current_stock) {
          const error = new Error(`Insufficient stock for ${product.code}. In stock: ${product.current_stock}, Requested: ${qty}`);
          error.status = 400;
          throw error;
        }

        await InventoryService.adjustStock({
          productId: product.id,
          direction: 'OUT',
          quantity: qty,
          reason: `Repair part used — ${job.tracking_id}`,
          refType: 'Repair Job',
          refId: job.id,
          date: new Date(),
          user
        }, client);

        await client.query(
          `INSERT INTO repair_parts_used (
            repair_job_id, product_id, product_code, name, quantity, customer_charge,
            cost_price_snapshot, added_by, added_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            job.id, product.id, product.code,
            `${product.brand} ${product.model || product.product_name || ''}`.trim(),
            qty, charge, parseFloat(product.cost_price || 0), user?.id || null, user?.name || 'Technician'
          ]
        );
      }

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Update an already-issued spare part (quantity or charge)
   */
  static async updateUsedPart(repairId, usedPartId, updateData, user) {
    return await db.withTransaction(async (client) => {
      const usedRes = await client.query(
        'SELECT * FROM repair_parts_used WHERE id = $1 AND repair_job_id = $2 FOR UPDATE',
        [usedPartId, repairId]
      );
      if (usedRes.rows.length === 0) {
        const error = new Error('Issued spare part record not found on this repair job.');
        error.status = 404;
        throw error;
      }
      const used = usedRes.rows[0];
      const oldQty = parseInt(used.quantity || 1, 10);
      const newQty = updateData.quantity !== undefined ? parseInt(updateData.quantity, 10) : oldQty;
      const newCharge = updateData.customerCharge !== undefined ? parseFloat(updateData.customerCharge) : parseFloat(used.customer_charge || 0);

      if (isNaN(newQty) || newQty <= 0) {
        const error = new Error('Part quantity must be at least 1.');
        error.status = 400;
        throw error;
      }
      if (isNaN(newCharge) || newCharge < 0) {
        const error = new Error('Customer charge must be a non-negative number.');
        error.status = 400;
        throw error;
      }

      const qtyDiff = newQty - oldQty;

      if (used.part_id) {
        if (qtyDiff > 0) {
          const partRes = await client.query('SELECT current_stock, name, code FROM repair_parts WHERE id = $1 FOR UPDATE', [used.part_id]);
          if (partRes.rows.length > 0 && partRes.rows[0].current_stock < qtyDiff) {
            const error = new Error(`Insufficient stock to add ${qtyDiff} more units. Available: ${partRes.rows[0].current_stock}`);
            error.status = 400;
            throw error;
          }
        }
        if (qtyDiff !== 0) {
          await client.query(
            'UPDATE repair_parts SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [qtyDiff, used.part_id]
          );
        }
      } else if (used.product_id && qtyDiff !== 0) {
        await InventoryService.adjustStock({
          productId: used.product_id,
          direction: qtyDiff > 0 ? 'OUT' : 'IN',
          quantity: Math.abs(qtyDiff),
          reason: `Repair part quantity adjustment on ${repairId}`,
          refType: 'Repair Job',
          refId: repairId,
          date: new Date(),
          user
        }, client);
      }

      await client.query(
        `UPDATE repair_parts_used SET quantity = $1, customer_charge = $2 WHERE id = $3`,
        [newQty, newCharge, usedPartId]
      );

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId, jobRes.rows[0].status,
          `Spare part updated: ${used.name} (New Qty: ${newQty}, New Charge: PKR ${newCharge.toFixed(2)})`,
          user?.id || null, user?.name || 'Technician'
        ]
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Remove an issued spare part and restore stock
   */
  static async removeUsedPart(repairId, usedPartId, user) {
    return await db.withTransaction(async (client) => {
      const usedRes = await client.query(
        'SELECT * FROM repair_parts_used WHERE id = $1 AND repair_job_id = $2 FOR UPDATE',
        [usedPartId, repairId]
      );
      if (usedRes.rows.length === 0) {
        const error = new Error('Issued spare part record not found on this repair job.');
        error.status = 404;
        throw error;
      }
      const used = usedRes.rows[0];
      const returnQty = parseInt(used.quantity || 1, 10);

      // Return stock back to inventory
      if (used.part_id) {
        await client.query(
          'UPDATE repair_parts SET current_stock = current_stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [returnQty, used.part_id]
        );
      } else if (used.product_id) {
        await InventoryService.adjustStock({
          productId: used.product_id,
          direction: 'IN',
          quantity: returnQty,
          reason: `Repair part returned from job ${repairId}`,
          refType: 'Repair Job',
          refId: repairId,
          date: new Date(),
          user
        }, client);
      }

      await client.query('DELETE FROM repair_parts_used WHERE id = $1', [usedPartId]);

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId, jobRes.rows[0].status,
          `Spare part removed: ${used.name} (${returnQty} units returned to inventory)`,
          user?.id || null, user?.name || 'Technician'
        ]
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Get full repair job card details
   */
  static async getJobDetails(repairId, userRole = 'admin') {
    const jobRes = await db.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
    if (jobRes.rows.length === 0) return null;
    const job = jobRes.rows[0];

    const linesRes = await db.query('SELECT * FROM repair_job_lines WHERE repair_job_id = $1 ORDER BY id ASC', [repairId]);
    
    // If technician, mask cost_price_snapshot
    const partsRes = await db.query(
      `SELECT 
        id, repair_job_id, part_id, product_id, product_code, name, quantity, customer_charge,
        ${userRole === 'technician' ? '0.00 as cost_price_snapshot' : 'cost_price_snapshot'},
        added_by, added_by_name, added_at
       FROM repair_parts_used 
       WHERE repair_job_id = $1 ORDER BY id ASC`,
      [repairId]
    );

    const historyRes = await db.query(
      `SELECT * FROM repair_status_history WHERE repair_job_id = $1 ORDER BY created_at DESC`,
      [repairId]
    );

    const paymentsRes = await db.query(
      `SELECT * FROM payments WHERE invoice_no = $1 OR invoice_id = $2 ORDER BY date ASC, created_at ASC`,
      [job.tracking_id, job.invoice_id]
    );

    const isTech = userRole === 'technician';

    return {
      id: job.id,
      trackingId: job.tracking_id,
      jobType: job.job_type,
      originJobType: job.origin_job_type,
      date: job.date,
      customerId: job.customer_id,
      customerName: job.customer_name,
      contact: job.contact,
      technicianId: job.technician_id,
      technicianName: job.technician_name,
      priority: job.priority,
      categoryId: job.category_id,
      categoryName: job.category_name,
      productType: job.product_type,
      brand: job.brand,
      model: job.model,
      serial: job.serial,
      problem: job.problem,
      diagnosisFee: isTech ? null : parseFloat(job.diagnosis_fee || 0),
      extraCharges: isTech ? null : parseFloat(job.extra_charges || 0),
      extraReason: isTech ? null : job.extra_reason,
      total: isTech ? null : parseFloat(job.total || 0),
      paid: isTech ? null : parseFloat(job.paid || 0),
      remaining: isTech ? null : Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0)),
      paymentMethod: isTech ? null : job.payment_method,
      paymentReference: isTech ? null : job.payment_reference,
      remarks: job.remarks,
      finalRemarks: job.final_remarks,
      diagnosedIssue: job.diagnosed_issue,
      recommendedSolution: job.recommended_solution,
      technicalNotes: job.technical_notes,
      workProgress: parseInt(job.work_progress || 0, 10),
      quotationAmount: isTech ? null : parseFloat(job.quotation_amount || 0),
      approvalStatus: job.approval_status,
      approvalRequestedAt: job.approval_requested_at,
      approvedAt: job.approved_at,
      approvedBy: job.approved_by,
      testingResult: job.testing_result,
      warrantyDays: parseInt(job.warranty_days || 0, 10),
      status: job.status,
      simpleStatus: simpleRepairStatus(job.status),
      duration: job.duration,
      expectedCompletion: job.expected_completion,
      invoiceId: isTech ? null : job.invoice_id,
      createdAt: job.created_at,
      lines: linesRes.rows.map(line => {
        const unitCharge = parseFloat(line.charges || 0);
        const qty = parseInt(line.quantity || 1, 10);
        return {
          id: line.id,
          serviceId: line.service_id,
          name: line.name,
          catalogPriceSnapshot: isTech ? null : parseFloat(line.catalog_price_snapshot !== null && line.catalog_price_snapshot !== undefined ? line.catalog_price_snapshot : unitCharge),
          charges: isTech ? null : unitCharge,
          quantity: qty,
          lineTotal: isTech ? null : unitCharge * qty,
          duration: line.duration,
          condition: line.condition,
          lineType: line.line_type || 'repair',
          isApprovedRepairLine: line.is_approved_repair_line
        };
      }),
      usedParts: partsRes.rows.map(part => {
        const unitCharge = parseFloat(part.customer_charge || 0);
        const qty = parseInt(part.quantity || 1, 10);
        return {
          id: part.id,
          partId: part.part_id || part.product_id,
          productId: part.product_id,
          productCode: part.product_code,
          name: part.name,
          quantity: qty,
          customerCharge: isTech ? null : unitCharge,
          costPriceSnapshot: isTech ? null : parseFloat(part.cost_price_snapshot || 0),
          lineTotal: isTech ? null : unitCharge * qty,
          addedBy: part.added_by_name || part.added_by,
          addedAt: part.added_at
        };
      }),
      history: historyRes.rows.map(h => ({
        id: h.id,
        status: h.status,
        note: h.note,
        by: h.performed_by_name || h.performed_by,
        at: h.created_at
      })),
      paymentHistory: isTech ? [] : paymentsRes.rows.map(p => ({
        id: p.id,
        amount: parseFloat(p.amount),
        method: p.payment_method,
        reference: p.reference_id,
        date: p.date,
        at: p.created_at,
        by: p.created_by_name || p.created_by,
        notes: p.notes
      }))
    };
  }
}

module.exports = RepairService;
