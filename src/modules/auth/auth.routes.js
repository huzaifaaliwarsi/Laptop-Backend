const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');

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

    const cleanUsername = String(username).trim().toLowerCase();
    const userRes = await db.query(
      `SELECT id, name, contact, designation, role, username, password_hash, status FROM users WHERE LOWER(username) = $1`,
      [cleanUsername]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.'
      });
    }

    const user = userRes.rows[0];

    if (user.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account is inactive. Please contact an administrator.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.'
      });
    }

    if (portal && user.role !== portal) {
      const correctPortal = user.role === 'admin' ? 'Admin Portal' : user.role === 'sales' ? 'Sales Staff Portal' : 'Technician Portal';
      return res.status(400).json({
        success: false,
        code: 'PORTAL_MISMATCH',
        message: `This account belongs to ${correctPortal}. Please select the correct portal to login.`,
      });
    }


    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
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
        user: {
          id: user.id,
          name: user.name,
          contact: user.contact,
          designation: user.designation,
          role: user.role,
          username: user.username
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
        user: userRes.rows[0]
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
