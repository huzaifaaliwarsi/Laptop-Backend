/**
 * Global Staff Identity Registry Service
 * Enforces cross-branch uniqueness for usernames and phone numbers
 * using the Master Database without violating physical branch isolation.
 */

const crypto = require('crypto');
const branchManager = require('../config/branchManager');
const { normalizeUsername, normalizePhone, isValidPhone } = require('../utils/phoneHelper');

/**
 * Custom Conflict Error
 */
class IdentityConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IdentityConflictError';
    this.code = code;
    this.statusCode = 409;
  }
}

/**
 * Scan all registered branch databases for duplicate usernames and phone numbers.
 * @returns {Promise<{duplicatesFound: boolean, conflicts: Array, totalScanned: number, branchStats: Object, allUsers: Array}>}
 */
async function scanIdentityConflicts() {
  const branches = await branchManager.listBranches();
  const allUsers = [];
  const branchStats = {};

  for (const b of branches) {
    branchStats[b.id] = { branchCode: b.branch_code, branchName: b.branch_name, count: 0 };
    try {
      const pool = await branchManager.getBranchPool(b.id, true);
      const res = await pool.query(
        'SELECT id, name, contact, designation, role, username, status FROM users ORDER BY id ASC'
      );
      branchStats[b.id].count = res.rows.length;
      for (const u of res.rows) {
        allUsers.push({
          branchId: b.id,
          branchCode: b.branch_code,
          branchName: b.branch_name,
          userId: u.id,
          rawUsername: u.username,
          normalizedUsername: normalizeUsername(u.username),
          rawContact: u.contact,
          normalizedPhone: normalizePhone(u.contact),
          role: u.role,
          name: u.name,
          status: u.status
        });
      }
    } catch (err) {
      console.error(`[IdentityRegistry] Error scanning branch ${b.id}:`, err.message);
    }
  }

  const conflicts = [];
  const usernameMap = new Map();
  const phoneMap = new Map();

  for (const user of allUsers) {
    // Check username duplicates
    if (user.normalizedUsername) {
      if (usernameMap.has(user.normalizedUsername)) {
        const existing = usernameMap.get(user.normalizedUsername);
        conflicts.push({
          type: 'USERNAME_DUPLICATE',
          conflictingValue: user.normalizedUsername,
          primaryUser: existing,
          conflictingUser: user
        });
      } else {
        usernameMap.set(user.normalizedUsername, user);
      }
    }

    // Check phone duplicates
    if (user.normalizedPhone) {
      if (phoneMap.has(user.normalizedPhone)) {
        const existing = phoneMap.get(user.normalizedPhone);
        conflicts.push({
          type: 'PHONE_DUPLICATE',
          conflictingValue: user.normalizedPhone,
          primaryUser: existing,
          conflictingUser: user
        });
      } else {
        phoneMap.set(user.normalizedPhone, user);
      }
    }
  }

  return {
    duplicatesFound: conflicts.length > 0,
    conflicts,
    totalScanned: allUsers.length,
    branchStats,
    allUsers
  };
}

/**
 * Reserves a staff identity atomically in Master DB before creating in Branch DB.
 * Uses DB UNIQUE constraints as authoritative concurrency arbitrator.
 * 
 * @param {Object} params
 * @param {number} params.branchId
 * @param {string} params.username
 * @param {string|null} params.phone
 * @param {string} params.role
 * @param {string} [params.status='Active']
 * @returns {Promise<{reservationId: number, reservationToken: string, normalizedUsername: string, normalizedPhone: string|null}>}
 */
