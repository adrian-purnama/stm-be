const User = require('../models/user.model');
const { JWT_SECRET, verifyToken } = require('../utils/jwtHelper');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = verifyToken(token);
    
    const user = await User.findById(decoded.userId)
      .populate('permissions', 'name displayName type includes');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found'
      });
    }

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

const authorize = (...requiredPermissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const permissions = Array.isArray(requiredPermissions[0]) 
        ? requiredPermissions[0] 
        : requiredPermissions;

    if (!Array.isArray(permissions)) {
        console.error('Permissions is not an array:', permissions);
        return res.status(500).json({
          success: false,
          message: 'Authorization error: Invalid permissions format'
      });
    }

    const userPermissions = [];
    let isSuperAdmin = false;
    if (req.user.permissions && Array.isArray(req.user.permissions)) {
      req.user.permissions.forEach(permission => {
        if (permission.name === 'super_admin') {
          isSuperAdmin = true;
        }
        if (permission.type === 'individual') {
          userPermissions.push(permission.name);
        } else if (permission.type === 'multi' && permission.includes) {
          userPermissions.push(...permission.includes);
        }
      });
    }

    // Super admin has access to everything
    if (isSuperAdmin) {
      req.userPermissions = userPermissions;
      next();
      return;
    }

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

const authorizeAll = () => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorize,
  authorizeAll
};
