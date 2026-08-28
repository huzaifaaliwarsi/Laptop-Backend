const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.'
      });
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
  requireAdmin: requireRole('admin'),
  requireSalesOrAdmin: requireRole('admin', 'sales'),
  requireTechnicianOrAdmin: requireRole('admin', 'technician'),
  requireAny: requireRole('admin', 'sales', 'technician')
};
