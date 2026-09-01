const branchManager = require('./src/config/branchManager');
const db = require('./src/config/db');

async function testReport() {
  try {
    const branches = await branchManager.listBranches();
    const branchMeta = branches[0];
    const pool = await branchManager.getBranchPool(branchMeta.id);

    console.log('Testing branch:', branchMeta.id, branchMeta.branch_name);

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
      FROM invoices WHERE 1=1
    `);
    console.log('salesRes:', salesRes.rows[0]);

    // 2. Repairs
    const repairsRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'Delivered & Closed' THEN total ELSE 0 END), 0) AS repair_revenue,
        COUNT(CASE WHEN status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) AS active_repairs,
        COUNT(CASE WHEN status = 'Delivered & Closed' THEN 1 END) AS completed_repairs,
        COUNT(*) AS total_repairs_count
      FROM repair_jobs WHERE 1=1
    `);
    console.log('repairsRes:', repairsRes.rows[0]);

    // 3. COGS
    const cogsRes = await pool.query(`
      SELECT COALESCE(SUM(ii.quantity * COALESCE(ii.cost_price_snapshot, p.cost_price, 0)), 0) AS total_cogs
      FROM invoice_items ii
      JOIN invoices inv ON ii.invoice_id = inv.id
      LEFT JOIN products p ON ii.product_id = p.id
      WHERE inv.type = 'Sales Invoice' AND inv.is_voided = FALSE
    `);
    console.log('cogsRes:', cogsRes.rows[0]);

    // 4. Products Valuation
    const stockRes = await pool.query(`
      SELECT 
        COALESCE(SUM(current_stock * cost_price), 0) AS stock_cost_value,
        COALESCE(SUM(current_stock * expected_sale_price), 0) AS stock_sale_value,
        COALESCE(SUM(current_stock), 0) AS total_stock_items,
        COUNT(*) AS total_sku_count,
        COUNT(CASE WHEN current_stock <= low_stock_alert THEN 1 END) AS low_stock_count
      FROM products
    `);
    console.log('stockRes:', stockRes.rows[0]);

    process.exit(0);
  } catch (err) {
    console.error('Error testing report:', err);
    process.exit(1);
  }
}

testReport();
