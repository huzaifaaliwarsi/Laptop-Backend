const db = require('../../config/db');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { getCreator } = require('../../utils/userHelper');

class InvoiceRegistryService {
  /**
   * Query unified transaction-level collection register
   * - Row 1: Original Sale / Invoice Row (date: invoice.date, billing: total, collected: initial_paid)
   * - Row 2..N: Remaining Collection rows (date: payment.date, billing: 0, collected: payment.amount, receipt: payment.id)
   * Supports strict transaction date range filtering, search, pagination, and KPI aggregation.
   */
  static async getTransactionRegistry(filters = {}, user = {}, branchId = 1) {
    const {
      search,
      type,
      status,
      transactionType,
      from,
      to,
      page = 1,
      limit = 25,
      sortBy = 'transaction_date',
      sortOrder = 'DESC'
    } = filters;

    const params = [branchId];
    let whereClauses = ['branch_id = $1'];

    // Role scoping: Sales staff only see transactions they initiated or collected
    if (user.role === 'sales') {
      params.push(user.id);
      whereClauses.push(`(collector_id = $${params.length} OR created_by = $${params.length})`);
    }

    if (search && String(search).trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      whereClauses.push(`(
        LOWER(invoice_no) LIKE $${params.length} OR
        LOWER(COALESCE(party_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(contact, '')) LIKE $${params.length} OR
        LOWER(COALESCE(receipt_no, '')) LIKE $${params.length} OR
        LOWER(COALESCE(collector_name, '')) LIKE $${params.length}
      )`);
    }

    if (type && String(type).trim() !== '') {
      params.push(type.trim());
      whereClauses.push(`(type = $${params.length} OR type_key = $${params.length})`);
    }

    if (transactionType && String(transactionType).trim() !== '') {
      if (transactionType === 'Original Sale' || transactionType === 'original') {
        whereClauses.push(`is_original = TRUE`);
      } else if (transactionType === 'Remaining Collection' || transactionType === 'collection') {
        whereClauses.push(`is_original = FALSE`);
      }
    }

    if (status && String(status).trim() !== '') {
      const s = status.trim().toLowerCase();
      if (s === 'voided' || s === 'refunded') {
        whereClauses.push(`is_voided = TRUE`);
      } else if (s === 'paid') {
        whereClauses.push(`LOWER(payment_status) = 'paid' AND is_voided = FALSE`);
      } else if (s === 'partial' || s === 'partially_paid') {
        whereClauses.push(`LOWER(payment_status) = 'partial' AND is_voided = FALSE`);
      } else if (s === 'unpaid') {
        whereClauses.push(`LOWER(payment_status) = 'unpaid' AND is_voided = FALSE`);
      } else {
        params.push(status.trim());
        whereClauses.push(`payment_status = $${params.length} AND is_voided = FALSE`);
      }
    }

    if (from && String(from).trim() !== '') {
      params.push(from.trim());
      whereClauses.push(`transaction_date >= $${params.length}`);
    }

    if (to && String(to).trim() !== '') {
      params.push(to.trim());
      whereClauses.push(`transaction_date <= $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Validate and build sorting
    const validSortCols = {
      transaction_date: 'transaction_date',
      date: 'transaction_date',
      transaction_at: 'transaction_at',
      created_at: 'transaction_at',
      billing_amount: 'billing_amount',
      total: 'billing_amount',
      collected_amount: 'collected_amount',
      paid: 'collected_amount',
      current_outstanding: 'current_outstanding',
      balance: 'current_outstanding',
      invoice_no: 'invoice_no'
    };
    const sortCol = validSortCols[sortBy] || 'transaction_date';
    const sortDir = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const cteSql = `
      WITH invoice_txns AS (
        -- 1. Original Sale / Invoice Row
        SELECT 
          i.id AS id,
          i.id AS invoice_id,
          i.invoice_no,
          i.type,
          i.type_key,
          'Original Sale' AS transaction_type,
          'Original Sale' AS transaction_badge,
          TRUE AS is_original,
          i.date AS transaction_date,
          i.created_at AS transaction_at,
          i.party_type,
          i.party_id,
          i.party_name,
          i.contact,
          i.exchange_case,
          i.product_total,
          i.service_total,
          i.total AS original_total,
          i.total AS billing_amount,
          COALESCE(i.initial_paid, 0.00) AS collected_amount,
          i.balance AS current_outstanding,
          i.payment_method,
          i.reference_id,
          NULL::varchar AS receipt_no,
          i.payment_status,
          i.is_voided,
          i.void_date,
          i.void_reason,
          i.refund_amount,
          i.credit_adjusted,
          i.created_by AS collector_id,
          i.created_by_name AS collector_name,
          i.created_by,
          i.created_by_name,
          i.branch_id,
          NULL::text AS notes
        FROM invoices i

        UNION ALL

        -- 2. Remaining Collections (Subsequent Installments from payments)
        SELECT 
          p.id AS id,
          i.id AS invoice_id,
          i.invoice_no,
          i.type,
          i.type_key,
          'Remaining Collection' AS transaction_type,
          'Remaining Collection' AS transaction_badge,
          FALSE AS is_original,
          p.date AS transaction_date,
          COALESCE(p.paid_at, p.created_at) AS transaction_at,
          i.party_type,
          i.party_id,
          i.party_name,
          i.contact,
          i.exchange_case,
          i.product_total,
          i.service_total,
          i.total AS original_total,
          0.00 AS billing_amount,
          p.amount AS collected_amount,
          i.balance AS current_outstanding,
          p.payment_method,
          p.reference_id,
          p.id AS receipt_no,
          i.payment_status,
          i.is_voided,
          i.void_date,
          i.void_reason,
          i.refund_amount,
          i.credit_adjusted,
          COALESCE(p.collected_by_id, p.created_by, i.created_by) AS collector_id,
          COALESCE(p.collected_by_name, p.created_by_name, i.created_by_name) AS collector_name,
          COALESCE(p.created_by, i.created_by) AS created_by,
          COALESCE(p.created_by_name, i.created_by_name) AS created_by_name,
          p.branch_id,
          p.notes
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id AND i.branch_id = p.branch_id
        WHERE (p.is_initial = FALSE OR p.is_initial IS NULL)
          AND (p.is_initial_settlement = FALSE OR p.is_initial_settlement IS NULL)
          AND (p.account_type IN ('Customer Receivable', 'Vendor Payable') OR p.account_type IS NULL OR p.account_type = '')
          AND p.direction IN ('Received', 'Paid')
          AND (p.notes NOT ILIKE '%void%' AND p.notes NOT ILIKE '%revert%' OR p.notes IS NULL)
      ),
      filtered_txns AS (
        SELECT * FROM invoice_txns
        ${whereSql}
      )
    `;

    // 1. Fetch Aggregated KPI Summary across all matching rows
    const summaryQuery = `
      ${cteSql}
      SELECT 
        COUNT(*)::int AS total_count,
        COALESCE(SUM(CASE WHEN NOT is_voided AND type IN ('Sales Invoice', 'Service Invoice', 'Repair Invoice') THEN billing_amount ELSE 0 END), 0) AS gross_sales,
        COALESCE(SUM(CASE WHEN NOT is_voided AND type IN ('Vendor Purchase', 'Customer Purchase') THEN billing_amount ELSE 0 END), 0) AS gross_purchases,
        COALESCE(SUM(CASE WHEN NOT is_voided THEN collected_amount ELSE 0 END), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN is_voided THEN COALESCE(refund_amount, original_total) ELSE credit_adjusted END), 0) AS total_refunded,
        COUNT(DISTINCT invoice_id)::int AS distinct_invoices_count,
        COALESCE((
          SELECT SUM(inv_bal)
          FROM (
            SELECT DISTINCT ON (invoice_id) current_outstanding AS inv_bal
            FROM filtered_txns
            WHERE NOT is_voided
          ) sub
        ), 0) AS total_outstanding
      FROM filtered_txns
    `;

    const summaryRes = await db.query(summaryQuery, params);
    const summaryRow = summaryRes.rows[0] || {};
    const totalRecords = parseInt(summaryRow.total_count || 0, 10);

    // 2. Fetch Paginated Records
    const paginationParams = [...params];
    let limitSql = '';
    const pageNum = Math.max(1, parseInt(page || 1, 10));
    const limitNum = parseInt(limit, 10);

    if (!isNaN(limitNum) && limitNum > 0) {
      const offset = (pageNum - 1) * limitNum;
      paginationParams.push(limitNum);
      const limitIndex = paginationParams.length;
      paginationParams.push(offset);
      const offsetIndex = paginationParams.length;
      limitSql = `LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
    }

    const rowsQuery = `
      ${cteSql}
      SELECT * FROM filtered_txns
      ORDER BY ${sortCol} ${sortDir}, transaction_at DESC, is_original DESC
      ${limitSql}
    `;

    const rowsRes = await db.query(rowsQuery, paginationParams);

    const formattedRows = rowsRes.rows.map(r => ({
      id: r.id,
      transactionId: r.id,
      invoiceId: r.invoice_id,
      invoiceNo: r.invoice_no,
      transactionType: r.transaction_type,
      transactionBadge: r.transaction_badge,
      isOriginal: r.is_original,
      isCollection: !r.is_original,
      transactionDate: r.transaction_date,
      transactionAt: r.transaction_at,
      date: r.transaction_date,
      createdAt: r.transaction_at,
      type: r.type,
      typeKey: r.type_key,
      partyType: r.party_type,
      partyId: r.party_id,
      partyName: r.party_name,
      contact: r.contact,
      exchangeCase: r.exchange_case,
      productTotal: parseFloat(r.product_total || 0),
      serviceTotal: parseFloat(r.service_total || 0),
      originalTotal: parseFloat(r.original_total || 0),
      total: parseFloat(r.billing_amount || 0),
      billingAmount: parseFloat(r.billing_amount || 0),
      collectedAmount: parseFloat(r.collected_amount || 0),
      paid: parseFloat(r.collected_amount || 0),
      initialPaid: parseFloat(r.initial_paid || 0),
      creditAdjusted: parseFloat(r.credit_adjusted || 0),
      balance: parseFloat(r.current_outstanding || 0),
      currentOutstanding: parseFloat(r.current_outstanding || 0),
      paymentMethod: r.payment_method,
      referenceId: r.reference_id,
      receiptNo: r.receipt_no,
      paymentStatus: r.payment_status,
      status: r.is_voided
        ? 'VOIDED'
        : r.payment_status === 'Partial'
        ? 'PARTIALLY_PAID'
        : (r.payment_status || 'UNPAID').toUpperCase(),
      isVoided: r.is_voided,
      voidDate: r.void_date,
      voidReason: r.void_reason,
      refundAmount: parseFloat(r.refund_amount || 0),
      collectorId: r.collector_id,
      collectorName: r.collector_name || 'Admin',
      createdById: r.created_by,
      createdByName: r.created_by_name || 'Admin',
      notes: r.notes
    }));

    const totalPages = !isNaN(limitNum) && limitNum > 0 ? Math.ceil(totalRecords / limitNum) : 1;

    return {
      rows: formattedRows,
      pagination: {
        page: pageNum,
        limit: !isNaN(limitNum) && limitNum > 0 ? limitNum : totalRecords,
        total: totalRecords,
        totalPages
      },
      summary: {
        grossSales: parseFloat(summaryRow.gross_sales || 0),
        grossPurchases: parseFloat(summaryRow.gross_purchases || 0),
        totalCollected: parseFloat(summaryRow.total_collected || 0),
        totalOutstanding: parseFloat(summaryRow.total_outstanding || 0),
        totalRefunded: parseFloat(summaryRow.total_refunded || 0),
        totalTransactions: totalRecords,
        distinctInvoicesCount: parseInt(summaryRow.distinct_invoices_count || 0, 10)
      }
    };
  }

