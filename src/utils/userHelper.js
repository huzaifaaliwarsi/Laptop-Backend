/**
 * Resolve database-safe user identity for branch database operations.
 * When Super Admin operates within a branch, created_by foreign key should be NULL
 * (or local user ID if mapped), while created_by_name holds the authoritative Super Admin label.
 */
function getCreator(user) {
  const isSuper = user?.role === 'super_admin' || user?.isSuperAdmin || user?.id === 1 || user?.id === '1' || user?.id === 0 || user?.id === '0';
  return {
    id: isSuper ? null : (user?.id || null),
    name: user?.name || (isSuper ? 'Platform Super Admin' : (user?.username || 'Staff'))
  };
}

/**
 * Async database-verified creator resolver.
 * Checks whether user.id actually exists in the target branch's `users` table.
 * If not (e.g. Super Admin id: 1, cross-branch user, or non-existent user),
 * safely returns id: null to prevent FOREIGN_KEY_VIOLATION on created_by / voided_by.
 */
async function resolveSafeCreator(user, branchId, client) {
  const isSuper = user?.role === 'super_admin' || user?.isSuperAdmin || user?.id === 1 || user?.id === '1' || user?.id === 0 || user?.id === '0';
  let validUserId = null;
  let validUserName = user?.name || (isSuper ? 'Platform Super Admin' : (user?.username || 'Staff'));

  if (!isSuper && user?.id) {
    try {
      const q = client ? client.query.bind(client) : require('../config/db').query;
      const bId = branchId !== undefined && branchId !== null ? branchId : (user?.branchId || 1);
      const uRes = await q('SELECT id, name FROM users WHERE id = $1 AND branch_id = $2', [user.id, bId]);
      if (uRes.rows.length > 0) {
        validUserId = uRes.rows[0].id;
        validUserName = uRes.rows[0].name || validUserName;
      }
    } catch (e) {
      validUserId = null;
    }
  }

  return { id: validUserId, name: validUserName };
}

module.exports = {
  getCreator,
  resolveSafeCreator
};
