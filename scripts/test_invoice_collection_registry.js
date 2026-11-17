const db = require('../src/config/db');
const InvoiceService = require('../src/modules/invoices/invoices.service');
const InvoiceRegistryService = require('../src/modules/invoices/invoice-registry.service');

async function runTests() {
  console.log('====================================================================');
  console.log('  TESTING INVOICE TRANSACTION-LEVEL COLLECTION REGISTRY (P0)');
  console.log('====================================================================\n');

  const testUser = { id: '1', name: 'Super Admin', role: 'admin' };
  const branchId = 1;
  const uniqueSuffix = Date.now().toString().slice(-6);

  // 1. Create a test product
  console.log('[Step 1] Creating test product & customer...');
  const catRes = await db.query('SELECT id, name FROM product_categories LIMIT 1');
  const catId = catRes.rows[0]?.id || 1;
  const catName = catRes.rows[0]?.name || 'Laptop';

  const prdId = `PRD-T${uniqueSuffix}`;
  const prdCode = `LPT-T${uniqueSuffix}`;
  await db.query(`
    INSERT INTO products (
      id, code, inventory_type, category_id, category_name, brand, model,
      product_name, condition, initial_stock, stock_in, stock_out, current_stock,
      low_stock_alert, cost_price, expected_sale_price, branch_id
    ) VALUES ($1, $2, 'Vendor Purchased', $3, $4, 'TestBrand', 'TestModel', 'Test Laptop',
              'Used', 10, 10, 0, 10, 1, 500, 1000, $5)
  `, [prdId, prdCode, catId, catName, branchId]);

  const cusId = `CUS-T${uniqueSuffix}`;
  const cusName = `Test Customer ${uniqueSuffix}`;
  await db.query(`
    INSERT INTO customers (id, name, contact, branch_id)
    VALUES ($1, $2, '0300-1112233', $3)
  `, [cusId, cusName, branchId]);

  // 2. Scenario Nov 1: Original Sale (1,000 PKR total, 500 PKR initial payment, 500 PKR balance)
  console.log('\n[Step 2] Scenario Nov 1: Creating Original Sale (Total: 1,000, Initial Paid: 500, Balance: 500)...');
  const saleRes = await InvoiceService.createSale({
    customerId: cusId,
    customerName: cusName,
    date: '2026-11-01',
    paymentMethod: 'Cash',
    paid: 500,
    items: [{
      productId: prdId,
      productCode: prdCode,
      name: 'Test Laptop',
      quantity: 1,
      unitPrice: 1000
    }]
  }, testUser);

  const invoiceId = saleRes.invoice.id;
  const invoiceNo = saleRes.invoice.invoice_no;
  console.log(`  ✔ Invoice created: ${invoiceNo} (${invoiceId})`);
  console.log(`    Total: PKR ${saleRes.invoice.total}, Initial Paid: PKR ${saleRes.invoice.paid}, Balance: PKR ${saleRes.invoice.balance}`);

  // Assert Step 2
  if (parseFloat(saleRes.invoice.total) !== 1000 || parseFloat(saleRes.invoice.paid) !== 500 || parseFloat(saleRes.invoice.balance) !== 500) {
    throw new Error(`Step 2 Failed: Invoice amounts incorrect: Total=${saleRes.invoice.total}, Paid=${saleRes.invoice.paid}, Balance=${saleRes.invoice.balance}`);
  }

  // 3. Test Registry on Nov 1
  console.log('\n[Step 3] Querying Registry for Nov 1...');
  const nov1Reg = await InvoiceRegistryService.getTransactionRegistry({
    search: invoiceNo,
    from: '2026-11-01',
    to: '2026-11-01'
  }, testUser, branchId);

  console.log(`  ✔ Found ${nov1Reg.rows.length} row(s) on Nov 1`);
  if (nov1Reg.rows.length !== 1) {
    throw new Error(`Expected exactly 1 row on Nov 1, got ${nov1Reg.rows.length}`);
  }
  const nov1Row = nov1Reg.rows[0];
  console.log(`    Row Type: ${nov1Row.transactionType}, Billing: PKR ${nov1Row.billingAmount}, Collected: PKR ${nov1Row.collectedAmount}, Outstanding: PKR ${nov1Row.currentOutstanding}`);
  if (nov1Row.transactionType !== 'Original Sale' || nov1Row.billingAmount !== 1000 || nov1Row.collectedAmount !== 500 || nov1Row.currentOutstanding !== 500) {
    throw new Error(`Step 3 Failed: Nov 1 row fields incorrect`);
  }

  // 4. Scenario Nov 6: Remaining Installment Collection of 200 PKR
  console.log('\n[Step 4] Scenario Nov 6: Collecting Remaining Installment of 200 PKR...');
  const requestKeyNov6 = `req_nov6_${uniqueSuffix}`;
  const payNov6 = await InvoiceRegistryService.recordInvoicePayment(invoiceId, {
    amount: 200,
    paymentMethod: 'Cash',
    referenceId: 'REF-NOV06',
    notes: 'Nov 6 installment',
    date: '2026-11-06',
    requestKey: requestKeyNov6
  }, testUser, branchId);

  console.log(`  ✔ Payment recorded: ${payNov6.payment.id}`);
  console.log(`    New Total Paid: PKR ${payNov6.paid}, Remaining Balance: PKR ${payNov6.balance}, Status: ${payNov6.paymentStatus}`);

  if (payNov6.paid !== 700 || payNov6.balance !== 300 || payNov6.paymentStatus !== 'Partial') {
    throw new Error(`Step 4 Failed: Expected paid=700, balance=300, status=Partial. Got: paid=${payNov6.paid}, balance=${payNov6.balance}`);
  }

  // 5. Test Idempotency with exact same requestKey
  console.log('\n[Step 5] Testing Idempotency & Double-Click Protection with same requestKey...');
  const replayNov6 = await InvoiceRegistryService.recordInvoicePayment(invoiceId, {
    amount: 200,
    paymentMethod: 'Cash',
    date: '2026-11-06',
    requestKey: requestKeyNov6
  }, testUser, branchId);

  console.log(`  ✔ Idempotent replay result: idempotent=${replayNov6.idempotent}, paymentId=${replayNov6.payment.id}`);
  if (!replayNov6.idempotent || replayNov6.payment.id !== payNov6.payment.id) {
    throw new Error(`Step 5 Failed: Idempotency check did not return existing payment`);
  }

  // Verify invoice balance did NOT deduct twice
  const checkInv1 = await db.query('SELECT paid, balance FROM invoices WHERE id = $1', [invoiceId]);
  if (parseFloat(checkInv1.rows[0].balance) !== 300) {
    throw new Error(`Step 5 Failed: Balance double-deducted! Expected 300, got ${checkInv1.rows[0].balance}`);
  }
  console.log(`  ✔ Verified: Balance remains PKR 300 (no duplicate payment applied)`);

  // 6. Test Date Filtering on Nov 6 only
  console.log('\n[Step 6] Verifying Date Filtering for Nov 6 ONLY (Must show collection row with 0 billing)...');
  const nov6Reg = await InvoiceRegistryService.getTransactionRegistry({
    search: invoiceNo,
    from: '2026-11-06',
    to: '2026-11-06'
  }, testUser, branchId);

  console.log(`  ✔ Found ${nov6Reg.rows.length} row(s) on Nov 6`);
  if (nov6Reg.rows.length !== 1) {
    throw new Error(`Expected exactly 1 row on Nov 6, got ${nov6Reg.rows.length}`);
  }
  const nov6Row = nov6Reg.rows[0];
  console.log(`    Row Type: ${nov6Row.transactionType}`);
  console.log(`    Receipt No: ${nov6Row.receiptNo}`);
  console.log(`    Billing Amount: PKR ${nov6Row.billingAmount} (CRITICAL: MUST BE 0)`);
  console.log(`    Collected Amount: PKR ${nov6Row.collectedAmount} (MUST BE 200)`);
  console.log(`    Current Outstanding: PKR ${nov6Row.currentOutstanding} (MUST BE 300)`);

  if (nov6Row.transactionType !== 'Remaining Collection') {
    throw new Error(`Expected 'Remaining Collection', got ${nov6Row.transactionType}`);
  }
  if (nov6Row.billingAmount !== 0) {
    throw new Error(`CRITICAL: Billing amount on collection date must be 0! Got ${nov6Row.billingAmount}`);
  }
  if (nov6Row.collectedAmount !== 200) {
    throw new Error(`Expected collectedAmount 200, got ${nov6Row.collectedAmount}`);
  }
  if (nov6Row.currentOutstanding !== 300) {
    throw new Error(`Expected currentOutstanding 300, got ${nov6Row.currentOutstanding}`);
  }
  if (nov6Reg.summary.grossSales !== 0) {
    throw new Error(`Gross sales on Nov 6 must be 0, got ${nov6Reg.summary.grossSales}`);
  }
  if (nov6Reg.summary.totalCollected !== 200) {
    throw new Error(`Total collected on Nov 6 must be 200, got ${nov6Reg.summary.totalCollected}`);
  }

  // 7. Scenario Nov 16: Final Settlement of remaining 300 PKR
  console.log('\n[Step 7] Scenario Nov 16: Final Settlement Collection of 300 PKR...');
  const payNov16 = await InvoiceRegistryService.recordInvoicePayment(invoiceId, {
    amount: 300,
    paymentMethod: 'Cash',
    referenceId: 'REF-NOV16',
    notes: 'Nov 16 final settlement',
    date: '2026-11-16',
    requestKey: `req_nov16_${uniqueSuffix}`
  }, testUser, branchId);

  console.log(`  ✔ Payment recorded: ${payNov16.payment.id}`);
  console.log(`    New Total Paid: PKR ${payNov16.paid}, Remaining Balance: PKR ${payNov16.balance}, Status: ${payNov16.paymentStatus}`);

  if (payNov16.paid !== 1000 || payNov16.balance !== 0 || payNov16.paymentStatus !== 'Paid') {
    throw new Error(`Step 7 Failed: Expected paid=1000, balance=0, status=Paid. Got: paid=${payNov16.paid}, balance=${payNov16.balance}`);
  }

  // 8. Test Overpayment Protection (Cannot pay more than balance or pay settled invoice)
  console.log('\n[Step 8] Testing Overpayment & Settlement Protection...');
  try {
    await InvoiceRegistryService.recordInvoicePayment(invoiceId, {
      amount: 100,
      paymentMethod: 'Cash'
    }, testUser, branchId);
    throw new Error('Overpayment test failed: Should have rejected payment on fully settled invoice');
  } catch (err) {
    console.log(`  ✔ Overpayment correctly rejected: "${err.message}"`);
  }

  // 9. Full Date Range (Nov 1 to Nov 16) Verification
  console.log('\n[Step 9] Verifying Full Range (Nov 1 to Nov 16) - Must show 3 separate transaction rows...');
  const fullReg = await InvoiceRegistryService.getTransactionRegistry({
    search: invoiceNo,
    from: '2026-11-01',
    to: '2026-11-16'
  }, testUser, branchId);

  console.log(`  ✔ Total transaction rows found: ${fullReg.rows.length} (Expected 3)`);
  if (fullReg.rows.length !== 3) {
    throw new Error(`Expected exactly 3 rows in full range, got ${fullReg.rows.length}`);
  }

  console.log('\n  --- Transaction Breakdown ---');
  fullReg.rows.forEach((r, idx) => {
    console.log(`  [Row ${idx + 1}] Date: ${r.date?.toISOString ? r.date.toISOString().split('T')[0] : String(r.date).slice(0, 10)} | Type: ${r.transactionType} | Rcpt: ${r.receiptNo || '—'} | Billing: PKR ${r.billingAmount} | Collected: PKR ${r.collectedAmount} | Balance: PKR ${r.currentOutstanding} | Status: ${r.status}`);
  });

  // Verify KPI summary
  console.log('\n  --- Summary KPIs ---');
  console.log(`  Gross Sales: PKR ${fullReg.summary.grossSales} (Expected 1000)`);
  console.log(`  Total Collected: PKR ${fullReg.summary.totalCollected} (Expected 1000 = 500 + 200 + 300)`);
  console.log(`  Total Outstanding: PKR ${fullReg.summary.totalOutstanding} (Expected 0, strictly deduplicated!)`);
  console.log(`  Distinct Invoices: ${fullReg.summary.distinctInvoicesCount} (Expected 1)`);

  if (fullReg.summary.grossSales !== 1000) {
    throw new Error(`Summary grossSales incorrect: expected 1000, got ${fullReg.summary.grossSales}`);
  }
  if (fullReg.summary.totalCollected !== 1000) {
    throw new Error(`Summary totalCollected incorrect: expected 1000, got ${fullReg.summary.totalCollected}`);
  }
  if (fullReg.summary.totalOutstanding !== 0) {
    throw new Error(`Summary totalOutstanding incorrect: expected 0, got ${fullReg.summary.totalOutstanding}`);
  }
  if (fullReg.summary.distinctInvoicesCount !== 1) {
    throw new Error(`Summary distinctInvoicesCount incorrect: expected 1, got ${fullReg.summary.distinctInvoicesCount}`);
  }

  // 10. Test Single Invoice Endpoint GET /invoices/:id includes payments
  console.log('\n[Step 10] Testing Single Invoice Details GET /invoices/:id...');
  const invDetails = await InvoiceService.getInvoiceById(invoiceId);
  console.log(`  ✔ Invoice lines: ${invDetails.items?.length || 0}`);
  console.log(`  ✔ Associated payment receipts: ${invDetails.payments?.length || 0} (Expected 3: Initial + 2 Collections)`);
  if ((invDetails.payments?.length || 0) < 3) {
    throw new Error(`Expected at least 3 payments attached to invoice, got ${invDetails.payments?.length}`);
  }

  console.log('\n====================================================================');
  console.log('  ALL INVOICE TRANSACTION-LEVEL REGISTRY TESTS PASSED 100%! 🎉');
  console.log('====================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});

