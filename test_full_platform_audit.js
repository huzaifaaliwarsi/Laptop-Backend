const BASE_URL = 'http://localhost:5000/api';

async function runFullAudit() {
  console.log('====================================================');
  console.log('🚀 COMPREHENSIVE PLATFORM SUPER ADMIN E2E AUDIT');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. SUPER ADMIN AUTHENTICATION
    console.log('--- 1. Testing Super Admin Master Login ---');
    const loginRes = await fetch(`${BASE_URL}/super-admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'superadmin',
        password: 'SuperAdmin@Secure2026!'
      })
    });
    const loginData = await loginRes.json();
    assert(loginRes.status === 200 && loginData.success, 'Super Admin login succeeds');
    const token = loginData.data?.token;
    assert(!!token, 'JWT token issued for Super Admin');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // 2. CONSOLIDATED BRANCH SUMMARY REPORT
    console.log('\n--- 2. Testing Consolidated Summary & Reports ---');
    const repRes = await fetch(`${BASE_URL}/super-admin/reports/consolidated`, { headers });
    const repData = await repRes.json();
    assert(repRes.status === 200 && repData.success, 'Consolidated report returns 200 OK');
    assert(repData.data?.combined !== undefined, 'Combined metrics object present');
    assert(Array.isArray(repData.data?.branches), 'Branches array present in report');
    console.log(`Current active branches count: ${repData.data?.branches?.length}`);

    // 3. EDIT BRANCH PROFILE
    console.log('\n--- 3. Testing Edit Branch Details ---');
    const branch1 = repData.data.branches[0];
    assert(!!branch1, `Branch 1 (${branch1?.branchCode}) found`);

    const editRes = await fetch(`${BASE_URL}/super-admin/branches/${branch1.branchId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        branch_name: branch1.branchName,
        phone: '0300-1122334',
        email: 'mainbranch@test.com',
        city: 'Karachi Central',
        address: 'Shop 101, Techno City Plaza',
        admin_name: 'Main Manager'
      })
    });
    const editData = await editRes.json();
    assert(editRes.status === 200 && editData.success, 'Branch profile updated successfully');

    // 4. RESET BRANCH ADMIN PASSWORD
    console.log('\n--- 4. Testing Reset Branch Admin Password ---');
    const resetRes = await fetch(`${BASE_URL}/super-admin/branches/${branch1.branchId}/reset-admin-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        newPassword: 'admin' // Keep it standard for easy testing
      })
    });
    const resetData = await resetRes.json();
    assert(resetRes.status === 200 && resetData.success, 'Branch admin password reset succeeds');

    // 5. TEST BRANCH ADMINS LIST & AUDIT LOGS
    console.log('\n--- 5. Testing Branch Admins List & Audit Logs ---');
    const adminsRes = await fetch(`${BASE_URL}/super-admin/branch-admins`, { headers });
    const adminsData = await adminsRes.json();
    assert(adminsRes.status === 200 && adminsData.success, 'Branch admins API returns 200 OK');

    const logsRes = await fetch(`${BASE_URL}/super-admin/audit-logs?limit=10`, { headers });
    const logsData = await logsRes.json();
    assert(logsRes.status === 200 && logsData.success, 'Master audit logs API returns 200 OK');
    assert(logsData.data?.length > 0, `Recorded audit logs count: ${logsData.data?.length}`);

    // 6. TEST PROVISIONING BRANCH 2 (IF SLOT AVAILABLE) OR CAPACITY LOCK
    console.log('\n--- 6. Testing Branch 2 Provisioning / Max Capacity Lock ---');
    if (repData.data.branches.length < 2) {
      console.log('Provisioning Branch 2 test instance...');
      const provRes = await fetch(`${BASE_URL}/super-admin/branches/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          branchName: 'Saddar Branch 2',
          branchCode: 'BR-02',
          city: 'Karachi',
          address: 'Plot 45, Saddar Commercial Area',
          phone: '0321-7654321',
          email: 'saddar@company.com',
          adminName: 'Saddar Manager',
          adminUsername: 'admin2',
          adminPassword: 'Password123!',
          openingCash: 50000,
          openingOnline: 100000
        })
      });
      const provData = await provRes.json();
      assert(provRes.status === 201 && provData.success, 'Branch 2 provisioned successfully');

      // Now verify max-2 rejection when 2 exist
      const prov3Res = await fetch(`${BASE_URL}/super-admin/branches/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          branchName: 'Branch 3 Test',
          branchCode: 'BR-03',
          city: 'Lahore',
          adminUsername: 'admin3',
          adminPassword: 'Password123!'
        })
      });
      assert(prov3Res.status === 400, 'Backend correctly rejects Branch 3 (Max-2 limit enforced)');

      // Clean up Branch 2 for clean test state
      console.log('\n--- 7. Testing Branch 2 Safety Check & Deletion ---');
      const rep2Res = await fetch(`${BASE_URL}/super-admin/reports/consolidated`, { headers });
      const rep2Data = await rep2Res.json();
      const b2 = rep2Data.data.branches.find(b => b.branchCode === 'BR-02');
      assert(!!b2, 'Branch 2 found in consolidated reports');

      if (b2) {
        const safetyRes = await fetch(`${BASE_URL}/super-admin/branches/${b2.branchId}/safety-check`, { headers });
        const safetyData = await safetyRes.json();
        assert(safetyRes.status === 200 && safetyData.success, 'Safety check inspects database counts');

        const delRes = await fetch(`${BASE_URL}/super-admin/branches/${b2.branchId}/delete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            confirmBranchCode: 'BR-02',
            superAdminPassword: 'SuperAdmin@Secure2026!',
            action: 'purge'
          })
        });
        const delData = await delRes.json();
        assert(delRes.status === 200 && delData.success, 'Branch 2 permanently deleted & database disconnected');
      }
    } else {
      console.log('2 branches already active. Verifying Branch 3 rejection...');
      const prov3Res = await fetch(`${BASE_URL}/super-admin/branches/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          branchName: 'Branch 3 Test',
          branchCode: 'BR-03',
          city: 'Lahore',
          adminUsername: 'admin3',
          adminPassword: 'Password123!'
        })
      });
      assert(prov3Res.status === 400, 'Backend correctly rejects Branch 3 (Max-2 limit enforced)');
    }

    // 8. TEST PRIMARY SOLE BRANCH PROTECTION
    console.log('\n--- 8. Testing Primary Anchor Sole Branch Protection ---');
    const soleDelRes = await fetch(`${BASE_URL}/super-admin/branches/${branch1.branchId}/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        confirmBranchCode: branch1.branchCode,
        superAdminPassword: 'SuperAdmin@Secure2026!',
        action: 'purge'
      })
    });
    const soleDelData = await soleDelRes.json();
    assert(soleDelRes.status === 400 && !soleDelData.success, 'System protects sole active branch from deletion');

    // 9. TEST MASTER SUPER ADMIN PASSWORD UPDATE & RESTORE
    console.log('\n--- 9. Testing Master Password Update Workflow ---');
    const pwUpdateRes = await fetch(`${BASE_URL}/super-admin/security/password`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        currentPassword: 'SuperAdmin@Secure2026!',
        newPassword: 'SuperAdmin@Secure2026!Updated'
      })
    });
    const pwUpdateData = await pwUpdateRes.json();
    assert(pwUpdateRes.status === 200 && pwUpdateData.success, 'Master password update succeeds');

    // Revert password back to original standard
    const pwRevertRes = await fetch(`${BASE_URL}/super-admin/security/password`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        currentPassword: 'SuperAdmin@Secure2026!Updated',
        newPassword: 'SuperAdmin@Secure2026!'
      })
    });
    const pwRevertData = await pwRevertRes.json();
    assert(pwRevertRes.status === 200 && pwRevertData.success, 'Master password reverted to standard test credentials');

    // 10. TEST ALL FRONTEND SUPER ADMIN ROUTE STATUS CODES
    console.log('\n--- 10. Testing Next.js Frontend Routes ---');
    const routes = [
      'http://localhost:3000/super-admin',
      'http://localhost:3000/super-admin?tab=branches',
      'http://localhost:3000/super-admin/branches/new',
      'http://localhost:3000/super-admin?tab=delete_branch',
      'http://localhost:3000/super-admin?tab=reports',
      'http://localhost:3000/super-admin?tab=audit_security',
      'http://localhost:3000/dashboard'
    ];

    for (const url of routes) {
      try {
        const r = await fetch(url);
        assert(r.status === 200, `Route: ${url.replace('http://localhost:3000', '')} is 200 OK`);
      } catch (e) {
        assert(false, `Route: ${url} failed with error: ${e.message}`);
      }
    }

    console.log('\n====================================================');
    console.log(`AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    console.error('Audit execution error:', err);
    process.exit(1);
  }
}

runFullAudit();
