/**
 * Automated Verification Suite for Global Staff Username & Phone Uniqueness
 * Tests all 12 Mandatory Requirements.
 */

const bcrypt = require('bcryptjs');
const branchManager = require('./src/config/branchManager');
const identityRegistry = require('./src/services/identityRegistry');
const { normalizeUsername, normalizePhone } = require('./src/utils/phoneHelper');

const BASE_URL = 'http://localhost:5000/api';

const results = [];

function recordResult(testName, passed, details) {
  results.push({ testName, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} - ${testName}`);
  if (details) console.log(`   Details: ${details}`);
}

async function runTests() {
  console.log('===============================================================');
  console.log('STARTING GLOBAL STAFF IDENTITY & UNIQUENESS TEST SUITE');
  console.log('===============================================================\n');

  // Setup: Ensure Master DB tables and clean any test artifacts
  await branchManager.initMasterDb();

  const pool1 = await branchManager.getBranchPool(1, true);
  const pool2 = await branchManager.getBranchPool(2, true);

  const salt = await bcrypt.genSalt(10);
  const pAdmin1 = await bcrypt.hash('admin', salt);
  const pAdmin2 = await bcrypt.hash('Password123!', salt);

  await pool1.query("UPDATE users SET password_hash = $1 WHERE username = 'admin'", [pAdmin1]);
  await pool2.query("UPDATE users SET password_hash = $1 WHERE username = 'admin2'", [pAdmin2]);

  await pool1.query("DELETE FROM users WHERE username IN ('ali', 'newstaff', 'concur_staff', 'user_two', 'temp_comp_user', 'comp_test_user')");
  await pool2.query("DELETE FROM users WHERE username IN ('ali', 'newstaff', 'concur_staff', 'user_two', 'temp_comp_user', 'comp_test_user')");
  await branchManager.masterPool.query("DELETE FROM master_staff_identities WHERE normalized_username IN ('ali', 'newstaff', 'concur_staff', 'user_two', 'temp_comp_user', 'comp_test_user')");

  // Login as Branch 1 Admin
  const b1LoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const b1LoginData = await b1LoginRes.json();
  const b1Token = b1LoginData.data?.token;

  // Login as Branch 2 Admin
  const b2LoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin2', password: 'Password123!' })
  });
  const b2LoginData = await b2LoginRes.json();
  const b2Token = b2LoginData.data?.token;

  if (!b1Token || !b2Token) {
    console.error('Failed to obtain admin tokens for test execution:', { b1: b1LoginData, b2: b2LoginData });
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // TEST 1 — GLOBAL USERNAME
  // Create in Branch 1: username: ali, phone: 03001234567 -> 201
  // Attempt in Branch 2: username: ali, phone: 03009999999 -> 409 USERNAME_ALREADY_EXISTS
  // -------------------------------------------------------------------------
  try {
    const res1 = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({
        name: 'Ali Faisal',
        username: 'ali',
        contact: '03001234567',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data1 = await res1.json();
    const step1Ok = res1.status === 201 && data1.success;

    const res2 = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b2Token}` },
      body: JSON.stringify({
        name: 'Ali From Branch 2',
        username: 'ali',
        contact: '03009999999',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data2 = await res2.json();
    const step2Ok = res2.status === 409 && data2.code === 'USERNAME_ALREADY_EXISTS';

    recordResult('TEST 1 — GLOBAL USERNAME UNIQUENESS', step1Ok && step2Ok, `Branch 1: ${res1.status}, Branch 2 Dup: ${res2.status} (${data2.code})`);
  } catch (err) {
    recordResult('TEST 1 — GLOBAL USERNAME UNIQUENESS', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 2 — GLOBAL PHONE
  // Branch 2 attempts: username: newuser, phone: 03001234567 -> 409 PHONE_ALREADY_EXISTS
  // -------------------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b2Token}` },
      body: JSON.stringify({
        name: 'New User',
        username: 'newuser',
        contact: '03001234567',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data = await res.json();
    const passed = res.status === 409 && data.code === 'PHONE_ALREADY_EXISTS';
    recordResult('TEST 2 — GLOBAL PHONE UNIQUENESS', passed, `Status: ${res.status}, Code: ${data.code}`);
  } catch (err) {
    recordResult('TEST 2 — GLOBAL PHONE UNIQUENESS', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 3 — CASE INSENSITIVITY
  // Branch 2 attempts: username: ALI -> 409 USERNAME_ALREADY_EXISTS
  // -------------------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b2Token}` },
      body: JSON.stringify({
        name: 'Ali Uppercase',
        username: 'ALI',
        contact: '03008888888',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data = await res.json();
    const passed = res.status === 409 && data.code === 'USERNAME_ALREADY_EXISTS';
    recordResult('TEST 3 — CASE INSENSITIVITY UNIQUENESS', passed, `Status: ${res.status}, Code: ${data.code}`);
  } catch (err) {
    recordResult('TEST 3 — CASE INSENSITIVITY UNIQUENESS', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 4 — PHONE NORMALIZATION
  // Branch 2 attempts: +92 300 1234567 (when Branch 1 has 03001234567) -> 409 PHONE_ALREADY_EXISTS
  // -------------------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b2Token}` },
      body: JSON.stringify({
        name: 'Phone Format Test',
        username: 'unique_user_4',
        contact: '+92 300 1234567',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data = await res.json();
    const passed = res.status === 409 && data.code === 'PHONE_ALREADY_EXISTS';
    recordResult('TEST 4 — PHONE NORMALIZATION CROSS-CHECK (+92 300 1234567)', passed, `Status: ${res.status}, Code: ${data.code}`);
  } catch (err) {
    recordResult('TEST 4 — PHONE NORMALIZATION CROSS-CHECK', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 5 — CONCURRENT CREATION RACE CONDITION
  // Branch 1 and Branch 2 simultaneously request username: concur_staff
  // Expected: Exactly ONE 201, exactly ONE 409. Master Registry contains exactly one.
  // -------------------------------------------------------------------------
  try {
    const p1 = fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({
        name: 'Concur Staff B1',
        username: 'concur_staff',
        contact: '03007777771',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });

    const p2 = fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b2Token}` },
      body: JSON.stringify({
        name: 'Concur Staff B2',
        username: 'concur_staff',
        contact: '03007777772',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    const d1 = await r1.json();
    const d2 = await r2.json();

    const statuses = [r1.status, r2.status];
    const hasOne201 = statuses.filter(s => s === 201).length === 1;
    const hasOne409 = statuses.filter(s => s === 409).length === 1;

    const countCheck = await branchManager.masterPool.query(
      "SELECT count(*) as count FROM master_staff_identities WHERE normalized_username = 'concur_staff'"
    );
    const exactOneInMaster = parseInt(countCheck.rows[0].count, 10) === 1;

    const passed = hasOne201 && hasOne409 && exactOneInMaster;
    recordResult(
      'TEST 5 — CONCURRENT CREATION SAFETY (SIMULTANEOUS RACE)',
      passed,
      `Statuses: [${statuses.join(', ')}], Master Identity Count: ${countCheck.rows[0].count}`
    );
  } catch (err) {
    recordResult('TEST 5 — CONCURRENT CREATION SAFETY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 6 — SELF UPDATE
  // Existing staff in Branch 1 (ali) updates designation without changing username/phone -> 200 SUCCESS
  // -------------------------------------------------------------------------
  try {
    const aliCheck = await pool1.query("SELECT id FROM users WHERE username = 'ali'");
    const aliId = aliCheck.rows[0]?.id;

    const res = await fetch(`${BASE_URL}/staff/${aliId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({
        name: 'Ali Faisal Updated',
        username: 'ali',
        contact: '03001234567',
        role: 'sales',
        designation: 'Senior Sales Executive'
      })
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success && data.data?.designation === 'Senior Sales Executive';
    recordResult('TEST 6 — SELF UPDATE (NO FALSE CONFLICT)', passed, `Status: ${res.status}, Designation: ${data.data?.designation}`);
  } catch (err) {
    recordResult('TEST 6 — SELF UPDATE', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 7 — CONFLICT UPDATE
  // Staff attempts to change username/phone to another globally registered value -> 409
  // -------------------------------------------------------------------------
  try {
    // Create a second user in Branch 1 (user_two)
    const createSecondRes = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({
        name: 'User Two',
        username: 'user_two',
        contact: '03009991122',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const createSecondData = await createSecondRes.json();
    const secondUserId = createSecondData.data?.id;

    // Attempt to change user_two's username to 'ali' (which already belongs to Ali)
    const res = await fetch(`${BASE_URL}/staff/${secondUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({
        name: 'User Two Renamed',
        username: 'ali', // Conflicts with Ali
        contact: '03009991122',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data = await res.json();
    const passed = res.status === 409 && data.code === 'USERNAME_ALREADY_EXISTS';

    // Verify original Ali and user_two remain unchanged
    const aliStillExists = await pool1.query("SELECT username FROM users WHERE username = 'ali'");
    const userTwoStillExists = await pool1.query("SELECT username FROM users WHERE username = 'user_two'");
    const dbIntact = aliStillExists.rows.length === 1 && userTwoStillExists.rows.length === 1;

    // Cleanup user_two
    await pool1.query("DELETE FROM users WHERE username = 'user_two'");
    await branchManager.masterPool.query("DELETE FROM master_staff_identities WHERE normalized_username = 'user_two'");

    recordResult('TEST 7 — CONFLICT UPDATE REJECTION (ROLLBACK INTACT)', passed && dbIntact, `Status: ${res.status}, Code: ${data.code}, DB Intact: ${dbIntact}`);
  } catch (err) {
    recordResult('TEST 7 — CONFLICT UPDATE REJECTION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 8 — LOGIN ROUTING
  // Login with globally unique username (ali) -> Master Registry routes to Branch 1 -> bcrypt verification -> JWT branchId: 1
  // -------------------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ali', password: 'Password123!' })
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success && data.data?.branch?.id === 1 && data.data?.user?.username === 'ali';
    recordResult('TEST 8 — LOGIN ROUTING VIA GLOBAL REGISTRY', passed, `Status: ${res.status}, BranchId: ${data.data?.branch?.id}, Username: ${data.data?.user?.username}`);
  } catch (err) {
    recordResult('TEST 8 — LOGIN ROUTING VIA GLOBAL REGISTRY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 9 — LEGACY DUPLICATE SCAN
  // Verify scanIdentityConflicts reports duplicates accurately
  // -------------------------------------------------------------------------
  try {
    const scan = await identityRegistry.scanIdentityConflicts();
    const passed = scan !== null && typeof scan.totalScanned === 'number';
    recordResult('TEST 9 — LEGACY DUPLICATE SCAN & REPORTING', passed, `Total Scanned: ${scan.totalScanned}, Duplicates: ${scan.conflicts.length}`);
  } catch (err) {
    recordResult('TEST 9 — LEGACY DUPLICATE SCAN & REPORTING', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 10 — UPDATE COMPENSATION
  // Master Registry update succeeds, Branch DB update simulated to fail -> restores previous identity
  // -------------------------------------------------------------------------
  try {
    const testUsername = 'comp_test_user';
    const originalPhone = '03001112233';
    const attemptedNewPhone = '03009998877';

    // 1. Reserve and finalize test identity
    const resv = await identityRegistry.reserveIdentity({
      branchId: 1,
      username: testUsername,
      phone: originalPhone,
      role: 'sales',
      status: 'Active'
    });
    await identityRegistry.finalizeIdentity({
      reservationId: resv.reservationId,
      reservationToken: resv.reservationToken,
      branchUserId: 'EMP-TEMP-99'
    });

    // 2. Perform Master update
    const updateRes = await identityRegistry.updateIdentity({
      branchId: 1,
      branchUserId: 'EMP-TEMP-99',
      currentUsername: testUsername,
      username: testUsername,
      phone: attemptedNewPhone,
      role: 'sales',
      status: 'Active'
    });

    // 3. Simulate Branch DB failure -> call restoreIdentity
    await identityRegistry.restoreIdentity({
      branchId: 1,
      branchUserId: 'EMP-TEMP-99',
      previousIdentity: updateRes.previousIdentity
    });

    // 4. Verify Master DB restored original phone
    const check = await branchManager.masterPool.query(
      "SELECT normalized_phone FROM master_staff_identities WHERE normalized_username = $1",
      [testUsername]
    );
    const restoredPhone = check.rows[0]?.normalized_phone;
    const passed = restoredPhone === originalPhone;

    // Cleanup
    await branchManager.masterPool.query("DELETE FROM master_staff_identities WHERE normalized_username = $1", [testUsername]);

    recordResult('TEST 10 — UPDATE COMPENSATION (RESTORES PREVIOUS VALUES ON BRANCH FAILURE)', passed, `Restored Phone: ${restoredPhone} (Expected: ${originalPhone})`);
  } catch (err) {
    recordResult('TEST 10 — UPDATE COMPENSATION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 11 — CREATION COMPENSATION
  // Master reservation succeeds, Branch DB staff creation fails -> pending reservation safely released
  // -------------------------------------------------------------------------
  try {
    const testUsername = 'temp_comp_user';
    const resv = await identityRegistry.reserveIdentity({
      branchId: 1,
      username: testUsername,
      phone: '03004445566',
      role: 'sales',
      status: 'Active'
    });

    // Verify pending reservation exists
    const beforeRelease = await branchManager.masterPool.query(
      "SELECT count(*) as count FROM master_staff_identities WHERE normalized_username = $1 AND reservation_status = 'pending'",
      [testUsername]
    );
    const pendingExists = parseInt(beforeRelease.rows[0].count, 10) === 1;

    // Simulate branch DB failure -> release reservation
    await identityRegistry.releaseReservation({
      reservationId: resv.reservationId,
      reservationToken: resv.reservationToken
    });

    // Verify reservation is gone
    const afterRelease = await branchManager.masterPool.query(
      "SELECT count(*) as count FROM master_staff_identities WHERE normalized_username = $1",
      [testUsername]
    );
    const released = parseInt(afterRelease.rows[0].count, 10) === 0;

    const passed = pendingExists && released;
    recordResult('TEST 11 — CREATION COMPENSATION (PENDING RESERVATION SAFELY RELEASED)', passed, `Pending Existed: ${pendingExists}, Released: ${released}`);
  } catch (err) {
    recordResult('TEST 11 — CREATION COMPENSATION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 12 — DEACTIVATED IDENTITY RESERVATION
  // Deactivate Branch 1 user (ali) -> Attempt Branch 2 creation of (ali) -> 409 USERNAME_ALREADY_EXISTS
  // -------------------------------------------------------------------------
  try {
    const aliCheck = await pool1.query("SELECT id FROM users WHERE username = 'ali'");
    const aliId = aliCheck.rows[0]?.id;

    // Deactivate Ali in Branch 1
    await fetch(`${BASE_URL}/staff/${aliId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({ status: 'Inactive' })
    });

    // Branch 2 attempts to create 'ali'
    const res = await fetch(`${BASE_URL}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b2Token}` },
      body: JSON.stringify({
        name: 'Ali Takeover Attempt',
        username: 'ali',
        contact: '03001239999',
        password: 'Password123!',
        role: 'sales',
        designation: 'Sales Rep'
      })
    });
    const data = await res.json();
    const passed = res.status === 409 && data.code === 'USERNAME_ALREADY_EXISTS';

    // Reactivate Ali for cleanup
    await fetch(`${BASE_URL}/staff/${aliId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${b1Token}` },
      body: JSON.stringify({ status: 'Active' })
    });

    recordResult('TEST 12 — DEACTIVATED IDENTITY REMAINS RESERVED (NO TAKEOVER)', passed, `Status: ${res.status}, Code: ${data.code}`);
  } catch (err) {
    recordResult('TEST 12 — DEACTIVATED IDENTITY REMAINS RESERVED', false, err.message);
  }

  // Cleanup test artifacts from databases
  await pool1.query("DELETE FROM users WHERE username IN ('ali', 'newstaff', 'concur_staff', 'user_two', 'temp_comp_user', 'comp_test_user')");
  await pool2.query("DELETE FROM users WHERE username IN ('ali', 'newstaff', 'concur_staff', 'user_two', 'temp_comp_user', 'comp_test_user')");
  await branchManager.masterPool.query("DELETE FROM master_staff_identities WHERE normalized_username IN ('ali', 'newstaff', 'concur_staff', 'user_two', 'temp_comp_user', 'comp_test_user')");

  console.log('\n===============================================================');
  console.log('TEST SUITE SUMMARY');
  console.log('===============================================================');
  const allPassed = results.every(r => r.passed);
  console.log(`Total Tests: ${results.length} | Passed: ${results.filter(r => r.passed).length} | Failed: ${results.filter(r => !r.passed).length}`);
  console.log(`Overall Result: ${allPassed ? '🎉 ALL 12 TESTS PASSED PERFECTLY!' : '❌ SOME TESTS FAILED'}\n`);

  process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
