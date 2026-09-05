const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');
const identityRegistry = require('../../services/identityRegistry');
const { normalizeUsername, normalizePhone, isValidPhone } = require('../../utils/phoneHelper');
const { CacheService, cacheRoute, getBranchIdFromReq } = require('../../config/cache');

// All staff endpoints require Admin or specific authenticated queries
router.use(authenticateToken);

// GET /api/staff - List staff (Admin sees all, Sales/Tech can get technician list for assignments) (Cached 120s)
router.get('/', cacheRoute(120), async (req, res, next) => {
  try {
    const { role } = req.query;
    let queryText = 'SELECT id, name, contact, designation, role, username, status, created_at FROM users';
    const params = [];

    if (role) {
      queryText += ' WHERE role = $1';
      params.push(role);
    } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
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

// POST /api/staff - Create staff (Admin only, concurrency-safe global uniqueness)
router.post('/', requireAdmin, async (req, res, next) => {
  let reservation = null;
  try {
    const { name, contact, phone, designation, role, username, password, status } = req.body;
    const staffContact = contact !== undefined ? contact : phone;

    if (!name || !username || !password || !role) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Name, role, username and password are required.'
      });
    }

    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_USERNAME',
        message: 'Valid username is required.'
      });
    }

    if (staffContact && !isValidPhone(staffContact)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PHONE',
        message: 'Please provide a valid phone number (e.g. 03001234567).'
      });
    }

    const branchId = req.user?.branchId || req.branchId || 1;

    // STEP 0: Immediate local branch database check to prevent duplicate username or phone
    const localConflict = await db.query(
      `SELECT id, username, contact FROM users 
       WHERE LOWER(username) = $1 
          OR (contact IS NOT NULL AND contact != '' AND contact = $2)
       LIMIT 1`,
      [cleanUsername, staffContact ? String(staffContact).trim() : '___NO_PHONE___']
    );
    if (localConflict.rows.length > 0) {
      const match = localConflict.rows[0];
      if (match.username && match.username.toLowerCase() === cleanUsername) {
        return res.status(409).json({
          success: false,
          code: 'USERNAME_ALREADY_EXISTS',
          message: 'This user already exists: Username is already taken. Please choose a different username.'
        });
      }
      if (staffContact && match.contact && match.contact === String(staffContact).trim()) {
        return res.status(409).json({
          success: false,
          code: 'PHONE_ALREADY_EXISTS',
          message: 'This user already exists: Phone number is already registered with another staff member.'
        });
      }
    }

    // STEP 1: Reserve identity globally in Master DB using atomic UNIQUE constraints
    try {
      reservation = await identityRegistry.reserveIdentity({
        branchId,
        username: cleanUsername,
        phone: staffContact,
        role,
        status: status || 'Active'
      });
    } catch (regErr) {
      if (regErr.statusCode === 409) {
        return res.status(409).json({
          success: false,
          code: regErr.code,
          message: regErr.message || (regErr.code === 'PHONE_ALREADY_EXISTS'
            ? 'This user already exists: Phone number is already registered with another staff member.'
            : 'This user already exists: Username is already taken. Please choose a different username.')
        });
      }
      throw regErr;
    }

    // STEP 2: Create user in active physical Branch DB
    try {
      const staffId = await getNextEntityId('users', 'id', 'EMP', 4);
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const insertRes = await db.query(
        `INSERT INTO users (id, name, contact, designation, role, username, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, contact, designation, role, username, status, created_at`,
        [
          staffId,
          name.trim(),
          reservation.normalizedPhone || (staffContact ? String(staffContact).trim() : null),
          designation ? designation.trim() : null,
          role,
          cleanUsername,
          passwordHash,
          status || 'Active'
        ]
      );

      // STEP 3: Finalize Master identity with branch_user_id
      await identityRegistry.finalizeIdentity({
        reservationId: reservation.reservationId,
        reservationToken: reservation.reservationToken,
        branchUserId: staffId
      });

      await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/staff*');
      emitEvent('staff.created', insertRes.rows[0]);

      return res.status(201).json({
        success: true,
        message: 'Staff user created successfully',
        data: insertRes.rows[0]
      });
    } catch (branchDbErr) {
      // Compensation: Release pending Master reservation on Branch DB failure
      if (reservation) {
        await identityRegistry.releaseReservation({
          reservationId: reservation.reservationId,
          reservationToken: reservation.reservationToken
        });
      }
      if (branchDbErr.code === '23505') {
        const detail = String(branchDbErr.detail || branchDbErr.message || '');
        if (detail.includes('contact') || branchDbErr.constraint?.includes('contact')) {
          return res.status(409).json({
            success: false,
            code: 'PHONE_ALREADY_EXISTS',
            message: 'This user already exists: Phone number is already registered with another staff member.'
          });
        }
        return res.status(409).json({
          success: false,
          code: 'USERNAME_ALREADY_EXISTS',
          message: 'This user already exists: Username is already taken. Please choose a different username.'
        });
      }
      throw branchDbErr;
    }
  } catch (error) {
    next(error);
  }
});

