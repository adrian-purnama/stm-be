/**
 * Standardized error handling utility
 * Provides consistent error response formats across all routes
 */

/**
 * Standard error response format
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {string} error - Technical error details (optional)
 * @param {Object} data - Additional data (optional)
 */
const sendErrorResponse = (res, statusCode, message, error = null, data = null) => {
  const response = {
    success: false,
    message: message
  };

  if (error && process.env.NODE_ENV === 'development') {
    response.error = error;
  }

  if (data) {
    response.data = data;
  }

  res.status(statusCode).json(response);
};

/**
 * Standard success response format
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {string} message - Success message
 * @param {Object} data - Response data (optional)
 * @param {Object} pagination - Pagination info (optional)
 */
const sendSuccessResponse = (res, statusCode = 200, message, data = null, pagination = null) => {
  const response = {
    success: true,
    message: message
  };

  if (data) {
    response.data = data;
  }

  if (pagination) {
    response.pagination = pagination;
  }

  res.status(statusCode).json(response);
};

/**
 * Handle async route errors
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Express route handler
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Handle validation errors
 * @param {Object} res - Express response object
 * @param {Object} error - Validation error object
 */
const handleValidationError = (res, error) => {
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return sendErrorResponse(res, 400, 'Validation failed', errors.join(', '));
  }
  
  if (error.name === 'CastError') {
    return sendErrorResponse(res, 400, 'Invalid ID format');
  }
  
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    return sendErrorResponse(res, 400, `${field} already exists`);
  }
  
  return sendErrorResponse(res, 500, 'Internal server error', error.message);
};

/**
 * Common error messages
 */
const ERROR_MESSAGES = {
  NOT_FOUND: 'Resource not found',
  UNAUTHORIZED: 'Access denied',
  FORBIDDEN: 'Permission denied',
  VALIDATION_FAILED: 'Validation failed',
  INTERNAL_ERROR: 'Internal server error',
  FILE_NOT_FOUND: 'File not found',
  INVALID_FILE_TYPE: 'Invalid file type',
  FILE_TOO_LARGE: 'File too large',
  DUPLICATE_ENTRY: 'Entry already exists',
  INVALID_CREDENTIALS: 'Invalid credentials',
  TOKEN_REQUIRED: 'Access token required',
  INVALID_TOKEN: 'Invalid token'
};

/**
 * Common success messages
 */
const SUCCESS_MESSAGES = {
  CREATED: 'Created successfully',
  UPDATED: 'Updated successfully',
  DELETED: 'Deleted successfully',
  RETRIEVED: 'Retrieved successfully',
  UPLOADED: 'Uploaded successfully',
  REPLACED: 'Replaced successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logout successful'
};

module.exports = {
  sendErrorResponse,
  sendSuccessResponse,
  asyncHandler,
  handleValidationError,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES
};

