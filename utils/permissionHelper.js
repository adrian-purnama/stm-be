/**
 * Permission Helper Utilities
 * Provides functions to check user permissions and handle super admin access
 */

/**
 * Check if user has a specific permission
 * @param {Object} user - User object with permissions populated
 * @param {string} permissionName - Name of the permission to check
 * @returns {boolean} - True if user has the permission
 */
const hasPermission = (user, permissionName) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  // Check if user has super_admin permission and if it includes the specific permission
  const superAdminPermission = user.permissions.find(p => p.name === 'super_admin');
  if (superAdminPermission && superAdminPermission.type === 'multi' && superAdminPermission.includes) {
    // Check if super admin includes this specific permission
    if (superAdminPermission.includes.includes(permissionName)) {
      return true;
    }
  }

  // Check individual permissions
  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      // Multi-permission includes multiple individual permissions
      userPermissions.push(...permission.includes);
    }
  });

  return userPermissions.includes(permissionName);
};

/**
 * Check if user has any of the specified permissions
 * @param {Object} user - User object with permissions populated
 * @param {string[]} permissionNames - Array of permission names to check
 * @returns {boolean} - True if user has any of the permissions
 */
const hasAnyPermission = (user, permissionNames) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  // Check if user has super_admin permission and if it includes the specific permission
  const superAdminPermission = user.permissions.find(p => p.name === 'super_admin');
  if (superAdminPermission && superAdminPermission.type === 'multi' && superAdminPermission.includes) {
    // Check if super admin includes this specific permission
    if (superAdminPermission.includes.includes(permissionName)) {
      return true;
    }
  }

  // Check individual permissions
  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      // Multi-permission includes multiple individual permissions
      userPermissions.push(...permission.includes);
    }
  });

  return permissionNames.some(permissionName => userPermissions.includes(permissionName));
};

/**
 * Check if user has all of the specified permissions
 * @param {Object} user - User object with permissions populated
 * @param {string[]} permissionNames - Array of permission names to check
 * @returns {boolean} - True if user has all of the permissions
 */
const hasAllPermissions = (user, permissionNames) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  // Check if user has super_admin permission and if it includes the specific permission
  const superAdminPermission = user.permissions.find(p => p.name === 'super_admin');
  if (superAdminPermission && superAdminPermission.type === 'multi' && superAdminPermission.includes) {
    // Check if super admin includes this specific permission
    if (superAdminPermission.includes.includes(permissionName)) {
      return true;
    }
  }

  // Check individual permissions
  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      // Multi-permission includes multiple individual permissions
      userPermissions.push(...permission.includes);
    }
  });

  return permissionNames.every(permissionName => userPermissions.includes(permissionName));
};

/**
 * Get all individual permissions for a user (expands multi-permissions)
 * @param {Object} user - User object with permissions populated
 * @returns {string[]} - Array of individual permission names
 */
const getAllUserPermissions = (user) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return [];
  }

  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      // Multi-permission includes multiple individual permissions
      userPermissions.push(...permission.includes);
    }
  });

  return [...new Set(userPermissions)]; // Remove duplicates
};

/**
 * Check if user is super admin
 * @param {Object} user - User object with permissions populated
 * @returns {boolean} - True if user is super admin
 */
const isSuperAdmin = (user) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  return user.permissions.some(p => p.name === 'super_admin');
};

module.exports = {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getAllUserPermissions,
  isSuperAdmin
};