const User = require('../models/user.model');
const { JWT_SECRET, verifyToken } = require('../utils/jwtHelper');

// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify JWT token
    const decoded = verifyToken(token);
    
    // Check if user still exists and is active
    const user = await User.findById(decoded.userId)
      .populate('permissions', 'name displayName type includes');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found'
      });
    }

    // Add user info to request object
    req.user = {
      userId: user._id,
      email: user.email,
      fullName: user.fullName,
      permissions: user.permissions
    };

    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

/**
 * Dynamic Authorization Middleware
 * Checks if user has required permissions directly
 */
const authorize = (...requiredPermissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Handle both array and multiple string arguments
      // If first argument is an array, use it; otherwise use all arguments as array
      const permissions = Array.isArray(requiredPermissions[0]) 
        ? requiredPermissions[0] 
        : requiredPermissions;

      // Ensure permissions is always an array
      if (!Array.isArray(permissions)) {
        console.error('Permissions is not an array:', permissions);
        return res.status(500).json({
          success: false,
          message: 'Authorization error: Invalid permissions format'
        });
      }

      // Get all individual permissions from user's permissions (including from multi-permissions)
      const userPermissions = [];
      if (req.user.permissions && Array.isArray(req.user.permissions)) {
        req.user.permissions.forEach(permission => {
          if (permission.type === 'individual') {
            userPermissions.push(permission.name);
          } else if (permission.type === 'multi' && permission.includes) {
            // Multi-permission includes multiple individual permissions
            userPermissions.push(...permission.includes);
          }
        });
      }

      // Check if user has all required permissions
      const hasAllPermissions = permissions.every(permission => 
        userPermissions.includes(permission)
      );

      if (!hasAllPermissions) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          required: permissions,
          userPermissions: userPermissions
        });
      }

      // Add user permissions to request for frontend use
      req.userPermissions = userPermissions;
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      res.status(500).json({
        success: false,
        message: 'Authorization error'
      });
    }
  };
};

// Authorize all roles (any authenticated user)
const authorizeAll = () => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Any authenticated user is authorized
    next();
  };
};

module.exports = {
  authenticateToken,
  authorize,
  authorizeAll
};
