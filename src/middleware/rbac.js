const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.'
      });
    }

    // Super Admin has unrestricted master access to all platform routes
    if (req.user.role === 'super_admin' || req.user.isSuperAdmin) {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
      });
    }

    next();
  };
};

module.exports = {
  requireRole,
  requireAdmin: requireRole('admin', 'super_admin'),
  requireSalesOrAdmin: requireRole('admin', 'sales', 'super_admin'),
  requireTechnicianOrAdmin: requireRole('admin', 'technician', 'super_admin'),
  requireAny: requireRole('admin', 'sales', 'technician', 'super_admin')
};
