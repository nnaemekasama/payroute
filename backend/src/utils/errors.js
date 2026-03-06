class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient funds') {
    super(message, 402, 'INSUFFICIENT_FUNDS');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class UnprocessableError extends AppError {
  constructor(message) {
    super(message, 422, 'UNPROCESSABLE');
  }
}

module.exports = {
  AppError,
  ValidationError,
  InsufficientFundsError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
};
