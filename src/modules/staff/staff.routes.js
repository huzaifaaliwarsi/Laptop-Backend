const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');

// All staff endpoints require Admin or specific authenticated queries
router.use(authenticateToken);

// GET /api/staff - List staff (Admin sees all, Sales/Tech can get technician list for assignments)
router.get('/', async (req, res, next) => {
  try {
    const { role } = req.query;
    let queryText = 'SELECT id, name, contact, designation, role, username, status, created_at FROM users';
    const params = [];

    if (role) {
      queryText += ' WHERE role = $1';
      params.push(role);
    } else if (req.user.role !== 'admin') {
      // Non-admins can only query active technicians for assignment dropdowns
      queryText += " WHERE role = 'technician' AND status = 'Active'";
    }

    queryText += ' ORDER BY created_at ASC';
    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/staff - Create staff (Admin only)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, contact, designation, role, username, password, status } = req.body;

    if (!name || !username || !password || !role) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Name, role, username and password are required.'
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const existing = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [cleanUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'USERNAME_EXISTS',
        message: 'A user with this username already exists.'
      });
    }

    const staffId = await getNextEntityId('users', 'id', 'EMP', 4);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const insertRes = await db.query(
      `INSERT INTO users (id, name, contact, designation, role, username, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, contact, designation, role, username, status, created_at`,
      [staffId, name.trim(), contact ? contact.trim() : null, designation ? designation.trim() : null, role, cleanUsername, passwordHash, status || 'Active']
    );

    emitEvent('staff.created', insertRes.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Staff user created successfully',
      data: insertRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/staff/:id - Update staff (Admin only)
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, contact, designation, role, username, password, status } = req.body;

    const existing = await db.query('SELECT id, role, username FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Staff member not found.'
      });
    }

    const cleanUsername = username ? String(username).trim().toLowerCase() : existing.rows[0].username;

    // Check if new username conflicts with another user
    if (cleanUsername !== existing.rows[0].username) {
      const dupCheck = await db.query('SELECT id FROM users WHERE LOWER(username) = $1 AND id != $2', [cleanUsername, id]);
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          code: 'USERNAME_EXISTS',
          message: 'Username is already in use by another user.'
        });
      }
    }

    let updateQuery = `
      UPDATE users
      SET name = $1, contact = $2, designation = $3, role = $4, username = $5, status = $6, updated_at = CURRENT_TIMESTAMP
    `;
    const params = [name.trim(), contact ? contact.trim() : null, designation ? designation.trim() : null, role, cleanUsername, status || 'Active'];

    if (password && String(password).trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password.trim(), salt);
      params.push(passwordHash);
      updateQuery += `, password_hash = $${params.length}`;
    }

    params.push(id);
    updateQuery += ` WHERE id = $${params.length} RETURNING id, name, contact, designation, role, username, status, created_at, updated_at`;

    const result = await db.query(updateQuery, params);
    emitEvent('staff.updated', result.rows[0]);

    return res.json({
      success: true,
      message: 'Staff updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/staff/:id/status - Toggle active/inactive status (Admin only)
router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const userRes = await db.query('SELECT id, username FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Staff member not found.'
      });
    }

    if (userRes.rows[0].username === 'admin') {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_DEACTIVATE_SUPERADMIN',
        message: 'Primary Super Admin cannot be deactivated.'
      });
    }

    const newStatus = status || 'Inactive';
    const result = await db.query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, status',
      [newStatus, id]
    );

    emitEvent('staff.status_changed', result.rows[0]);

    return res.json({
      success: true,
      message: `Staff member ${newStatus.toLowerCase()}`,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/staff/:id - Delete staff (Admin only)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const userRes = await db.query('SELECT id, username FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Staff member not found.'
      });
    }

    if (userRes.rows[0].username === 'admin') {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_DELETE_SUPERADMIN',
        message: 'Primary Super Admin cannot be deleted.'
      });
    }

    await db.query('DELETE FROM users WHERE id = $1', [id]);
    emitEvent('staff.deleted', { id });

    return res.json({
      success: true,
      message: 'Staff user deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
