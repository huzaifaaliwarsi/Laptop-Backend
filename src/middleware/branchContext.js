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
      // Super Admin is authorized to explicitly select branch via X-Branch-Id header
      if (req.headers['x-branch-id']) {
        const headerBId = parseInt(req.headers['x-branch-id'], 10);
        if (!isNaN(headerBId) && headerBId > 0) {
          branchId = headerBId;
        }
      }
    } else if (decoded && decoded.branchId) {
      // Normal Branch User (admin, sales, technician) is LOCKED to their token's branchId
      branchId = parseInt(decoded.branchId, 10) || 1;
    } else if (req.headers['x-branch-id']) {
      // Unauthenticated request (e.g. login attempt with explicit branch selection)
      const headerBId = parseInt(req.headers['x-branch-id'], 10);
      if (!isNaN(headerBId) && headerBId > 0) {
        branchId = headerBId;
      }
    }

    // 3. Acquire Branch Pool from trusted Master Registry
    const pool = await branchManager.getBranchPool(branchId, isSuperAdmin);
    req.branchId = branchId;

    // 4. Run downstream handlers within AsyncLocalStorage context
    branchStorage.run({ branchId, pool, isSuperAdmin }, () => {
      next();
    });
  } catch (err) {
    // If Super Admin request failed to connect to specific branch, try fallback pool
    if (req.headers['x-branch-id'] && req.headers.authorization) {
      try {
        const fallbackPool = await branchManager.getBranchPool(1, true);
        req.branchId = 1;
        return branchStorage.run({ branchId: 1, pool: fallbackPool, isSuperAdmin: true }, () => {
          next();
        });
      } catch (fallbackErr) {
        return next(err);
      }
    }
    // For normal branch users, pass error to errorHandler/auth middleware
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
