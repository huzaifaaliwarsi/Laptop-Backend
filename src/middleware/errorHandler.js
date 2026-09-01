const errorHandler = (err, req, res, next) => {
  console.error('[API Error]:', err);

  // PostgreSQL unique violation error
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_KEY',
      message: 'A record with this unique value already exists.',
      detail: err.detail
    });
  }

  // PostgreSQL foreign key violation error
  if (err.code === '23503') {
    return res.status(409).json({
      success: false,
      code: 'FOREIGN_KEY_VIOLATION',
      message: err.detail || err.message || 'Related record or user reference could not be found.',
      detail: err.detail
    });
  }

  // Custom business error with status
  if (err.status) {
    return res.status(err.status).json({
      success: false,
      code: err.code || 'BUSINESS_ERROR',
      message: err.message
    });
  }

  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  return res.status(statusCode).json({
    success: false,
    code: 'SERVER_ERROR',
    message: err.message || 'Internal Server Error'
  });
};

module.exports = errorHandler;
