// backend/scripts/test_vendor_group_payment_e2e.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin123@127.0.0.1:5432/retail_repair_db'
});

const BASE_URL = 'http://localhost:5001/api';

async function run() {
  console.log('--- Starting Vendor Group Payment E2E Test ---');

  // 1. Fetch or create a test user / login
  const usersRes = await db.query("SELECT id, username, password_hash, role, branch_id FROM users WHERE status = 'Active' LIMIT 5");
  console.log('Available active users in retail_repair_db:', usersRes.rows.map(u => ({ id: u.id, username: u.username, role: u.role, branch_id: u.branch_id })));

  let token = null;
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026';
  
  // Create an authorized token for Branch 1 admin
  const user = usersRes.rows.find(u => u.role === 'admin') || usersRes.rows[0];
  if (!user) throw new Error('No user found in database');

  token = jwt.sign(
    {
      id: user.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branch_id || 1,
      name: user.name || 'Admin User'
    },
    secret,
    { expiresIn: '1h' }
  );
  console.log(`Generated test JWT token for user ${user.username} (Branch: ${user.branch_id || 1})`);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  // 2. Ensure a vendor with unpaid bills exists
  let vendorRes = await db.query(
    "SELECT id, name FROM vendors WHERE branch_id = $1 LIMIT 1",
    [user.branch_id || 1]
  );

  let vendorId;
  if (vendorRes.rows.length === 0) {
    const newV = await db.query(
      "INSERT INTO vendors (id, branch_id, name, contact) VALUES ('VND-TEST-001', $1, 'Global Tech Distro', '03001234567') RETURNING id, name",
      [user.branch_id || 1]
    );
    vendorId = newV.rows[0].id;
    console.log('Created test vendor:', newV.rows[0]);
  } else {
    vendorId = vendorRes.rows[0].id;
    console.log('Using existing vendor:', vendorRes.rows[0]);
  }

  // 3. Ensure at least two open unpaid bills exist for this vendor
  let openBillsRes = await db.query(
    `SELECT * FROM accounts 
     WHERE party_id = $1 AND branch_id = $2 AND type = 'Vendor Payable' AND status = 'Open' AND remaining > 0.005`,
    [vendorId, user.branch_id || 1]
  );

  if (openBillsRes.rows.length < 2) {
    console.log('Creating 2 test open purchase bills for vendor...');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const invNo1 = `VPU-9${randSuffix}1`;
    const invNo2 = `VPU-9${randSuffix}2`;

    const inv1 = await db.query(
      `INSERT INTO invoices (id, branch_id, type, type_key, invoice_no, party_type, party_id, party_name, total, paid, balance, payment_status, created_at)
       VALUES ('INV-TEST-P1-${Date.now()}', $1, 'Vendor Purchase', 'vendor_purchase', $3, 'vendor', $2, 'Test Vendor', 3000, 0, 3000, 'Unpaid', NOW() - INTERVAL '2 days')
       RETURNING id, invoice_no`,
      [user.branch_id || 1, vendorId, invNo1]
    );
    await db.query(
      `INSERT INTO accounts (id, branch_id, type, invoice_id, invoice_no, party_type, party_id, party_name, amount, remaining, status, date)
       VALUES ('ACC-TEST-P1-${Date.now()}', $1, 'Vendor Payable', $2, $3, 'vendor', $4, 'Test Vendor', 3000, 3000, 'Open', CURRENT_DATE - 2)`,
      [user.branch_id || 1, inv1.rows[0].id, inv1.rows[0].invoice_no, vendorId]
    );

    const inv2 = await db.query(
      `INSERT INTO invoices (id, branch_id, type, type_key, invoice_no, party_type, party_id, party_name, total, paid, balance, payment_status, created_at)
       VALUES ('INV-TEST-P2-${Date.now()}', $1, 'Vendor Purchase', 'vendor_purchase', $3, 'vendor', $2, 'Test Vendor', 4000, 0, 4000, 'Unpaid', NOW() - INTERVAL '1 day')
       RETURNING id, invoice_no`,
      [user.branch_id || 1, vendorId, invNo2]
    );
    await db.query(
      `INSERT INTO accounts (id, branch_id, type, invoice_id, invoice_no, party_type, party_id, party_name, amount, remaining, status, date)
       VALUES ('ACC-TEST-P2-${Date.now()}', $1, 'Vendor Payable', $2, $3, 'vendor', $4, 'Test Vendor', 4000, 4000, 'Open', CURRENT_DATE - 1)`,
      [user.branch_id || 1, inv2.rows[0].id, inv2.rows[0].invoice_no, vendorId]
    );
    console.log(`Created 2 test open bills: ${invNo1} (PKR 3,000) and ${invNo2} (PKR 4,000)`);
  }

  // 4. Test GET /api/accounts/vendor/:vendorId/open-bills
  console.log('\n--- Test 1: Fetch Open Bills API ---');
  const billsRes = await fetch(`${BASE_URL}/accounts/vendor/${vendorId}/open-bills`, { headers });
  const billsJson = await billsRes.json();
  console.log('Open Bills response status:', billsRes.status);
  assert.equal(billsRes.status, 200);
  assert.equal(billsJson.success, true);
  console.log(`Found ${billsJson.data.openBillsCount} open bill(s), Total Payable: PKR ${billsJson.data.totalPayable}`);
  assert.ok(billsJson.data.openBillsCount >= 2);

  const bill1 = billsJson.data.bills[0];
  const bill2 = billsJson.data.bills[1];
  console.log(`Bill 1 (Oldest): ${bill1.invoiceNo || bill1.accountId} - Remaining: PKR ${bill1.remaining}`);
  console.log(`Bill 2 (Newer): ${bill2.invoiceNo || bill2.accountId} - Remaining: PKR ${bill2.remaining}`);

  // 5. Test POST /api/accounts/vendor-group-payment with FIFO auto-distribution
  console.log('\n--- Test 2: Execute Group Payment (Lump-Sum PKR 4,000) ---');
  // Bill 1 has 3000, Bill 2 has 4000. Paying 4000 should completely settle Bill 1 (3000) and leave Bill 2 with 3000 (paid 1000).
  const payAmt = Math.min(billsJson.data.totalPayable, bill1.remaining + 1000);
  console.log(`Submitting group payment amount: PKR ${payAmt}`);

  const groupPayRes = await fetch(`${BASE_URL}/accounts/vendor-group-payment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vendorId,
      amount: payAmt,
      paymentMethod: 'Cash',
      notes: 'Automated E2E Test Group Payment'
    })
  });

  const groupPayJson = await groupPayRes.json();
  console.log('Group Payment response status:', groupPayRes.status);
  console.log('Response body:', JSON.stringify(groupPayJson, null, 2));

  assert.equal(groupPayRes.status, 200);
  assert.equal(groupPayJson.success, true);
  assert.ok(groupPayJson.data.totalPaid > 0);

  // 6. Verify Database State
  console.log('\n--- Test 3: Verify Database Ledger & Invoices Consistency ---');
  const checkBill1 = await db.query('SELECT remaining, status FROM accounts WHERE id = $1', [bill1.accountId]);
  console.log('Bill 1 Account Status after payment:', checkBill1.rows[0]);
  assert.equal(checkBill1.rows[0].status, 'Settled');
  assert.equal(parseFloat(checkBill1.rows[0].remaining), 0);

  const checkBill2 = await db.query('SELECT remaining, status FROM accounts WHERE id = $1', [bill2.accountId]);
  console.log('Bill 2 Account Status after payment:', checkBill2.rows[0]);
  assert.ok(parseFloat(checkBill2.rows[0].remaining) < bill2.remaining);

  // Check payment audit records
  const paymentAudit = await db.query(
    "SELECT id, amount, party_name, direction, notes FROM payments WHERE party_id = $1 ORDER BY date DESC, id DESC LIMIT 2",
    [vendorId]
  );
  console.log('Payment records logged in DB:', paymentAudit.rows);
  assert.ok(paymentAudit.rows.length >= 1);
  assert.equal(paymentAudit.rows[0].direction, 'Paid');

  console.log('\n✅ ALL E2E TESTS PASSED SUCCESSFULLY! FIFO Group Payment is 100% functional.');
  await db.end();
}

run().catch(async (err) => {
  console.error('E2E Test Failed:', err);
  try { await db.end(); } catch (e) {}
  process.exit(1);
});
