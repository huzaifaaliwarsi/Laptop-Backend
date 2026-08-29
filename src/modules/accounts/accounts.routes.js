const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireSalesOrAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { getAvailableBalance, validateOutflow } = require('../../utils/financialFormulas');
const { emitEvent } = require('../../config/socket');

router.use(authenticateToken);

// GET /api/accounts/drawer-balance - Current Available Cash & Online Drawer Balances
router.get('/drawer-balance', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const cash = await getAvailableBalance('Cash');
    const online = await getAvailableBalance('Online');
    return res.json({
      success: true,
      data: {
        cash: parseFloat(cash || 0),
        online: parseFloat(online || 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/accounts - Filtered receivables & payables
router.get('/', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { type, partyType, partyId, status } = req.query;
    let queryText = 'SELECT * FROM accounts WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      queryText += ` AND type = $${params.length}`;
    }

    if (partyType) {
      params.push(partyType);
      queryText += ` AND party_type = $${params.length}`;
    }

    if (partyId) {
      params.push(partyId);
      queryText += ` AND party_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      queryText += ` AND status = $${params.length}`;
    }

    queryText += ' ORDER BY date DESC, created_at DESC';

    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(acc => ({
        id: acc.id,
        type: acc.type,
        partyType: acc.party_type,
        partyId: acc.party_id,
        partyName: acc.party_name,
        invoiceId: acc.invoice_id,
        invoiceNo: acc.invoice_no,
        amount: parseFloat(acc.amount || 0),
        remaining: parseFloat(acc.remaining || 0),
        status: acc.status,
        date: acc.date,
        createdAt: acc.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/accounts/:id/payment - Record payment installment
router.post('/:id/payment', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount: reqAmount, paymentMethod, referenceId, notes, date } = req.body;

    const payAmount = parseFloat(reqAmount || 0);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_AMOUNT',
        message: 'Payment amount must be greater than zero.'
      });
    }

    const pMethod = paymentMethod || 'Cash';

    const result = await db.withTransaction(async (client) => {
      const accRes = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [id]);
      if (accRes.rows.length === 0) {
        const error = new Error('Account not found.');
        error.status = 404;
        throw error;
      }
      const account = accRes.rows[0];

      if (account.status !== 'Open') {
        const error = new Error('This account is already settled or cancelled.');
        error.status = 400;
        throw error;
      }

      const accRemaining = parseFloat(account.remaining || 0);
      if (payAmount > accRemaining + 0.005) {
        const error = new Error(`Payment cannot exceed remaining balance of PKR ${accRemaining.toFixed(2)}.`);
        error.status = 400;
        throw error;
      }

      // If paying out (Customer Payable or Vendor Payable), validate cash/online balance
      if (account.type.includes('Payable')) {
        await validateOutflow(pMethod, payAmount, `${account.type} Settlement`, client);
      }

      const newRemaining = Math.max(0, accRemaining - payAmount);
      const newStatus = newRemaining <= 0.005 ? 'Settled' : 'Open';

      // Update account
      await client.query(
        `UPDATE accounts SET remaining = $1, status = $2 WHERE id = $3`,
        [newRemaining, newStatus, id]
      );

      // Update linked invoice if exists
      if (account.invoice_id) {
        const invRes = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [account.invoice_id]);
        if (invRes.rows.length > 0) {
          const inv = invRes.rows[0];
          const newPaid = parseFloat(inv.paid || 0) + payAmount;
          const newBal = Math.max(0, parseFloat(inv.total || 0) - newPaid - parseFloat(inv.credit_adjusted || 0));
          const newPayStatus = newBal <= 0.005 ? 'Paid' : 'Partial';

          await client.query(
            `UPDATE invoices SET paid = $1, balance = $2, payment_status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
            [newPaid, newBal, newPayStatus, inv.id]
          );
        }

        // Update linked repair job if exists
        const repairRes = await client.query('SELECT * FROM repair_jobs WHERE invoice_id = $1 OR tracking_id = $2 FOR UPDATE', [account.invoice_id, account.invoice_no]);
        if (repairRes.rows.length > 0) {
          const job = repairRes.rows[0];
          const jobNewPaid = Math.min(parseFloat(job.total || 0), parseFloat(job.paid || 0) + payAmount);
          await client.query(
            `UPDATE repair_jobs SET paid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [jobNewPaid, job.id]
          );

          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              job.id,
              job.status,
              `Payment received: PKR ${payAmount.toLocaleString('en-PK', { maximumFractionDigits: 2 })} via ${pMethod}. Remaining: PKR ${newRemaining.toLocaleString('en-PK', { maximumFractionDigits: 2 })}.`,
              req.user.id,
              req.user.name
            ]
          );
        }

        // Update vendor return if linked
        const vrRes = await client.query('SELECT * FROM vendor_returns WHERE id = $1 FOR UPDATE', [account.invoice_id]);
        if (vrRes.rows.length > 0) {
          const vr = vrRes.rows[0];
          const vrPaid = parseFloat(vr.actual_money_received || 0) + payAmount;
          const vrBal = Math.max(0, parseFloat(vr.amount || 0) - vrPaid - parseFloat(vr.exchange_value || 0) - parseFloat(vr.payable_adjustment || 0));
          const vrStatus = vrBal <= 0.005 ? 'Paid' : 'Partial';

          await client.query(
            `UPDATE vendor_returns SET actual_money_received = $1, balance = $2, status = $3 WHERE id = $4`,
            [vrPaid, vrBal, vrStatus, vr.id]
          );
        }
      }

      // Record payment row
      const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
      const direction = account.type.includes('Receivable') ? 'Received' : 'Paid';

      const payRes = await client.query(
        `INSERT INTO payments (
          id, account_id, invoice_id, invoice_no, party_type, party_id, party_name,
          account_type, direction, amount, date, payment_method, reference_id, notes,
          affects_money, is_initial_settlement, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          TRUE, FALSE, $15, $16
        ) RETURNING *`,
        [
          payId, id, account.invoice_id, account.invoice_no, account.party_type, account.party_id, account.party_name,
          account.type, direction, payAmount, date || new Date(), pMethod, referenceId ? referenceId.trim() : null, notes ? notes.trim() : null,
          req.user.id, req.user.name
        ]
      );

      return {
        payment: payRes.rows[0],
        remaining: newRemaining,
        status: newStatus
      };
    });

    emitEvent('payment.recorded', result);

    return res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
