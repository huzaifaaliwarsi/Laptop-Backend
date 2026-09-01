const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireSalesOrAdmin } = require('../../middleware/rbac');
const { CacheService, cacheRoute } = require('../../config/cache');

router.use(authenticateToken);

// GET /api/ledger/party/:partyType/:partyId - Grouped bills and chronological transaction log (Cached 60s)
router.get('/party/:partyType/:partyId', requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
  try {
    const { partyType, partyId } = req.params;
    const isVendor = partyType.toLowerCase() === 'vendor';

    // 1. Fetch Party details
    const partyTable = isVendor ? 'vendors' : 'customers';
    const partyRes = await db.query(`SELECT * FROM ${partyTable} WHERE id = $1`, [partyId]);
    if (partyRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Party profile not found.'
      });
    }
    const party = partyRes.rows[0];

    // 2. Fetch all Invoices for this party
    const invoicesRes = await db.query(
      `SELECT * FROM invoices WHERE party_id = $1 ORDER BY date ASC, created_at ASC`,
      [partyId]
    );

    // 3. Fetch all Payments for this party
    const paymentsRes = await db.query(
      `SELECT * FROM payments WHERE party_id = $1 ORDER BY date ASC, created_at ASC`,
      [partyId]
    );

    // 4. Fetch all Vendor Returns if vendor
    let returnsRes = { rows: [] };
    if (isVendor) {
      returnsRes = await db.query(
        `SELECT * FROM vendor_returns WHERE vendor_id = $1 ORDER BY date ASC, created_at ASC`,
        [partyId]
      );
    }

    // 5. Fetch all Accounts
    const accountsRes = await db.query(
      `SELECT * FROM accounts WHERE party_id = $1`,
      [partyId]
    );

    // Build Grouped Bills structure
    const groupedBills = [];

    for (const inv of invoicesRes.rows) {
      const laterPayments = paymentsRes.rows.filter(p => p.invoice_id === inv.id && !p.is_initial_settlement);
      const total = parseFloat(inv.total || 0);
      const paid = parseFloat(inv.paid || 0);
      const balance = parseFloat(inv.balance || 0);
      const initialPaid = parseFloat(inv.initial_paid || 0);
      const creditAdjusted = parseFloat(inv.credit_adjusted || 0);
      const account = accountsRes.rows.find(a => a.invoice_id === inv.id && a.status !== 'Cancelled');

      groupedBills.push({
        kind: 'invoice',
        id: inv.id,
        invoiceNo: inv.invoice_no,
        type: inv.type,
        exchangeCase: inv.exchange_case,
        date: inv.date,
        total,
        initialPaid,
        paidToDate: paid,
        creditAdjusted,
        remaining: balance,
        status: balance <= 0.005 ? 'settled' : paid > 0 ? 'partial' : 'unpaid',
        paymentMethod: inv.payment_method,
        referenceId: inv.reference_id,
        accountId: account?.id || null,
        accountStatus: account?.status || 'Settled',
        installments: [
          ...(initialPaid > 0 ? [{
            type: 'Initial Payment',
            date: inv.date,
            method: inv.payment_method,
            reference: inv.reference_id,
            amount: initialPaid
          }] : []),
          ...laterPayments.map((p, idx) => ({
            type: `Installment #${idx + 1}`,
            date: p.date,
            method: p.payment_method,
            reference: p.reference_id,
            notes: p.notes,
            amount: parseFloat(p.amount)
          }))
        ]
      });
    }

    if (isVendor) {
      for (const ret of returnsRes.rows) {
        const retPayments = paymentsRes.rows.filter(p => p.invoice_id === ret.id || p.invoice_no === ret.id);
        const total = parseFloat(ret.amount || 0);
        const initial = parseFloat(ret.initial_settlement || 0);
        const actualMoney = parseFloat(ret.actual_money_received || 0);
        const exchangeVal = parseFloat(ret.exchange_value || 0);
        const payableAdj = parseFloat(ret.payable_adjustment || 0);
        const balance = parseFloat(ret.balance || 0);
        const account = accountsRes.rows.find(a => (a.invoice_id === ret.id || a.invoice_no === ret.id) && a.type === 'Vendor Receivable');

        groupedBills.push({
          kind: 'return',
          id: ret.id,
          invoiceNo: ret.id,
          type: 'Vendor Return Credit',
          date: ret.date,
          productCode: ret.product_code,
          returnedProductName: ret.returned_product_name,
          total,
          initialPaid: initial,
          actualMoneyReceived: actualMoney,
          exchangeValue: exchangeVal,
          payableAdjustment: payableAdj,
          remaining: balance,
          status: balance <= 0.005 ? 'settled' : (actualMoney > 0 || exchangeVal > 0 || payableAdj > 0) ? 'partial' : 'unpaid',
          settlementMethod: ret.settlement_method,
          referenceId: ret.reference_id,
          reason: ret.reason,
          accountId: account?.id || null,
          accountStatus: account?.status || 'Settled',
          installments: retPayments.map((p, idx) => ({
            type: p.is_initial_settlement ? 'Initial Settlement' : `Receipt #${idx + 1}`,
            date: p.date,
            method: p.payment_method,
            reference: p.reference_id,
            notes: p.notes,
            amount: parseFloat(p.amount)
          }))
        });
      }
    }

    groupedBills.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Build Chronological Transaction Log with Canonical Running Balance
    const rawEntries = [];

    invoicesRes.rows.forEach(inv => {
      const total = parseFloat(inv.total || 0);
      const base = {
        id: inv.id,
        date: inv.date,
        createdAt: inv.created_at,
        reference: inv.invoice_no,
        invoiceId: inv.id,
        entryType: 'invoice',
        billAmount: total,
        paymentMethod: inv.payment_method
      };

      if (isVendor) {
        rawEntries.push({
          ...base,
          order: 1,
          description: `Vendor Purchase (${inv.invoice_no})`,
          paid: 0,
          received: 0,
          effect: total,
          balanceNature: 'Vendor Payable'
        });
      } else if (['Sales Invoice', 'Service Invoice', 'Repair Invoice', 'Diagnosis Invoice'].includes(inv.type) || (inv.type === 'Exchange Invoice' && inv.exchange_case === 'Customer Pays Shop')) {
        rawEntries.push({
          ...base,
          order: 1,
          description: `${inv.type} (${inv.invoice_no})`,
          paid: 0,
          received: 0,
          effect: total,
          balanceNature: 'Customer Receivable'
        });
      } else if (inv.type === 'Customer Purchase' || (inv.type === 'Exchange Invoice' && inv.exchange_case === 'Shop Pays Customer')) {
        rawEntries.push({
          ...base,
          order: 1,
          description: `${inv.type} (${inv.invoice_no})`,
          paid: 0,
          received: 0,
          effect: -total,
          balanceNature: 'Customer Payable'
        });
      } else if (inv.type === 'Exchange Invoice') {
        rawEntries.push({
          ...base,
          order: 1,
          description: `Even Exchange (${inv.invoice_no})`,
          billAmount: 0,
          paid: 0,
          received: 0,
          effect: 0,
          balanceNature: 'Settled'
        });
      }
    });

    if (isVendor) {
      returnsRes.rows.forEach(r => {
        const retAmount = parseFloat(r.amount || 0);
        rawEntries.push({
          id: r.id,
          date: r.date,
          createdAt: r.created_at,
          order: 2,
          reference: r.id,
          invoiceId: r.id,
          entryType: 'return',
          description: `Vendor Return / Refund Credit (${r.id})`,
          billAmount: retAmount,
          paid: 0,
          received: 0,
          effect: -retAmount,
          balanceNature: 'Vendor Receivable'
        });
      });
    }

    paymentsRes.rows.forEach(p => {
      const amt = parseFloat(p.amount || 0);
      let effect = 0;
      const isInitial = p.is_initial_settlement;
      const prefix = isInitial ? 'Initial Settlement' : 'Payment';

      if (isVendor) {
        if (p.account_type === 'Vendor Payable') {
          effect = p.direction === 'Paid' ? -amt : amt;
        } else if (p.account_type === 'Vendor Receivable') {
          effect = p.direction === 'Received' ? amt : -amt;
        } else {
          effect = p.direction === 'Paid' ? -amt : amt;
        }
      } else {
        if (p.account_type === 'Customer Receivable') {
          // Received reduces receivable (-), Paid (void refund) increases receivable (+)
          effect = (p.direction === 'Received' || p.direction === 'Adjusted') ? -amt : amt;
        } else if (p.account_type === 'Customer Payable') {
          // Paid reduces customer payable (+ toward 0), Received increases payable (-)
          effect = p.direction === 'Paid' ? amt : -amt;
        } else {
          effect = (p.direction === 'Received' || p.direction === 'Adjusted') ? -amt : amt;
        }
      }

      rawEntries.push({
        id: p.id,
        date: p.date,
        createdAt: p.created_at,
        order: 3,
        reference: p.invoice_no || p.id,
        paymentId: p.id,
        invoiceId: p.invoice_id,
        entryType: 'payment',
        description: `${prefix} ${p.direction === 'Paid' ? 'Made' : 'Received'} — ${p.payment_method}${p.reference_id ? ' · Ref: ' + p.reference_id : ''}${p.notes ? ' · ' + p.notes : ''}`,
        paid: p.direction === 'Paid' ? amt : 0,
        received: (p.direction === 'Received' || p.direction === 'Adjusted') ? amt : 0,
        effect,
        balanceNature: p.account_type
      });
    });

    rawEntries.sort((a, b) => {
      const dDiff = new Date(a.date) - new Date(b.date);
      if (dDiff !== 0) return dDiff;
      const oDiff = (a.order || 0) - (b.order || 0);
      if (oDiff !== 0) return oDiff;
      const cDiff = new Date(a.createdAt) - new Date(b.createdAt);
      if (cDiff !== 0) return cDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    let running = 0;
    const transactionLog = rawEntries.map(e => {
      running += e.effect;
      return {
        ...e,
        running: Math.round(running * 100) / 100
      };
    });

    const openReceivables = accountsRes.rows.filter(a => a.status === 'Open' && a.type.includes('Receivable')).reduce((s, a) => s + parseFloat(a.remaining), 0);
    const openPayables = accountsRes.rows.filter(a => a.status === 'Open' && a.type.includes('Payable')).reduce((s, a) => s + parseFloat(a.remaining), 0);
    const netBalance = isVendor ? openPayables - openReceivables : openReceivables - openPayables;

    const totalPurchases = isVendor ? invoicesRes.rows.reduce((s, i) => s + parseFloat(i.total || 0), 0) : 0;
    const totalSales = !isVendor ? invoicesRes.rows.reduce((s, i) => s + parseFloat(i.total || 0), 0) : 0;
    const paymentsMade = paymentsRes.rows.filter(p => p.direction === 'Paid').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const receivedFromParty = paymentsRes.rows.filter(p => p.direction === 'Received' || p.direction === 'Adjusted').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const totalReturns = isVendor ? returnsRes.rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0) : 0;
    const totalCustomerCredits = !isVendor ? invoicesRes.rows.filter(i => i.type === 'Customer Purchase' || (i.type === 'Exchange Invoice' && i.exchange_case === 'Shop Pays Customer')).reduce((s, i) => s + parseFloat(i.total || 0), 0) : 0;

    return res.json({
      success: true,
      data: {
        party: {
          id: party.id,
          name: party.name,
          contact: party.contact,
          notes: party.notes,
          type: isVendor ? 'vendor' : 'customer'
        },
        summary: {
          totalPurchases,
          totalSales,
          paymentsMade,
          receivedFromParty,
          totalReturns,
          totalCustomerCredits,
          openReceivable: openReceivables,
          openPayable: openPayables,
          netBalance,
          netBalanceLabel: Math.abs(netBalance) < 0.005 ? 'Settled' : isVendor ? (netBalance > 0 ? `Payable PKR ${netBalance.toFixed(2)}` : `Receivable PKR ${Math.abs(netBalance).toFixed(2)}`) : (netBalance > 0 ? `Receivable PKR ${netBalance.toFixed(2)}` : `Payable PKR ${Math.abs(netBalance).toFixed(2)}`)
        },
        groupedBills,
        transactionLog: transactionLog.reverse()
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
