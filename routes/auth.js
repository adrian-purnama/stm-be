const express = require('express');
const User = require('../models/user.model');
const Permission = require('../models/permission.model');
const PermissionCategory = require('../models/permissionCategory.model');
const userHelper = require('../utils/userHelper');
const { authenticateToken, authorize, authorizeAll } = require('../middleware/auth');
const { generateToken } = require('../utils/jwtHelper');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');
const router = express.Router();

// Comprehensive database seeding function
const seedDatabase = async (adminUserId) => {
  try {
    console.log('\n🌱 Starting database seeding...');

    // Step 1: Create Permission Categories
    console.log('\n🔧 Creating permission categories...');
    const categories = [
      { name: 'user', displayName: 'User Management', description: 'User account management permissions' },
      { name: 'role', displayName: 'Role Management', description: 'Role and permission management' },
      { name: 'truck', displayName: 'Truck Management', description: 'Truck type and configuration management' },
      { name: 'drawing', displayName: 'Drawing Management', description: 'Drawing specification management' },
      { name: 'quotation', displayName: 'Quotation Management', description: 'Quotation creation and management' },
      { name: 'notes', displayName: 'Notes Management', description: 'Notes and image management' },
      { name: 'analytics', displayName: 'Analytics', description: 'Analytics and reporting permissions' },
      { name: 'system', displayName: 'System Administration', description: 'System-wide administration permissions' }
    ];

    const createdCategories = [];
    for (const categoryData of categories) {
      let category = await PermissionCategory.findOne({ name: categoryData.name });
      if (!category) {
        category = new PermissionCategory({
          ...categoryData,
          createdBy: adminUserId
        });
        await category.save();
        console.log(`✓ Created category: ${category.name}`);
      }
      createdCategories.push(category);
    }

    // Step 2: Create Individual Permissions (linked to endpoints)
    console.log('\n🔧 Creating individual permissions...');
    const individualPermissions = [
      // User Management
      { name: 'user_view', displayName: 'View Users', description: 'View user accounts', category: 'user' },
      { name: 'user_create', displayName: 'Create Users', description: 'Create new user accounts', category: 'user' },
      { name: 'user_edit', displayName: 'Edit Users', description: 'Edit existing user accounts', category: 'user' },
      { name: 'user_delete', displayName: 'Delete Users', description: 'Delete user accounts', category: 'user' },
      { name: 'user_manage', displayName: 'Manage Users', description: 'Manage Users Accounts', category: 'user' },

      // Permission Management
      { name: 'permission_view', displayName: 'View Permissions', description: 'View permissions and categories', category: 'role' },
      { name: 'permission_create', displayName: 'Create Permissions', description: 'Create new permissions', category: 'role' },
      { name: 'permission_edit', displayName: 'Edit Permissions', description: 'Edit existing permissions', category: 'role' },
      { name: 'permission_delete', displayName: 'Delete Permissions', description: 'Delete permissions', category: 'role' },

      // Truck Management
      { name: 'truck_view', displayName: 'View Trucks', description: 'View truck types', category: 'truck' },
      { name: 'truck_create', displayName: 'Create Trucks', description: 'Create new truck types', category: 'truck' },
      { name: 'truck_edit', displayName: 'Edit Trucks', description: 'Edit truck types', category: 'truck' },
      { name: 'truck_delete', displayName: 'Delete Trucks', description: 'Delete truck types', category: 'truck' },

      // Drawing Management
      { name: 'drawing_view', displayName: 'View Drawings', description: 'View drawing specifications', category: 'drawing' },
      { name: 'drawing_create', displayName: 'Create Drawings', description: 'Create drawing specifications', category: 'drawing' },
      { name: 'drawing_edit', displayName: 'Edit Drawings', description: 'Edit drawing specifications', category: 'drawing' },
      { name: 'drawing_delete', displayName: 'Delete Drawings', description: 'Delete drawing specifications', category: 'drawing' },

      // Quotation Management
      { name: 'quotation_view', displayName: 'View Quotations', description: 'View quotations', category: 'quotation' },
      { name: 'quotation_create', displayName: 'Create Quotations', description: 'Create new quotations', category: 'quotation' },
      { name: 'quotation_edit', displayName: 'Edit Quotations', description: 'Edit existing quotations', category: 'quotation' },
      { name: 'quotation_delete', displayName: 'Delete Quotations', description: 'Delete quotations', category: 'quotation' },

      // Notes Management
      { name: 'notes_view', displayName: 'View Notes', description: 'View notes and images', category: 'notes' },
      { name: 'notes_create', displayName: 'Create Notes', description: 'Create notes and upload images', category: 'notes' },
      { name: 'notes_edit', displayName: 'Edit Notes', description: 'Edit notes and images', category: 'notes' },
      { name: 'notes_delete', displayName: 'Delete Notes', description: 'Delete notes and images', category: 'notes' },

      // Analytics
      { name: 'analytics_view', displayName: 'View Analytics', description: 'View analytics and reports', category: 'analytics' },
      { name: 'analytics_export', displayName: 'Export Analytics', description: 'Export analytics data', category: 'analytics' },

      // System Administration
      { name: 'system_admin', displayName: 'System Admin', description: 'Full system administration access', category: 'system' },
      { name: 'system_config', displayName: 'System Config', description: 'System configuration access', category: 'system' },
      { name: 'placeholder_test', displayName: 'Placeholder Test', description: 'PLaceholder for testing purposes', category: 'system' }
    ];

    const createdIndividualPermissions = [];
    for (const permissionData of individualPermissions) {
      let permission = await Permission.findOne({ name: permissionData.name });
      if (!permission) {
        const category = createdCategories.find(cat => cat.name === permissionData.category);
        permission = new Permission({
          ...permissionData,
          type: 'individual',
          category: category._id,
          createdBy: adminUserId
        });
        await permission.save();
        console.log(`✓ Created individual permission: ${permission.displayName}`);
      }
      createdIndividualPermissions.push(permission);
    }

    // Step 3: Create Multi Permissions (contain multiple individual permissions)
    console.log('\n🔧 Creating multi permissions...');
    const multiPermissions = [
      {
        name: 'super_admin',
        displayName: 'Super Administrator',
        description: 'Full system access with all permissions',
        category: 'system',
        includes: individualPermissions.map(p => p.name) // All individual permissions
      }
    ];

    const createdMultiPermissions = [];
    for (const permissionData of multiPermissions) {
      let permission = await Permission.findOne({ name: permissionData.name });
      if (!permission) {
        const category = createdCategories.find(cat => cat.name === permissionData.category);
        permission = new Permission({
          ...permissionData,
          type: 'multi',
          category: category._id,
          createdBy: adminUserId
        });
        await permission.save();
        console.log(`✓ Created multi permission: ${permission.displayName}`);
      }
      createdMultiPermissions.push(permission);
    }

    const allPermissions = [...createdIndividualPermissions, ...createdMultiPermissions];

    console.log('\n🎉 Database seeding completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`  • Permission Categories: ${createdCategories.length}`);
    console.log(`  • Individual Permissions: ${createdIndividualPermissions.length}`);
    console.log(`  • Multi Permissions: ${createdMultiPermissions.length}`);

    return {
      categories: createdCategories,
      individualPermissions: createdIndividualPermissions,
      multiPermissions: createdMultiPermissions,
      allPermissions: allPermissions
    };

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
};

/**
 * GET /api/auth/registration-status
 * Check if user registration is available
 * No authentication required (public endpoint)
 */
router.get('/registration-status', async (req, res) => {
  try {
    const existingUsers = await User.countDocuments();
    const isRegistrationAvailable = existingUsers === 0;
    
    res.json({
      success: true,
      data: {
        isRegistrationAvailable,
        message: isRegistrationAvailable 
          ? 'Registration is available' 
          : 'Registration is disabled - users already exist'
      }
    });
  } catch (error) {
    sendErrorResponse(res, 500, 'Error checking registration status', error.message);
  }
});

/**
 * POST /api/auth/register
 * Register new user - ONLY ALLOWED ONCE
 * If no users exist, this user becomes super admin and seeds the database
 * After first user, registration is disabled
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, phoneNumbers, roles } = req.body;

    // Check if any users already exist
    const existingUsers = await User.countDocuments();
    
    if (existingUsers > 0) {
      return sendErrorResponse(res, 403, 'User registration is disabled. Only one user account is allowed.');
    }

    console.log('🌱 First user registration - seeding database...');

    // Create the first user first (without permissions initially)
    const userResponse = await userHelper.createUser({ 
      email, 
      password, 
      fullName, 
      phoneNumbers, 
      permissions: [] // Start with no permissions
    });

    console.log('✅ First user created, now seeding database...');

    // Get the actual user document from database
    const user = await User.findById(userResponse._id);

    // Seed the database with the first user as the creator
    const seedResult = await seedDatabase(user._id);

    // Assign the super admin permission to the first user (which includes all individual permissions)
    const superAdminPermission = seedResult.multiPermissions.find(p => p.name === 'super_admin');
    user.permissions = [superAdminPermission._id];
    await user.save();

    // Populate permissions for response
    const userWithPermissions = await User.findById(user._id)
      .populate('permissions')
      .populate('permissions.category');

    console.log('🎉 First user registered successfully with super admin access!');

    sendSuccessResponse(res, 201, 'First user registered successfully with super admin access. Database has been seeded with all permissions.', {
        user: {
          id: user._id,
          email: user.email,
        fullName: user.fullName,
        permissions: userWithPermissions.permissions,
          createdAt: user.createdAt
      },
      seeded: {
        categories: seedResult.categories.length,
        individualPermissions: seedResult.individualPermissions.length,
        multiPermissions: seedResult.multiPermissions.length
      }
    });

  } catch (error) {
    console.error('🚨 REGISTRATION ERROR:', {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString()
    });
    handleValidationError(res, error);
  }
});

/**
 * POST /api/auth/login
 * User login and authentication
 * No permission required (public endpoint)
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await userHelper.authenticateUser(email, password);
    

    // Get user permissions for token and response
    const userWithPermissions = await User.findById(user._id).populate('permissions');
    const permissionNames = userWithPermissions.permissions.map(permission => permission.name);

    // Generate JWT token
    const token = generateToken({
        userId: user._id, 
        email: user.email, 
      permissions: permissionNames 
    });



    sendSuccessResponse(res, 200, SUCCESS_MESSAGES.LOGIN_SUCCESS, {
        user: {
          id: user._id,
          email: user.email,
          permissions: userWithPermissions.permissions,
          fullName: user.fullName,
          phoneNumbers: user.phoneNumbers,
          lastLogin: user.lastLogin
        },
        token
    });

  } catch (error) {
    console.error('🚨 LOGIN ERROR:', {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString()
    });
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/auth/profile
 * Get current user profile information
 * Required Permission: user_view (self)
 */
router.get('/profile', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * PUT /api/auth/profile
 * Update current user profile
 * Required Permission: user_update (self)
 */
router.put('/profile', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { fullName, phoneNumbers } = req.body;
    
    const updateData = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phoneNumbers !== undefined) updateData.phoneNumbers = phoneNumbers;

    const user = await userHelper.updateUser(req.user.userId, updateData);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/auth/reset-password
 * Reset user password
 * Required Permission: user_update (self)
 */
router.post('/reset-password', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    await userHelper.changePassword(req.user.id, currentPassword, newPassword);

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/auth/users
 * Get all users with pagination
 * Required Permission: user_view
 */
router.get('/users', authenticateToken, authorize(['user_view']), async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    console.log('Fetching users - Page:', page, 'Limit:', limit);
    console.log('Current user:', req.user);

    const result = await userHelper.getAllUsers(page, limit);

    console.log('Found users:', result.users.length);
    console.log('Users:', result.users.map(u => ({ id: u._id, email: u.email, fullName: u.fullName })));

    res.json({
      success: true,
      data: result.users, // Return users array directly
      pagination: result.pagination
    });

  } catch (error) {
    console.error('Error in /users endpoint:', error);
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * PUT /api/auth/users/:id
 * Update user information
 * Required Permission: user_update
 */
router.put('/users/:id', authenticateToken, authorize(['user_manage']), async (req, res) => {
  try {
    console.log('Updating user:', req.params.id);
    console.log('Request body:', req.body);
    console.log('Current user permissions:', req.user.permissions?.map(p => p.name || p.displayName));
    
    const { fullName, phoneNumbers, permissions, isActive } = req.body;
    const updateData = {};
    
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phoneNumbers !== undefined) updateData.phoneNumbers = phoneNumbers;
    if (permissions !== undefined) updateData.permissions = permissions;
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await userHelper.updateUser(req.params.id, updateData);

    // Populate permissions for response
    const userWithPermissions = await User.findById(user._id).populate('permissions');

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: userWithPermissions }
    });

  } catch (error) {
    console.error('Error updating user:', error);
    handleValidationError(res, error);
  }
});

/**
 * DELETE /api/auth/users/:id
 * Delete user account
 * Required Permission: user_delete
 */
router.delete('/users/:id', authenticateToken, authorize(['user_delete']), async (req, res) => {
  try {
    await userHelper.deleteUser(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * POST /api/auth/users
 * Create new user
 * Required Permission: user_create
 */
router.post('/users', authenticateToken, authorize(['user_create']), async (req, res) => {
  try {
    const { email, password, fullName, phoneNumbers, roles } = req.body;

    if (!email || !password || !fullName) {
      return sendErrorResponse(res, 400, 'Email, password, and fullName are required');
    }

    const user = await userHelper.createUser({
      email,
      password,
      fullName,
      phoneNumbers: phoneNumbers || [],
      roles: roles || []
    });

    // Populate roles for response
    const userWithRoles = await User.findById(user._id).populate('roles');

    sendSuccessResponse(res, 201, 'User created successfully', {
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        roles: userWithRoles.roles,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/auth/users/:id/copy
 * Copy user account with same roles
 * Required Permission: user_create
 */
router.post('/users/:id/copy', authenticateToken, authorize(['user_create']), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, fullName } = req.body;

    if (!email || !fullName) {
      return sendErrorResponse(res, 400, 'Email and fullName are required');
    }

    // Get original user
    const originalUser = await User.findById(id).populate('roles');
    if (!originalUser) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return sendErrorResponse(res, 400, 'User with this email already exists');
    }

    // Create new user with same roles
    const newUser = new User({
      email,
      fullName,
      password: 'temp123', // Temporary password, user should reset
      phoneNumbers: originalUser.phoneNumbers,
      roles: originalUser.roles.map(role => role._id),
      isActive: true
    });

    // Hash the temporary password
    const bcrypt = require('bcryptjs');
    newUser.password = await bcrypt.hash('temp123', 10);

    await newUser.save();

    sendSuccessResponse(res, 201, 'User copied successfully', {
      id: newUser._id,
      email: newUser.email,
      fullName: newUser.fullName,
      message: 'User created with temporary password: temp123'
    });
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/auth/users/:id/reset-password
 * Reset user password (super admin only)
 * Required Permission: user_manage
 */
router.post('/users/:id/reset-password', authenticateToken, authorize(['user_manage']), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return sendErrorResponse(res, 400, 'New password is required');
    }

    const user = await User.findById(id);
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Hash the new password
    const bcrypt = require('bcryptjs');
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    sendSuccessResponse(res, 200, 'Password reset successfully');
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * GET /api/auth/users/:id/permissions
 * Get user permissions
 * Required Permission: user_view
 */
router.get('/users/:id/permissions', authenticateToken, authorize(['user_view']), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Get all individual permissions (expanding multi-permissions)
    const allIndividualPermissions = await user.getAllIndividualPermissions();

    const userPermissions = user.permissions.map(permission => ({
      id: permission._id,
      name: permission.name,
      displayName: permission.displayName,
      description: permission.description,
      type: permission.type,
      includes: permission.includes
    }));

    sendSuccessResponse(res, 200, 'User permissions retrieved successfully', {
      userId: user._id,
      email: user.email,
      fullName: user.fullName,
      permissions: userPermissions,
      allIndividualPermissions: allIndividualPermissions
    });
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/auth/users/:id/reset-password
 * Reset user password
 * Required Permission: user_edit
 */
router.post('/users/:id/reset-password', authenticateToken, authorize(['user_edit']), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return sendErrorResponse(res, 400, 'New password must be at least 6 characters long');
    }

    const user = await User.findById(id);
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    sendSuccessResponse(res, 200, 'Password reset successfully');
  } catch (error) {
    handleValidationError(res, error);
  }
});

// Check if current user has specific permission
router.get('/ispermission/:permission', authenticateToken, async (req, res) => {
  try {
    const { permission } = req.params;
    const userId = req.user.userId;

    // Find user with permissions populated
    const user = await User.findById(userId).populate('permissions');
    
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Check if user has the specific permission
    const hasPermission = user.permissions.some(userPermission => {
      const nameMatch = userPermission.name === permission;
      const idMatch = userPermission._id.toString() === permission;
      return nameMatch || idMatch;
    });

    sendSuccessResponse(res, 200, {
      hasPermission,
      permission,
      userId: user._id,
      userEmail: user.email,
      userPermissions: user.permissions.map(perm => ({
        id: perm._id,
        name: perm.name,
        displayName: perm.displayName
      }))
    });
  } catch (error) {
    console.error('Error checking permission:', error);
    sendErrorResponse(res, 500, 'Error checking permission', error.message);
  }
});

module.exports = router;
