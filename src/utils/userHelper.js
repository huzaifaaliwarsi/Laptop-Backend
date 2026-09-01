/**
 * Resolve database-safe user identity for branch database operations.
 * When Super Admin operates within a branch, created_by foreign key should be NULL
 * (or local user ID if mapped), while created_by_name holds the authoritative Super Admin label.
 */
function getCreator(user) {
  const isSuper = user?.role === 'super_admin' || user?.isSuperAdmin;
  return {
    id: isSuper ? null : (user?.id || null),
    name: user?.name || (isSuper ? 'Platform Super Admin' : (user?.username || 'Staff'))
  };
}

module.exports = {
  getCreator
};
