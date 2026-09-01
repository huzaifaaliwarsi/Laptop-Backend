const db = require('../../config/db');
const { getNextTrackingId, getNextEntityId, getNextInvoiceNo } = require('../../utils/codeGenerator');
const { validateOutflow } = require('../../utils/financialFormulas');
const InventoryService = require('../inventory/inventory.service');
const { emitEvent } = require('../../config/socket');
const {
  buildIntakeConfirmationTemplate,
  buildTrackingResponseTemplate,
  buildStatusUpdateTemplate,
  buildQuotationApprovalTemplate,
  buildApprovalConfirmationTemplate,
  buildDeclineConfirmationTemplate,
  buildPaymentReceiptTemplate,
  buildDeliveryClosedTemplate,
  buildAdditionalWorkApprovalTemplate,
  buildAdditionalWorkApprovedTemplate,
  buildAdditionalWorkDeclinedTemplate
} = require('../whatsapp/whatsapp.templates');

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

function getCreator(user) {
  const isSuper = user?.role === 'super_admin' || user?.isSuperAdmin;
  return {
    id: isSuper ? null : (user?.id || null),
    name: user?.name || (isSuper ? 'Platform Super Admin' : (user?.username || 'Staff'))
  };
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
  static async sendAutomatedWhatsapp(job, customMessageOrNote = '', client = db, options = {}) {
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

      let messageText = '';
      if (options.templateType === 'intake') {
        messageText = buildIntakeConfirmationTemplate({
          job,
          requestedService: options.requestedService,
          isDiagnosis: options.isDiagnosis
        });
      } else if (options.templateType === 'approval_request') {
        messageText = buildQuotationApprovalTemplate(job);
      } else if (options.templateType === 'approval_confirmed') {
        messageText = buildApprovalConfirmationTemplate(job);
      } else if (options.templateType === 'decline_confirmed') {
        messageText = buildDeclineConfirmationTemplate(job);
      } else if (options.templateType === 'payment_receipt') {
        messageText = buildPaymentReceiptTemplate({
          job,
          amountPaid: options.amountPaid,
          newBalance: options.newBalance
        });
      } else if (options.templateType === 'delivery_closed') {
        messageText = buildDeliveryClosedTemplate(job);
      } else if (typeof customMessageOrNote === 'string' && customMessageOrNote.includes('\n')) {
        // Pre-formatted custom template string
        messageText = customMessageOrNote;
      } else {
        // Status update template with customer-safe note
        messageText = buildStatusUpdateTemplate({
          job,
          safeNote: customMessageOrNote
        });
      }

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

      const creator = getCreator(user);

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
          isDiag ? diagFee : 0, creator.id, creator.name
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
        [repairId, initialStatus, isDiag ? `Diagnosis Job received for ${categoryName} and assigned to ${techName}` : `Service Job created for ${categoryName} and assigned to ${techName}`, creator.id, creator.name]
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
            creator.id, creator.name
          ]
        );
      }

      // Sync linked invoice & receivables
      await RepairService.syncLinkedInvoice(repairId, client);

      const finalJobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      const createdJob = finalJobRes.rows[0];

      const requestedService = isDiag
        ? (diagnosisServiceName || 'Diagnostic Inspection & Fault Analysis')
        : (lines && lines.length > 0 && lines[0].name ? lines.map(l => l.name).join(', ') : (problem || 'Standard Hardware Service'));

      await RepairService.sendAutomatedWhatsapp(createdJob, '', client, {
        templateType: 'intake',
        requestedService,
        isDiagnosis: isDiag
      });

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

      let validUserId = null;
      if (user?.id) {
        const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
      }

      let newStatus = reqStatus || job.status;
      const finalNote = (updateNote && String(updateNote).trim() !== '')
        ? String(updateNote).trim()
        : (finalRemarks && String(finalRemarks).trim())
        || (technicalNotes && String(technicalNotes).trim())
        || `Technical update on workbench (${newStatus})`;
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

          // Log in repair_parts_movements
          try {
            await client.query(
              `INSERT INTO repair_parts_movements (
                part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, balance_after, performed_by, performed_by_name
              ) VALUES ($1, $2, $3, 'OUT', $4, $5, 'Repair Job Issuance', $6, $7, $8, $9)`,
              [
                part.id, part.code, part.name, qty,
                `Issued to repair job ${job.id} (${job.customer_name})`,
                job.id,
                Math.max(0, parseInt(part.current_stock || 0, 10) - qty),
                user.id, user.name
              ]
            );
          } catch (mErr) {
            console.error('[Spare Parts Movement] Issuance log error:', mErr.message);
          }
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

      let parsedExpectedDate = null;
      let durationStr = updateData.duration || null;
      if (expectedCompletion && String(expectedCompletion).trim() !== '') {
        const str = String(expectedCompletion).trim();
        if (!isNaN(Date.parse(str))) {
          parsedExpectedDate = new Date(str);
        } else {
          durationStr = str;
          const match = str.match(/([0-9]+)\s*(?:day|d)/i);
          if (match) {
            const days = parseInt(match[1], 10);
            parsedExpectedDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          }
        }
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
          duration = COALESCE($14, duration),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $13
         RETURNING *`,
        [
          newStatus,
          parsedExpectedDate,
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
          repairId,
          durationStr
        ]
      );

      // Log status history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [repairId, newStatus, finalNote, validUserId, user?.name || 'Technician']
      );

      // Recalculate linked invoice
      await RepairService.syncLinkedInvoice(repairId, client);

      const updatedJob = updateRes.rows[0];
      if (newStatus === 'Waiting for Customer Approval') {
        await RepairService.sendAutomatedWhatsapp(updatedJob, '', client, { templateType: 'approval_request' });
      } else {
        await RepairService.sendAutomatedWhatsapp(updatedJob, finalRemarks || finalNote, client);
      }

      emitEvent('repair.updated', updatedJob);

      return updatedJob;
    });
  }

  /**
   * Approve Diagnosis Job Quotation (Atomic & Idempotent)
   */
  static async approveQuote(repairId, user, approvalSource = 'Admin') {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      // Idempotency: Reject if already resolved
      if (job.approval_status === 'Approved') {
        const error = new Error('This quotation has already been approved.');
        error.status = 400;
        throw error;
      }
      if (job.approval_status === 'Declined') {
        const error = new Error('This quotation has already been declined.');
        error.status = 400;
        throw error;
      }
      if (job.status !== 'Waiting for Customer Approval' && job.approval_status !== 'Pending') {
        const error = new Error('Repair job is not in a pending approval state.');
        error.status = 400;
        throw error;
      }

      const quoteAmt = parseFloat(job.quotation_amount || 0);

      let validUserId = null;
      if (user?.id) {
        const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
      }

      // Convert to active service job
      await client.query(
        `UPDATE repair_jobs SET
          job_type = 'Service Job',
          status = 'Repair Approved',
          approval_status = 'Approved',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = $1,
          approval_source = $2,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [user?.name || approvalSource || 'Customer', approvalSource, repairId]
      );

      // Add approved repair line if quotation amount > 0
      if (quoteAmt > 0) {
        const checkLine = await client.query(
          'SELECT id FROM repair_job_lines WHERE repair_job_id = $1 AND (is_approved_repair_line = TRUE OR line_type = $2)',
          [repairId, 'approved_repair']
        );
        if (checkLine.rows.length === 0) {
          await client.query(
            `INSERT INTO repair_job_lines (
              repair_job_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type, is_approved_repair_line
            ) VALUES ($1, $2, $3, $3, 1, $4, 'Approved repair service after diagnosis', 'approved_repair', TRUE)`,
            [repairId, job.recommended_solution || 'Approved Repair Work', quoteAmt, job.duration || '1-2 Days']
          );
        }
      }

      // Log status history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Repair Approved', $2, $3, $4)`,
        [
          repairId,
          `Repair quotation approved via ${approvalSource}: ${job.recommended_solution || 'Repair Work'} (PKR ${quoteAmt.toFixed(2)}). Hardware repair work may now proceed.`,
          validUserId,
          user?.name || approvalSource
        ]
      );

      // Clear WhatsApp bot state
      const cleanContact = String(job.contact || '').trim();
      if (cleanContact) {
        await client.query(
          `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
          [cleanContact]
        );
      }

      // Sync linked invoice & balances atomically
      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], '', client, { templateType: 'approval_confirmed' });

      emitEvent('repair.updated', refreshed.rows[0]);
      emitEvent('repair.approved', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Decline Diagnosis Job Quotation (Atomic & Idempotent)
   */
  static async declineQuote(repairId, user, approvalSource = 'Admin') {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      // Idempotency: Reject if already resolved
      if (job.approval_status === 'Declined') {
        const error = new Error('This quotation has already been declined.');
        error.status = 400;
        throw error;
      }
      if (job.approval_status === 'Approved') {
        const error = new Error('This quotation has already been approved.');
        error.status = 400;
        throw error;
      }
      if (job.status !== 'Waiting for Customer Approval' && job.approval_status !== 'Pending') {
        const error = new Error('Repair job is not in a pending approval state.');
        error.status = 400;
        throw error;
      }

      let validUserId = null;
      if (user?.id) {
        const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
      }

      await client.query(
        `UPDATE repair_jobs SET
          status = 'Repair Declined',
          approval_status = 'Declined',
          approval_source = $1,
          declined_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [approvalSource, repairId]
      );

      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Repair Declined', $2, $3, $4)`,
        [
          repairId,
          `Repair quotation declined via ${approvalSource}. Only diagnostic inspection charges (if applicable) apply.`,
          validUserId,
          user?.name || approvalSource
        ]
      );

      // Clear WhatsApp bot state
      const cleanContact = String(job.contact || '').trim();
      if (cleanContact) {
        await client.query(
          `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
          [cleanContact]
        );
      }

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], '', client, { templateType: 'decline_confirmed' });

      emitEvent('repair.updated', refreshed.rows[0]);
      emitEvent('repair.declined', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Collect Repair Payment installment
   */
  static async collectPayment(repairId, paymentData, user) {
    return await db.withTransaction(async (client) => {
      const { amount, paymentMethod, reference, date, note } = paymentData;
      const payAmount = parseFloat(amount || 0);

      if (payAmount <= 0) {
        const error = new Error('Payment amount must be greater than zero.');
        error.status = 400;
        throw error;
      }

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];
      const remaining = Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0));

      if (payAmount > remaining + 0.005) {
        const error = new Error(`Payment amount (PKR ${payAmount.toFixed(2)}) cannot exceed remaining balance (PKR ${remaining.toFixed(2)}).`);
        error.status = 400;
        throw error;
      }

      const pMethod = paymentMethod || 'Cash';
      const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);

      // 1. Record in payments table
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

      const newPaid = parseFloat(job.paid || 0) + payAmount;
      const newRemaining = Math.max(0, parseFloat(job.total || 0) - newPaid);

      await client.query(
        `UPDATE repair_jobs SET paid = $1, payment_method = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [newPaid, pMethod, repairId]
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
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], '', client, {
        templateType: 'payment_receipt',
        amountPaid: payAmount,
        newBalance: newRemaining
      });

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
      await RepairService.sendAutomatedWhatsapp(refreshed.rows[0], '', client, { templateType: 'delivery_closed' });

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

        // Log in repair_parts_movements
        try {
          await client.query(
            `INSERT INTO repair_parts_movements (
              part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, balance_after, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, 'OUT', $4, $5, 'Repair Job Issuance', $6, $7, $8, $9)`,
            [
              part.id, part.code, part.name, qty,
              `Issued to repair job ${job.id} (${job.customer_name})`,
              job.id,
              Math.max(0, parseInt(part.current_stock || 0, 10) - qty),
              user?.id || null, user?.name || 'Technician'
            ]
          );
        } catch (mErr) {
          console.error('[Spare Parts Movement] Issuance log error:', mErr.message);
        }

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

        try {
          await client.query(
            `INSERT INTO repair_parts_movements (
              part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, 'IN', $4, $5, 'Repair Job Return', $6, $7, $8)`,
            [
              used.part_id, used.product_code, used.name, returnQty,
              `Returned from repair job ${repairId}`,
              repairId,
              user?.id || null, user?.name || 'Technician'
            ]
          );
        } catch (mErr) {
          console.error('[Spare Parts Movement] Return log error:', mErr.message);
        }
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

  /**
   * Add an additional service line to an existing repair job
   */
  static async addServiceLine(repairId, lineData, user) {
    return await db.withTransaction(async (client) => {
      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      const { serviceId, name, charges, quantity, duration, condition } = lineData;
      let lineName = (name || '').trim();
      let unitCharge = parseFloat(charges !== undefined && charges !== null ? charges : 0);
      let qty = parseInt(quantity || 1, 10);
      let catalogPrice = unitCharge;

      if (serviceId) {
        const srvRes = await client.query('SELECT name, charges, duration FROM repair_services WHERE id = $1', [serviceId]);
        if (srvRes.rows.length > 0) {
          if (!lineName) lineName = srvRes.rows[0].name;
          catalogPrice = parseFloat(srvRes.rows[0].charges || 0);
          if (isNaN(unitCharge) || unitCharge === 0) unitCharge = catalogPrice;
        }
      }

      if (!lineName) {
        const error = new Error('Service name is required.');
        error.status = 400;
        throw error;
      }
      if (isNaN(unitCharge) || unitCharge < 0) unitCharge = 0;
      if (isNaN(qty) || qty <= 0) qty = 1;

      const insRes = await client.query(
        `INSERT INTO repair_job_lines (
          repair_job_id, service_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'repair')
        RETURNING *`,
        [
          repairId,
          serviceId || null,
          lineName,
          catalogPrice,
          unitCharge,
          qty,
          (duration || '').trim(),
          (condition || '').trim()
        ]
      );

      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId,
          job.status,
          `Additional service added: ${lineName} (Charge: PKR ${unitCharge.toFixed(2)}, Qty: ${qty})`,
          user?.id || null,
          user?.name || 'Technician'
        ]
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      emitEvent('repair.updated', refreshed.rows[0]);

      return {
        job: refreshed.rows[0],
        line: insRes.rows[0]
      };
    });
  }

  /**
   * Remove a service line from a repair job
   */
  static async removeServiceLine(repairId, lineId, user) {
    return await db.withTransaction(async (client) => {
      const lineRes = await client.query(
        'SELECT * FROM repair_job_lines WHERE id = $1 AND repair_job_id = $2 FOR UPDATE',
        [lineId, repairId]
      );
      if (lineRes.rows.length === 0) {
        const error = new Error('Service line not found on this repair job.');
        error.status = 404;
        throw error;
      }
      const line = lineRes.rows[0];

      await client.query('DELETE FROM repair_job_lines WHERE id = $1', [lineId]);

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId,
          jobRes.rows[0].status,
          `Service line removed: ${line.name}`,
          user?.id || null,
          user?.name || 'Technician'
        ]
      );

      await RepairService.syncLinkedInvoice(repairId, client);

      const refreshed = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);
      emitEvent('repair.updated', refreshed.rows[0]);

      return refreshed.rows[0];
    });
  }

  /**
   * Create an Additional Work Request for a Service Job
   */
  static async createAdditionalWorkRequest(repairId, requestData, user) {
    return await db.withTransaction(async (client) => {
      const {
        faultFinding,
        recommendedService,
        serviceCharge,
        partsCharge,
        customerSafeNote,
        parts
      } = requestData;

      if (!faultFinding || !recommendedService) {
        const error = new Error('Fault finding and recommended service are required.');
        error.status = 400;
        throw error;
      }

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      const sCharge = parseFloat(serviceCharge || 0);
      const pCharge = parseFloat(partsCharge || 0);
      const totalQuotation = sCharge + pCharge;

      const reqId = await getNextEntityId('repair_additional_work_requests', 'id', 'AWR', 4, client);
      const partsPayload = Array.isArray(parts) ? parts : [];

      const snapshot = {
        faultFinding: faultFinding.trim(),
        recommendedService: recommendedService.trim(),
        serviceCharge: sCharge,
        partsCharge: pCharge,
        totalQuotation,
        customerSafeNote: customerSafeNote ? customerSafeNote.trim() : '',
        parts: partsPayload,
        createdAt: new Date().toISOString()
      };

      let validUserId = null;
      if (user?.id) {
        const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
      }

      const insRes = await client.query(
        `INSERT INTO repair_additional_work_requests (
          id, repair_job_id, tracking_id, fault_finding, recommended_service,
          service_charge, parts_charge, total_quotation, customer_safe_note,
          parts_payload, status, quotation_snapshot, created_by, created_by_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending Approval', $11, $12, $13)
        RETURNING *`,
        [
          reqId, repairId, job.tracking_id, faultFinding.trim(), recommendedService.trim(),
          sCharge, pCharge, totalQuotation, customerSafeNote ? customerSafeNote.trim() : null,
          JSON.stringify(partsPayload), JSON.stringify(snapshot), validUserId, user?.name || 'Technician'
        ]
      );

      const createdRequest = insRes.rows[0];

      // Set WhatsApp conversation state for approval lookup
      const cleanContact = String(job.contact || '').trim();
      if (cleanContact) {
        const convRes = await client.query('SELECT id FROM whatsapp_conversations WHERE contact = $1', [cleanContact]);
        let convId = null;
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

        await client.query(
          `UPDATE whatsapp_conversations 
           SET bot_state = 'additional_work_approval', approval_tracking_id = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [job.tracking_id, convId]
        );

        // Send WhatsApp approval notification
        const approvalMsg = buildAdditionalWorkApprovalTemplate({
          job,
          workRequest: createdRequest
        });

        await client.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
           VALUES ($1, 'out', $2, 'approval_request')`,
          [convId, approvalMsg]
        );

        await client.query(
          `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [approvalMsg, convId]
        );

        emitEvent('whatsapp.message_added', { conversationId: convId, text: approvalMsg });
      }

      // Log in repair status history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId,
          job.status,
          `Additional fault discovered: ${faultFinding.trim()}. Additional work quote: PKR ${totalQuotation.toFixed(2)} sent for customer approval.`,
          validUserId,
          user?.name || 'Technician'
        ]
      );

      emitEvent('repair.additional_work_created', { repairId, request: createdRequest });
      emitEvent('repair.updated', job);

      return createdRequest;
    });
  }

  /**
   * Get all Additional Work Requests for a Repair Job
   */
  static async getAdditionalWorkRequests(repairId) {
    const res = await db.query(
      `SELECT * FROM repair_additional_work_requests 
       WHERE repair_job_id = $1 
       ORDER BY created_at DESC`,
      [repairId]
    );
    return res.rows;
  }

  /**
   * Approve an Additional Work Request (Idempotent)
   */
  static async approveAdditionalWorkRequest(repairId, requestId, user, approvalSource = 'Admin', customerResponse = null) {
    return await db.withTransaction(async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM repair_additional_work_requests 
         WHERE id = $1 AND repair_job_id = $2 FOR UPDATE`,
        [requestId, repairId]
      );
      if (reqRes.rows.length === 0) {
        const error = new Error('Additional work request not found.');
        error.status = 404;
        throw error;
      }
      const workRequest = reqRes.rows[0];

      // Idempotency: Reject if already approved or declined
      if (workRequest.status !== 'Pending Approval') {
        const error = new Error(`This additional work request has already been ${workRequest.status.toLowerCase()}.`);
        error.status = 400;
        throw error;
      }

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      let validUserId = null;
      if (user?.id) {
        const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
      }

      // 1. Mark request as Approved
      const updReq = await client.query(
        `UPDATE repair_additional_work_requests SET
          status = 'Approved',
          approval_source = $1,
          approved_by = $2,
          approved_by_name = $3,
          customer_response = $4,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [
          approvalSource,
          validUserId,
          user?.name || approvalSource,
          customerResponse || `Approved via ${approvalSource}`,
          requestId
        ]
      );
      const approvedRequest = updReq.rows[0];

      // 2. Add approved service line into repair_job_lines
      const serviceCharge = parseFloat(workRequest.service_charge || 0);
      if (serviceCharge > 0 || workRequest.recommended_service) {
        await client.query(
          `INSERT INTO repair_job_lines (
            repair_job_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type, is_approved_repair_line
          ) VALUES ($1, $2, $3, $3, 1, 'Approved Additional Service', $4, 'additional_approved', TRUE)`,
          [
            repairId,
            workRequest.recommended_service || 'Approved Additional Service',
            serviceCharge,
            `Additional fault approval (${workRequest.fault_finding})`
          ]
        );
      }

      // 3. Issue and consume parts if included in parts_payload
      let partsList = [];
      try {
        let rawPayload = workRequest.parts_payload;
        if (typeof rawPayload === 'string') {
          try { rawPayload = JSON.parse(rawPayload); } catch (_) {}
        }
        if (typeof rawPayload === 'string') {
          try { rawPayload = JSON.parse(rawPayload); } catch (_) {}
        }
        if (Array.isArray(rawPayload)) {
          partsList = rawPayload;
        }
      } catch (e) {
        partsList = [];
      }

      for (const partItem of partsList) {
        if (!partItem.partId) continue;
        const partRes = await client.query('SELECT * FROM repair_parts WHERE id = $1 FOR UPDATE', [partItem.partId]);
        if (partRes.rows.length > 0) {
          const partObj = partRes.rows[0];
          const qty = parseInt(partItem.quantity || 1, 10);
          const sellingPrice = parseFloat(
            partItem.customerCharge !== undefined && partItem.customerCharge !== null
              ? partItem.customerCharge
              : (partItem.sellingPrice !== undefined && partItem.sellingPrice !== null
                ? partItem.sellingPrice
                : (partObj.selling_price || 0))
          );
          const costPrice = parseFloat(partObj.cost_price || 0);

          // Deduct stock
          const newStock = Math.max(0, partObj.current_stock - qty);
          await client.query('UPDATE repair_parts SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, partObj.id]);

          // Record in repair_parts_used
          await client.query(
            `INSERT INTO repair_parts_used (
              repair_job_id, part_id, product_code, name, quantity, customer_charge, cost_price_snapshot, added_by, added_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              repairId, partObj.id, partObj.code, partObj.name, qty, sellingPrice, costPrice, validUserId, user?.name || approvalSource
            ]
          );

          // Record inventory movement ledger
          await client.query(
            `INSERT INTO repair_parts_movements (
              part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, balance_after, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, 'OUT', $4, $5, 'Additional Repair Job Usage', $6, $7, $8, $9)`,
            [
              partObj.id, partObj.code, partObj.name, qty,
              `Consumed for repair ${job.tracking_id} via additional fault approval`,
              job.tracking_id, newStock, validUserId, user?.name || approvalSource
            ]
          );
        }
      }

      // 4. Atomically sync linked invoice & accounts
      await RepairService.syncLinkedInvoice(repairId, client);

      // 5. Log history
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId,
          job.status,
          `Additional work approved by ${approvalSource}: ${workRequest.recommended_service} (PKR ${parseFloat(workRequest.total_quotation || 0).toFixed(2)})`,
          validUserId,
          user?.name || approvalSource
        ]
      );

      // 6. Clear WhatsApp approval bot state & send confirmation
      const cleanContact = String(job.contact || '').trim();
      if (cleanContact) {
        await client.query(
          `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
          [cleanContact]
        );

        const convRes = await client.query('SELECT id FROM whatsapp_conversations WHERE contact = $1', [cleanContact]);
        if (convRes.rows.length > 0) {
          const convId = convRes.rows[0].id;
          const confMsg = buildAdditionalWorkApprovedTemplate({
            job,
            workRequest: approvedRequest
          });

          await client.query(
            `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
             VALUES ($1, 'out', $2, 'approval_confirmed')`,
            [convId, confMsg]
          );

          await client.query(
            `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [confMsg, convId]
          );

          emitEvent('whatsapp.message_added', { conversationId: convId, text: confMsg });
        }
      }

      const refreshedJob = await client.query('SELECT * FROM repair_jobs WHERE id = $1', [repairId]);

      emitEvent('repair.additional_work_approved', { repairId, request: approvedRequest });
      emitEvent('repair.updated', refreshedJob.rows[0]);

      return {
        success: true,
        request: approvedRequest,
        job: refreshedJob.rows[0]
      };
    });
  }

  /**
   * Decline an Additional Work Request (Idempotent)
   */
  static async declineAdditionalWorkRequest(repairId, requestId, user, approvalSource = 'Admin', customerResponse = null) {
    return await db.withTransaction(async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM repair_additional_work_requests 
         WHERE id = $1 AND repair_job_id = $2 FOR UPDATE`,
        [requestId, repairId]
      );
      if (reqRes.rows.length === 0) {
        const error = new Error('Additional work request not found.');
        error.status = 404;
        throw error;
      }
      const workRequest = reqRes.rows[0];

      // Idempotency: Reject if already approved or declined
      if (workRequest.status !== 'Pending Approval') {
        const error = new Error(`This additional work request has already been ${workRequest.status.toLowerCase()}.`);
        error.status = 400;
        throw error;
      }

      const jobRes = await client.query('SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE', [repairId]);
      if (jobRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }
      const job = jobRes.rows[0];

      let validUserId = null;
      if (user?.id) {
        const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
      }

      // 1. Mark request as Declined
      const updReq = await client.query(
        `UPDATE repair_additional_work_requests SET
          status = 'Declined',
          approval_source = $1,
          approved_by = $2,
          approved_by_name = $3,
          customer_response = $4,
          declined_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [
          approvalSource,
          validUserId,
          user?.name || approvalSource,
          customerResponse || `Declined via ${approvalSource}`,
          requestId
        ]
      );
      const declinedRequest = updReq.rows[0];

      // 2. Log history (no charges or parts added)
      await client.query(
        `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          repairId,
          job.status,
          `Additional work declined by ${approvalSource}: ${workRequest.recommended_service}. Original service job proceeds normally without extra charges.`,
          validUserId,
          user?.name || approvalSource
        ]
      );

      // 3. Clear WhatsApp bot state & send decline confirmation
      const cleanContact = String(job.contact || '').trim();
      if (cleanContact) {
        await client.query(
          `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
          [cleanContact]
        );

        const convRes = await client.query('SELECT id FROM whatsapp_conversations WHERE contact = $1', [cleanContact]);
        if (convRes.rows.length > 0) {
          const convId = convRes.rows[0].id;
          const declineMsg = buildAdditionalWorkDeclinedTemplate({
            job,
            workRequest: declinedRequest
          });

          await client.query(
            `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
             VALUES ($1, 'out', $2, 'approval_declined')`,
            [convId, declineMsg]
          );

          await client.query(
            `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [declineMsg, convId]
          );

          emitEvent('whatsapp.message_added', { conversationId: convId, text: declineMsg });
        }
      }

      emitEvent('repair.additional_work_declined', { repairId, request: declinedRequest });
      emitEvent('repair.updated', job);

      return {
        success: true,
        request: declinedRequest,
        job
      };
    });
  }
}

module.exports = RepairService;
