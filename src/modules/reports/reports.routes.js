const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');

router.use(authenticateToken);

const { getAvailableBalance } = require('../../utils/financialFormulas');

// Helper for date filtering
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

// GET /api/reports/dashboard - Dynamic Dashboard Metrics
router.get('/dashboard', async (req, res, next) => {
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
          COUNT(CASE WHEN balance > 0 THEN 1 END) as pending_count
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
            cashCollected: parseFloat(paymentsRes.rows[0].cash_in || 0),
            onlineCollected: parseFloat(paymentsRes.rows[0].online_in || 0),
            retailBilling: parseFloat(salesRes.rows[0].billing || 0),
            retailCount: parseInt(salesRes.rows[0].count || 0, 10),
            pendingInvoices: parseInt(salesRes.rows[0].pending_count || 0, 10),
            outstandingBalance: parseFloat(salesRes.rows[0].balance || 0)
          },
          recentInvoices: recentInvRes.rows,
          lowStock: lowStockRes.rows
        }
      });
    }

    // Admin Dashboard - Comprehensive multi-module real-time metrics
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
      // Inventory
      db.query(`
        SELECT 
          COUNT(*) as total_products,
          COALESCE(SUM(current_stock), 0) as current_stock,
          COUNT(CASE WHEN current_stock <= low_stock_alert THEN 1 END) as low_stock,
          COALESCE(SUM(current_stock * cost_price), 0) as stock_cost_value,
          COALESCE(SUM(current_stock * expected_sale_price), 0) as stock_sale_value
        FROM products
      `),
      // Sales & Invoices
      db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE AND date = CURRENT_DATE THEN total ELSE 0 END), 0) as today_sales,
          COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN 1 END) as total_sales_count,
          COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE AND date = CURRENT_DATE THEN 1 END) as today_sales_count
        FROM invoices
      `),
      // Accounts (Receivables & Payables across Customer & Vendor)
      db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'Customer Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as customer_receivable,
          COALESCE(SUM(CASE WHEN type = 'Customer Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as customer_payable,
          COALESCE(SUM(CASE WHEN type = 'Vendor Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as vendor_payable,
          COALESCE(SUM(CASE WHEN type = 'Vendor Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as vendor_receivable
        FROM accounts
      `),
      // Repairs Workshop
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
      // Expenses
      db.query(`
        SELECT 
          COALESCE(SUM(amount), 0) as total_expenses,
          COALESCE(SUM(CASE WHEN date = CURRENT_DATE THEN amount ELSE 0 END), 0) as today_expenses
        FROM expenses
      `),
      // Canonical Cash & Online Drawer balances
      getAvailableBalance('Cash'),
      getAvailableBalance('Online'),
      // Recent Invoices
      db.query(`
        SELECT id, invoice_no, type, date, party_name, total, paid, balance, payment_status, is_voided, created_by_name
        FROM invoices ORDER BY date DESC, created_at DESC LIMIT 6
      `),
      // Recent Repair Jobs
      db.query(`
        SELECT id, tracking_id, customer_name, contact as customer_contact, category_name as category, brand, model, status, priority, total, date, expected_completion
        FROM repair_jobs ORDER BY date DESC, created_at DESC LIMIT 6
      `),
      // Recent Expenses
      db.query(`
        SELECT id, date, description as title, category_name as category, amount, payment_method
        FROM expenses ORDER BY date DESC, created_at DESC LIMIT 5
      `),
      // Low Stock Products
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
          // Inventory
          totalProducts: parseInt(prodRes.rows[0].total_products || 0, 10),
          currentStock: parseInt(prodRes.rows[0].current_stock || 0, 10),
          lowStock: parseInt(prodRes.rows[0].low_stock || 0, 10),
          stockCostValue: parseFloat(prodRes.rows[0].stock_cost_value || 0),
          stockSaleValue: parseFloat(prodRes.rows[0].stock_sale_value || 0),
          // Sales
          totalSales: parseFloat(salesRes.rows[0].total_sales || 0),
          todaySales: parseFloat(salesRes.rows[0].today_sales || 0),
          totalSalesCount: parseInt(salesRes.rows[0].total_sales_count || 0, 10),
          todaySalesCount: parseInt(salesRes.rows[0].today_sales_count || 0, 10),
          // Balances & Accounts
          customerReceivables: parseFloat(accountsRes.rows[0].customer_receivable || 0),
          customerPayables: parseFloat(accountsRes.rows[0].customer_payable || 0),
          vendorPayables: parseFloat(accountsRes.rows[0].vendor_payable || 0),
          vendorReceivables: parseFloat(accountsRes.rows[0].vendor_receivable || 0),
          openBalance: parseFloat(accountsRes.rows[0].customer_receivable || 0),
          // Cash & Bank
          cashInHand: cashInHand,
          onlineBalance: onlineBalance,
          // Expenses
          totalExpenses: parseFloat(expenseRes.rows[0].total_expenses || 0),
          todayExpenses: parseFloat(expenseRes.rows[0].today_expenses || 0),
          // Repairs
          activeRepairs: parseInt(repairRes.rows[0].active_repairs || 0, 10),
          waitingApproval: parseInt(repairRes.rows[0].waiting_approval || 0, 10),
          inProgress: parseInt(repairRes.rows[0].in_progress || 0, 10),
          readyDelivery: parseInt(repairRes.rows[0].ready_delivery || 0, 10),
          completedRepairs: parseInt(repairRes.rows[0].completed_repairs || 0, 10),
          repairRevenue: parseFloat(repairRes.rows[0].repair_revenue || 0),
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

