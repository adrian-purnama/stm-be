const hasPermission = (user, permissionName) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  const superAdminPermission = user.permissions.find(p => p.name === 'super_admin');
  if (superAdminPermission && superAdminPermission.type === 'multi' && superAdminPermission.includes) {
    if (superAdminPermission.includes.includes(permissionName)) {
      return true;
    }
  }

  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      userPermissions.push(...permission.includes);
    }
  });

  return userPermissions.includes(permissionName);
};

const hasAnyPermission = (user, permissionNames) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  const superAdminPermission = user.permissions.find(p => p.name === 'super_admin');
  if (superAdminPermission && superAdminPermission.type === 'multi' && superAdminPermission.includes) {
    if (permissionNames.some(pn => superAdminPermission.includes.includes(pn))) {
      return true;
    }
  }

  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      userPermissions.push(...permission.includes);
    }
  });

  return permissionNames.some(permissionName => userPermissions.includes(permissionName));
};

const hasAllPermissions = (user, permissionNames) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  const superAdminPermission = user.permissions.find(p => p.name === 'super_admin');
  if (superAdminPermission && superAdminPermission.type === 'multi' && superAdminPermission.includes) {
    if (permissionNames.every(pn => superAdminPermission.includes.includes(pn))) {
      return true;
    }
  }

  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      userPermissions.push(...permission.includes);
    }
  });

  return permissionNames.every(permissionName => userPermissions.includes(permissionName));
};

const getAllUserPermissions = (user) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return [];
  }

  const userPermissions = [];
  user.permissions.forEach(permission => {
    if (permission.type === 'individual') {
      userPermissions.push(permission.name);
    } else if (permission.type === 'multi' && permission.includes) {
      userPermissions.push(...permission.includes);
    }
  });

  return [...new Set(userPermissions)];
};

const isSuperAdmin = (user) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  return user.permissions.some(p => p.name === 'super_admin');
};

const hasAllQuotationAccess = (user) => {
  if (!user || !user.permissions || !Array.isArray(user.permissions)) {
    return false;
  }

  return hasPermission(user, 'all_quotation_viewer') || 
         hasAnyPermission(user, ['quotation_admin', 'admin', 'system_admin']) ||
         isSuperAdmin(user);
};

module.exports = {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getAllUserPermissions,
  isSuperAdmin,
  hasAllQuotationAccess
};