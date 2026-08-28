/**
 * COMPREHENSIVE DB AUDIT SCRIPT
 * Run: node scratch/full_audit.js
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'retail_repair_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin123',
});

const q = (sql, params) => pool.query(sql, params);
const num = (v) => parseFloat(v || 0).toFixed(2);

async function audit() {
  console.log('\n====================================================');
  console.log('       FULL SYSTEM AUDIT - DB SOURCE OF TRUTH');
  console.log('====================================================\n');

  // ============================================================
  // 1. INVENTORY COUNTS
  // ============================================================
  console.log('──────────────────────────────────────────');
  console.log('1. INVENTORY');
  console.log('──────────────────────────────────────────');

  const totalProducts = await q(`SELECT COUNT(*) as total FROM products WHERE status != 'Deleted'`);
  const totalStock = await q(`SELECT COALESCE(SUM(current_stock),0) as total FROM products WHERE status != 'Deleted'`);
  const lowStock = await q(`SELECT COUNT(*) as total FROM products WHERE current_stock <= low_stock_alert AND status = 'Active'`);
  const zeroStock = await q(`SELECT COUNT(*) as total FROM products WHERE current_stock <= 0 AND status = 'Active'`);

  console.log(`Total Products (non-deleted): ${totalProducts.rows[0].total}`);
  console.log(`Total Stock Units: ${totalStock.rows[0].total}`);
  console.log(`Low Stock Products: ${lowStock.rows[0].total}`);
  console.log(`Zero Stock Products: ${zeroStock.rows[0].total}`);

  // ============================================================
  // 2. REPAIRS
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('2. REPAIRS');
  console.log('──────────────────────────────────────────');

  const repairsByStatus = await q(`
    SELECT status, COUNT(*) as count 
    FROM repair_jobs 
    GROUP BY status ORDER BY status
  `);
  const activeRepairs = await q(`
    SELECT COUNT(*) as total FROM repair_jobs 
    WHERE status NOT IN ('Delivered', 'Cancelled')
  `);
  const pendingApproval = await q(`
    SELECT COUNT(*) as total FROM repair_jobs 
    WHERE status = 'Waiting Approval'
  `);
  const inProgress = await q(`
    SELECT COUNT(*) as total FROM repair_jobs 
    WHERE status IN ('In Progress', 'Repair Work')
  `);

  console.log('Repair Status Breakdown:');
  repairsByStatus.rows.forEach(r => console.log(`  ${r.status}: ${r.count}`));
  console.log(`Active Repairs (non-delivered): ${activeRepairs.rows[0].total}`);
  console.log(`Pending Approval: ${pendingApproval.rows[0].total}`);
  console.log(`In Progress: ${inProgress.rows[0].total}`);

  // ============================================================
  // 3. CASH / ONLINE BALANCES
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('3. CASH & ONLINE BALANCE RECONCILIATION');
  console.log('──────────────────────────────────────────');

  // Opening balance from settings
  const settings = await q(`SELECT opening_cash, opening_online FROM business_settings LIMIT 1`);
  const openingCash = parseFloat(settings.rows[0]?.opening_cash || 0);
  const openingOnline = parseFloat(settings.rows[0]?.opening_online || 0);

  // Cash IN: All payments received in cash
  const cashIn = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM payments 
    WHERE payment_method = 'Cash' AND direction = 'in' AND status != 'Voided'
  `);
  // Cash OUT: All cash payments made (vendor, expenses, buybacks)
  const cashOut = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM payments 
    WHERE payment_method = 'Cash' AND direction = 'out' AND status != 'Voided'
  `);

  // Online IN
  const onlineIn = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM payments 
    WHERE payment_method IN ('Online', 'Bank Transfer', 'Online Transfer') AND direction = 'in' AND status != 'Voided'
  `);
  // Online OUT
  const onlineOut = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM payments 
    WHERE payment_method IN ('Online', 'Bank Transfer', 'Online Transfer') AND direction = 'out' AND status != 'Voided'
  `);

  // Expenses
  const cashExpenses = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses 
    WHERE payment_method = 'Cash' AND status != 'Voided'
  `);
  const onlineExpenses = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses 
    WHERE payment_method IN ('Online', 'Bank Transfer', 'Online Transfer') AND status != 'Voided'
  `);

  const cashBalance = openingCash + parseFloat(cashIn.rows[0].total) - parseFloat(cashOut.rows[0].total) - parseFloat(cashExpenses.rows[0].total);
  const onlineBalance = openingOnline + parseFloat(onlineIn.rows[0].total) - parseFloat(onlineOut.rows[0].total) - parseFloat(onlineExpenses.rows[0].total);

  console.log(`Opening Cash: PKR ${num(openingCash)}`);
  console.log(`Cash IN (payments): PKR ${num(cashIn.rows[0].total)}`);
  console.log(`Cash OUT (payments): PKR ${num(cashOut.rows[0].total)}`);
  console.log(`Cash Expenses: PKR ${num(cashExpenses.rows[0].total)}`);
  console.log(`→ CALCULATED Cash Balance: PKR ${num(cashBalance)}`);
  console.log('');
  console.log(`Opening Online: PKR ${num(openingOnline)}`);
  console.log(`Online IN (payments): PKR ${num(onlineIn.rows[0].total)}`);
  console.log(`Online OUT (payments): PKR ${num(onlineOut.rows[0].total)}`);
  console.log(`Online Expenses: PKR ${num(onlineExpenses.rows[0].total)}`);
  console.log(`→ CALCULATED Online Balance: PKR ${num(onlineBalance)}`);

  // Check payment directions exist
  const checkDirections = await q(`
    SELECT direction, COUNT(*) as cnt FROM payments GROUP BY direction
  `);
  console.log('\nPayment directions in DB:');
  if (checkDirections.rows.length === 0) {
    console.log('  ⚠ WARNING: No payment direction column or no payments exist!');
  } else {
    checkDirections.rows.forEach(r => console.log(`  direction="${r.direction}": ${r.cnt}`));
  }

  // ============================================================
  // 4. ACCOUNTS (RECEIVABLES / PAYABLES)
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('4. ACCOUNTS RECEIVABLE / PAYABLE');
  console.log('──────────────────────────────────────────');

  const accounts = await q(`
    SELECT account_type, 
           COUNT(*) as count,
           COALESCE(SUM(total_amount),0) as total_billed,
           COALESCE(SUM(amount_paid),0) as total_paid,
           COALESCE(SUM(remaining_amount),0) as total_remaining
    FROM accounts 
    WHERE status NOT IN ('Settled', 'Voided')
    GROUP BY account_type ORDER BY account_type
  `);

  if (accounts.rows.length === 0) {
    console.log('No open accounts found.');
  } else {
    accounts.rows.forEach(r => {
      console.log(`  ${r.account_type}: ${r.count} records | Billed: PKR ${num(r.total_billed)} | Paid: PKR ${num(r.total_paid)} | Remaining: PKR ${num(r.total_remaining)}`);
    });
  }

  // ============================================================
  // 5. INVOICES SUMMARY
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('5. INVOICES SUMMARY');
  console.log('──────────────────────────────────────────');

  const invoiceSummary = await q(`
    SELECT invoice_type,
           COUNT(*) as count,
           COALESCE(SUM(total_amount),0) as total,
           COALESCE(SUM(paid_amount),0) as paid,
           COALESCE(SUM(remaining_amount),0) as remaining
    FROM invoices
    WHERE status != 'Voided'
    GROUP BY invoice_type ORDER BY invoice_type
  `);

  invoiceSummary.rows.forEach(r => {
    console.log(`  ${r.invoice_type}: ${r.count} invoices | Total: PKR ${num(r.total)} | Paid: PKR ${num(r.paid)} | Remaining: PKR ${num(r.remaining)}`);
  });

  // ============================================================
  // 6. SALES P&L RECONCILIATION
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('6. P&L RECONCILIATION (Sales)');
  console.log('──────────────────────────────────────────');

  const salesRevenue = await q(`
    SELECT COALESCE(SUM(ii.quantity * ii.unit_price),0) as revenue,
           COALESCE(SUM(ii.quantity * ii.cost_price_snapshot),0) as cogs
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.invoice_type = 'Sale' AND i.status != 'Voided'
    AND ii.item_type IN ('product', 'custom_product', 'stock_product')
  `);

  const serviceRevenue = await q(`
    SELECT COALESCE(SUM(ii.quantity * ii.unit_price),0) as revenue
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.invoice_type = 'Sale' AND i.status != 'Voided'
    AND ii.item_type = 'service'
  `);

  const repairRevenue = await q(`
    SELECT COALESCE(SUM(total_amount),0) as revenue,
           COALESCE(SUM(paid_amount),0) as paid
    FROM invoices
    WHERE invoice_type IN ('Repair', 'Diagnosis') AND status != 'Voided'
  `);

  const expenses = await q(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE status != 'Voided'
  `);

  const saleRev = parseFloat(salesRevenue.rows[0].revenue);
  const saleCogs = parseFloat(salesRevenue.rows[0].cogs);
  const svcRev = parseFloat(serviceRevenue.rows[0].revenue);
  const repRev = parseFloat(repairRevenue.rows[0].revenue);
  const totalExp = parseFloat(expenses.rows[0].total);
  const grossProfit = (saleRev + svcRev + repRev) - saleCogs;
  const netProfit = grossProfit - totalExp;

  console.log(`Product Sale Revenue:   PKR ${num(saleRev)}`);
  console.log(`Service Revenue:        PKR ${num(svcRev)}`);
  console.log(`Repair Revenue:         PKR ${num(repRev)}`);
  console.log(`COGS (from items):      PKR ${num(saleCogs)}`);
  console.log(`Gross Profit:           PKR ${num(grossProfit)}`);
  console.log(`Expenses:               PKR ${num(totalExp)}`);
  console.log(`Net Profit:             PKR ${num(netProfit)}`);

  // ============================================================
  // 7. CUSTOMER RECONCILIATION
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('7. CUSTOMER RECONCILIATION (Top 10 with balance)');
  console.log('──────────────────────────────────────────');

  const customers = await q(`
    SELECT c.id, c.name,
      COALESCE(SUM(CASE WHEN i.invoice_type='Sale' AND i.status!='Voided' THEN i.remaining_amount ELSE 0 END),0) as invoice_remaining,
      COALESCE((
        SELECT SUM(a.remaining_amount) FROM accounts a 
        WHERE a.party_id = c.id AND a.party_type='Customer' 
        AND a.account_type='Customer Receivable' AND a.status NOT IN ('Settled','Voided')
      ),0) as account_remaining,
      COALESCE((
        SELECT SUM(
          CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE -le.amount END
        ) FROM ledger_entries le WHERE le.party_id = c.id AND le.party_type='Customer'
      ),0) as ledger_balance
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    GROUP BY c.id, c.name
    HAVING COALESCE(SUM(CASE WHEN i.invoice_type='Sale' AND i.status!='Voided' THEN i.remaining_amount ELSE 0 END),0) > 0
    ORDER BY invoice_remaining DESC
    LIMIT 10
  `);

  if (customers.rows.length === 0) {
    console.log('No customers with open receivables.');
  } else {
    console.log('Customer | Invoice Remaining | Account Remaining | Ledger Balance | Match?');
    customers.rows.forEach(r => {
      const invR = parseFloat(r.invoice_remaining);
      const accR = parseFloat(r.account_remaining);
      const ledR = parseFloat(r.ledger_balance);
      const match = Math.abs(invR - accR) < 0.01 ? '✓' : '✗ MISMATCH';
      console.log(`  ${r.name} | PKR ${num(invR)} | PKR ${num(accR)} | PKR ${num(ledR)} | ${match}`);
    });
  }

  // ============================================================
  // 8. VENDOR RECONCILIATION
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('8. VENDOR RECONCILIATION (with open payables)');
  console.log('──────────────────────────────────────────');

  const vendors = await q(`
    SELECT v.id, v.name,
      COALESCE((
        SELECT SUM(a.remaining_amount) FROM accounts a 
        WHERE a.party_id = v.id AND a.party_type='Vendor' 
        AND a.account_type='Vendor Payable' AND a.status NOT IN ('Settled','Voided')
      ),0) as payable_remaining,
      COALESCE((
        SELECT SUM(a.remaining_amount) FROM accounts a 
        WHERE a.party_id = v.id AND a.party_type='Vendor' 
        AND a.account_type='Vendor Receivable' AND a.status NOT IN ('Settled','Voided')
      ),0) as receivable_remaining
    FROM vendors v
    WHERE EXISTS (
      SELECT 1 FROM accounts a WHERE a.party_id = v.id AND a.status NOT IN ('Settled','Voided')
    )
    ORDER BY v.name
    LIMIT 10
  `);

  if (vendors.rows.length === 0) {
    console.log('No vendors with open accounts.');
  } else {
    vendors.rows.forEach(r => {
      console.log(`  ${r.name} | Payable: PKR ${num(r.payable_remaining)} | Receivable: PKR ${num(r.receivable_remaining)}`);
    });
  }

  // ============================================================
  // 9. PAYMENTS TABLE AUDIT
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('9. PAYMENTS TABLE AUDIT');
  console.log('──────────────────────────────────────────');

  const paymentsCheck = await q(`
    SELECT 
      payment_method,
      direction,
      COUNT(*) as count,
      COALESCE(SUM(amount),0) as total
    FROM payments
    WHERE status != 'Voided'
    GROUP BY payment_method, direction
    ORDER BY payment_method, direction
  `);

  if (paymentsCheck.rows.length === 0) {
    console.log('⚠ No payments found!');
  } else {
    console.log('Method | Direction | Count | Total');
    paymentsCheck.rows.forEach(r => {
      console.log(`  ${r.payment_method || 'NULL'} | ${r.direction || 'NULL'} | ${r.count} | PKR ${num(r.total)}`);
    });
  }

  // Check for NULL direction
  const nullDir = await q(`SELECT COUNT(*) as c FROM payments WHERE direction IS NULL AND status!='Voided'`);
  if (parseInt(nullDir.rows[0].c) > 0) {
    console.log(`\n⚠ BUG: ${nullDir.rows[0].c} payments have NULL direction! Cash balance will be wrong.`);
  }

  // ============================================================
  // 10. LEDGER ENTRIES AUDIT
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('10. LEDGER ENTRIES SUMMARY');
  console.log('──────────────────────────────────────────');

  const ledgerCheck = await q(`
    SELECT entry_type, COUNT(*) as count, COALESCE(SUM(amount),0) as total
    FROM ledger_entries
    GROUP BY entry_type
  `);

  ledgerCheck.rows.forEach(r => {
    console.log(`  ${r.entry_type}: ${r.count} entries | PKR ${num(r.total)}`);
  });

  const totalDebits = await q(`SELECT COALESCE(SUM(amount),0) as t FROM ledger_entries WHERE entry_type='debit'`);
  const totalCredits = await q(`SELECT COALESCE(SUM(amount),0) as t FROM ledger_entries WHERE entry_type='credit'`);
  console.log(`\n  Total Debits:  PKR ${num(totalDebits.rows[0].t)}`);
  console.log(`  Total Credits: PKR ${num(totalCredits.rows[0].t)}`);

  // ============================================================
  // 11. EXPENSES BREAKDOWN
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('11. EXPENSES');
  console.log('──────────────────────────────────────────');

  const expBreakdown = await q(`
    SELECT category, payment_method, COUNT(*) as count, COALESCE(SUM(amount),0) as total
    FROM expenses WHERE status != 'Voided'
    GROUP BY category, payment_method ORDER BY total DESC
  `);

  if (expBreakdown.rows.length === 0) {
    console.log('No expenses recorded.');
  } else {
    expBreakdown.rows.forEach(r => {
      console.log(`  ${r.category || 'Uncategorized'} [${r.payment_method}]: ${r.count} entries | PKR ${num(r.total)}`);
    });
  }

  // ============================================================
  // 12. INVOICE_ITEMS COST_PRICE_SNAPSHOT CHECK
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('12. COGS INTEGRITY (cost_price_snapshot)');
  console.log('──────────────────────────────────────────');

  const zeroCostItems = await q(`
    SELECT COUNT(*) as c FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.invoice_type = 'Sale' AND i.status != 'Voided'
    AND ii.item_type IN ('product', 'stock_product')
    AND (ii.cost_price_snapshot IS NULL OR ii.cost_price_snapshot = 0)
  `);

  if (parseInt(zeroCostItems.rows[0].c) > 0) {
    console.log(`⚠ BUG: ${zeroCostItems.rows[0].c} product sale lines have NULL/zero cost_price_snapshot!`);
    console.log('  COGS will be understated. Check InvoiceService.createSale()');
  } else {
    console.log('✓ All sale product lines have cost_price_snapshot > 0');
  }

  // ============================================================
  // 13. STOCK MOVEMENT INTEGRITY
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('13. STOCK MOVEMENT INTEGRITY');
  console.log('──────────────────────────────────────────');

  const negativeStock = await q(`
    SELECT id, code, brand, model, current_stock FROM products 
    WHERE current_stock < 0 AND status != 'Deleted'
  `);

  if (negativeStock.rows.length > 0) {
    console.log(`⚠ BUG: ${negativeStock.rows.length} products have negative stock!`);
    negativeStock.rows.forEach(r => {
      console.log(`  ${r.code} ${r.brand} ${r.model}: stock=${r.current_stock}`);
    });
  } else {
    console.log('✓ No negative stock found');
  }

  // ============================================================
  // 14. REPAIR JOB INTEGRITY
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('14. REPAIR JOB INTEGRITY');
  console.log('──────────────────────────────────────────');

  const repairInvoiceCheck = await q(`
    SELECT r.id, r.job_no, r.status,
      CASE WHEN i.id IS NULL THEN 'NO INVOICE' ELSE 'HAS INVOICE' END as invoice_status
    FROM repair_jobs r
    LEFT JOIN invoices i ON i.repair_job_id = r.id AND i.status != 'Voided'
    WHERE r.status = 'Delivered' AND i.id IS NULL
    LIMIT 5
  `);

  if (repairInvoiceCheck.rows.length > 0) {
    console.log(`⚠ BUG: ${repairInvoiceCheck.rows.length} Delivered repairs have no invoice!`);
  } else {
    console.log('✓ All delivered repairs have invoices');
  }

  // Parts consumed before approval
  const unapprovedParts = await q(`
    SELECT COUNT(*) as c FROM repair_job_lines rjl
    JOIN repair_jobs rj ON rj.id = rjl.repair_job_id
    WHERE rjl.line_type = 'part'
    AND rj.status IN ('Waiting Approval', 'Checking', 'Pending')
    AND rj.job_type = 'diagnosis'
  `);

  if (parseInt(unapprovedParts.rows[0].c) > 0) {
    console.log(`⚠ SECURITY BUG: ${unapprovedParts.rows[0].c} parts consumed on unapproved diagnosis jobs!`);
  } else {
    console.log('✓ No parts consumed on unapproved diagnosis jobs');
  }

  // ============================================================
  // 15. ACCOUNTS vs INVOICE REMAINING MISMATCH
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('15. ACCOUNTS vs INVOICE REMAINING MISMATCH');
  console.log('──────────────────────────────────────────');

  const accountMismatch = await q(`
    SELECT a.id, a.account_type, a.party_id, a.remaining_amount as acc_remaining,
           i.remaining_amount as inv_remaining,
           ABS(a.remaining_amount - i.remaining_amount) as diff
    FROM accounts a
    JOIN invoices i ON i.id = a.invoice_id
    WHERE a.status NOT IN ('Settled', 'Voided')
    AND ABS(a.remaining_amount - i.remaining_amount) > 0.01
    LIMIT 10
  `);

  if (accountMismatch.rows.length > 0) {
    console.log(`⚠ BUG: ${accountMismatch.rows.length} accounts have remaining_amount != invoice remaining_amount!`);
    accountMismatch.rows.forEach(r => {
      console.log(`  Account ${r.id} [${r.account_type}]: acc=${num(r.acc_remaining)}, inv=${num(r.inv_remaining)}, diff=${num(r.diff)}`);
    });
  } else {
    console.log('✓ Accounts and Invoice remaining amounts are in sync');
  }

  // ============================================================
  // 16. SETTINGS CHECK
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('16. BUSINESS SETTINGS');
  console.log('──────────────────────────────────────────');

  const settingsAll = await q(`SELECT * FROM business_settings LIMIT 1`);
  if (settingsAll.rows.length === 0) {
    console.log('⚠ BUG: No business settings row found!');
  } else {
    const s = settingsAll.rows[0];
    console.log(`Company: ${s.company_name || 'NOT SET'}`);
    console.log(`Phone: ${s.phone || 'NOT SET'}`);
    console.log(`NTN: ${s.ntn || 'NOT SET'}`);
    console.log(`STRN: ${s.strn || 'NOT SET'}`);
    console.log(`POS ID: ${s.pos_id || 'NOT SET'}`);
    console.log(`Opening Cash: PKR ${num(s.opening_cash)}`);
    console.log(`Opening Online: PKR ${num(s.opening_online)}`);
  }

  // ============================================================
  // 17. STAFF & AUTH
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('17. STAFF & AUTH');
  console.log('──────────────────────────────────────────');

  const staff = await q(`
    SELECT role, status, COUNT(*) as count FROM staff GROUP BY role, status ORDER BY role
  `);
  staff.rows.forEach(r => {
    console.log(`  ${r.role} [${r.status}]: ${r.count}`);
  });

  // Check if any staff has plaintext password (not bcrypt hash)
  const plainPwd = await q(`
    SELECT id, name, role FROM staff 
    WHERE password_hash IS NOT NULL 
    AND password_hash NOT LIKE '$2b$%' 
    AND password_hash NOT LIKE '$2a$%'
    LIMIT 3
  `);
  if (plainPwd.rows.length > 0) {
    console.log(`\n⚠ SECURITY BUG: ${plainPwd.rows.length} staff have non-bcrypt password hashes!`);
  } else {
    console.log('✓ All passwords are bcrypt hashed');
  }

  // ============================================================
  // 18. HARDCODED VALUE CHECK IN BACKEND
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('18. RECENT TRANSACTIONS SAMPLE');
  console.log('──────────────────────────────────────────');

  const recentInvoices = await q(`
    SELECT id, invoice_no, invoice_type, total_amount, paid_amount, remaining_amount, status, created_at
    FROM invoices ORDER BY created_at DESC LIMIT 5
  `);

  if (recentInvoices.rows.length === 0) {
    console.log('No invoices in DB. System may be freshly reset.');
  } else {
    recentInvoices.rows.forEach(r => {
      console.log(`  ${r.invoice_no} [${r.invoice_type}] Total: PKR ${num(r.total_amount)} | Paid: PKR ${num(r.paid_amount)} | Rem: PKR ${num(r.remaining_amount)} | ${r.status}`);
    });
  }

  // ============================================================
  // 19. TABLE EXISTENCE CHECK
  // ============================================================
  console.log('\n──────────────────────────────────────────');
  console.log('19. TABLE EXISTENCE CHECK');
  console.log('──────────────────────────────────────────');

  const expectedTables = [
    'products', 'customers', 'vendors', 'invoices', 'invoice_items',
    'payments', 'accounts', 'ledger_entries', 'repair_jobs', 'repair_job_lines',
    'expenses', 'staff', 'business_settings', 'repair_services', 'inventory_movements'
  ];

  const existingTables = await q(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const existSet = new Set(existingTables.rows.map(r => r.table_name));

  for (const t of expectedTables) {
    const exists = existSet.has(t);
    console.log(`  ${exists ? '✓' : '✗ MISSING'} ${t}`);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n====================================================');
  console.log('AUDIT COMPLETE');
  console.log('====================================================');
  console.log('Review all ⚠ warnings above for confirmed bugs.');

  await pool.end();
}

audit().catch(e => {
  console.error('Audit failed:', e.message);
  pool.end();
  process.exit(1);
});
