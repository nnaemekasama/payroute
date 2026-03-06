const { AppError } = require('../utils/errors');

function errorHandler(err, _req, res, _next) {
  console.error(err.stack || err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  res.status(err.status || 500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'Internal server error',
    },
  });
}

module.exports = errorHandler;
