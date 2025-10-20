const PermissionCategory = require('../models/permissionCategory.model');
const Permission = require('../models/permission.model');

/**
 * Initialize default permission categories and permissions
 * This should be called when the application starts
 */
const initializeDefaultPermissions = async (createdBy = null) => {
  try {
    console.log('🔧 Initializing default permission categories and permissions...');

    // Default permission categories
    const defaultCategories = [
      { name: 'user' },
      { name: 'role' },
      { name: 'truck' },
      { name: 'drawing' },
      { name: 'quotation' },
      { name: 'notes' },
      { name: 'analytics' },
      { name: 'system' }
    ];

    // Create categories
    const createdCategories = {};
    for (const categoryData of defaultCategories) {
      let category = await PermissionCategory.findOne({ name: categoryData.name });
      if (!category) {
        category = new PermissionCategory({
          ...categoryData,
          createdBy: createdBy || new require('mongoose').Types.ObjectId() // Use a dummy ObjectId if no user
        });
        await category.save();
        console.log(`✅ Created category: ${category.name}`);
      }
      createdCategories[categoryData.name] = category;
    }

    // Default permissions
    const defaultPermissions = [
      // User Management
      { name: 'user_view', displayName: 'View Users', category: 'user' },
      { name: 'user_create', displayName: 'Create Users', category: 'user' },
      { name: 'user_edit', displayName: 'Edit Users', category: 'user' },
      { name: 'user_delete', displayName: 'Delete Users', category: 'user' },
      { name: 'user_manage', displayName: 'Manage Users', category: 'user' },

      // Role Management
      { name: 'role_view', displayName: 'View Roles', category: 'role' },
      { name: 'role_create', displayName: 'Create Roles', category: 'role' },
      { name: 'role_edit', displayName: 'Edit Roles', category: 'role' },
      { name: 'role_delete', displayName: 'Delete Roles', category: 'role' },
      { name: 'role_manage', displayName: 'Manage Roles', category: 'role' },

      // Truck Management
      { name: 'truck_view', displayName: 'View Trucks', category: 'truck' },
      { name: 'truck_create', displayName: 'Create Trucks', category: 'truck' },
      { name: 'truck_edit', displayName: 'Edit Trucks', category: 'truck' },
      { name: 'truck_delete', displayName: 'Delete Trucks', category: 'truck' },
      { name: 'truck_manage', displayName: 'Manage Trucks', category: 'truck' },

      // Drawing Management
      { name: 'drawing_view', displayName: 'View Drawings', category: 'drawing' },
      { name: 'drawing_create', displayName: 'Create Drawings', category: 'drawing' },
      { name: 'drawing_edit', displayName: 'Edit Drawings', category: 'drawing' },
      { name: 'drawing_delete', displayName: 'Delete Drawings', category: 'drawing' },
      { name: 'drawing_manage', displayName: 'Manage Drawings', category: 'drawing' },

      // Quotation Management
      { name: 'quotation_view', displayName: 'View Quotations', category: 'quotation' },
      { name: 'quotation_create', displayName: 'Create Quotations', category: 'quotation' },
      { name: 'quotation_edit', displayName: 'Edit Quotations', category: 'quotation' },
      { name: 'quotation_delete', displayName: 'Delete Quotations', category: 'quotation' },
      { name: 'quotation_manage', displayName: 'Manage Quotations', category: 'quotation' },

      // Notes Management
      { name: 'notes_view', displayName: 'View Notes', category: 'notes' },
      { name: 'notes_create', displayName: 'Create Notes', category: 'notes' },
      { name: 'notes_edit', displayName: 'Edit Notes', category: 'notes' },
      { name: 'notes_delete', displayName: 'Delete Notes', category: 'notes' },
      { name: 'notes_manage', displayName: 'Manage Notes', category: 'notes' },

      // Analytics
      { name: 'analytics_view', displayName: 'View Analytics', category: 'analytics' },
      { name: 'analytics_export', displayName: 'Export Analytics', category: 'analytics' },

      // System
      { name: 'system_admin', displayName: 'System Admin', category: 'system' },
      { name: 'system_config', displayName: 'System Config', category: 'system' }
    ];

    // Create permissions
    for (const permissionData of defaultPermissions) {
      let permission = await Permission.findOne({ name: permissionData.name });
      if (!permission) {
        permission = new Permission({
          name: permissionData.name,
          displayName: permissionData.displayName,
          description: `${permissionData.displayName} permission`,
          category: createdCategories[permissionData.category]._id,
          createdBy: createdBy || new require('mongoose').Types.ObjectId() // Use a dummy ObjectId if no user
        });
        await permission.save();
        console.log(`✅ Created permission: ${permission.displayName}`);
      }
    }

    console.log('✅ Default permissions initialization completed');
    return { success: true };
  } catch (error) {
    console.error('❌ Error initializing default permissions:', error);
    throw error;
  }
};

/**
 * Get all permissions grouped by category
 */
const getPermissionsByCategory = async () => {
  try {
    const permissions = await Permission.find({ isActive: true })
      .populate('category', 'name')
      .sort({ displayName: 1 });

    // Group by category
    const grouped = permissions.reduce((acc, permission) => {
      const categoryName = permission.category.name;
      if (!acc[categoryName]) {
        acc[categoryName] = {
          category: permission.category,
          permissions: []
        };
      }
      acc[categoryName].permissions.push(permission);
      return acc;
    }, {});

    return grouped;
  } catch (error) {
    console.error('Error getting permissions by category:', error);
    throw error;
  }
};

module.exports = {
  initializeDefaultPermissions,
  getPermissionsByCategory
};
