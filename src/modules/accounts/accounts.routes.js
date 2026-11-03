const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireSalesOrAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { getAvailableBalance, validateOutflow } = require('../../utils/financialFormulas');
const { getCreator } = require('../../utils/userHelper');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute, getBranchIdFromReq } = require('../../config/cache');

router.use(authenticateToken);

// GET /api/accounts/drawer-balance - Current Available Cash & Online Drawer Balances (Cached 30s)
router.get('/drawer-balance', requireSalesOrAdmin, cacheRoute(30), async (req, res, next) => {
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

// POST /api/accounts/drawer-transaction - Top-up / Deposit or Withdraw money directly to/from Cash Drawer / Bank Account
router.post('/drawer-transaction', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { type, method, amount: reqAmount, notes, date } = req.body;
    const amount = parseFloat(reqAmount || 0);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_AMOUNT',
        message: 'Amount must be greater than zero.'
      });
    }

    const pMethod = method === 'Online' ? 'Online' : 'Cash';
    const isDeposit = type === 'Deposit' || type === 'Cash In' || type === 'Add';
    const direction = isDeposit ? 'Received' : 'Paid';

    const creator = getCreator(req.user);
    const payId = await getNextEntityId('payments', 'id', 'PAY', 5);
    const result = await db.query(`
      INSERT INTO payments (
        id, party_type, party_id, party_name, account_type,
        direction, amount, date, payment_method, reference_id, notes, affects_money,
        is_initial_settlement, created_by, created_by_name
      ) VALUES (
        $1, 'Business', 'TREASURY', 'Cash Drawer / Treasury', $2,
        $3, $4, $5, $6, $7, $8, TRUE,
        FALSE, $9, $10
      ) RETURNING *
    `, [
      payId, isDeposit ? 'Drawer Deposit' : 'Drawer Withdrawal',
      direction, amount, date || new Date(), pMethod, null,
      notes ? notes.trim() : (isDeposit ? `${pMethod} Drawer Deposit / Cash In` : `${pMethod} Drawer Withdrawal / Cash Out`),
      creator.id, creator.name
    ]);

    const newCash = await getAvailableBalance('Cash');
    const newOnline = await getAvailableBalance('Online');

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/accounts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
    emitEvent('settings.balances_updated', { cash: newCash, online: newOnline });

    return res.status(201).json({
      success: true,
      message: `${pMethod} ${isDeposit ? 'deposited' : 'withdrawn'} successfully!`,
      data: {
        payment: result.rows[0],
        liveCash: newCash,
        liveOnline: newOnline
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/accounts/drawer-transactions - Recent 20 drawer deposits / withdrawals (Cached 60s)
router.get('/drawer-transactions', requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT p.*, u.name as performed_by_name
      FROM payments p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.account_type IN ('Drawer Deposit', 'Drawer Withdrawal')
      ORDER BY p.date DESC, p.created_at DESC
      LIMIT 20
    `);
    return res.json({
      success: true,
      data: result.rows.map(r => ({
        id: r.id,
        type: r.account_type,
        direction: r.direction,
        amount: parseFloat(r.amount || 0),
        paymentMethod: r.payment_method,
        notes: r.notes,
        date: r.date,
        performedBy: r.created_by_name || r.performed_by_name || 'Admin',
        createdAt: r.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/accounts - Filtered receivables & payables (Cached 60s)
router.get('/', requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
  try {
    const { type, partyType, partyId, status } = req.query;
    const branchContext = require('../../middleware/branchContext');
    const branchStore = branchContext.getBranchStore();
    const bId = Number(req.headers['x-branch-id']) || branchStore?.branchId || req.branchId || 1;
    let queryText = 'SELECT * FROM accounts WHERE branch_id = $1';
    const params = [bId];

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

// GET /api/accounts/vendor/:vendorId/open-bills - Get all open payable bills for a vendor
router.get('/vendor/:vendorId/open-bills', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { vendorId } = req.params;
    const branchId = getBranchIdFromReq(req) || 1;

    // Fetch vendor info
    const vRes = await db.query(
      'SELECT id, name, contact FROM vendors WHERE id = $1 AND branch_id = $2',
      [vendorId, branchId]
    );
    if (vRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found.'
      });
    }
    const vendor = vRes.rows[0];

    // Fetch all open accounts for this vendor with linked invoice info
    const query = `
      SELECT 
        a.id AS account_id,
        a.type AS account_type,
        a.invoice_id,
        a.invoice_no,
        a.amount AS original_amount,
        a.remaining,
        a.status,
        a.date,
        a.created_at,
        i.type AS invoice_type,
        i.total AS invoice_total,
        i.paid AS invoice_paid,
        i.balance AS invoice_balance
      FROM accounts a
      LEFT JOIN invoices i ON i.id = a.invoice_id AND i.branch_id = a.branch_id
      WHERE a.party_id = $1 
        AND a.branch_id = $2 
        AND a.type = 'Vendor Payable' 
        AND a.status = 'Open'
        AND a.remaining > 0.005
      ORDER BY a.date ASC, a.created_at ASC
    `;
    const accRes = await db.query(query, [vendorId, branchId]);

    const bills = accRes.rows.map(row => ({
      accountId: row.account_id,
      invoiceId: row.invoice_id,
      invoiceNo: row.invoice_no,
      date: row.date,
      originalAmount: parseFloat(row.original_amount || 0),
      remaining: parseFloat(row.remaining || 0),
      invoiceTotal: parseFloat(row.invoice_total || row.original_amount || 0),
      invoicePaid: parseFloat(row.invoice_paid || 0),
      invoiceBalance: parseFloat(row.invoice_balance || row.remaining || 0)
    }));

    const totalPayable = bills.reduce((sum, b) => sum + b.remaining, 0);

    return res.json({
      success: true,
      data: {
        vendor: {
          id: vendor.id,
          name: vendor.name,
          contact: vendor.contact
        },
        bills,
        totalPayable: parseFloat(totalPayable.toFixed(2)),
        openBillsCount: bills.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/accounts/vendor-group-payment - Record lump-sum / multi-bill payment to a vendor
router.post('/vendor-group-payment', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { vendorId, amount: reqAmount, paymentMethod, referenceId, notes, date, allocations } = req.body;
    const branchId = getBranchIdFromReq(req) || 1;

    const payAmount = parseFloat(reqAmount || 0);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_AMOUNT',
        message: 'Payment amount must be greater than zero.'
      });
    }

    const pMethod = paymentMethod === 'Online' ? 'Online' : 'Cash';

    const result = await db.withTransaction(async (client) => {
      // 1. Fetch vendor
      const vRes = await client.query(
        'SELECT id, name FROM vendors WHERE id = $1 AND branch_id = $2 FOR UPDATE',
        [vendorId, branchId]
      );
      if (vRes.rows.length === 0) {
        const error = new Error('Vendor not found.');
        error.status = 404;
        throw error;
      }
      const vendor = vRes.rows[0];

      // 2. Fetch all open accounts for this vendor
      const accRes = await client.query(
        `SELECT * FROM accounts 
         WHERE party_id = $1 
           AND branch_id = $2 
           AND type = 'Vendor Payable' 
           AND status = 'Open'
           AND remaining > 0.005
         ORDER BY date ASC, created_at ASC
         FOR UPDATE`,
        [vendorId, branchId]
      );

      if (accRes.rows.length === 0) {
        const error = new Error('No open payable bills found for this vendor.');
        error.status = 400;
        throw error;
      }

      const totalOpen = accRes.rows.reduce((s, r) => s + parseFloat(r.remaining || 0), 0);
      if (payAmount > totalOpen + 0.005) {
        const error = new Error(`Payment amount (PKR ${payAmount.toLocaleString()}) cannot exceed total outstanding payable (PKR ${totalOpen.toLocaleString()}).`);
        error.status = 400;
        throw error;
      }

      // 3. Validate cash/online drawer balance before outflow
      await validateOutflow(pMethod, payAmount, `Vendor Group Payment (${vendor.name})`, client);

      // 4. Calculate distribution (either from explicit allocations array or FIFO auto-allocation)
      const plannedAllocations = [];
      if (Array.isArray(allocations) && allocations.length > 0) {
        let allocatedSum = 0;
        for (const alloc of allocations) {
          const allocAmt = parseFloat(alloc.amount || 0);
          if (allocAmt <= 0) continue;
          const targetAcc = accRes.rows.find(a => a.id === alloc.accountId);
          if (!targetAcc) continue;
          const remainingAcc = parseFloat(targetAcc.remaining || 0);
          const effectiveAmt = Math.min(allocAmt, remainingAcc);
          plannedAllocations.push({
            account: targetAcc,
            amount: effectiveAmt
          });
          allocatedSum += effectiveAmt;
        }

        if (allocatedSum <= 0) {
          const error = new Error('No valid bill allocations provided.');
          error.status = 400;
          throw error;
        }
      } else {
        // FIFO Auto-Allocation: Distribute from oldest to newest
        let remainingToDistribute = payAmount;
        for (const acc of accRes.rows) {
          if (remainingToDistribute <= 0.005) break;
          const accRem = parseFloat(acc.remaining || 0);
          const takeAmt = Math.min(accRem, remainingToDistribute);
          plannedAllocations.push({
            account: acc,
            amount: takeAmt
          });
          remainingToDistribute -= takeAmt;
        }
      }

      // 5. Execute settlements and insert payment records
      const creator = getCreator(req.user);
      const paymentDate = date ? new Date(date) : new Date();
      const groupNote = notes && notes.trim() ? notes.trim() : `Group settlement for ${plannedAllocations.length} bill(s)`;
      const recordedPayments = [];
      let totalActualSettled = 0;

      for (const item of plannedAllocations) {
        const { account, amount: itemAmount } = item;
        const currentRemaining = parseFloat(account.remaining || 0);
        const newRemaining = Math.max(0, currentRemaining - itemAmount);
        const newStatus = newRemaining <= 0.005 ? 'Settled' : 'Open';

        // Update Account
        await client.query(
          `UPDATE accounts SET remaining = $1, status = $2 WHERE id = $3`,
          [newRemaining, newStatus, account.id]
        );

        // Update Linked Invoice
        if (account.invoice_id) {
          const invRes = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [account.invoice_id]);
          if (invRes.rows.length > 0) {
            const inv = invRes.rows[0];
            const newPaid = parseFloat(inv.paid || 0) + itemAmount;
            const newBal = Math.max(0, parseFloat(inv.total || 0) - newPaid - parseFloat(inv.credit_adjusted || 0));
            const newPayStatus = newBal <= 0.005 ? 'Paid' : 'Partial';

            await client.query(
              `UPDATE invoices SET paid = $1, balance = $2, payment_status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
              [newPaid, newBal, newPayStatus, inv.id]
            );
          }
        }

        // Generate payment ID and log payment entry
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, branch_id, account_id, invoice_id, invoice_no, party_type, party_id, party_name,
            account_type, direction, amount, date, payment_method, reference_id, notes,
            affects_money, is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, $4, $5, 'Vendor', $6, $7,
            'Vendor Payable', 'Paid', $8, $9, $10, $11, $12,
            TRUE, FALSE, $13, $14
          )`,
          [
            payId, branchId, account.id, account.invoice_id, account.invoice_no, vendor.id, vendor.name,
            itemAmount, paymentDate, pMethod, referenceId ? referenceId.trim() : null, groupNote,
            creator.id, creator.name
          ]
        );

        recordedPayments.push({
          paymentId: payId,
          accountId: account.id,
          invoiceNo: account.invoice_no,
          amount: itemAmount,
          newRemaining,
          status: newStatus
        });
        totalActualSettled += itemAmount;
      }

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        totalPaid: totalActualSettled,
        settledBillsCount: recordedPayments.length,
        remainingVendorPayable: Math.max(0, totalOpen - totalActualSettled),
        payments: recordedPayments
      };
    });

    await CacheService.invalidateBranchPattern(branchId, '/api/accounts*');
    await CacheService.invalidateBranchPattern(branchId, '/api/vendors*');
    await CacheService.invalidateBranchPattern(branchId, '/api/invoices*');
    await CacheService.invalidateBranchPattern(branchId, '/api/ledger*');
    await CacheService.invalidateBranchPattern(branchId, '/api/reports*');
    await CacheService.invalidateBranchPattern(branchId, '/api/dashboard*');

    emitEvent('accounts.payment_recorded', { vendorId, amount: payAmount });
    emitEvent('balance.updated', { branchId });

    return res.json({
      success: true,
      message: `Successfully recorded group payment of PKR ${result.totalPaid.toLocaleString()} across ${result.settledBillsCount} bill(s) for ${result.vendorName}.`,
      data: result
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

          const creator = getCreator(req.user);
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              job.id,
              job.status,
              `Payment received: PKR ${payAmount.toLocaleString('en-PK', { maximumFractionDigits: 2 })} via ${pMethod}. Remaining: PKR ${newRemaining.toLocaleString('en-PK', { maximumFractionDigits: 2 })}.`,
              creator.id,
              creator.name
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
      const creator = getCreator(req.user);
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
          creator.id, creator.name
        ]
      );

      return {
        payment: payRes.rows[0],
        remaining: newRemaining,
        status: newStatus
      };
    });

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/accounts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/invoices*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/customers*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/vendors*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/ledger*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/dashboard*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
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
