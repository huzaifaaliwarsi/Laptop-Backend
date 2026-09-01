const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { CacheService, cacheRoute } = require('../../config/cache');
const { getAvailableBalance } = require('../../utils/financialFormulas');

router.use(authenticateToken);

// =============================================================================
// HELPERS
// =============================================================================

/** Round to 2 decimals — Master Formula: ROUND(value, 2) */
function r2(v) { return Math.round((parseFloat(v) || 0) * 100) / 100; }

/** Settlement epsilon: remaining <= 0.005 => treat as 0 (Paid) */
const EPSILON = 0.005;

/**
 * Append AND date-range clauses to a query string.
 * dateCol defaults to 'date'.
 */
function applyDateFilter(queryText, params, from, to, dateCol = 'date') {
  if (from) {
    params.push(from);
    queryText += ` AND ${dateCol} >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    queryText += ` AND ${dateCol} <= $${params.length}`;
  }
  return queryText;
}

/** Convert a result-set array to CSV string */
function toCSV(rows, headers) {
  if (!rows || rows.length === 0) return headers.map(h => h.label).join(',') + '\n';
  const csvHeaders = headers.map(h => `"${h.label}"`).join(',');
  const csvRows = rows.map(row =>
    headers.map(h => {
      const val = row[h.key] ?? '';
      // Escape double-quotes
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );
  return [csvHeaders, ...csvRows].join('\n');
}

// =============================================================================
// GET /api/reports/dashboard — Admin / Sales / Technician dashboard metrics
// =============================================================================
router.get('/dashboard', cacheRoute(30), async (req, res, next) => {
  try {
    const role = req.user.role;
    const userId = req.user.id;

    if (role === 'technician') {
      const assignedRes = await db.query(
        `SELECT 
          COUNT(CASE WHEN status IN ('Job Received', 'Diagnosis Received') THEN 1 END) as new_jobs,
          COUNT(CASE WHEN status IN ('Diagnosis in Progress', 'Diagnosis Completed', 'Waiting for Customer Approval') THEN 1 END) as checking_jobs,
          COUNT(CASE WHEN status IN ('Repair Approved', 'Work in Progress', 'Waiting for Parts') THEN 1 END) as active_jobs,
          COUNT(CASE WHEN status IN ('Work Completed', 'Ready for Delivery', 'Delivered & Closed') THEN 1 END) as completed_jobs
         FROM repair_jobs WHERE technician_id = $1`,
        [userId]
      );

      const dueRes = await db.query(
        `SELECT id, tracking_id, customer_name, status, expected_completion, priority, brand, model
         FROM repair_jobs 
         WHERE technician_id = $1 AND status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair')
           AND expected_completion <= CURRENT_DATE
         ORDER BY expected_completion ASC LIMIT 10`,
        [userId]
      );

      const recentJobsRes = await db.query(
        `SELECT id, tracking_id, customer_name, status, expected_completion, priority, brand, model, problem
         FROM repair_jobs 
         WHERE technician_id = $1 AND status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair')
         ORDER BY date DESC, created_at DESC LIMIT 8`,
        [userId]
      );

      return res.json({
        success: true,
        data: {
          role: 'technician',
          counts: {
            newJobs: parseInt(assignedRes.rows[0].new_jobs || 0, 10),
            checkingJobs: parseInt(assignedRes.rows[0].checking_jobs || 0, 10),
            activeJobs: parseInt(assignedRes.rows[0].active_jobs || 0, 10),
            completedJobs: parseInt(assignedRes.rows[0].completed_jobs || 0, 10)
          },
          dueJobs: dueRes.rows,
          recentJobs: recentJobsRes.rows
        }
      });
    }

    if (role === 'sales') {
      const salesRes = await db.query(
        `SELECT 
          COALESCE(SUM(total), 0) as billing,
          COUNT(*) as count,
          COALESCE(SUM(balance), 0) as balance,
          COUNT(CASE WHEN balance > 0.005 THEN 1 END) as pending_count
         FROM invoices 
         WHERE created_by = $1 AND type = 'Sales Invoice' AND is_voided = FALSE`,
        [userId]
      );

      const paymentsRes = await db.query(
        `SELECT 
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' AND direction = 'Received' THEN amount WHEN payment_method = 'Cash' AND direction = 'Paid' THEN -amount ELSE 0 END), 0) as cash_in,
          COALESCE(SUM(CASE WHEN payment_method = 'Online' AND direction = 'Received' THEN amount WHEN payment_method = 'Online' AND direction = 'Paid' THEN -amount ELSE 0 END), 0) as online_in
         FROM payments WHERE created_by = $1`,
        [userId]
      );

      const recentInvRes = await db.query(
        `SELECT id, invoice_no, type, date, party_name, total, paid, balance, payment_status, is_voided
         FROM invoices WHERE created_by = $1 ORDER BY date DESC, created_at DESC LIMIT 5`,
        [userId]
      );

      const lowStockRes = await db.query(
        `SELECT code, brand, model, current_stock, low_stock_alert FROM products WHERE current_stock <= low_stock_alert ORDER BY current_stock ASC LIMIT 6`
      );

      return res.json({
        success: true,
        data: {
          role: 'sales',
          stats: {
            cashCollected: r2(paymentsRes.rows[0].cash_in),
            onlineCollected: r2(paymentsRes.rows[0].online_in),
            retailBilling: r2(salesRes.rows[0].billing),
            retailCount: parseInt(salesRes.rows[0].count || 0, 10),
            pendingInvoices: parseInt(salesRes.rows[0].pending_count || 0, 10),
            outstandingBalance: r2(salesRes.rows[0].balance)
          },
          recentInvoices: recentInvRes.rows,
          lowStock: lowStockRes.rows
        }
      });
    }

    // Admin Dashboard
    const [
      prodRes,
      salesRes,
      accountsRes,
      repairRes,
      expenseRes,
      cashInHand,
      onlineBalance,
      recentInvoicesRes,
      recentRepairsRes,
      recentExpensesRes,
      lowStockRes
    ] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total_products,
          COALESCE(SUM(current_stock), 0) as current_stock,
          COUNT(CASE WHEN current_stock <= low_stock_alert THEN 1 END) as low_stock,
          COALESCE(SUM(current_stock * cost_price), 0) as stock_cost_value,
          COALESCE(SUM(current_stock * expected_sale_price), 0) as stock_sale_value
        FROM products
      `),
      // Net Sales = non-voided Sales Invoice totals (formula: gross - credit_adjusted)
      db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE AND date = CURRENT_DATE THEN total ELSE 0 END), 0) as today_sales,
          COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN 1 END) as total_sales_count,
          COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE AND date = CURRENT_DATE THEN 1 END) as today_sales_count
        FROM invoices
      `),
      db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'Customer Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as customer_receivable,
          COALESCE(SUM(CASE WHEN type = 'Customer Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as customer_payable,
          COALESCE(SUM(CASE WHEN type = 'Vendor Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as vendor_payable,
          COALESCE(SUM(CASE WHEN type = 'Vendor Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as vendor_receivable
        FROM accounts
      `),
      db.query(`
        SELECT 
          COUNT(CASE WHEN status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) as active_repairs,
          COUNT(CASE WHEN status = 'Waiting for Customer Approval' THEN 1 END) as waiting_approval,
          COUNT(CASE WHEN status IN ('Job Received', 'Diagnosis in Progress', 'Work in Progress', 'Waiting for Parts') THEN 1 END) as in_progress,
          COUNT(CASE WHEN status IN ('Ready for Delivery', 'Work Completed') THEN 1 END) as ready_delivery,
          COUNT(CASE WHEN status = 'Delivered & Closed' THEN 1 END) as completed_repairs,
          COALESCE(SUM(CASE WHEN status = 'Delivered & Closed' THEN total ELSE 0 END), 0) as repair_revenue,
          COUNT(CASE WHEN expected_completion < CURRENT_DATE AND status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) as overdue
        FROM repair_jobs
      `),
      db.query(`
        SELECT 
          COALESCE(SUM(amount), 0) as total_expenses,
          COALESCE(SUM(CASE WHEN date = CURRENT_DATE THEN amount ELSE 0 END), 0) as today_expenses
        FROM expenses
      `),
      getAvailableBalance('Cash'),
      getAvailableBalance('Online'),
      db.query(`
        SELECT id, invoice_no, type, date, party_name, total, paid, balance, payment_status, is_voided, created_by_name
        FROM invoices ORDER BY date DESC, created_at DESC LIMIT 6
      `),
      db.query(`
        SELECT id, tracking_id, customer_name, contact as customer_contact, category_name as category, brand, model, status, priority, total, date, expected_completion
        FROM repair_jobs ORDER BY date DESC, created_at DESC LIMIT 6
      `),
      db.query(`
        SELECT id, date, description as title, category_name as category, amount, payment_method
        FROM expenses ORDER BY date DESC, created_at DESC LIMIT 5
      `),
      db.query(`
        SELECT code, brand, model, category_name as category, current_stock, low_stock_alert, cost_price, expected_sale_price as sale_price
        FROM products WHERE current_stock <= low_stock_alert ORDER BY current_stock ASC LIMIT 6
      `)
    ]);

    return res.json({
      success: true,
      data: {
        role: 'admin',
        stats: {
          totalProducts: parseInt(prodRes.rows[0].total_products || 0, 10),
          currentStock: parseInt(prodRes.rows[0].current_stock || 0, 10),
          lowStock: parseInt(prodRes.rows[0].low_stock || 0, 10),
          stockCostValue: r2(prodRes.rows[0].stock_cost_value),
          stockSaleValue: r2(prodRes.rows[0].stock_sale_value),
          totalSales: r2(salesRes.rows[0].total_sales),
          todaySales: r2(salesRes.rows[0].today_sales),
          totalSalesCount: parseInt(salesRes.rows[0].total_sales_count || 0, 10),
          todaySalesCount: parseInt(salesRes.rows[0].today_sales_count || 0, 10),
          customerReceivables: r2(accountsRes.rows[0].customer_receivable),
          customerPayables: r2(accountsRes.rows[0].customer_payable),
          vendorPayables: r2(accountsRes.rows[0].vendor_payable),
          vendorReceivables: r2(accountsRes.rows[0].vendor_receivable),
          openBalance: r2(accountsRes.rows[0].customer_receivable),
          cashInHand: cashInHand,
          onlineBalance: onlineBalance,
          totalExpenses: r2(expenseRes.rows[0].total_expenses),
          todayExpenses: r2(expenseRes.rows[0].today_expenses),
          activeRepairs: parseInt(repairRes.rows[0].active_repairs || 0, 10),
          waitingApproval: parseInt(repairRes.rows[0].waiting_approval || 0, 10),
          inProgress: parseInt(repairRes.rows[0].in_progress || 0, 10),
          readyDelivery: parseInt(repairRes.rows[0].ready_delivery || 0, 10),
          completedRepairs: parseInt(repairRes.rows[0].completed_repairs || 0, 10),
          repairRevenue: r2(repairRes.rows[0].repair_revenue),
          overdueRepairs: parseInt(repairRes.rows[0].overdue || 0, 10)
        },
        recentInvoices: recentInvoicesRes.rows,
        recentRepairs: recentRepairsRes.rows,
        recentExpenses: recentExpensesRes.rows,
        lowStock: lowStockRes.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/sales
// Formula: Revenue from non-voided Sales Invoices (product + service lines).
// Includes Exchange Invoice and Custom Sale Invoice types.
// Remaining = MAX(0, total - paid); settled if <= EPSILON.
// =============================================================================
router.get('/sales', async (req, res, next) => {
  try {
    const { from, to, staffId, paymentMethod, type } = req.query;

    let queryText = `
      SELECT 
        i.id, i.invoice_no, i.type, i.date, i.party_name,
        i.product_total, i.service_total, i.total,
        i.paid, i.credit_adjusted, i.balance,
        i.payment_method, i.reference_id, i.payment_status,
        i.is_voided, i.exchange_case,
        i.created_by_name,
        COALESCE((
          SELECT SUM(ii.quantity * ii.cost_price_snapshot)
          FROM invoice_items ii
          WHERE ii.invoice_id = i.id AND ii.item_type IN ('product', 'custom_product')
        ), 0) as cogs
      FROM invoices i
      WHERE i.is_voided = FALSE
        AND i.type IN ('Sales Invoice', 'Exchange Invoice', 'Custom Sale Invoice')
    `;
    const params = [];

    if (req.user.role === 'sales') {
      params.push(req.user.id);
      queryText += ` AND i.created_by = $${params.length}`;
    } else if (staffId) {
      params.push(staffId);
      queryText += ` AND i.created_by = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      queryText += ` AND i.payment_method = $${params.length}`;
    }

    if (type) {
      params.push(type);
      queryText += ` AND i.type = $${params.length}`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'i.date');
    queryText += ' ORDER BY i.date DESC, i.created_at DESC';

    const result = await db.query(queryText, params);

    // Summary totals
    let grossSales = 0, totalCogs = 0, totalPaid = 0, totalBalance = 0;
    const rows = result.rows.map(row => {
      const total = r2(row.total);
      const paid = r2(row.paid);
      const isPrivileged = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.isSuperAdmin;
      const cogs = isPrivileged ? r2(row.cogs) : 0;
      const remaining = Math.max(0, r2(total - paid));
      const settled = remaining <= EPSILON;
      grossSales += total;
      totalCogs += cogs;
      totalPaid += paid;
      totalBalance += remaining;
      return {
        id: row.id,
        invoiceNo: row.invoice_no,
        type: row.type,
        date: row.date,
        customerName: row.party_name,
        productTotal: r2(row.product_total),
        serviceTotal: r2(row.service_total),
        total,
        cogs,
        paid,
        creditAdjusted: r2(row.credit_adjusted),
        remaining: settled ? 0 : remaining,
        paymentMethod: row.payment_method,
        paymentStatus: settled ? 'Paid' : row.payment_status,
        exchangeCase: row.exchange_case,
        soldBy: row.created_by_name
      };
    });

    return res.json({
      success: true,
      summary: {
        grossSales: r2(grossSales),
        totalCogs: r2(totalCogs),
        grossProfit: r2(grossSales - totalCogs),
        totalPaid: r2(totalPaid),
        totalOutstanding: r2(totalBalance),
        count: rows.length
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/returns (Admin only)
// Formula: Sales returns = voided Sales Invoices (full void) + partial returns (credit_adjusted > 0)
// Refund = MIN(refund_amount, paid) — can never exceed what was collected.
// COGS reversed = qty_returned × cost_price_snapshot.
// =============================================================================
router.get('/returns', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;

    // Full voids (entire invoice returned)
    let voidQuery = `
      SELECT 
        i.id, i.invoice_no, i.date, i.party_name,
        i.total as return_amount, i.paid as was_paid,
        i.refund_amount, i.refund_method, i.void_date, i.void_reason,
        'Full Void' as return_type,
        COALESCE((
          SELECT SUM(ii.quantity * ii.cost_price_snapshot)
          FROM invoice_items ii
          WHERE ii.invoice_id = i.id AND ii.item_type IN ('product', 'custom_product')
        ), 0) as cogs_reversed
      FROM invoices i
      WHERE i.type IN ('Sales Invoice', 'Exchange Invoice', 'Custom Sale Invoice')
        AND i.is_voided = TRUE
    `;
    const voidParams = [];
    voidQuery = applyDateFilter(voidQuery, voidParams, from, to, 'i.void_date');
    voidQuery += ' ORDER BY i.void_date DESC NULLS LAST, i.created_at DESC';

    // Partial returns — invoices with credit_adjusted > 0 (not voided)
    let partialQuery = `
      SELECT 
        i.id, i.invoice_no, i.date, i.party_name,
        i.credit_adjusted as return_amount, i.paid as was_paid,
        i.credit_adjusted as refund_amount, i.refund_method, i.date as void_date, NULL as void_reason,
        'Partial Return' as return_type,
        0 as cogs_reversed
      FROM invoices i
      WHERE i.type IN ('Sales Invoice', 'Exchange Invoice', 'Custom Sale Invoice')
        AND i.is_voided = FALSE
        AND i.credit_adjusted > 0.005
    `;
    const partialParams = [];
    partialQuery = applyDateFilter(partialQuery, partialParams, from, to, 'i.date');
    partialQuery += ' ORDER BY i.date DESC, i.created_at DESC';

    const [voidRes, partialRes] = await Promise.all([
      db.query(voidQuery, voidParams),
      db.query(partialQuery, partialParams)
    ]);

    let totalReturnAmount = 0, totalCogsReversed = 0, totalRefunded = 0;

    const formatRow = row => {
      const returnAmount = r2(row.return_amount);
      const refundAmount = r2(Math.min(r2(row.refund_amount), r2(row.was_paid))); // can't refund > what was paid
      const cogsReversed = r2(row.cogs_reversed);
      totalReturnAmount += returnAmount;
      totalCogsReversed += cogsReversed;
      totalRefunded += refundAmount;
      return {
        id: row.id,
        invoiceNo: row.invoice_no,
        date: row.date,
        voidDate: row.void_date,
        customerName: row.party_name,
        returnType: row.return_type,
        returnAmount,
        wasPaid: r2(row.was_paid),
        refundAmount,
        refundMethod: row.refund_method || '—',
        voidReason: row.void_reason || '—',
        cogsReversed
      };
    };

    const data = [
      ...voidRes.rows.map(formatRow),
      ...partialRes.rows.map(formatRow)
    ].sort((a, b) => new Date(b.voidDate || b.date) - new Date(a.voidDate || a.date));

    return res.json({
      success: true,
      summary: {
        totalReturns: data.length,
        totalReturnAmount: r2(totalReturnAmount),
        totalRefunded: r2(totalRefunded),
        totalCogsReversed: r2(totalCogsReversed)
      },
      data
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/purchases (Admin only)
// Vendor Purchases + Customer (Buyback) Purchases.
// Remaining = MAX(0, total - paid - credit_adjusted).
// =============================================================================
router.get('/purchases', requireAdmin, async (req, res, next) => {
  try {
    const { from, to, paymentMethod, staffId, type } = req.query;

    let queryText = `
      SELECT 
        i.id, i.invoice_no, i.type, i.date, i.party_name, i.party_type,
        i.total, i.paid, i.credit_adjusted, i.balance,
        i.payment_method, i.payment_status, i.is_voided,
        i.created_by_name
      FROM invoices i
      WHERE i.type IN ('Vendor Purchase', 'Customer Purchase', 'Buyback Invoice')
    `;
    const params = [];

    if (staffId) {
      params.push(staffId);
      queryText += ` AND i.created_by = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      queryText += ` AND i.payment_method = $${params.length}`;
    }

    if (type) {
      params.push(type);
      queryText += ` AND i.type = $${params.length}`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'i.date');
    queryText += ' ORDER BY i.date DESC, i.created_at DESC';

    const result = await db.query(queryText, params);

    let totalPurchases = 0, totalPaid = 0, totalOutstanding = 0;
    const rows = result.rows.map(row => {
      const total = r2(row.total);
      const paid = r2(row.paid);
      const creditAdj = r2(row.credit_adjusted);
      const remaining = Math.max(0, r2(total - paid - creditAdj));
      const settled = remaining <= EPSILON;
      totalPurchases += total;
      totalPaid += paid;
      totalOutstanding += remaining;
      return {
        id: row.id,
        invoiceNo: row.invoice_no,
        type: row.type,
        date: row.date,
        partyName: row.party_name,
        partyType: row.party_type,
        total,
        paid,
        creditAdjusted: creditAdj,
        remaining: settled ? 0 : remaining,
        paymentMethod: row.payment_method,
        paymentStatus: settled ? 'Paid' : row.payment_status,
        isVoided: row.is_voided,
        createdBy: row.created_by_name
      };
    });

    return res.json({
      success: true,
      summary: {
        totalPurchases: r2(totalPurchases),
        totalPaid: r2(totalPaid),
        totalOutstanding: r2(totalOutstanding),
        count: rows.length
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/vendor-returns (Admin only)
// From vendor_returns table.
// Amount = qty × cost_price at return time.
// Settlement modes: Cash, Online, Exchange, Vendor Adjustment.
// =============================================================================
router.get('/vendor-returns', requireAdmin, async (req, res, next) => {
  try {
    const { from, to, staffId, paymentMethod } = req.query;

    let queryText = `
      SELECT 
        vr.id, vr.date, vr.vendor_name, vr.product_code,
        vr.returned_product_name, vr.quantity, vr.amount,
        vr.actual_money_received, vr.exchange_value,
        vr.payable_adjustment, vr.replacement_mode,
        vr.replacement_product_name, vr.replacement_qty,
        vr.payment_method, vr.settlement_method, vr.reason,
        vr.status, vr.created_by_name
      FROM vendor_returns vr
      WHERE 1=1
    `;
    const params = [];

    if (staffId) {
      params.push(staffId);
      queryText += ` AND vr.created_by = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      queryText += ` AND (vr.payment_method = $${params.length} OR vr.settlement_method = $${params.length})`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'vr.date');
    queryText += ' ORDER BY vr.date DESC, vr.created_at DESC';

    const result = await db.query(queryText, params);

    let totalReturned = 0, totalCashReceived = 0, totalExchange = 0, totalAdjustment = 0;
    const rows = result.rows.map(row => {
      const amount = r2(row.amount);
      const cashReceived = r2(row.actual_money_received);
      const exchange = r2(row.exchange_value);
      const adjustment = r2(row.payable_adjustment);
      totalReturned += amount;
      totalCashReceived += cashReceived;
      totalExchange += exchange;
      totalAdjustment += adjustment;
      return {
        id: row.id,
        date: row.date,
        vendorName: row.vendor_name,
        productCode: row.product_code,
        productName: row.returned_product_name,
        quantity: row.quantity,
        amount,
        actualMoneyReceived: cashReceived,
        exchangeValue: exchange,
        payableAdjustment: adjustment,
        settlementMethod: row.settlement_method,
        replacementMode: row.replacement_mode,
        replacementProduct: row.replacement_product_name,
        replacementQty: row.replacement_qty,
        paymentMethod: row.payment_method,
        reason: row.reason,
        status: row.status,
        createdBy: row.created_by_name
      };
    });

    return res.json({
      success: true,
      summary: {
        count: rows.length,
        totalReturned: r2(totalReturned),
        totalCashReceived: r2(totalCashReceived),
        totalExchangeValue: r2(totalExchange),
        totalPayableAdjustment: r2(totalAdjustment)
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/inventory (Admin only)
// Stock snapshot per product.
// Formula:
//   Stock Value (Cost)  = current_stock × cost_price
//   Stock Value (Sale)  = current_stock × expected_sale_price
//   Unrealised Margin   = Stock Value (Sale) − Stock Value (Cost)
//   Stock = Initial + IN - OUT (running ledger, verified by current_stock)
// =============================================================================
router.get('/inventory', requireAdmin, async (req, res, next) => {
  try {
    const { from, to, category } = req.query;

    let queryText = `
      SELECT 
        p.id, p.code, p.inventory_type, p.category_name, p.brand, p.model,
        p.condition,
        p.initial_stock, p.stock_in, p.stock_out, p.current_stock,
        p.cost_price, p.expected_sale_price,
        p.low_stock_alert, p.date_added,
        (p.current_stock * p.cost_price) as cost_value,
        (p.current_stock * p.expected_sale_price) as sale_value,
        ((p.current_stock * p.expected_sale_price) - (p.current_stock * p.cost_price)) as unrealised_margin
      FROM products p
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      queryText += ` AND p.category_name = $${params.length}`;
    }

    queryText += ' ORDER BY p.category_name, p.brand, p.model';

    const result = await db.query(queryText, params);

    let totalCostValue = 0, totalSaleValue = 0, totalUnits = 0;
    const rows = result.rows.map(row => {
      const costValue = r2(row.cost_value);
      const saleValue = r2(row.sale_value);
      totalCostValue += costValue;
      totalSaleValue += saleValue;
      totalUnits += parseInt(row.current_stock || 0, 10);
      return {
        id: row.id,
        code: row.code,
        inventoryType: row.inventory_type,
        category: row.category_name,
        brand: row.brand,
        model: row.model,
        condition: row.condition,
        initialStock: parseInt(row.initial_stock || 0, 10),
        stockIn: parseInt(row.stock_in || 0, 10),
        stockOut: parseInt(row.stock_out || 0, 10),
        currentStock: parseInt(row.current_stock || 0, 10),
        costPrice: r2(row.cost_price),
        salePriceEP: r2(row.expected_sale_price),
        costValue,
        saleValue,
        unrealisedMargin: r2(row.unrealised_margin),
        lowStockAlert: row.low_stock_alert,
        isLowStock: parseInt(row.current_stock || 0, 10) <= parseInt(row.low_stock_alert || 0, 10),
        dateAdded: row.date_added
      };
    });

    return res.json({
      success: true,
      summary: {
        totalProducts: rows.length,
        totalUnits: totalUnits,
        totalCostValue: r2(totalCostValue),
        totalSaleValue: r2(totalSaleValue),
        totalUnrealisedMargin: r2(totalSaleValue - totalCostValue),
        lowStockCount: rows.filter(r => r.isLowStock).length
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/spare-parts (Admin only)
// Workshop Repair Spare Parts Inventory & Job Consumption Report.
// Tracks in-stock valuations, quantities issued to repair jobs,
// cost consumed, revenue collected, and gross profit margin.
// =============================================================================
router.get('/spare-parts', requireAdmin, async (req, res, next) => {
  try {
    const { category, search, status } = req.query;

    let queryText = `
      SELECT 
        p.id, p.code, p.name, p.category, p.compatible_models,
        p.cost_price, p.selling_price, p.current_stock, p.min_stock_alert,
        p.status, p.created_at,
        (p.current_stock * p.cost_price) as stock_cost_value,
        (p.current_stock * p.selling_price) as stock_sale_value,
        COALESCE(SUM(rpu.quantity), 0) as total_used_qty,
        COALESCE(SUM(rpu.quantity * rpu.cost_price_snapshot), 0) as total_cogs_consumed,
        COALESCE(SUM(rpu.customer_charge), 0) as total_revenue_generated
      FROM repair_parts p
      LEFT JOIN repair_parts_used rpu ON rpu.part_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      queryText += ` AND p.category = $${params.length}`;
    }

    if (status) {
      if (status === 'In Stock') {
        queryText += ` AND p.current_stock > 0`;
      } else if (status === 'Low Stock') {
        queryText += ` AND p.current_stock <= p.min_stock_alert`;
      } else if (status === 'Out of Stock') {
        queryText += ` AND p.current_stock = 0`;
      } else {
        params.push(status);
        queryText += ` AND p.status = $${params.length}`;
      }
    }

    if (search) {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (LOWER(p.code) LIKE $${params.length} OR LOWER(p.name) LIKE $${params.length} OR LOWER(p.category) LIKE $${params.length})`;
    }

    queryText += ' GROUP BY p.id ORDER BY p.category, p.name';

    const result = await db.query(queryText, params);

    let totalParts = result.rows.length;
    let totalStockUnits = 0;
    let totalCostValue = 0;
    let totalSaleValue = 0;
    let totalUsedUnits = 0;
    let totalCogsConsumed = 0;
    let totalRevenueGenerated = 0;

    const rows = result.rows.map(row => {
      const stock = parseInt(row.current_stock || 0, 10);
      const usedQty = parseInt(row.total_used_qty || 0, 10);
      const costVal = r2(row.stock_cost_value);
      const saleVal = r2(row.stock_sale_value);
      const cogs = r2(row.total_cogs_consumed);
      const rev = r2(row.total_revenue_generated);
      const isLow = stock <= parseInt(row.min_stock_alert || 2, 10);

      totalStockUnits += stock;
      totalCostValue += costVal;
      totalSaleValue += saleVal;
      totalUsedUnits += usedQty;
      totalCogsConsumed += cogs;
      totalRevenueGenerated += rev;

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        category: row.category,
        compatibleModels: row.compatible_models || '—',
        currentStock: stock,
        minStockAlert: parseInt(row.min_stock_alert || 2, 10),
        costPrice: r2(row.cost_price),
        sellingPrice: r2(row.selling_price),
        stockCostValue: costVal,
        stockSaleValue: saleVal,
        usedUnits: usedQty,
        cogsConsumed: cogs,
        revenueGenerated: rev,
        profitEarned: r2(rev - cogs),
        isLowStock: isLow,
        status: row.status
      };
    });

    return res.json({
      success: true,
      summary: {
        totalParts,
        totalStockUnits,
        totalCostValue: r2(totalCostValue),
        totalSaleValue: r2(totalSaleValue),
        totalUsedUnits,
        totalCogsConsumed: r2(totalCogsConsumed),
        totalRevenueGenerated: r2(totalRevenueGenerated),
        totalPartProfit: r2(totalRevenueGenerated - totalCogsConsumed),
        lowStockCount: rows.filter(r => r.isLowStock).length
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/expenses (Admin only)
// Operating expenses breakdown by category and date.
// These reduce Net Profit (not COGS — not product cost).
// =============================================================================
router.get('/expenses', requireAdmin, async (req, res, next) => {
  try {
    const { from, to, category, paymentMethod } = req.query;

    let queryText = `
      SELECT 
        e.id, e.date, e.category_name, e.description,
        e.amount, e.payment_method, e.reference_id,
        e.created_by_name
      FROM expenses e
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      queryText += ` AND e.category_name = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      queryText += ` AND e.payment_method = $${params.length}`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'e.date');
    queryText += ' ORDER BY e.date DESC, e.created_at DESC';

    const result = await db.query(queryText, params);

    // Category breakdown
    const byCategory = {};
    let totalAmount = 0, totalCash = 0, totalOnline = 0;
    const rows = result.rows.map(row => {
      const amount = r2(row.amount);
      totalAmount += amount;
      if (row.payment_method === 'Cash') totalCash += amount;
      else totalOnline += amount;
      byCategory[row.category_name] = r2((byCategory[row.category_name] || 0) + amount);
      return {
        id: row.id,
        date: row.date,
        category: row.category_name,
        description: row.description,
        amount,
        paymentMethod: row.payment_method,
        referenceId: row.reference_id || '—',
        createdBy: row.created_by_name
      };
    });

    return res.json({
      success: true,
      summary: {
        totalAmount: r2(totalAmount),
        totalCash: r2(totalCash),
        totalOnline: r2(totalOnline),
        count: rows.length,
        byCategory
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/repairs
// Repair jobs report. Remaining = MAX(0, total - paid).
// Repair Revenue recognized only at status = 'Delivered & Closed'.
// =============================================================================
router.get('/repairs', async (req, res, next) => {
  try {
    const { from, to, staffId, status } = req.query;
    let queryText = 'SELECT * FROM repair_jobs WHERE 1=1';
    const params = [];

    if (req.user.role === 'technician') {
      params.push(req.user.id);
      queryText += ` AND technician_id = $${params.length}`;
    } else if (staffId) {
      params.push(staffId);
      queryText += ` AND (technician_id = $${params.length} OR created_by = $${params.length})`;
    }

    if (status) {
      params.push(status);
      queryText += ` AND status = $${params.length}`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'date');
    queryText += ' ORDER BY date DESC, created_at DESC';

    const result = await db.query(queryText, params);

    let totalRevenue = 0, totalPaid = 0, totalRemaining = 0;
    const rows = result.rows.map(job => {
      const total = r2(job.total);
      const paid = r2(job.paid);
      const remaining = Math.max(0, r2(total - paid));
      const settled = remaining <= EPSILON;
      if (job.status === 'Delivered & Closed') totalRevenue += total;
      totalPaid += paid;
      totalRemaining += settled ? 0 : remaining;
      return {
        id: job.id,
        trackingId: job.tracking_id,
        date: job.date,
        customerName: job.customer_name,
        jobType: job.job_type,
        categoryId: job.category_id,
        categoryName: job.category_name,
        technicianName: job.technician_name || 'Unassigned',
        status: job.status,
        priority: job.priority,
        total,
        paid,
        remaining: settled ? 0 : remaining,
        paymentStatus: settled ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid'),
        approvalStatus: job.approval_status,
        expectedCompletion: job.expected_completion
      };
    });

    return res.json({
      success: true,
      summary: {
        count: rows.length,
        deliveredRevenue: r2(totalRevenue),
        totalPaid: r2(totalPaid),
        totalOutstanding: r2(totalRemaining)
      },
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/cash-balance (Admin only)
// Formula (per method):
//   Balance = Opening + SUM(Received) - SUM(Paid) - SUM(Expenses)
//   Unique posted money events only (affects_money = TRUE)
//   No double-counting: payments OR invoice entries, not both.
// =============================================================================
router.get('/cash-balance', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const settingsRes = await db.query(`SELECT opening_cash, opening_online FROM business_settings WHERE id = 1`);
    const openingCash = r2(settingsRes.rows[0]?.opening_cash || 0);
    const openingOnline = r2(settingsRes.rows[0]?.opening_online || 0);

    // Cash flows (date-filtered)
    let cashQuery = `
      SELECT 
        payment_method,
        SUM(CASE WHEN direction = 'Received' THEN amount ELSE 0 END) as received,
        SUM(CASE WHEN direction = 'Paid' THEN amount ELSE 0 END) as paid_out
      FROM payments
      WHERE affects_money = TRUE
        AND payment_method IN ('Cash', 'Online')
    `;
    const cashParams = [];
    cashQuery = applyDateFilter(cashQuery, cashParams, from, to, 'date');
    cashQuery += ' GROUP BY payment_method';

    let expQuery = `
      SELECT 
        payment_method,
        SUM(amount) as total_expenses
      FROM expenses
      WHERE 1=1
    `;
    const expParams = [];
    expQuery = applyDateFilter(expQuery, expParams, from, to, 'date');
    expQuery += ' GROUP BY payment_method';

    // Daily movement for chart
    let dailyQuery = `
      SELECT 
        date,
        payment_method,
        SUM(CASE WHEN direction = 'Received' THEN amount ELSE 0 END) as received,
        SUM(CASE WHEN direction = 'Paid' THEN amount ELSE 0 END) as paid_out
      FROM payments
      WHERE affects_money = TRUE AND payment_method IN ('Cash', 'Online')
    `;
    const dailyParams = [];
    dailyQuery = applyDateFilter(dailyQuery, dailyParams, from, to, 'date');
    dailyQuery += ' GROUP BY date, payment_method ORDER BY date ASC';

    const [cashRes, expRes, dailyRes] = await Promise.all([
      db.query(cashQuery, cashParams),
      db.query(expQuery, expParams),
      db.query(dailyQuery, dailyParams)
    ]);

    const flows = { Cash: { received: 0, paidOut: 0, expenses: 0 }, Online: { received: 0, paidOut: 0, expenses: 0 } };
    cashRes.rows.forEach(row => {
      if (flows[row.payment_method]) {
        flows[row.payment_method].received = r2(row.received);
        flows[row.payment_method].paidOut = r2(row.paid_out);
      }
    });
    expRes.rows.forEach(row => {
      if (flows[row.payment_method]) {
        flows[row.payment_method].expenses = r2(row.total_expenses);
      }
    });

    const cashBalance = r2(openingCash + flows.Cash.received - flows.Cash.paidOut - flows.Cash.expenses);
    const onlineBalance = r2(openingOnline + flows.Online.received - flows.Online.paidOut - flows.Online.expenses);

    return res.json({
      success: true,
      data: {
        cash: {
          opening: openingCash,
          received: flows.Cash.received,
          paidOut: flows.Cash.paidOut,
          expenses: flows.Cash.expenses,
          balance: cashBalance
        },
        online: {
          opening: openingOnline,
          received: flows.Online.received,
          paidOut: flows.Online.paidOut,
          expenses: flows.Online.expenses,
          balance: onlineBalance
        },
        totalLiquidity: r2(cashBalance + onlineBalance),
        dailyMovements: dailyRes.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/profit-loss (Admin only)
// MASTER FORMULA P&L:
//
// REVENUE
//   Retail Net Product Sales = SUM(product_total, non-voided Sales Invoice) 
//                            − SUM(credit_adjusted, all Sales Invoice)
//                            − SUM(product_total, voided Sales Invoice)
//   Service Revenue          = SUM(service_total, non-voided Sales Invoice)
//   Repair Revenue           = SUM(total, Repair/Diagnosis Invoice, is_voided=FALSE)
//   Exchange Net Income      = SUM(total, Exchange Invoice where case='Customer Pays Shop')
//                            − SUM(total, Exchange Invoice where case='Shop Pays Customer')
//   Buyback Revenue          = SUM(total, Customer Purchase/Buyback invoices that were resold)
//                              [tracked as sold inventory — already in COGS/Sales loop]
//   Custom Sale Revenue      = SUM(product_total, Custom Sale Invoice, is_voided=FALSE)
//
// COGS
//   Retail COGS              = SUM(qty × cost_price_snapshot, non-voided Sales invoice items)
//   COGS Reversed            = SUM(qty × cost_price_snapshot, voided Sales invoice items)
//                            + estimated reversal from credit_adjusted items
//   Repair Parts COGS        = SUM(qty × cost_price_snapshot, repair_parts_used)
//   Custom Sale COGS         = SUM(qty × cost_price_snapshot, Custom Sale invoice items)
//
// Gross Profit = Total Revenue − Total COGS
// Net Profit   = Gross Profit  − Operating Expenses
// =============================================================================
router.get('/profit-loss', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;

    // --- REVENUE QUERIES ---

    // 1. Retail Sales (product + service), voided separately
    let retailQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN product_total ELSE 0 END), 0) as gross_product_sales,
        COALESCE(SUM(CASE WHEN is_voided = TRUE  THEN product_total ELSE 0 END), 0) as voided_product_sales,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN service_total ELSE 0 END), 0) as gross_service_sales,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN credit_adjusted ELSE 0 END), 0) as partial_return_adj
      FROM invoices 
      WHERE type = 'Sales Invoice'
    `;
    const retailParams = [];
    retailQuery = applyDateFilter(retailQuery, retailParams, from, to, 'date');

    // 2. Repair Revenue — only from delivered+closed invoices
    let repairQuery = `
      SELECT 
        COALESCE(SUM(i.total), 0) as repair_revenue
      FROM invoices i
      WHERE i.type IN ('Repair Invoice', 'Diagnosis Invoice') AND i.is_voided = FALSE
    `;
    const repairParams = [];
    repairQuery = applyDateFilter(repairQuery, repairParams, from, to, 'i.date');

    // 3. Exchange net income/cost
    let exchangeQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN exchange_case = 'Customer Pays Shop' THEN total ELSE 0 END), 0) as exchange_income,
        COALESCE(SUM(CASE WHEN exchange_case = 'Shop Pays Customer'  THEN total ELSE 0 END), 0) as exchange_cost
      FROM invoices
      WHERE type = 'Exchange Invoice' AND is_voided = FALSE
    `;
    const exParams = [];
    exchangeQuery = applyDateFilter(exchangeQuery, exParams, from, to, 'date');

    // 4. Custom Sale Revenue
    let customSaleQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN product_total ELSE 0 END), 0) as custom_sale_revenue,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN service_total ELSE 0 END), 0) as custom_service_revenue
      FROM invoices
      WHERE type = 'Custom Sale Invoice'
    `;
    const csParams = [];
    customSaleQuery = applyDateFilter(customSaleQuery, csParams, from, to, 'date');

    // 5. Buyback revenue (Customer Purchase = shop bought from customer)
    //    Revenue is realised when these items are resold as Sales Invoice items.
    //    Here we track the total cost of buyback (what was paid to customers).
    let buybackQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN total ELSE 0 END), 0) as buyback_cost
      FROM invoices
      WHERE type IN ('Customer Purchase', 'Buyback Invoice')
    `;
    const bbParams = [];
    buybackQuery = applyDateFilter(buybackQuery, bbParams, from, to, 'date');

    // --- COGS QUERIES ---

    // 6. Retail COGS from non-voided Sales Invoice items (cost_price_snapshot)
    let retailCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as retail_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Sales Invoice' AND i.is_voided = FALSE 
        AND ii.item_type IN ('product', 'custom_product')
    `;
    const retailCogsParams = [];
    retailCogsQuery = applyDateFilter(retailCogsQuery, retailCogsParams, from, to, 'i.date');

    // 7. COGS reversed from voided Sales Invoice items
    let voidCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as voided_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Sales Invoice' AND i.is_voided = TRUE 
        AND ii.item_type IN ('product', 'custom_product')
    `;
    const voidCogsParams = [];
    voidCogsQuery = applyDateFilter(voidCogsQuery, voidCogsParams, from, to, 'i.date');

    // 8. Repair Parts COGS — from repair_parts_used (parts consumed by technicians)
    let repairCogsQuery = `
      SELECT COALESCE(SUM(rpu.quantity * rpu.cost_price_snapshot), 0) as repair_cogs
      FROM repair_parts_used rpu
      JOIN repair_jobs rj ON rj.id = rpu.repair_job_id
      WHERE rj.status = 'Delivered & Closed'
    `;
    const repCogsParams = [];
    // Date filter on repair job date
    if (from) {
      repCogsParams.push(from);
      repairCogsQuery += ` AND rj.date >= $${repCogsParams.length}`;
    }
    if (to) {
      repCogsParams.push(to);
      repairCogsQuery += ` AND rj.date <= $${repCogsParams.length}`;
    }

    // Also include invoice_items COGS for Repair Invoices (parts billed via POS)
    let repairInvCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as repair_inv_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type IN ('Repair Invoice', 'Diagnosis Invoice') 
        AND i.is_voided = FALSE AND ii.item_type = 'product'
    `;
    const repInvCogsParams = [];
    repairInvCogsQuery = applyDateFilter(repairInvCogsQuery, repInvCogsParams, from, to, 'i.date');

    // 9. Custom Sale COGS
    let csCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as custom_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Custom Sale Invoice' AND i.is_voided = FALSE
        AND ii.item_type IN ('product', 'custom_product')
    `;
    const csCogsParams = [];
    csCogsQuery = applyDateFilter(csCogsQuery, csCogsParams, from, to, 'i.date');

    // 10. Operating Expenses
    let expQuery = `SELECT COALESCE(SUM(amount), 0) as expenses FROM expenses WHERE 1=1`;
    const expParams = [];
    expQuery = applyDateFilter(expQuery, expParams, from, to, 'date');

    // --- RUN ALL IN PARALLEL ---
    const [
      retailRes,
      repairRes,
      exRes,
      csRes,
      bbRes,
      retailCogsRes,
      voidCogsRes,
      repairCogsRes,
      repairInvCogsRes,
      csCogsRes,
      expRes
    ] = await Promise.all([
      db.query(retailQuery, retailParams),
      db.query(repairQuery, repairParams),
      db.query(exchangeQuery, exParams),
      db.query(customSaleQuery, csParams),
      db.query(buybackQuery, bbParams),
      db.query(retailCogsQuery, retailCogsParams),
      db.query(voidCogsQuery, voidCogsParams),
      db.query(repairCogsQuery, repCogsParams),
      db.query(repairInvCogsQuery, repInvCogsParams),
      db.query(csCogsQuery, csCogsParams),
      db.query(expQuery, expParams)
    ]);

    // --- COMPUTE ---

    // Revenue
    const grossProductSales  = r2(retailRes.rows[0].gross_product_sales);
    const voidedProductSales  = r2(retailRes.rows[0].voided_product_sales);
    const partialReturnAdj    = r2(retailRes.rows[0].partial_return_adj);
    // Net Product Sales = Gross − Voided − Partial Returns
    const netProductSales     = r2(grossProductSales - voidedProductSales - partialReturnAdj);
    const serviceSales        = r2(retailRes.rows[0].gross_service_sales);

    const repairRevenue       = r2(repairRes.rows[0].repair_revenue);

    const exchangeIncome      = r2(exRes.rows[0].exchange_income);
    const exchangeCost        = r2(exRes.rows[0].exchange_cost);
    const exchangeNetIncome   = r2(exchangeIncome - exchangeCost);

    const customSaleRevenue   = r2(parseFloat(csRes.rows[0].custom_sale_revenue) + parseFloat(csRes.rows[0].custom_service_revenue));

    const buybackCost         = r2(bbRes.rows[0].buyback_cost);

    const totalRevenue        = r2(netProductSales + serviceSales + repairRevenue + exchangeNetIncome + customSaleRevenue);

    // COGS
    // Net retail COGS = non-voided COGS − voided COGS reversed
    const retailCogs          = r2(retailCogsRes.rows[0].retail_cogs);
    const voidedCogs          = r2(voidCogsRes.rows[0].voided_cogs);
    const netRetailCogs       = r2(retailCogs - voidedCogs);

    // Repair COGS = parts used by technicians (repair_parts_used)
    //             + any product items on Repair Invoices
    //             (avoid double-count: repair_parts_used is internal, invoice items are customer-facing)
    const repairPartsCogs     = r2(repairCogsRes.rows[0].repair_cogs);
    const repairInvPartsCogs  = r2(repairInvCogsRes.rows[0].repair_inv_cogs);
    // Use the larger of the two — they may overlap. Prefer repair_parts_used as source of truth.
    // If repair_parts_used is 0, fall back to invoice items.
    const repairCogs          = repairPartsCogs > 0 ? repairPartsCogs : repairInvPartsCogs;

    const customSaleCogs      = r2(csCogsRes.rows[0].custom_cogs);

    const totalCogs           = r2(netRetailCogs + repairCogs + customSaleCogs);

    // P&L
    const grossProfit         = r2(totalRevenue - totalCogs);
    const operatingExpenses   = r2(expRes.rows[0].expenses);
    const netProfit           = r2(grossProfit - operatingExpenses);

    return res.json({
      success: true,
      data: {
        // Revenue breakdown
        grossProductSales,
        voidedProductSales,
        partialReturnAdj,
        netProductSales,
        serviceSales,
        repairRevenue,
        exchangeIncome,
        exchangeCost,
        exchangeNetIncome,
        customSaleRevenue,
        buybackCost,           // informational: total paid out for buybacks
        totalRevenue,

        // COGS breakdown
        retailCogs,
        voidedCogs,
        netRetailCogs,
        repairPartsCogs,
        repairInvPartsCogs,
        repairCogs,
        customSaleCogs,
        totalCogs,

        // Bottom line
        grossProfit,
        operatingExpenses,
        netProfit,

        // Margin %
        grossMarginPct: totalRevenue > 0 ? r2((grossProfit / totalRevenue) * 100) : 0,
        netMarginPct:   totalRevenue > 0 ? r2((netProfit   / totalRevenue) * 100) : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/reports/csv/:type (Admin only)
// CSV export for: sales | returns | purchases | vendor-returns | inventory | expenses | repairs
// =============================================================================
router.get('/csv/:type', requireAdmin, async (req, res, next) => {
  try {
    const { type } = req.params;
    const { from, to } = req.query;

    // Re-use the internal report endpoints by making a local DB call
    // and formatting as CSV.
    const dateTag = [from, to].filter(Boolean).join('_to_') || 'all-time';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${dateTag}.csv"`);

    let csv = '';

    if (type === 'sales') {
      let q = `
        SELECT i.invoice_no, i.date, i.party_name, i.type, i.payment_method,
               i.product_total, i.service_total, i.total, i.paid, i.credit_adjusted,
               GREATEST(0, i.total - i.paid) as remaining, i.payment_status, i.created_by_name
        FROM invoices i
        WHERE i.is_voided = FALSE AND i.type IN ('Sales Invoice','Exchange Invoice','Custom Sale Invoice')
      `;
      const p = [];
      q = applyDateFilter(q, p, from, to, 'i.date');
      q += ' ORDER BY i.date DESC';
      const r = await db.query(q, p);
      csv = toCSV(r.rows, [
        { key: 'invoice_no', label: 'Invoice No' },
        { key: 'date', label: 'Date' },
        { key: 'party_name', label: 'Customer' },
        { key: 'type', label: 'Type' },
        { key: 'payment_method', label: 'Payment Method' },
        { key: 'product_total', label: 'Product Total (PKR)' },
        { key: 'service_total', label: 'Service Total (PKR)' },
        { key: 'total', label: 'Invoice Total (PKR)' },
        { key: 'paid', label: 'Amount Paid (PKR)' },
        { key: 'credit_adjusted', label: 'Credit Adjusted (PKR)' },
        { key: 'remaining', label: 'Outstanding (PKR)' },
        { key: 'payment_status', label: 'Status' },
        { key: 'created_by_name', label: 'Sold By' }
      ]);

    } else if (type === 'returns') {
      let q = `
        SELECT i.invoice_no, i.void_date as date, i.party_name,
               i.total as return_amount, i.paid as was_paid,
               i.refund_amount, i.refund_method, i.void_reason,
               'Full Void' as return_type
        FROM invoices i
        WHERE i.type IN ('Sales Invoice','Exchange Invoice','Custom Sale Invoice') AND i.is_voided = TRUE
      `;
      const p = [];
      q = applyDateFilter(q, p, from, to, 'i.void_date');
      q += ' UNION ALL SELECT i.invoice_no, i.date, i.party_name, i.credit_adjusted, i.paid, i.credit_adjusted, i.refund_method, NULL, \'Partial Return\' FROM invoices i WHERE i.type IN (\'Sales Invoice\',\'Exchange Invoice\',\'Custom Sale Invoice\') AND i.is_voided = FALSE AND i.credit_adjusted > 0.005';
      q += ' ORDER BY date DESC NULLS LAST';
      const r = await db.query(q, p);
      csv = toCSV(r.rows, [
        { key: 'invoice_no', label: 'Invoice No' },
        { key: 'date', label: 'Return Date' },
        { key: 'party_name', label: 'Customer' },
        { key: 'return_type', label: 'Return Type' },
        { key: 'return_amount', label: 'Return Amount (PKR)' },
        { key: 'was_paid', label: 'Was Paid (PKR)' },
        { key: 'refund_amount', label: 'Refunded (PKR)' },
        { key: 'refund_method', label: 'Refund Method' },
        { key: 'void_reason', label: 'Reason' }
      ]);

    } else if (type === 'purchases') {
      let q = `
        SELECT i.invoice_no, i.date, i.party_name, i.type, i.payment_method,
               i.total, i.paid, i.credit_adjusted,
               GREATEST(0, i.total - i.paid - i.credit_adjusted) as remaining,
               i.payment_status, i.created_by_name
        FROM invoices i
        WHERE i.type IN ('Vendor Purchase','Customer Purchase','Buyback Invoice')
      `;
      const p = [];
      q = applyDateFilter(q, p, from, to, 'i.date');
      q += ' ORDER BY i.date DESC';
      const r = await db.query(q, p);
      csv = toCSV(r.rows, [
        { key: 'invoice_no', label: 'Invoice No' },
        { key: 'date', label: 'Date' },
        { key: 'party_name', label: 'Party' },
        { key: 'type', label: 'Type' },
        { key: 'payment_method', label: 'Payment Method' },
        { key: 'total', label: 'Total (PKR)' },
        { key: 'paid', label: 'Paid (PKR)' },
        { key: 'credit_adjusted', label: 'Credit Adjusted (PKR)' },
        { key: 'remaining', label: 'Outstanding (PKR)' },
        { key: 'payment_status', label: 'Status' },
        { key: 'created_by_name', label: 'Recorded By' }
      ]);

    } else if (type === 'vendor-returns') {
      let q = `
        SELECT vr.date, vr.vendor_name, vr.product_code, vr.returned_product_name,
               vr.quantity, vr.amount, vr.actual_money_received, vr.exchange_value,
               vr.payable_adjustment, vr.settlement_method, vr.replacement_product_name,
               vr.replacement_qty, vr.reason, vr.status
        FROM vendor_returns vr WHERE 1=1
      `;
      const p = [];
      if (staffId) {
        p.push(staffId);
        q += ` AND vr.created_by = $${p.length}`;
      }
      if (paymentMethod) {
        p.push(paymentMethod);
        q += ` AND (vr.payment_method = $${p.length} OR vr.settlement_method = $${p.length})`;
      }
      q = applyDateFilter(q, p, from, to, 'vr.date');
      q += ' ORDER BY vr.date DESC';
      const r = await db.query(q, p);
      csv = toCSV(r.rows, [
        { key: 'date', label: 'Date' },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'product_code', label: 'Product Code' },
        { key: 'returned_product_name', label: 'Product Name' },
        { key: 'quantity', label: 'Qty Returned' },
        { key: 'amount', label: 'Return Amount (PKR)' },
        { key: 'actual_money_received', label: 'Cash Received (PKR)' },
        { key: 'exchange_value', label: 'Exchange Value (PKR)' },
        { key: 'payable_adjustment', label: 'Payable Adj (PKR)' },
        { key: 'settlement_method', label: 'Settlement' },
        { key: 'replacement_product_name', label: 'Replacement Product' },
        { key: 'replacement_qty', label: 'Replacement Qty' },
        { key: 'reason', label: 'Reason' },
        { key: 'status', label: 'Status' }
      ]);

    } else if (type === 'inventory') {
      const r = await db.query(`
        SELECT p.code, p.inventory_type, p.category_name, p.brand, p.model, p.condition,
               p.initial_stock, p.stock_in, p.stock_out, p.current_stock,
               p.cost_price, p.expected_sale_price,
               (p.current_stock * p.cost_price) as cost_value,
               (p.current_stock * p.expected_sale_price) as sale_value,
               p.low_stock_alert, p.date_added
        FROM products p ORDER BY p.category_name, p.brand
      `);
      csv = toCSV(r.rows, [
        { key: 'code', label: 'Product Code' },
        { key: 'inventory_type', label: 'Type' },
        { key: 'category_name', label: 'Category' },
        { key: 'brand', label: 'Brand' },
        { key: 'model', label: 'Model' },
        { key: 'condition', label: 'Condition' },
        { key: 'initial_stock', label: 'Opening Stock' },
        { key: 'stock_in', label: 'Stock IN' },
        { key: 'stock_out', label: 'Stock OUT' },
        { key: 'current_stock', label: 'Current Stock' },
        { key: 'cost_price', label: 'Cost Price (PKR)' },
        { key: 'expected_sale_price', label: 'Sale Price EP (PKR)' },
        { key: 'cost_value', label: 'Stock Cost Value (PKR)' },
        { key: 'sale_value', label: 'Stock Sale Value (PKR)' },
        { key: 'low_stock_alert', label: 'Low Stock Alert' },
        { key: 'date_added', label: 'Date Added' }
      ]);

    } else if (type === 'expenses') {
      let q = `
        SELECT e.date, e.category_name, e.description, e.amount, e.payment_method,
               e.reference_id, e.created_by_name
        FROM expenses e WHERE 1=1
      `;
      const p = [];
      q = applyDateFilter(q, p, from, to, 'e.date');
      q += ' ORDER BY e.date DESC';
      const r = await db.query(q, p);
      csv = toCSV(r.rows, [
        { key: 'date', label: 'Date' },
        { key: 'category_name', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount (PKR)' },
        { key: 'payment_method', label: 'Payment Method' },
        { key: 'reference_id', label: 'Reference ID' },
        { key: 'created_by_name', label: 'Recorded By' }
      ]);

    } else if (type === 'repairs') {
      let q = `
        SELECT tracking_id, date, customer_name, category_name, brand, model,
               technician_name, status, total, paid,
               GREATEST(0, total - paid) as remaining,
               expected_completion
        FROM repair_jobs WHERE 1=1
      `;
      const p = [];
      q = applyDateFilter(q, p, from, to, 'date');
      q += ' ORDER BY date DESC';
      const r = await db.query(q, p);
      csv = toCSV(r.rows, [
        { key: 'tracking_id', label: 'Tracking ID' },
        { key: 'date', label: 'Date' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'category_name', label: 'Category' },
        { key: 'brand', label: 'Brand' },
        { key: 'model', label: 'Model' },
        { key: 'technician_name', label: 'Technician' },
        { key: 'status', label: 'Status' },
        { key: 'total', label: 'Total (PKR)' },
        { key: 'paid', label: 'Paid (PKR)' },
        { key: 'remaining', label: 'Remaining (PKR)' },
        { key: 'expected_completion', label: 'Expected Date' }
      ]);

    } else if (type === 'spare-parts') {
      const r = await db.query(`
        SELECT 
          p.code, p.name, p.category, p.compatible_models,
          p.current_stock, p.cost_price, p.selling_price,
          (p.current_stock * p.cost_price) as stock_cost_value,
          (p.current_stock * p.selling_price) as stock_sale_value,
          COALESCE(SUM(rpu.quantity), 0) as total_used_qty,
          COALESCE(SUM(rpu.customer_charge), 0) as total_revenue,
          p.status
        FROM repair_parts p
        LEFT JOIN repair_parts_used rpu ON rpu.part_id = p.id
        GROUP BY p.id
        ORDER BY p.category, p.name
      `);
      csv = toCSV(r.rows, [
        { key: 'code', label: 'Part SKU / Code' },
        { key: 'category', label: 'Category' },
        { key: 'name', label: 'Part Name' },
        { key: 'compatible_models', label: 'Compatible Models' },
        { key: 'current_stock', label: 'Current Stock Qty' },
        { key: 'cost_price', label: 'Unit Cost Price (PKR)' },
        { key: 'selling_price', label: 'Customer Billing Price (PKR)' },
        { key: 'stock_cost_value', label: 'Stock Cost Value (PKR)' },
        { key: 'stock_sale_value', label: 'Stock Sale Value (PKR)' },
        { key: 'total_used_qty', label: 'Consumed in Jobs (Qty)' },
        { key: 'total_revenue', label: 'Revenue Generated (PKR)' },
        { key: 'status', label: 'Status' }
      ]);

    } else {
      return res.status(400).json({ success: false, message: 'Unknown report type for CSV export.' });
    }

    return res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
