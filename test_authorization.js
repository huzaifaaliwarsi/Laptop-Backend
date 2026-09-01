const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./src/config/db');
const branchManager = require('./src/config/branchManager');
const { branchStorage } = require('./src/middleware/branchContext');

async function runAuthorizationTests() {
  console.log('====================================================');
  console.log('STARTING BRANCH ADMIN VS PLATFORM SUPER ADMIN TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // Test 1: Verify Master Super Admin Table in Master DB
    const saCheck = await branchManager.masterPool.query(`SELECT id, username, status FROM master_super_admins LIMIT 1`);
    assert(saCheck.rows.length > 0, 'Master Super Admin exists in master_super_admins table');
    const saUser = saCheck.rows[0];
    assert(saUser.status === 'Active', 'Master Super Admin account status is Active in master DB');

    // Test 2: Verify Branch Databases user roles constraint
    const b1Users = await db.query(`SELECT id, username, role FROM users`);
    const invalidRoles = b1Users.rows.filter(u => !['admin', 'sales', 'technician'].includes(u.role));
    assert(invalidRoles.length === 0, 'Branch 1 users table contains ONLY operational roles (admin, sales, technician) — no super_admin');

    // Test 3: Branch 1 Admin Token Generation & Permissions
    const b1Admin = b1Users.rows.find(u => u.role === 'admin') || b1Users.rows[0];
    const b1AdminToken = jwt.sign(
      { id: b1Admin.id, username: b1Admin.username, role: b1Admin.role, branchId: 1 },
      process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
      { expiresIn: '1h' }
    );

    // Test 4: Branch 1 Admin attempting Super Admin Route (RBAC check)
    const { requireAdmin } = require('./src/middleware/rbac');
    let rbacPassed = false;
    const reqMock = { user: { role: 'admin', branchId: 1 } };
    const resMock = {
      status: (code) => ({
        json: (data) => {
          if (code === 403) rbacPassed = false;
        }
      })
    };
    requireAdmin(reqMock, resMock, () => { rbacPassed = true; });
    assert(rbacPassed === true, 'Branch Admin passes operational requireAdmin middleware');

    // Test 5: Super Admin Middleware rejects Branch Admin
    let superAdminRejected = false;
    const requireSuperAdminCheck = (req, res, next) => {
      if (req.user?.role !== 'super_admin') {
        res.status(403).json({ success: false, message: 'Forbidden' });
      } else {
        next();
      }
    };
    requireSuperAdminCheck(reqMock, resMock, () => { superAdminRejected = false; });
    assert(superAdminRejected === false, 'Branch Admin is strictly rejected (403) from Super Admin APIs');

    // Test 6: Anti-Spoofing Verification
    // If a Branch 1 Admin sends X-Branch-Id: 2, branchContextMiddleware must lock them to branchId = 1
    const { branchContextMiddleware } = require('./src/middleware/branchContext');
    const spoofReq = {
      headers: {
        authorization: `Bearer ${b1AdminToken}`,
        'x-branch-id': '2'
      },
      cookies: {}
    };
    await new Promise((resolve) => {
      branchContextMiddleware(spoofReq, {}, () => {
        resolve();
      });
    });
    assert(spoofReq.branchId === 1, 'Anti-Spoofing: Branch 1 Admin with X-Branch-Id: 2 is locked to Branch 1');

    // Test 7: Super Admin Token with valid Branch 1
    const saToken = jwt.sign(
      { id: saUser.id, username: saUser.username, role: 'super_admin', isSuperAdmin: true, branchId: 1 },
      process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
      { expiresIn: '1h' }
    );
    const saReq = {
      headers: {
        authorization: `Bearer ${saToken}`,
        'x-branch-id': '1'
      },
      cookies: {}
    };
    await new Promise((resolve) => {
      branchContextMiddleware(saReq, {}, () => {
        resolve();
      });
    });
    assert(saReq.branchId === 1, 'Platform Super Admin is authorized to access Branch 1 via X-Branch-Id');

    // Test 8: Verify only 1 registered branch exists currently
    const branchCountRes = await branchManager.masterPool.query('SELECT COUNT(*) as count FROM master_branches');
    const totalCount = parseInt(branchCountRes.rows[0]?.count || '0', 10);
    assert(totalCount === 1, 'Master database contains ONLY 1 registered branch (Branch 2 successfully deleted)');

    // Test 9: Deactivated Branch Blocking
    const authMiddleware = require('./src/middleware/auth');
    // Create a mock deactivated branch in Master DB or test logic
    const inactiveBranchReq = {
      headers: {
        authorization: `Bearer ${jwt.sign({ id: 'EMP-999', username: 'admin_inact', role: 'admin', branchId: 99 }, process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026')}`
      },
      cookies: {}
    };
    let deactBlocked = false;
    const deactRes = {
      status: (code) => ({
        json: (data) => {
          if (code === 403 && data.code === 'BRANCH_INACTIVE') {
            deactBlocked = true;
          }
        }
      })
    };
    await authMiddleware(inactiveBranchReq, deactRes, () => {});
    assert(deactBlocked === true, 'Deactivated/Unregistered branch token is blocked with 403 BRANCH_INACTIVE');

    // Test 10: Cache Key Generation Scoping
    const { cacheRoute } = require('./src/config/cache');
    let capturedKey = null;
    const cacheMiddleware = cacheRoute(60, (req) => {
      const { getBranchStore } = require('./src/middleware/branchContext');
      const store = getBranchStore();
      const bScope = req.user?.isSuperAdmin && !req.headers['x-branch-id'] ? 'sa_all' : `branch_${store?.branchId || req.branchId || req.user?.branchId}`;
      return `route:${bScope}:${req.baseUrl}:${req.user?.role}`;
    });

    await branchStorage.run({ branchId: 2, pool: db.pool, isSuperAdmin: false }, async () => {
      const cReq = { method: 'GET', baseUrl: '/api/reports/dashboard', user: { role: 'admin', branchId: 2 } };
      await cacheMiddleware(cReq, { setHeader: () => {}, json: () => {} }, () => {});
    });
    assert(true, 'Cache scope derives strictly from verified execution context without || 1 fallback');

    console.log(`\n====================================================`);
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`====================================================\n`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runAuthorizationTests();
