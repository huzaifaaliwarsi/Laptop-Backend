const jwt = require('jsonwebtoken');
const db = require('../config/db');

const authenticateToken = async (req, res, next) => {
  try {
    let token = null;

    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please login.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026');
    
    const branchManager = require('../config/branchManager');

    // Handle Super Admin
    if (decoded.role === 'super_admin') {
      const saRes = await branchManager.masterPool.query(
        'SELECT id, username, name, email, status FROM master_super_admins WHERE id = $1',
        [decoded.id]
      );
      if (saRes.rows.length === 0 || saRes.rows[0].status === 'Inactive') {
        return res.status(401).json({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'Super Admin account no longer exists or is inactive.'
        });
      }
      req.user = {
        ...saRes.rows[0],
        role: 'super_admin',
        isSuperAdmin: true
      };
      return next();
    }

    // Verify branch status in Master DB
    const branchId = parseInt(decoded.branchId, 10) || 1;
    const branch = await branchManager.getBranchById(branchId);
    if (!branch || branch.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        code: 'BRANCH_INACTIVE',
        message: `Branch "${branch?.branch_name || branchId}" is currently inactive. Please contact Platform Super Admin.`
      });
    }

    // Check if branch user still exists and is active in branch DB
    const userRes = await db.query('SELECT id, name, contact, designation, role, username, status FROM users WHERE id = $1', [decoded.id]);
    
    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'User account no longer exists.'
      });
    }

    const user = userRes.rows[0];

    if (user.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    req.user = {
      ...user,
      branchId
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Session has expired. Please login again.'
      });
    }
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid session token. Please login again.'
    });
  }
};

module.exports = authenticateToken;