async function reserveIdentity({ branchId, username, phone, role, status = 'Active' }) {
  const normUsername = normalizeUsername(username);
  if (!normUsername) {
    const err = new Error('Username is required.');
    err.statusCode = 400;
    err.code = 'MISSING_USERNAME';
    throw err;
  }

  const normPhone = normalizePhone(phone);
  if (phone && !normPhone) {
    const err = new Error('Invalid phone number format.');
    err.statusCode = 400;
    err.code = 'INVALID_PHONE';
    throw err;
  }

  const reservationToken = crypto.randomBytes(16).toString('hex');

  try {
    const res = await branchManager.masterPool.query(
      `INSERT INTO master_staff_identities (
        branch_id, branch_user_id, normalized_username, normalized_phone,
        role, status, reservation_token, reservation_status, created_at, updated_at
      ) VALUES (
        $1, NULL, $2, $3,
        $4, $5, $6, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING id`,
      [branchId, normUsername, normPhone, role, status, reservationToken]
    );

    return {
      reservationId: res.rows[0].id,
      reservationToken,
      normalizedUsername: normUsername,
      normalizedPhone: normPhone
    };
  } catch (err) {
    if (err.code === '23505') {
      const detail = String(err.detail || err.message || '');
      if (detail.includes('normalized_phone') || err.constraint === 'uq_master_staff_phone') {
        throw new IdentityConflictError(
          'PHONE_ALREADY_EXISTS',
          'Phone number is already registered in another branch.'
        );
      }
      throw new IdentityConflictError(
        'USERNAME_ALREADY_EXISTS',
        'Username already exists in another branch. Please choose a different username.'
      );
    }
    throw err;
  }
}

/**
 * Finalizes a pending identity reservation by attaching the branch-generated user ID.
 * 
 * @param {Object} params
 * @param {number} params.reservationId
 * @param {string} params.reservationToken
 * @param {string} params.branchUserId
 * @returns {Promise<boolean>}
 */
async function finalizeIdentity({ reservationId, reservationToken, branchUserId }) {
  const res = await branchManager.masterPool.query(
    `UPDATE master_staff_identities
     SET branch_user_id = $1, reservation_status = 'active', reservation_token = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND reservation_token = $3 AND reservation_status = 'pending'
     RETURNING id`,
    [String(branchUserId), reservationId, reservationToken]
  );

  if (res.rows.length === 0) {
    console.error(`[IdentityRegistry] Failed to finalize reservation ${reservationId}: token mismatch or not pending.`);
    return false;
  }
  return true;
}

/**
 * Safely releases ONLY the pending reservation created by this request (compensation on branch DB failure).
 * 
 * @param {Object} params
 * @param {number} params.reservationId
 * @param {string} params.reservationToken
 * @returns {Promise<void>}
 */
async function releaseReservation({ reservationId, reservationToken }) {
  try {
    await branchManager.masterPool.query(
      `DELETE FROM master_staff_identities
       WHERE id = $1 AND reservation_token = $2 AND reservation_status = 'pending'`,
      [reservationId, reservationToken]
    );
    console.log(`[IdentityRegistry] Released pending reservation ${reservationId}`);
  } catch (err) {
    console.error(`[IdentityRegistry] Error releasing pending reservation ${reservationId}:`, err.message);
  }
}

/**
 * Updates an existing staff identity in Master DB with self-exclusion conflict validation.
 * 
 * @param {Object} params
 * @param {number} params.branchId
 * @param {string} params.branchUserId
 * @param {string} [params.currentUsername] - Username before update (for exact identity resolution)
 * @param {string} params.username - New or current username
 * @param {string|null} params.phone - New or current phone
 * @param {string} params.role
 * @param {string} [params.status='Active']
 * @returns {Promise<{updatedIdentity: Object, previousIdentity: Object}>}
 */
