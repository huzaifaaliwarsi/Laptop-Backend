const db = require('../src/config/db');
const InvoiceService = require('../src/modules/invoices/invoices.service');
const InvoiceRegistryService = require('../src/modules/invoices/invoice-registry.service');

async function testConcurrency() {
  console.log('Testing Concurrent Overpayment Race Condition Protection...');
  const testUser = { id: '1', name: 'Super Admin', role: 'admin' };
  const branchId = 1;
  const uniqueSuffix = Date.now().toString().slice(-6);

  // 1. Create a sale with 100 PKR remaining balance
  const saleRes = await InvoiceService.createSale({
    customerName: `Concurrent Test ${uniqueSuffix}`,
    date: '2026-11-17',
    paymentMethod: 'Cash',
    paid: 0,
    items: [{
      name: 'Concurrent Test Item',
      quantity: 1,
      unitPrice: 100
    }]
  }, testUser);

  const invoiceId = saleRes.invoice.id;
  console.log(`Created invoice ${invoiceId} with balance PKR 100.`);

  // 2. Launch 2 simultaneous payments of 70 PKR each (Total attempted = 140 PKR, which exceeds 100 PKR!)
  // Exactly ONE must succeed and the other MUST be rejected by row lock!
  const results = await Promise.allSettled([
    InvoiceRegistryService.recordInvoicePayment(invoiceId, {
      amount: 70,
      paymentMethod: 'Cash',
      notes: 'Cashier A',
      requestKey: `keyA_${uniqueSuffix}`
    }, testUser, branchId),
    InvoiceRegistryService.recordInvoicePayment(invoiceId, {
      amount: 70,
      paymentMethod: 'Cash',
      notes: 'Cashier B',
      requestKey: `keyB_${uniqueSuffix}`
    }, testUser, branchId)
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  console.log(`Fulfilled: ${fulfilled.length}, Rejected: ${rejected.length}`);
  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Concurrency protection failed! Fulfilled=${fulfilled.length}, Rejected=${rejected.length}`);
  }

  console.log(`Rejected reason: "${rejected[0].reason?.message}"`);

  // Verify DB balance is exactly 30 PKR (100 - 70)
  const inv = await db.query('SELECT paid, balance, payment_status FROM invoices WHERE id = $1', [invoiceId]);
  console.log(`Final DB Invoice: Paid=${inv.rows[0].paid}, Balance=${inv.rows[0].balance}, Status=${inv.rows[0].payment_status}`);
  if (parseFloat(inv.rows[0].balance) !== 30 || parseFloat(inv.rows[0].paid) !== 70) {
    throw new Error(`Balance incorrect: Expected 30 balance, got ${inv.rows[0].balance}`);
  }

  console.log('✔ Concurrency & Overpayment Race Condition Protection 100% Verified!');
  process.exit(0);
}

testConcurrency().catch(err => {
  console.error(err);
  process.exit(1);
});

