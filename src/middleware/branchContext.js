const { AsyncLocalStorage } = require('async_hooks');
const branchManager = require('../config/branchManager');
const jwt = require('jsonwebtoken');

const branchStorage = new AsyncLocalStorage();

/**
 * Middleware that establishes the active Branch DB connection pool for the request.
 * Enforces strict anti-spoofing: normal branch users can NEVER access another branch's DB.
 */
async function branchContextMiddleware(req, res, next) {
  try {
    await require('../config/db').ready;
    let branchId = 1;
    let isSuperAdmin = false;
    let token = null;


    // 1. Extract JWT token if present
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    let decoded = null;
    if (token) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026');
        if (decoded && decoded.role === 'super_admin') {
          isSuperAdmin = true;
        }
      } catch (e) {
        // Expired or invalid token — will be caught by auth middleware if route is protected
      }
    }

    // 2. Branch Resolution with Anti-Spoofing Rules
    if (isSuperAdmin) {
      // Super Admin is authorized to explicitly select branch via X-Branch-Id header or query
      const targetB = req.headers['x-branch-id'] || req.headers['x-branch_id'] || req.query?.branchId || req.query?.branch_id;
      if (targetB) {
        const headerBId = Number(targetB);
        if (!isNaN(headerBId) && headerBId > 0) {
          branchId = headerBId;
        }
      }
    } else if (decoded) {
      // Normal Branch User (admin, sales, technician) is LOCKED to their token's branchId
      branchId = Number(decoded.branchId || 1);
    } else {
      const targetB = req.headers['x-branch-id'] || req.headers['x-branch_id'] || req.query?.branchId || req.query?.branch_id;
      if (targetB) {
        const headerBId = Number(targetB);
        if (!isNaN(headerBId) && headerBId > 0) {
          branchId = headerBId;
        }
      }
    }

    // Ignore client-supplied branch ownership.
    if (req.body && typeof req.body === 'object') {
      delete req.body.branch_id;
      req.body.branchId = branchId;
    }
    // 3. Acquire Branch Pool from trusted Master Registry
    const isLogin = ['/api/auth/login', '/api/super-admin/login'].includes(req.path);
    const pool = await branchManager.getBranchPool(branchId, isSuperAdmin || isLogin);
    req.branchId = branchId;

    // 4. Run downstream handlers within AsyncLocalStorage context
    branchStorage.run({ branchId, pool, isSuperAdmin }, () => {
      next();
    });
  } catch (err) {

    next(err);
  }
}

/**
 * Get active branch store from current async execution context
 */
function getBranchStore() {
  return branchStorage.getStore() || null;
}

module.exports = {
  branchStorage,
  branchContextMiddleware,
  getBranchStore
};