async function updateIdentity({ branchId, branchUserId, currentUsername, username, phone, role, status = 'Active' }) {
  const normUsername = normalizeUsername(username);
  if (!normUsername) {
    const err = new Error('Username is required.');
    err.statusCode = 400;
    err.code = 'MISSING_USERNAME';
    throw err;
  }

  const normCurrentUsername = normalizeUsername(currentUsername || username);

  const normPhone = normalizePhone(phone);
  if (phone && !normPhone) {
    const err = new Error('Invalid phone number format.');
    err.statusCode = 400;
    err.code = 'INVALID_PHONE';
    throw err;
  }

  // 1. Find existing record in Master DB
  const curRes = await branchManager.masterPool.query(
    `SELECT * FROM master_staff_identities 
     WHERE (branch_id = $1 AND normalized_username = $2)
        OR (branch_id = $1 AND branch_user_id = $3)
     ORDER BY (normalized_username = $2) DESC
     LIMIT 1`,
    [branchId, normCurrentUsername, String(branchUserId)]
  );
  const previousIdentity = curRes.rows[0] || null;
  const excludeId = previousIdentity ? previousIdentity.id : -1;

  // 2. Pre-check conflict excluding self
  const userCheck = await branchManager.masterPool.query(
    `SELECT id FROM master_staff_identities 
     WHERE normalized_username = $1 AND id != $2`,
    [normUsername, excludeId]
  );
  if (userCheck.rows.length > 0) {
    throw new IdentityConflictError(
      'USERNAME_ALREADY_EXISTS',
      'Username already exists in another branch. Please choose a different username.'
    );
  }

  if (normPhone) {
    const phoneCheck = await branchManager.masterPool.query(
      `SELECT id FROM master_staff_identities 
       WHERE normalized_phone = $1 AND id != $2`,
      [normPhone, excludeId]
    );
    if (phoneCheck.rows.length > 0) {
      throw new IdentityConflictError(
        'PHONE_ALREADY_EXISTS',
        'Phone number is already registered in another branch.'
      );
    }
  }

  // 3. Atomically upsert/update identity in Master DB
  let res;
  if (previousIdentity) {
    res = await branchManager.masterPool.query(
      `UPDATE master_staff_identities
       SET branch_user_id = $1, normalized_username = $2, normalized_phone = $3, role = $4, status = $5, reservation_status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [String(branchUserId), normUsername, normPhone, role, status, previousIdentity.id]
    );
  } else {
    res = await branchManager.masterPool.query(
      `INSERT INTO master_staff_identities (
        branch_id, branch_user_id, normalized_username, normalized_phone,
        role, status, reservation_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING *`,
      [branchId, String(branchUserId), normUsername, normPhone, role, status]
    );
  }

  return {
    updatedIdentity: res.rows[0],
    previousIdentity
  };
}

/**
 * Restores previous identity values if Branch DB update failed (update compensation).
 * 
 * @param {Object} params
 * @param {number} params.branchId
 * @param {string} params.branchUserId
 * @param {Object} params.previousIdentity
 * @returns {Promise<void>}
 */
async function restoreIdentity({ branchId, branchUserId, previousIdentity }) {
  if (!previousIdentity) return;
  try {
    await branchManager.masterPool.query(
      `UPDATE master_staff_identities
       SET normalized_username = $1, normalized_phone = $2, role = $3, status = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [
        previousIdentity.normalized_username,
        previousIdentity.normalized_phone,
        previousIdentity.role,
        previousIdentity.status,
        previousIdentity.id
      ]
    );
    console.log(`[IdentityRegistry] Compensated & restored previous identity for ${branchUserId} in Branch ${branchId}`);
  } catch (err) {
    console.error(`[IdentityRegistry CRITICAL] Failed to restore identity for ${branchUserId}:`, err.message);
  }
}

/**
 * Sets identity status (e.g. Active, Inactive, Deleted) while preserving reservation.
 * 
 * @param {Object} params
 * @param {number} params.branchId
 * @param {string} params.branchUserId
 * @param {string} params.status
 * @returns {Promise<void>}
 */
async function setIdentityStatus({ branchId, branchUserId, status }) {
  try {
    await branchManager.masterPool.query(
      `UPDATE master_staff_identities
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE branch_id = $2 AND branch_user_id = $3`,
      [status, branchId, String(branchUserId)]
    );
  } catch (err) {
    console.error(`[IdentityRegistry] Error updating status for ${branchUserId}:`, err.message);
  }
}

/**
 * Unambiguously resolves an identity by normalized username for login routing.
 * 
 * @param {string} username
 * @returns {Promise<Object|null>} returns identity or { ambiguous: true } or null
 */
async function resolveIdentityByUsername(username) {
  const normUsername = normalizeUsername(username);
  if (!normUsername) return null;

  const res = await branchManager.masterPool.query(
    `SELECT id, branch_id, branch_user_id, normalized_username, normalized_phone, role, status, reservation_status
     FROM master_staff_identities
     WHERE normalized_username = $1`,
    [normUsername]
  );

  if (res.rows.length === 0) {
    return null;
  }

  if (res.rows.length > 1) {
    console.error(`[IdentityRegistry SECURITY ALERT] Ambiguous identity resolution detected for username "${normUsername}". Count: ${res.rows.length}`);
    return {
      ambiguous: true,
      count: res.rows.length,
      identities: res.rows
    };
  }

  return res.rows[0];
}

module.exports = {
  scanIdentityConflicts,
  reserveIdentity,
  finalizeIdentity,
  releaseReservation,
  updateIdentity,
  restoreIdentity,
  setIdentityStatus,
  resolveIdentityByUsername,
  IdentityConflictError
};
