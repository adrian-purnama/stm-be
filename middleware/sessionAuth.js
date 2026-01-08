const Session = require('../models/session.model');
const { sendErrorResponse } = require('../utils/errorHandler');

/**
 * Middleware to validate catalogue session token
 * Extracts token from req.query.session and validates it
 * Attaches session info to req.session on success
 */
const validateSession = async (req, res, next) => {
  try {
    const token = req.query.session;

    if (!token) {
      return sendErrorResponse(res, 401, 'Session token is required');
    }

    // Find active, non-expired session
    const session = await Session.findOne({
      token: token.trim(),
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      return sendErrorResponse(res, 401, 'Invalid or expired session token');
    }

    // Update last used timestamp
    session.lastUsedAt = new Date();
    await session.save();

    // Attach session info to request
    req.session = {
      _id: session._id,
      token: session.token,
      expiresAt: session.expiresAt,
      createdBy: session.createdBy
    };

    next();
  } catch (error) {
    console.error('Error validating session:', error);
    return sendErrorResponse(res, 500, 'Error validating session', error.message);
  }
};

module.exports = { validateSession };
