// GET /api/reports/sales
router.get('/sales', async (req, res, next) => {
  try {
    const { from, to, staffId, paymentMethod } = req.query;
    let queryText = `
      SELECT 
        i.*,
        COALESCE((
          SELECT SUM(ii.quantity * ii.cost_price_snapshot) 
          FROM invoice_items ii 
          WHERE ii.invoice_id = i.id AND ii.item_type IN ('product', 'custom_product')
        ), 0) as cogs
      FROM invoices i
      WHERE i.type = 'Sales Invoice'
    `;
    const params = [];

    // Role-scoping for Sales Staff
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

    queryText = applyDateFilter(queryText, params, from, to, 'i.date');
    queryText += ' ORDER BY i.date DESC, i.created_at DESC';

    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        invoiceNo: row.invoice_no,
        date: row.date,
        customerName: row.party_name,
        productTotal: parseFloat(row.product_total || 0),
        serviceTotal: parseFloat(row.service_total || 0),
        cogs: req.user.role === 'admin' ? parseFloat(row.cogs || 0) : 0,
        paid: parseFloat(row.paid || 0),
        balance: parseFloat(row.balance || 0),
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        isVoided: row.is_voided,
        soldBy: row.created_by_name
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/purchases (Admin only)
router.get('/purchases', requireAdmin, async (req, res, next) => {
  try {
    const { from, to, paymentMethod, staffId } = req.query;
    let queryText = `
      SELECT * FROM invoices 
      WHERE type IN ('Vendor Purchase', 'Customer Purchase')
    `;
    const params = [];

    if (staffId) {
      params.push(staffId);
      queryText += ` AND created_by = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      queryText += ` AND payment_method = $${params.length}`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'date');
    queryText += ' ORDER BY date DESC, created_at DESC';

    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        invoiceNo: row.invoice_no,
        date: row.date,
        type: row.type,
        partyName: row.party_name,
        total: parseFloat(row.total || 0),
        paid: parseFloat(row.paid || 0),
        creditAdjusted: parseFloat(row.credit_adjusted || 0),
        balance: parseFloat(row.balance || 0),
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        createdBy: row.created_by_name
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/profit-loss (Admin only)
router.get('/profit-loss', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;

    // Retail Revenue & COGS
    let retailQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN product_total ELSE 0 END), 0) as gross_product_sales,
        COALESCE(SUM(CASE WHEN is_voided = TRUE THEN product_total ELSE 0 END), 0) as voided_product_sales,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN service_total ELSE 0 END), 0) as gross_service_sales
      FROM invoices 
      WHERE type = 'Sales Invoice'
    `;
    const retailParams = [];
    retailQuery = applyDateFilter(retailQuery, retailParams, from, to, 'date');
    const retailRes = await db.query(retailQuery, retailParams);

    // Retail COGS (non-voided)
    let cogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Sales Invoice' AND i.is_voided = FALSE AND ii.item_type IN ('product', 'custom_product')
    `;
    const cogsParams = [];
    cogsQuery = applyDateFilter(cogsQuery, cogsParams, from, to, 'i.date');
    const cogsRes = await db.query(cogsQuery, cogsParams);

    // Repair Revenue & Parts COGS
    let repairQuery = `
      SELECT 
        COALESCE(SUM(total), 0) as repair_revenue
      FROM invoices
      WHERE type IN ('Repair Invoice', 'Diagnosis Invoice') AND is_voided = FALSE
    `;
    const repairParams = [];
    repairQuery = applyDateFilter(repairQuery, repairParams, from, to, 'date');
    const repairRes = await db.query(repairQuery, repairParams);

    let repairCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as repair_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type IN ('Repair Invoice', 'Diagnosis Invoice') AND i.is_voided = FALSE AND ii.item_type = 'product'
    `;
    const repCogsParams = [];
    repairCogsQuery = applyDateFilter(repairCogsQuery, repCogsParams, from, to, 'i.date');
    const repCogsRes = await db.query(repairCogsQuery, repCogsParams);

    // Exchange Difference Income & Cost
    let exchangeQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN exchange_case = 'Customer Pays Shop' THEN total ELSE 0 END), 0) as exchange_income,
        COALESCE(SUM(CASE WHEN exchange_case = 'Shop Pays Customer' THEN total ELSE 0 END), 0) as exchange_cost
      FROM invoices
      WHERE type = 'Exchange Invoice' AND is_voided = FALSE
    `;
    const exParams = [];
    exchangeQuery = applyDateFilter(exchangeQuery, exParams, from, to, 'date');
    const exRes = await db.query(exchangeQuery, exParams);

    // Operating Expenses
    let expQuery = `SELECT COALESCE(SUM(amount), 0) as expenses FROM expenses WHERE 1=1`;
    const expParams = [];
    expQuery = applyDateFilter(expQuery, expParams, from, to, 'date');
    const expRes = await db.query(expQuery, expParams);

    const grossProductSales = parseFloat(retailRes.rows[0].gross_product_sales || 0);
    const voidedProductSales = parseFloat(retailRes.rows[0].voided_product_sales || 0);
    const netProductSales = grossProductSales - voidedProductSales;
    const serviceSales = parseFloat(retailRes.rows[0].gross_service_sales || 0);
    const retailCogs = parseFloat(cogsRes.rows[0].cogs || 0);

    const repairRevenue = parseFloat(repairRes.rows[0].repair_revenue || 0);
    const repairPartsCogs = parseFloat(repCogsRes.rows[0].repair_cogs || 0);

    const exchangeIncome = parseFloat(exRes.rows[0].exchange_income || 0);
    const exchangeCost = parseFloat(exRes.rows[0].exchange_cost || 0);

    const operatingExpenses = parseFloat(expRes.rows[0].expenses || 0);

    const totalRevenue = netProductSales + serviceSales + repairRevenue + exchangeIncome;
    const totalCogs = retailCogs + repairPartsCogs + exchangeCost;
    const grossProfit = totalRevenue - totalCogs;
    const netProfit = grossProfit - operatingExpenses;

    return res.json({
      success: true,
      data: {
        grossProductSales,
        voidedProductSales,
        netProductSales,
        serviceSales,
        repairRevenue,
        exchangeIncome,
        totalRevenue,
        retailCogs,
        repairPartsCogs,
        exchangeCost,
        totalCogs,
        grossProfit,
        operatingExpenses,
        netProfit
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/repairs - Repair operations report
router.get('/repairs', async (req, res, next) => {
  try {
    const { from, to, staffId } = req.query;
    let queryText = 'SELECT * FROM repair_jobs WHERE 1=1';
    const params = [];

    if (req.user.role === 'technician') {
      params.push(req.user.id);
      queryText += ` AND technician_id = $${params.length}`;
    } else if (staffId) {
      params.push(staffId);
      queryText += ` AND (technician_id = $${params.length} OR created_by = $${params.length})`;
    }

    queryText = applyDateFilter(queryText, params, from, to, 'date');
    queryText += ' ORDER BY date DESC, created_at DESC';

    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(job => ({
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
        total: parseFloat(job.total || 0),
        paid: parseFloat(job.paid || 0),
        remaining: Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0)),
        approvalStatus: job.approval_status,
        expectedCompletion: job.expected_completion
      }))
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
