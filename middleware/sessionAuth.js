const Session = require('../models/session.model');
const User = require('../models/user.model');
const { sendErrorResponse } = require('../utils/errorHandler');
const { verifyToken } = require('../utils/jwtHelper');

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

/**
 * Middleware that allows access with EITHER a valid catalogue session (query.session)
 * OR a valid JWT with the given permissions (e.g. for admin STM frontend).
 * Used for GET /catalogues and GET /catalogues/:id so both the catalogue app and admin can access.
 */
const validateSessionOrAuthorize = (...requiredPermissions) => {
  const permissions = Array.isArray(requiredPermissions[0]) ? requiredPermissions[0] : requiredPermissions;

  return async (req, res, next) => {
    try {
      // 1. Try catalogue session first (for catalogue app)
      const sessionToken = req.query.session;
      if (sessionToken) {
        const session = await Session.findOne({
          token: sessionToken.trim(),
          isActive: true,
          expiresAt: { $gt: new Date() }
        });
        if (session) {
          session.lastUsedAt = new Date();
          await session.save();
          req.session = {
            _id: session._id,
            token: session.token,
            expiresAt: session.expiresAt,
            createdBy: session.createdBy
          };
          return next();
        }
        // Invalid or expired session token - reject with session message
        return sendErrorResponse(res, 401, 'Invalid or expired session token');
      }

      // 2. No session in query: try JWT (for admin STM frontend)
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (!token) {
        return sendErrorResponse(res, 401, 'Session token or access token is required');
      }

      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId)
        .populate('permissions', 'name displayName type includes');
      if (!user || !user.isActive) {
        return sendErrorResponse(res, 401, 'Invalid token or user not found');
      }

      req.user = {
        userId: user._id,
        email: user.email,
        fullName: user.fullName,
        permissions: user.permissions
      };

      // Check permissions (same logic as authorize middleware)
      let isSuperAdmin = false;
      const userPermissions = [];
      if (req.user.permissions && Array.isArray(req.user.permissions)) {
        req.user.permissions.forEach(permission => {
          if (permission.name === 'super_admin') isSuperAdmin = true;
          if (permission.type === 'individual') {
            userPermissions.push(permission.name);
          } else if (permission.type === 'multi' && permission.includes) {
            userPermissions.push(...permission.includes);
          }
        });
      }
      if (isSuperAdmin) return next();
      const hasAll = permissions.every(p => userPermissions.includes(p));
      if (!hasAll) {
        return sendErrorResponse(res, 403, 'Insufficient permissions', null, { required: permissions, userPermissions });
      }
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return sendErrorResponse(res, 401, 'Invalid token');
      }
      if (error.name === 'TokenExpiredError') {
        return sendErrorResponse(res, 401, 'Token expired');
      }
      console.error('validateSessionOrAuthorize error:', error);
      return sendErrorResponse(res, 500, 'Authentication error', error.message);
    }
  };
};

module.exports = { validateSession, validateSessionOrAuthorize };




