// PUT /api/staff/:id - Update staff (Admin only, concurrency-safe global uniqueness)
router.put('/:id', requireAdmin, async (req, res, next) => {
  let updateResult = null;
  const branchId = req.user?.branchId || req.branchId || 1;
  const { id } = req.params;

  try {
    const { name, contact, phone, designation, role, username, password, status } = req.body;

    const existing = await db.query('SELECT id, role, username, contact, status FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Staff member not found.'
      });
    }

    const cleanUsername = username ? normalizeUsername(username) : existing.rows[0].username;
    const targetContact = contact !== undefined ? contact : (phone !== undefined ? phone : existing.rows[0].contact);

    if (targetContact && !isValidPhone(targetContact)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PHONE',
        message: 'Please provide a valid phone number.'
      });
    }

    // STEP 1: Attempt atomic Master Registry update (with self-exclusion)
    try {
      updateResult = await identityRegistry.updateIdentity({
        branchId,
        branchUserId: id,
        currentUsername: existing.rows[0].username,
        username: cleanUsername,
        phone: targetContact,
        role: role || existing.rows[0].role,
        status: status || existing.rows[0].status || 'Active'
      });
    } catch (regErr) {
      if (regErr.statusCode === 409) {
        return res.status(409).json({
          success: false,
          code: regErr.code,
          message: regErr.message
        });
      }
      throw regErr;
    }

    // STEP 2: Update Branch DB user record
    try {
      let updateQuery = `
        UPDATE users
        SET name = $1, contact = $2, designation = $3, role = $4, username = $5, status = $6, updated_at = CURRENT_TIMESTAMP
      `;
      const params = [
        name ? name.trim() : existing.rows[0].name,
        updateResult.updatedIdentity.normalized_phone || (targetContact ? targetContact.trim() : null),
        designation ? designation.trim() : null,
        role || existing.rows[0].role,
        cleanUsername,
        status || existing.rows[0].status || 'Active'
      ];

      if (password && String(password).trim() !== '') {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password.trim(), salt);
        params.push(passwordHash);
        updateQuery += `, password_hash = $${params.length}`;
      }

      params.push(id);
      updateQuery += ` WHERE id = $${params.length} RETURNING id, name, contact, designation, role, username, status, created_at, updated_at`;

      const result = await db.query(updateQuery, params);
      await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/staff*');
      emitEvent('staff.updated', result.rows[0]);

      return res.json({
        success: true,
        message: 'Staff updated successfully',
        data: result.rows[0]
      });
    } catch (branchDbErr) {
      // Compensation: Restore previous Master Registry values on Branch DB failure
      if (updateResult && updateResult.previousIdentity) {
        await identityRegistry.restoreIdentity({
          branchId,
          branchUserId: id,
          previousIdentity: updateResult.previousIdentity
        });
      }
      throw branchDbErr;
    }
  } catch (error) {
    next(error);
  }
});

// PATCH /api/staff/:id/status - Toggle active/inactive status (Admin only)
router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const branchId = req.user?.branchId || req.branchId || 1;

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
        code: 'CANNOT_DEACTIVATE_ADMIN',
        message: 'Primary Branch Administrator cannot be deactivated.'
      });
    }

    const newStatus = status || 'Inactive';
    const result = await db.query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, status',
      [newStatus, id]
    );

    // Sync status with Master Identity Registry while preserving reservation
    await identityRegistry.setIdentityStatus({
      branchId,
      branchUserId: id,
      status: newStatus
    });

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/staff*');
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

// router.delete('/:id', requireAdmin, async (req, res, next) => {
//   try {
//     const { id } = req.params;
//     const branchId = req.user?.branchId || req.branchId || 1;

//     const userRes = await db.query('SELECT id, username FROM users WHERE id = $1', [id]);
//     if (userRes.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         code: 'NOT_FOUND',
//         message: 'Staff member not found.'
//       });
//     }

//     if (userRes.rows[0].username === 'Admin') {
//       return res.status(400).json({
//         success: false,
//         code: 'CANNOT_DELETE_ADMIN',
//         message: 'Primary Branch Administrator cannot be deleted.'
//       });
//     }

//     await db.query('DELETE FROM users WHERE id = $1', [id]);

//     // Mark as Deleted in Master Identity Registry while preserving username/phone reservation
//     await identityRegistry.setIdentityStatus({
//       branchId,
//       branchUserId: id,
//       status: 'Deleted'
//     });

//     await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/staff*');
//     emitEvent('staff.deleted', { id });

//     return res.json({
//       success: true,
//       message: 'Staff user deleted successfully'
//     });
//   } catch (error) {
//     next(error);
//   }
// });



router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = req.user?.branchId || req.branchId || 1;
    const loggedInUserId = req.user?.id; // Current session user ID

    // 🛑 FIX 1: Prevent self-deletion directly via session state context
    if (String(id).trim() === String(loggedInUserId).trim()) {
      return res.status(400).json({
        success: false,
        code: 'SELF_DELETION_PROHIBITED',
        message: 'admin can not be deleted!'
      });
    }

    // 🛑 FIX 2: Added designation to select layout (PostgreSQL returns lowercase)
    const userRes = await db.query('SELECT id, username, designation FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Staff member not found.'
      });
    }

    // 🛑 FIX 3: Safe lower-case mapping object evaluation
    const targetUser = userRes.rows[0];
    if (targetUser.designation === 'System Administrator') {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_DELETE_ADMIN',
        message: 'Primary Branch Administrator cannot be deleted.'
      });
    }

    // Hard purge execution block 
    await db.query('DELETE FROM users WHERE id = $1', [id]);

    // Mark as Deleted in Master Identity Registry while preserving username/phone reservation
    await identityRegistry.setIdentityStatus({
      branchId,
      branchUserId: id,
      status: 'Deleted'
    });

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/staff*');
    emitEvent('staff.deleted', { id });

    return res.json({
      success: true,
      message: 'Staff user deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});


module.exports = router