  /**
   * Atomic, idempotent remaining collection on an invoice
   * Safe against double-clicks/retries via requestKey and row locks (SELECT FOR UPDATE).
   */
  static async recordInvoicePayment(invoiceId, paymentData, user, branchId = 1) {
    const {
      amount: reqAmount,
      paymentMethod = 'Cash',
      referenceId = null,
      notes = null,
      date = null,
      requestKey = null
    } = paymentData;

    const payAmount = parseFloat(reqAmount || 0);
    if (isNaN(payAmount) || payAmount <= 0) {
      const err = new Error('Payment amount must be greater than zero.');
      err.status = 400;
      throw err;
    }

    const cleanRequestKey = requestKey && String(requestKey).trim() ? String(requestKey).trim() : null;

    // 1. Idempotency Check: if requestKey already exists, return existing payment immediately
    if (cleanRequestKey) {
      const existingPay = await db.query(
        `SELECT * FROM payments WHERE request_key = $1 AND branch_id = $2 LIMIT 1`,
        [cleanRequestKey, branchId]
      );
      if (existingPay.rows.length > 0) {
        return {
          idempotent: true,
          message: 'Payment already processed (idempotent replay)',
          payment: existingPay.rows[0]
        };
      }
    }

    // 2. Atomic Transaction with Row-Level Lock
    return await db.withTransaction(async (client) => {
      // Lock invoice row
      const invRes = await client.query(
        `SELECT * FROM invoices WHERE (id = $1 OR invoice_no = $1) AND branch_id = $2 FOR UPDATE`,
        [invoiceId, branchId]
      );
      if (invRes.rows.length === 0) {
        const err = new Error('Invoice not found.');
        err.status = 404;
        throw err;
      }
      const invoice = invRes.rows[0];

      if (invoice.is_voided) {
        const err = new Error('Cannot collect payment on a voided/refunded invoice.');
        err.status = 400;
        throw err;
      }

      const total = parseFloat(invoice.total || 0);
      const paid = parseFloat(invoice.paid || 0);
      const creditAdj = parseFloat(invoice.credit_adjusted || 0);
      const balance = Math.max(0, total - paid - creditAdj);

      if (balance <= 0.005) {
        const err = new Error('This invoice is already fully settled (0 balance).');
        err.status = 400;
        throw err;
      }

      if (payAmount > balance + 0.005) {
        const err = new Error(`Payment amount (PKR ${payAmount.toLocaleString('en-PK', { maximumFractionDigits: 2 })}) cannot exceed current outstanding balance of PKR ${balance.toLocaleString('en-PK', { maximumFractionDigits: 2 })}.`);
        err.status = 400;
        throw err;
      }

      // Check linked account
      const accRes = await client.query(
        `SELECT * FROM accounts WHERE invoice_id = $1 AND branch_id = $2 AND status = 'Open' FOR UPDATE`,
        [invoice.id, branchId]
      );
      let accountId = null;
      let accountType = invoice.type.includes('Purchase') ? 'Vendor Payable' : 'Customer Receivable';

      if (accRes.rows.length > 0) {
        const acc = accRes.rows[0];
        accountId = acc.id;
        accountType = acc.type || accountType;
        const newAccRemaining = Math.max(0, parseFloat(acc.remaining || 0) - payAmount);
        const newAccStatus = newAccRemaining <= 0.005 ? 'Settled' : 'Open';
        await client.query(
          `UPDATE accounts SET remaining = $1, status = $2 WHERE id = $3`,
          [newAccRemaining, newAccStatus, acc.id]
        );
      }

      // If linked repair job exists, update paid amount
      const repairRes = await client.query(
        `SELECT * FROM repair_jobs WHERE (invoice_id = $1 OR tracking_id = $2) AND branch_id = $3 FOR UPDATE`,
        [invoice.id, invoice.invoice_no, branchId]
      );
      if (repairRes.rows.length > 0) {
        const job = repairRes.rows[0];
        const newJobPaid = Math.min(parseFloat(job.total || 0), parseFloat(job.paid || 0) + payAmount);
        await client.query(
          `UPDATE repair_jobs SET paid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newJobPaid, job.id]
        );
      }

      // Update Invoice
      const newPaid = paid + payAmount;
      const newBal = Math.max(0, total - newPaid - creditAdj);
      const newStatus = newBal <= 0.005 ? 'Paid' : 'Partial';

      await client.query(
        `UPDATE invoices 
         SET paid = $1, balance = $2, payment_status = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [newPaid, newBal, newStatus, invoice.id]
      );

      // Generate Receipt ID & Insert Payment
      const creator = getCreator(user);
      const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
      const direction = invoice.type.includes('Purchase') ? 'Paid' : 'Received';
      const paymentDate = date
        ? (typeof date === 'string' && date.includes('T') ? date.split('T')[0] : date)
        : new Date().toISOString().split('T')[0];

      const insertPayRes = await client.query(
        `INSERT INTO payments (
          id, branch_id, account_id, invoice_id, invoice_no, party_type, party_id, party_name,
          account_type, direction, amount, date, payment_method, reference_id, notes,
          affects_money, is_initial_settlement, is_initial, request_key,
          created_by, created_by_name, collected_by_id, collected_by_name, paid_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          TRUE, FALSE, FALSE, $16,
          $17, $18, $17, $18, CURRENT_TIMESTAMP
        ) RETURNING *`,
        [
          payId, branchId, accountId, invoice.id, invoice.invoice_no,
          invoice.party_type || 'Customer', invoice.party_id, invoice.party_name,
          accountType, direction, payAmount, paymentDate, paymentMethod,
          referenceId ? String(referenceId).trim() : null,
          notes ? String(notes).trim() : 'Remaining installment collection',
          cleanRequestKey,
          creator.id, creator.name
        ]
      );

      return {
        payment: insertPayRes.rows[0],
        invoiceId: invoice.id,
        invoiceNo: invoice.invoice_no,
        paid: newPaid,
        balance: newBal,
        paymentStatus: newStatus
      };
    });
  }
}

module.exports = InvoiceRegistryService;

