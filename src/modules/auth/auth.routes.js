const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const identityRegistry = require('../../services/identityRegistry');
const { normalizeUsername } = require('../../utils/phoneHelper');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password, portal } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: 'Username and password are required.'
      });
    }

    const cleanUsername = normalizeUsername(username);
    const branchManager = require('../../config/branchManager');

    // 1. Check Master Super Admin in master_super_admins table
    const saRes = await branchManager.masterPool.query(
      `SELECT id, username, password_hash, name, email, status FROM master_super_admins WHERE LOWER(username) = $1 LIMIT 1`,
      [cleanUsername]
    );

    if (saRes.rows.length > 0) {
      const sa = saRes.rows[0];
      if (sa.status === 'Inactive') {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_INACTIVE',
          message: 'This Super Admin account is inactive.'
        });
      }

      const isMatch = await bcrypt.compare(password, sa.password_hash);
      if (isMatch) {
        const branches = await branchManager.listBranches();
        const primaryBranch = branches[0] || { id: 1, branch_code: 'BR-01', branch_name: 'Saad Communication (Main Branch)' };

        const token = jwt.sign(
          {
            id: sa.id,
            username: sa.username,
            name: sa.name,
            role: 'super_admin',
            isSuperAdmin: true,
            branchId: primaryBranch.id || 1
          },
          process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
          { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
          success: true,
          message: 'Super Admin login successful',
          data: {
            token,
            branch: primaryBranch,
            user: {
              id: sa.id,
              name: sa.name,
              username: sa.username,
              email: sa.email,
              role: 'super_admin',
              isSuperAdmin: true
            }
          }
        });
      }
    }

    // 2. Resolve staff identity globally from Master Registry (unambiguous routing)
    const identity = await identityRegistry.resolveIdentityByUsername(cleanUsername);

    if (!identity) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.'
      });
    }

    if (identity.ambiguous) {
      console.error(`[Auth Security Alert] Ambiguous identity detected for "${cleanUsername}". Login rejected.`);
      return res.status(409).json({
        success: false,
        code: 'IDENTITY_RESOLUTION_REQUIRED',
        message: 'Ambiguous user identity detected across branches. Please contact Platform Super Admin.'
      });
    }

    // 3. Resolve target physical branch database
    const branchId = identity.branch_id;
    const branchMeta = await branchManager.getBranchById(branchId);

    if (!branchMeta || branchMeta.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        code: 'BRANCH_INACTIVE',
        message: `Branch "${branchMeta?.branch_name || branchId}" is currently inactive. Please contact Platform Super Admin.`
      });
    }

    // 4. Fetch user from target branch database and verify credentials
    const branchPool = await branchManager.getBranchPool(branchId, true);
    const userRes = await branchPool.query(
      `SELECT id, name, contact, designation, role, username, password_hash, status 
       FROM users 
       WHERE LOWER(username) = $1 OR (id = $2 AND $2 IS NOT NULL)
       LIMIT 1`,
      [cleanUsername, identity.branch_user_id]
    );

    if (userRes.rows.length === 0) {
      console.warn(`[Auth Inconsistency] Master identity found for ${cleanUsername} in Branch ${branchId} but user not found in branch DB.`);
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.'
      });
    }

    const matchedUser = userRes.rows[0];

    if (matchedUser.status === 'Inactive' || identity.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account is inactive. Please contact an administrator.'
      });
    }

    const isMatch = await bcrypt.compare(password, matchedUser.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.'
      });
    }

    if (portal && matchedUser.role !== portal) {
      const correctPortal = matchedUser.role === 'admin' ? 'Admin Portal' : matchedUser.role === 'sales' ? 'Sales Staff Portal' : 'Technician Portal';
      return res.status(400).json({
        success: false,
        code: 'PORTAL_MISMATCH',
        message: `This account belongs to ${correctPortal}. Please select the correct portal to login.`,
      });
    }

    const token = jwt.sign(
      { id: matchedUser.id, username: matchedUser.username, role: matchedUser.role, branchId },
      process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        branch: branchMeta,
        user: {
          id: matchedUser.id,
          name: matchedUser.name,
          contact: matchedUser.contact,
          designation: matchedUser.designation,
          role: matchedUser.role,
          username: matchedUser.username,
          branchId
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// GET /api/auth/me - Graceful session check (returns 200 with user: null if unauthenticated)
router.get('/me', async (req, res) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.json({
        success: true,
        data: { user: null }
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026');

    const branchManager = require('../../config/branchManager');
    const activeBranch = await branchManager.getBranchById(req.branchId || decoded.branchId || 1);

    // Handle Super Admin session check
    if (decoded.role === 'super_admin') {
      const saRes = await branchManager.masterPool.query(
        'SELECT id, username, name, email, status FROM master_super_admins WHERE id = $1',
        [decoded.id]
      );
      if (saRes.rows.length === 0 || saRes.rows[0].status === 'Inactive') {
        return res.json({ success: true, data: { user: null } });
      }
      return res.json({
        success: true,
        data: {
          user: {
            ...saRes.rows[0],
            role: 'super_admin',
            isSuperAdmin: true
          },
          branch: activeBranch || { id: 1, branch_code: 'BR-01', branch_name: 'Main Branch (Branch 1)' }
        }
      });
    }

    const userRes = await db.query(
      'SELECT id, name, contact, designation, role, username, status FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userRes.rows.length === 0 || userRes.rows[0].status === 'Inactive') {
      return res.json({
        success: true,
        data: { user: null }
      });
    }

    return res.json({
      success: true,
      data: {
        user: userRes.rows[0],
        branch: activeBranch || { id: 1, branch_code: 'BR-01', branch_name: 'Main Branch (Branch 1)' }
      }
    });
  } catch (error) {
    return res.json({
      success: true,
      data: { user: null }
    });
  }
});

module.exports = router;
