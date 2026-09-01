const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const branchManager = require('../../config/branchManager');
const { getAvailableBalance } = require('../../utils/financialFormulas');

// Helper to round to 2 decimals
function r2(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

// Helper to check Super Admin JWT
const requireSuperAdmin = async (req, res, next) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login as Super Admin.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026');
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin privileges required.'
      });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired Super Admin token.'
    });
  }
};

/**
 * Server-side calculation of complete financial & operational truth for a single branch pool
 */
async function computeBranchMetrics(pool, branchMeta = {}, from = null, to = null) {
  let dateFilterInv = '';
  let dateFilterRep = '';
  let dateFilterExp = '';
  const invParams = [];
  const repParams = [];
  const expParams = [];

  if (from) {
    invParams.push(from);
    dateFilterInv += ` AND date >= $${invParams.length}`;
    repParams.push(from);
    dateFilterRep += ` AND date >= $${repParams.length}`;
    expParams.push(from);
    dateFilterExp += ` AND date >= $${expParams.length}`;
  }
  if (to) {
    invParams.push(to);
    dateFilterInv += ` AND date <= $${invParams.length}`;
    repParams.push(to);
    dateFilterRep += ` AND date <= $${repParams.length}`;
    expParams.push(to);
    dateFilterExp += ` AND date <= $${expParams.length}`;
  }

  // 1. Sales & Purchases
  const salesRes = await pool.query(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_sales,
      COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN 1 END) AS sales_count,
      COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN balance ELSE 0 END), 0) AS sales_unpaid,
      COALESCE(SUM(CASE WHEN (type = 'Purchase Invoice' OR type = 'Vendor Purchase') AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_purchases,
      COALESCE(SUM(CASE WHEN type = 'Buyback Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_buybacks,
      COALESCE(SUM(CASE WHEN type = 'Exchange Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_exchanges,
      COALESCE(SUM(CASE WHEN type = 'Return Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_returns
    FROM invoices WHERE 1=1 ${dateFilterInv}
  `, invParams);

  // 2. Repairs
  const repairsRes = await pool.query(`
    SELECT 
      COALESCE(SUM(CASE WHEN status = 'Delivered & Closed' THEN total ELSE 0 END), 0) AS repair_revenue,
      COUNT(CASE WHEN status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) AS active_repairs,
      COUNT(CASE WHEN status = 'Delivered & Closed' THEN 1 END) AS completed_repairs,
      COUNT(*) AS total_repairs_count
    FROM repair_jobs WHERE 1=1 ${dateFilterRep}
  `, repParams);

  // 3. COGS (Cost of Goods Sold)
  const cogsRes = await pool.query(`
    SELECT COALESCE(SUM(ii.quantity * COALESCE(ii.cost_price_snapshot, p.cost_price, 0)), 0) AS total_cogs
    FROM invoice_items ii
    JOIN invoices inv ON ii.invoice_id = inv.id
    LEFT JOIN products p ON ii.product_id = p.id
    WHERE inv.type = 'Sales Invoice' AND inv.is_voided = FALSE ${dateFilterInv.replace(/date/g, 'inv.date')}
  `, invParams);

  // 4. Expenses
  const expRes = await pool.query(`
    SELECT 
      COALESCE(SUM(amount), 0) AS total_expenses,
      COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN amount ELSE 0 END), 0) AS cash_expenses,
      COALESCE(SUM(CASE WHEN payment_method = 'Online' THEN amount ELSE 0 END), 0) AS online_expenses
    FROM expenses WHERE 1=1 ${dateFilterExp}
  `, expParams);

  // 5. Accounts (Receivables & Payables)
  const accountsRes = await pool.query(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'Customer Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS customer_receivable,
      COALESCE(SUM(CASE WHEN type = 'Customer Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS customer_payable,
      COALESCE(SUM(CASE WHEN type = 'Vendor Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS vendor_payable,
      COALESCE(SUM(CASE WHEN type = 'Vendor Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS vendor_receivable
    FROM accounts
  `);

  // 6. Inventory Valuation
  const stockRes = await pool.query(`
    SELECT 
      COALESCE(SUM(current_stock * cost_price), 0) AS stock_cost_value,
      COALESCE(SUM(current_stock * expected_sale_price), 0) AS stock_sale_value,
      COALESCE(SUM(current_stock), 0) AS total_stock_items,
      COUNT(*) AS total_sku_count,
      COUNT(CASE WHEN current_stock <= low_stock_alert THEN 1 END) AS low_stock_count
    FROM products
  `);

  // 7. Cash Drawer & Online Liquidity
  const cashInDrawer = await getAvailableBalance('Cash', pool);
  const onlineBalance = await getAvailableBalance('Online', pool);

  // 8. Staff Count
  const staffRes = await pool.query(`SELECT COUNT(*) AS total_staff FROM users WHERE status = 'Active'`);

  const sRow = salesRes.rows[0] || {};
  const rRow = repairsRes.rows[0] || {};
  const eRow = expRes.rows[0] || {};
  const aRow = accountsRes.rows[0] || {};
  const stRow = stockRes.rows[0] || {};

  const totalSales = parseFloat(sRow.total_sales || 0);
  const repairRevenue = parseFloat(rRow.repair_revenue || 0);
  const totalGrossRevenue = totalSales + repairRevenue;
  const totalCogs = parseFloat(cogsRes.rows[0]?.total_cogs || 0);
  const grossProfit = totalGrossRevenue - totalCogs;
  const totalExpenses = parseFloat(eRow.total_expenses || 0);
  const netProfit = grossProfit - totalExpenses;

  const custReceivable = parseFloat(aRow.customer_receivable || 0);
  const custPayable = parseFloat(aRow.customer_payable || 0);
  const vendPayable = parseFloat(aRow.vendor_payable || 0);
  const vendReceivable = parseFloat(aRow.vendor_receivable || 0);

  const stockCostValue = parseFloat(stRow.stock_cost_value || 0);
  const stockSaleValue = parseFloat(stRow.stock_sale_value || 0);

  return {
    branchId: branchMeta.id,
    branchCode: branchMeta.branch_code,
    branchName: branchMeta.branch_name,
    status: branchMeta.status || 'Active',
    city: branchMeta.city || '',
    phone: branchMeta.phone || '',
    email: branchMeta.email || '',
    address: branchMeta.address || '',
    adminName: branchMeta.admin_name || '',
    adminUsername: branchMeta.admin_username || '',
    dbName: branchMeta.db_name,
    dbHost: branchMeta.db_host,
    schemaVersion: branchMeta.schema_version,
    createdAt: branchMeta.created_at,
    updatedAt: branchMeta.updated_at,
    isHealthy: true,

    // Core Financial Metrics
    totalSales: r2(totalSales),
    salesCount: parseInt(sRow.sales_count || 0, 10),
    salesUnpaidBalance: r2(sRow.sales_unpaid || 0),
    totalPurchases: r2(sRow.total_purchases || 0),
    totalBuybacks: r2(sRow.total_buybacks || 0),
    totalExchanges: r2(sRow.total_exchanges || 0),
    totalReturns: r2(sRow.total_returns || 0),

    // Repairs
    repairRevenue: r2(repairRevenue),
    activeRepairs: parseInt(rRow.active_repairs || 0, 10),
    completedRepairs: parseInt(rRow.completed_repairs || 0, 10),
    totalRepairsCount: parseInt(rRow.total_repairs_count || 0, 10),

    // Profitability
    totalGrossRevenue: r2(totalGrossRevenue),
    totalCogs: r2(totalCogs),
    grossProfit: r2(grossProfit),
    grossMarginPercent: totalGrossRevenue > 0 ? r2((grossProfit / totalGrossRevenue) * 100) : 0,
    totalExpenses: r2(totalExpenses),
    cashExpenses: r2(eRow.cash_expenses || 0),
    onlineExpenses: r2(eRow.online_expenses || 0),
    netProfit: r2(netProfit),
    netMarginPercent: totalGrossRevenue > 0 ? r2((netProfit / totalGrossRevenue) * 100) : 0,

    // Balances & Liquidity
    cashInDrawer: r2(cashInDrawer),
    onlineBalance: r2(onlineBalance),
    totalLiquidity: r2(cashInDrawer + onlineBalance),

    // Credit & Accounts
    customerReceivables: r2(custReceivable),
    customerPayables: r2(custPayable),
    vendorPayables: r2(vendPayable),
    vendorReceivables: r2(vendReceivable),
    netReceivables: r2(custReceivable - custPayable),
    netPayables: r2(vendPayable - vendReceivable),

    // Inventory
    stockCostValue: r2(stockCostValue),
    stockSaleValue: r2(stockSaleValue),
    totalStockItems: parseInt(stRow.total_stock_items || 0, 10),
    totalSkuCount: parseInt(stRow.total_sku_count || 0, 10),
    lowStockCount: parseInt(stRow.low_stock_count || 0, 10),

    // Staff
    staffCount: parseInt(staffRes.rows[0]?.total_staff || 0, 10)
  };
}

// POST /api/super-admin/login — Authenticate Super Admin against Master DB
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required.'
      });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const result = await branchManager.masterPool.query(
      `SELECT id, username, password_hash, name, email, status FROM master_super_admins WHERE LOWER(username) = $1 LIMIT 1`,
      [cleanUser]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Super Admin credentials.'
      });
    }

    const admin = result.rows[0];
    if (admin.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        message: 'This Super Admin account is inactive.'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Super Admin credentials.'
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: 'super_admin',
        isSuperAdmin: true
      },
      process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      message: 'Super Admin authenticated successfully',
      data: {
        token,
        user: {
          id: admin.id,
          username: admin.username,
          name: admin.name,
          email: admin.email,
          role: 'super_admin',
          isSuperAdmin: true
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/dashboard & /api/super-admin/reports/consolidated
// Supports branchId ('all' | '1' | '2') and date filters ('from', 'to')
router.get(['/dashboard', '/reports/consolidated'], requireSuperAdmin, async (req, res, next) => {
  try {
    const { branchId = 'all', from, to } = req.query;
    const branches = await branchManager.listBranches();

    let targetBranches = branches;
    if (branchId !== 'all') {
      const selectedId = parseInt(branchId, 10);
      targetBranches = branches.filter(b => b.id === selectedId);
      if (targetBranches.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Branch with ID ${branchId} not found.`
        });
      }
    }

    const branchReports = [];

    for (const b of targetBranches) {
      try {
        const pool = await branchManager.getBranchPool(b.id, true);
        const report = await computeBranchMetrics(pool, b, from, to);
        branchReports.push(report);
      } catch (err) {
        console.error(`[SuperAdmin Reporting] Error processing branch ${b.id}:`, err.message);
        branchReports.push({
          branchId: b.id,
          branchCode: b.branch_code,
          branchName: b.branch_name,
          status: b.status,
          city: b.city,
          dbName: b.db_name,
          dbHost: b.db_host,
          isHealthy: false,
          error: err.message,
          totalSales: 0,
          repairRevenue: 0,
          totalExpenses: 0,
          grossProfit: 0,
          netProfit: 0,
          cashInDrawer: 0,
          onlineBalance: 0,
          totalLiquidity: 0,
          stockCostValue: 0,
          activeRepairs: 0,
          customerReceivables: 0,
          vendorPayables: 0,
          staffCount: 0
        });
      }
    }

    // Server-side Aggregation for Combined Truth
    const combined = {
      totalSales: r2(branchReports.reduce((sum, b) => sum + (b.totalSales || 0), 0)),
      salesCount: branchReports.reduce((sum, b) => sum + (b.salesCount || 0), 0),
      salesUnpaidBalance: r2(branchReports.reduce((sum, b) => sum + (b.salesUnpaidBalance || 0), 0)),
      totalPurchases: r2(branchReports.reduce((sum, b) => sum + (b.totalPurchases || 0), 0)),
      totalBuybacks: r2(branchReports.reduce((sum, b) => sum + (b.totalBuybacks || 0), 0)),
      totalExchanges: r2(branchReports.reduce((sum, b) => sum + (b.totalExchanges || 0), 0)),
      totalReturns: r2(branchReports.reduce((sum, b) => sum + (b.totalReturns || 0), 0)),

      repairRevenue: r2(branchReports.reduce((sum, b) => sum + (b.repairRevenue || 0), 0)),
      activeRepairs: branchReports.reduce((sum, b) => sum + (b.activeRepairs || 0), 0),
      completedRepairs: branchReports.reduce((sum, b) => sum + (b.completedRepairs || 0), 0),
      totalRepairsCount: branchReports.reduce((sum, b) => sum + (b.totalRepairsCount || 0), 0),

      totalGrossRevenue: r2(branchReports.reduce((sum, b) => sum + (b.totalGrossRevenue || 0), 0)),
      totalCogs: r2(branchReports.reduce((sum, b) => sum + (b.totalCogs || 0), 0)),
      grossProfit: r2(branchReports.reduce((sum, b) => sum + (b.grossProfit || 0), 0)),
      totalExpenses: r2(branchReports.reduce((sum, b) => sum + (b.totalExpenses || 0), 0)),
      cashExpenses: r2(branchReports.reduce((sum, b) => sum + (b.cashExpenses || 0), 0)),
      onlineExpenses: r2(branchReports.reduce((sum, b) => sum + (b.onlineExpenses || 0), 0)),
      netProfit: r2(branchReports.reduce((sum, b) => sum + (b.netProfit || 0), 0)),

      cashInDrawer: r2(branchReports.reduce((sum, b) => sum + (b.cashInDrawer || 0), 0)),
      onlineBalance: r2(branchReports.reduce((sum, b) => sum + (b.onlineBalance || 0), 0)),
      totalLiquidity: r2(branchReports.reduce((sum, b) => sum + (b.totalLiquidity || 0), 0)),

      customerReceivables: r2(branchReports.reduce((sum, b) => sum + (b.customerReceivables || 0), 0)),
      customerPayables: r2(branchReports.reduce((sum, b) => sum + (b.customerPayables || 0), 0)),
      vendorPayables: r2(branchReports.reduce((sum, b) => sum + (b.vendorPayables || 0), 0)),
      vendorReceivables: r2(branchReports.reduce((sum, b) => sum + (b.vendorReceivables || 0), 0)),
      netReceivables: r2(branchReports.reduce((sum, b) => sum + (b.netReceivables || 0), 0)),
      netPayables: r2(branchReports.reduce((sum, b) => sum + (b.netPayables || 0), 0)),

      stockCostValue: r2(branchReports.reduce((sum, b) => sum + (b.stockCostValue || 0), 0)),
      stockSaleValue: r2(branchReports.reduce((sum, b) => sum + (b.stockSaleValue || 0), 0)),
      totalStockItems: branchReports.reduce((sum, b) => sum + (b.totalStockItems || 0), 0),
      totalSkuCount: branchReports.reduce((sum, b) => sum + (b.totalSkuCount || 0), 0),
      lowStockCount: branchReports.reduce((sum, b) => sum + (b.lowStockCount || 0), 0),

      staffCount: branchReports.reduce((sum, b) => sum + (b.staffCount || 0), 0),
      activeBranchesCount: branchReports.filter(b => b.status === 'Active').length,
      totalRegisteredBranches: branches.length,
      maxAllowed: 2
    };

    combined.grossMarginPercent = combined.totalGrossRevenue > 0
      ? r2((combined.grossProfit / combined.totalGrossRevenue) * 100)
      : 0;
    combined.netMarginPercent = combined.totalGrossRevenue > 0
      ? r2((combined.netProfit / combined.totalGrossRevenue) * 100)
      : 0;

    return res.json({
      success: true,
      filter: {
        branchId,
        from: from || null,
        to: to || null
      },
      data: {
        combined,
        branches: branchReports
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/branches — List registered branches
router.get('/branches', requireSuperAdmin, async (req, res, next) => {
  try {
    const branches = await branchManager.listBranches();
    return res.json({
      success: true,
      data: branches,
      totalBranches: branches.length,
      maxAllowed: 2,
      canAddMore: branches.length < 2
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/super-admin/branches/:id — Update Branch metadata (Name, address, phone, email, city)
router.put('/branches/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id, 10);
    const { branch_name, phone, email, city, address, admin_name } = req.body;

    if (!branch_name) {
      return res.status(400).json({
        success: false,
        message: 'Branch name is required.'
      });
    }

    const updated = await branchManager.updateBranch(branchId, {
      branch_name,
      phone,
      email,
      city,
      address,
      admin_name
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found.'
      });
    }

    // Log to Master Audit Logs
    await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_METADATA_UPDATED', $2, $3)
    `, [
      branchId,
      JSON.stringify({ branch_name, phone, email, city, address }),
      req.user.username
    ]);

    return res.json({
      success: true,
      message: 'Branch details updated successfully.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/branches/provision — Automated Branch 2 Database Provisioning
router.post('/branches/provision', requireSuperAdmin, async (req, res, next) => {
  try {
    const {
      branchName,
      branchCode,
      address,
      phone,
      email,
      city,
      adminName,
      adminUsername,
      adminPassword,
      adminContact,
      openingCash,
      openingOnline
    } = req.body;

    if (!branchName) {
      return res.status(400).json({
        success: false,
        message: 'Branch name is required.'
      });
    }

    if (!adminUsername || !adminPassword) {
      return res.status(400).json({
        success: false,
        message: 'Branch Admin username and password are required.'
      });
    }

    const createdBranch = await branchManager.provisionBranch2Database(
      {
        branchName,
        branchCode: branchCode || 'BR-02',
        address,
        phone,
        email,
        city: city || 'Karachi',
        adminName: adminName || 'Branch 2 Manager',
        adminUsername,
        adminPassword,
        adminContact: adminContact || phone || '',
        openingCash: parseFloat(openingCash || 0),
        openingOnline: parseFloat(openingOnline || 0)
      },
      req.user?.username || 'superadmin'
    );

    return res.status(201).json({
      success: true,
      message: 'Branch 2 database provisioned, schema migrated, and activated successfully!',
      data: createdBranch
    });
  } catch (error) {
    if (error.code === 'MAX_BRANCHES_REACHED') {
      return res.status(400).json({
        success: false,
        code: 'MAX_BRANCHES_REACHED',
        message: 'Maximum branch limit reached. Only 2 branches are allowed.'
      });
    }
    next(error);
  }
});

// PATCH /api/super-admin/branches/:id/status — Activate / Deactivate (Never hard-delete history)
router.patch('/branches/:id/status', requireSuperAdmin, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['Active', 'Inactive', 'Maintenance'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be Active, Inactive, or Maintenance.'
      });
    }

    const updated = await branchManager.updateBranch(req.params.id, { status });
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found.'
      });
    }

    // Log to Master Audit Logs
    await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_STATUS_CHANGED', $2, $3)
    `, [
      parseInt(req.params.id, 10),
      JSON.stringify({ new_status: status }),
      req.user.username
    ]);

    return res.json({
      success: true,
      message: `Branch status updated to ${status}.`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/branches/:id/admin/reset-password — Reset branch admin password
router.post('/branches/:id/admin/reset-password', requireSuperAdmin, async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id, 10);
    const { newPassword, adminUsername } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    const branch = await branchManager.getBranchById(branchId);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found.'
      });
    }

    const branchPool = await branchManager.getBranchPool(branchId);
    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash(newPassword, salt);

    const targetUser = adminUsername ? String(adminUsername).toLowerCase().trim() : (branch.admin_username || 'admin');

    const updateRes = await branchPool.query(`
      UPDATE users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE LOWER(username) = $2 OR role = 'admin'
      RETURNING id, name, username, role
    `, [passHash, targetUser]);

    if (updateRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Admin user not found in Branch ${branchId} database.`
      });
    }

    return res.json({
      success: true,
      message: `Admin password for Branch ${branch.branch_code} reset successfully.`
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/audit-logs — Paginated master audit logs
router.get('/audit-logs', requireSuperAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    const logsRes = await branchManager.masterPool.query(`
      SELECT l.*, b.branch_code, b.branch_name
      FROM master_audit_logs l
      LEFT JOIN master_branches b ON l.branch_id = b.id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countRes = await branchManager.masterPool.query(`SELECT COUNT(*) as total FROM master_audit_logs`);

    return res.json({
      success: true,
      data: logsRes.rows,
      total: parseInt(countRes.rows[0]?.total || 0, 10),
      limit,
      offset
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/branch-admins — List branch admins across all registered branches
router.get('/branch-admins', requireSuperAdmin, async (req, res, next) => {
  try {
    const branches = await branchManager.listBranches();
    const branchAdmins = [];

    for (const b of branches) {
      try {
        const pool = await branchManager.getBranchPool(b.id, true);
        const usersRes = await pool.query(`
          SELECT id, name, contact, designation, role, username, status, created_at, updated_at
          FROM users
          WHERE role = 'admin'
          ORDER BY created_at ASC
        `);
        branchAdmins.push({
          branchId: b.id,
          branchCode: b.branch_code,
          branchName: b.branch_name,
          branchStatus: b.status,
          admins: usersRes.rows
        });
      } catch (err) {
        branchAdmins.push({
          branchId: b.id,
          branchCode: b.branch_code,
          branchName: b.branch_name,
          branchStatus: b.status,
          admins: [],
          error: err.message
        });
      }
    }

    return res.json({
      success: true,
      data: branchAdmins
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/branches/:id/reset-admin-password — Reset password for branch administrator
router.post('/branches/:id/reset-admin-password', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = parseInt(id, 10);
    const { newPassword, username } = req.body;

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 4 characters.'
      });
    }

    const bRes = await branchManager.masterPool.query('SELECT * FROM master_branches WHERE id = $1', [branchId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Branch not found.' });
    }
    const branch = bRes.rows[0];

    const pool = await branchManager.getBranchPool(branchId);
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    if (username) {
      await pool.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER($2)`,
        [newHash, String(username).trim()]
      );
    } else {
      await pool.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE role = 'admin'`,
        [newHash]
      );
    }

    // Write Master Audit Log
    await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_ADMIN_PASSWORD_RESET', $2::jsonb, $3)
    `, [
      branchId,
      JSON.stringify({ branchCode: branch.branch_code, branchName: branch.branch_name }),
      req.user.username || 'superadmin'
    ]);

    return res.json({
      success: true,
      message: `Administrator password for branch ${branch.branch_code} has been reset successfully!`
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/super-admin/security/password — Update Platform Super Admin master password
router.put('/security/password', requireSuperAdmin, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password (min 8 characters) are required.'
      });
    }

    const saRes = await branchManager.masterPool.query(
      `SELECT id, password_hash FROM master_super_admins WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (saRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Super Admin account not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, saRes.rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect current password.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await branchManager.masterPool.query(
      `UPDATE master_super_admins SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newHash, req.user.id]
    );

    await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (NULL, 'SUPER_ADMIN_PASSWORD_CHANGED', '{"action":"master_password_updated"}'::jsonb, $1)
    `, [req.user.username]);

    return res.json({
      success: true,
      message: 'Super Admin master password updated successfully!'
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/branches/:id/safety-check — Inspect historical records before deletion
router.get('/branches/:id/safety-check', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = parseInt(id, 10);

    const bRes = await branchManager.masterPool.query('SELECT * FROM master_branches WHERE id = $1', [branchId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Branch not found.' });
    }
    const branch = bRes.rows[0];

    let counts = {
      invoicesCount: 0,
      repairsCount: 0,
      paymentsCount: 0,
      expensesCount: 0,
      productsCount: 0,
      customersCount: 0
    };

    try {
      const pool = await branchManager.getBranchPool(branchId);
      const invRes = await pool.query('SELECT COUNT(*) AS total FROM invoices WHERE is_voided = FALSE');
      const repRes = await pool.query('SELECT COUNT(*) AS total FROM repair_jobs');
      const payRes = await pool.query('SELECT COUNT(*) AS total FROM payments');
      const expRes = await pool.query('SELECT COUNT(*) AS total FROM expenses');
      const prodRes = await pool.query('SELECT COUNT(*) AS total FROM products');
      const custRes = await pool.query('SELECT COUNT(*) AS total FROM customers');

      counts = {
        invoicesCount: parseInt(invRes.rows[0]?.total || 0, 10),
        repairsCount: parseInt(repRes.rows[0]?.total || 0, 10),
        paymentsCount: parseInt(payRes.rows[0]?.total || 0, 10),
        expensesCount: parseInt(expRes.rows[0]?.total || 0, 10),
        productsCount: parseInt(prodRes.rows[0]?.total || 0, 10),
        customersCount: parseInt(custRes.rows[0]?.total || 0, 10)
      };
    } catch (dbErr) {
      console.warn(`[Branch Safety Check] Could not inspect branch DB:`, dbErr.message);
    }

    const hasFinancialRecords = (counts.invoicesCount + counts.repairsCount + counts.paymentsCount + counts.expensesCount) > 0;

    return res.json({
      success: true,
      data: {
        branchId: branch.id,
        branchCode: branch.branch_code,
        branchName: branch.branch_name,
        counts,
        hasFinancialRecords
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/branches/:id/delete — High-risk permanent deletion or archiving of a branch
router.post('/branches/:id/delete', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = parseInt(id, 10);
    const { superAdminPassword, confirmBranchCode, action } = req.body;

    if (!superAdminPassword || !confirmBranchCode) {
      return res.status(400).json({
        success: false,
        message: 'Super Admin password and confirmation branch code are required.'
      });
    }

    // 1. Fetch branch metadata from Master DB
    const bRes = await branchManager.masterPool.query('SELECT * FROM master_branches WHERE id = $1', [branchId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Branch not found.' });
    }
    const branch = bRes.rows[0];

    // 2. Prevent deleting when only 1 branch exists or deleting primary anchor
    const countRes = await branchManager.masterPool.query(`SELECT COUNT(*) AS total FROM master_branches WHERE status != 'Deleted'`);
    const totalActive = parseInt(countRes.rows[0]?.total || 0, 10);
    if (totalActive <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the only registered branch on the platform. At least one branch must remain active.'
      });
    }

    // 3. Verify typed branch code matches exactly
    if (String(confirmBranchCode).trim().toUpperCase() !== String(branch.branch_code).trim().toUpperCase()) {
      return res.status(400).json({
        success: false,
        message: `Branch code confirmation failed. You typed "${confirmBranchCode}", but the branch code is "${branch.branch_code}".`
      });
    }

    // 4. Verify Super Admin password against master database
    const saRes = await branchManager.masterPool.query(
      `SELECT id, password_hash FROM master_super_admins WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (saRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Super Admin account not found.' });
    }

    const isMatch = await bcrypt.compare(superAdminPassword, saRes.rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect Super Admin password. Deletion aborted.' });
    }

    // 5. If action is 'archive', soft deactivate
    if (action === 'archive') {
      await branchManager.masterPool.query(
        `UPDATE master_branches SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [branchId]
      );
      await branchManager.masterPool.query(`
        INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
        VALUES ($1, 'BRANCH_ARCHIVED', $2::jsonb, $3)
      `, [branchId, JSON.stringify({ branchCode: branch.branch_code, branchName: branch.branch_name }), req.user.username || 'superadmin']);

      return res.json({
        success: true,
        message: `Branch ${branch.branch_code} has been deactivated and archived safely.`
      });
    }

    // 6. Permanent Delete action: Disconnect pool & delete registration
    try {
      if (branchManager.branchPools.has(branchId)) {
        const pool = branchManager.branchPools.get(branchId);
        await pool.end();
        branchManager.branchPools.delete(branchId);
      }
    } catch (poolErr) {
      console.warn(`[Branch Deletion] Pool teardown notice:`, poolErr.message);
    }

    // Remove from master_branches
    await branchManager.masterPool.query('DELETE FROM master_branches WHERE id = $1', [branchId]);

    // Record immutable Master Audit Log
    await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (NULL, 'BRANCH_PERMANENTLY_DELETED', $1::jsonb, $2)
    `, [
      JSON.stringify({
        branchId: branch.id,
        branchCode: branch.branch_code,
        branchName: branch.branch_name,
        dbName: branch.db_name,
        deletedAt: new Date().toISOString()
      }),
      req.user.username || 'superadmin'
    ]);

    return res.json({
      success: true,
      message: `Branch ${branch.branch_code} (${branch.branch_name}) has been permanently deleted from the platform.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
