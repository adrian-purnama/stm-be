// =============================================================================
// AUTHENTICATION & USER MANAGEMENT ROUTES
// =============================================================================
// This module handles all authentication, user management, and permission-related endpoints
// for the ASB system including login, registration, user CRUD, and permission management.

const express = require('express');
const User = require('../models/user.model');
const Permission = require('../models/permission.model');
const PermissionCategory = require('../models/permissionCategory.model');
const userHelper = require('../utils/userHelper');
const { authenticateToken, authorize, authorizeAll } = require('../middleware/auth');
const { generateToken } = require('../utils/jwtHelper');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');
const PasswordResetToken = require('../models/passwordResetToken.model');
const bcrypt = require('bcryptjs');
const { sendPasswordResetEmail } = require('../utils/emailUtils');
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
      { name: 'system', displayName: 'System Administration', description: 'System-wide administration permissions' },
      { name: 'roles', displayName: 'User Roles', description: 'Predefined Bundled User Roles' }
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
      { name: 'email_broadcast', displayName: 'Broadcast Email', description: 'Send broadcast emails to all users', category: 'user' },

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
      { name: 'all_quotation_viewer', displayName: 'All Quotation Viewer', description: 'View All Quotations Made Regardles of Team', category: 'quotation' },
      { name: 'approve_rfq', displayName: 'Approve RFQ', description: 'Approve or Reject RFQ Requests', category: 'quotation' },
      { name: 'quotation_requester', displayName: 'Quotation Requester', description: 'Create RFQ Requests', category: 'quotation' },
      { name: 'engineer_review', displayName: 'Engineer Review', description: 'Review RFQs in engineering stage', category: 'quotation' },
      { name: 'quotation_admin', displayName: 'Quotation Admin', description: 'Full quotation administration access', category: 'quotation' },

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
      { name: 'admin', displayName: 'Admin', description: 'General admin access', category: 'system' },
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
        category: 'roles',
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
// =============================================================================
// PUBLIC AUTHENTICATION ROUTES
// =============================================================================

/**
 * GET /api/auth/registration-status
 * Permission: None (Public)
 * Description: Check if any users exist in the system (for first-time setup)
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
/**
 * POST /api/auth/register
 * Permission: None (Public - only if no users exist)
 * Description: Register the first admin user in the system
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
/**
 * POST /api/auth/login
 * Permission: None (Public)
 * Description: Authenticate user and return JWT token
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
    const normalizedMessage = error.message || 'Invalid credentials';

    const isAuthError =
      normalizedMessage.toLowerCase().includes('invalid email or password') ||
      normalizedMessage.toLowerCase().includes('account is deactivated');

    if (isAuthError) {
      console.warn('⚠️ Login failed:', normalizedMessage);
      return res.status(401).json({
        success: false,
        message: 'Email atau kata sandi salah'
      });
    }

    console.error('🚨 LOGIN ERROR:', {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString()
    });
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendErrorResponse(res, 400, 'Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    // Respond with generic message to avoid email enumeration
    const genericResponse = {
      success: true,
      message: 'If the email exists in our system, an OTP has been sent.'
    };

    if (!user) {
      return res.json(genericResponse);
    }

    await PasswordResetToken.deleteMany({ email: normalizedEmail });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 12);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await PasswordResetToken.create({
      email: normalizedEmail,
      otpHash,
      expiresAt
    });

    const frontendUrl = process.env.FRONTEND_URL || '';

    await sendPasswordResetEmail(
      user.email,
      user.fullName || user.email,
      otp,
      frontendUrl,
      user.email
    );

    return res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

router.post('/reset-password/otp', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return sendErrorResponse(res, 400, 'Email, OTP, and new password are required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const tokenDoc = await PasswordResetToken.findOne({ email: normalizedEmail });

    if (!tokenDoc) {
      return sendErrorResponse(res, 400, 'Invalid or expired OTP');
    }

    if (tokenDoc.expiresAt < new Date()) {
      await PasswordResetToken.deleteMany({ email: normalizedEmail });
      return sendErrorResponse(res, 400, 'Invalid or expired OTP');
    }

    const isOtpValid = await bcrypt.compare(otp, tokenDoc.otpHash);

    if (!isOtpValid) {
      return sendErrorResponse(res, 400, 'Invalid or expired OTP');
    }

    const passwordValidation = userHelper.validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return sendErrorResponse(res, 400, passwordValidation.message);
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      await PasswordResetToken.deleteMany({ email: normalizedEmail });
      return sendErrorResponse(res, 400, 'Invalid or expired OTP');
    }

    const hashedPassword = await userHelper.hashPassword(newPassword);
    await User.updateOne({ email: normalizedEmail }, { password: hashedPassword });
    await PasswordResetToken.deleteMany({ email: normalizedEmail });

    return res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password OTP error:', error);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/auth/profile
 * Get current user profile information
 * Required Permission: user_view (self)
 */
// =============================================================================
// AUTHENTICATED USER PROFILE ROUTES
// =============================================================================

/**
 * GET /api/auth/profile
 * Permission: Any authenticated user
 * Description: Get current user's profile information
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
/**
 * PUT /api/auth/profile
 * Permission: Any authenticated user
 * Description: Update current user's profile information
 */
router.put('/profile', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { fullName, phoneNumbers, sendToEmail } = req.body;
    
    console.log('Profile update request body:', req.body);
    console.log('sendToEmail value:', sendToEmail, 'type:', typeof sendToEmail);
    
    const updateData = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phoneNumbers !== undefined) updateData.phoneNumbers = phoneNumbers;
    if (sendToEmail !== undefined) {
      // Explicitly convert to boolean
      updateData.sendToEmail = sendToEmail === true || sendToEmail === 'true' || sendToEmail === 1;
      console.log('Converted sendToEmail to:', updateData.sendToEmail, 'type:', typeof updateData.sendToEmail);
    }

    const user = await userHelper.updateUser(req.user.userId, updateData);
    
    console.log('Updated user sendToEmail:', user.sendToEmail);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    handleValidationError(res, error);
  }
});

/**
 * POST /api/auth/reset-password
 * Reset user password
 * Required Permission: user_update (self)
 */
/**
 * POST /api/auth/reset-password
 * Permission: Any authenticated user
 * Description: Reset current user's password
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

    await userHelper.changePassword(req.user.userId, currentPassword, newPassword);

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
// =============================================================================
// USER MANAGEMENT ROUTES (ADMIN ONLY)
// =============================================================================

/**
 * GET /api/auth/users
 * Permission: user_view
 * Description: Get paginated list of all users (admin only)
 */
router.get('/users', authenticateToken, authorize(['user_view']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    console.log('Fetching users - Page:', page, 'Limit:', limit, 'Search:', search);
    console.log('Current user:', req.user);

    const result = await userHelper.getAllUsers(page, limit, search);

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
/**
 * PUT /api/auth/users/:id
 * Permission: user_manage
 * Description: Update user information and permissions (admin only)
 */
router.put('/users/:id', authenticateToken, authorize(['user_manage']), async (req, res) => {
  try {
    console.log('Updating user:', req.params.id);
    console.log('Request body:', req.body);
    console.log('Current user permissions:', req.user.permissions?.map(p => p.name || p.displayName));
    
    const { fullName, email, phoneNumbers, permissions, isActive } = req.body;
    const updateData = {};
    
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
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
/**
 * DELETE /api/auth/users/:id
 * Permission: user_delete
 * Description: Delete a user account (admin only)
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
/**
 * POST /api/auth/users
 * Permission: user_create
 * Description: Create a new user account (admin only)
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

    // Return created user (permissions-based system; no roles)
    const freshUser = await User.findById(user._id).populate('permissions');
    sendSuccessResponse(res, 201, 'User created successfully', {
      user: {
        id: freshUser._id,
        email: freshUser.email,
        fullName: freshUser.fullName,
        permissions: freshUser.permissions,
        isActive: freshUser.isActive,
        createdAt: freshUser.createdAt
      }
    });

  } catch (error) {
    // Return a clear message so the client can show it (avoid generic 500 with no details)
    // Try known validation/duplicate errors first
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message).join(', ');
      return sendErrorResponse(res, 400, messages);
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return sendErrorResponse(res, 400, `${field} already exists`);
    }
    // Fallback to the actual error message
    return sendErrorResponse(res, 400, error.message || 'Failed to create user');
  }
});

/**
 * POST /api/auth/users/:id/copy
 * Copy user account with same roles
 * Required Permission: user_create
 */
/**
 * POST /api/auth/users/:id/copy
 * Permission: user_create
 * Description: Copy an existing user with new email/name (admin only)
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
/**
 * POST /api/auth/users/:id/reset-password
 * Permission: user_manage
 * Description: Reset another user's password (admin only)
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
/**
 * GET /api/auth/users/:id/permissions
 * Permission: user_view
 * Description: Get user's permissions and roles (admin only)
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
// =============================================================================
// PERMISSION CHECK ROUTES
// =============================================================================

/**
 * GET /api/auth/ispermission/:permission
 * Permission: Any authenticated user
 * Description: Check if current user has a specific permission
 */
router.get('/ispermission/:permission', authenticateToken, async (req, res) => {
  try {
    const { permission } = req.params;
    const userId = req.user.userId;

    // Find user with permissions populated
    const user = await User.findById(userId).populate('permissions');
    
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Check if user has the specific permission using the proper permission helper
    const { hasPermission } = require('../utils/permissionHelper');
    const hasPermissionResult = hasPermission(user, permission);

    sendSuccessResponse(res, 200, {
      hasPermission: hasPermissionResult,
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

// =============================================================================
// RFQ FOLDER MANAGEMENT ROUTES
// =============================================================================

/**
 * GET /api/auth/folders
 * Permission: Any authenticated user
 * Description: Get current user's RFQ folders
 */
router.get('/folders', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    sendSuccessResponse(res, 200, 'Folders fetched successfully', {
      folders: user.rfqFolders || []
    });
  } catch (error) {
    console.error('Error fetching folders:', error);
    sendErrorResponse(res, 500, 'Failed to fetch folders', error.message);
  }
});

/**
 * POST /api/auth/folders
 * Permission: Any authenticated user
 * Description: Create a new RFQ folder
 */
router.post('/folders', authenticateToken, async (req, res) => {
  try {
    const { name, color } = req.body;
    
    if (!name || !name.trim()) {
      return sendErrorResponse(res, 400, 'Folder name is required');
    }

    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Validate folder limit (max 5 folders per user)
    if (user.rfqFolders && user.rfqFolders.length >= 5) {
      return sendErrorResponse(res, 400, 'Maximum of 5 folders allowed per user');
    }

    // Add folder to user's rfqFolders array
    user.rfqFolders.push({
      name: name.trim(),
      color: color || '#3B82F6'
    });

    await user.save();

    sendSuccessResponse(res, 201, 'Folder created successfully', {
      folder: user.rfqFolders[user.rfqFolders.length - 1]
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    sendErrorResponse(res, 500, 'Failed to create folder', error.message);
  }
});

/**
 * PUT /api/auth/folders/:folderId
 * Permission: Any authenticated user
 * Description: Update an RFQ folder
 */
router.put('/folders/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name, color } = req.body;
    
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const folder = user.rfqFolders.id(folderId);
    
    if (!folder) {
      return sendErrorResponse(res, 404, 'Folder not found');
    }

    if (name !== undefined) folder.name = name.trim();
    if (color !== undefined) folder.color = color;

    await user.save();

    sendSuccessResponse(res, 200, 'Folder updated successfully', {
      folder
    });
  } catch (error) {
    console.error('Error updating folder:', error);
    sendErrorResponse(res, 500, 'Failed to update folder', error.message);
  }
});

/**
 * DELETE /api/auth/folders/:folderId
 * Permission: Any authenticated user
 * Description: Delete an RFQ folder. If folder contains RFQs, they will be moved to default (no folder)
 */
router.delete('/folders/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.userId;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const folder = user.rfqFolders.id(folderId);
    
    if (!folder) {
      return sendErrorResponse(res, 404, 'Folder not found');
    }

    // Check if there are RFQs in this folder
    const RFQ = require('../models/rfq.model').RFQ;
    const rfqsInFolder = await RFQ.find({
      requesterId: userId,
      folderId: folderId
    });

    // Move all RFQs to default (no folder) by setting folderId to null
    if (rfqsInFolder.length > 0) {
      await RFQ.updateMany(
        { 
          requesterId: userId,
          folderId: folderId 
        },
        { 
          $set: { folderId: null } 
        }
      );
    }

    // Delete the folder
    user.rfqFolders.pull({ _id: folderId });
    await user.save();

    sendSuccessResponse(res, 200, 'Folder deleted successfully', {
      rfqsMovedToDefault: rfqsInFolder.length
    });
  } catch (error) {
    console.error('Error deleting folder:', error);
    sendErrorResponse(res, 500, 'Failed to delete folder', error.message);
  }
});

/**
 * POST /api/auth/broadcast-email
 * Permission: email_broadcast
 * Description: Send broadcast email to selected users
 */
router.post('/broadcast-email', authenticateToken, authorize(['email_broadcast']), async (req, res) => {
  try {
    const { userIds, subject, message } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return sendErrorResponse(res, 400, 'User IDs are required');
    }

    if (!subject || !subject.trim()) {
      return sendErrorResponse(res, 400, 'Subject is required');
    }

    if (!message || !message.trim()) {
      return sendErrorResponse(res, 400, 'Message is required');
    }

    const { sendBroadcastEmail } = require('../utils/emailUtils');
    const result = await sendBroadcastEmail(userIds, subject.trim(), message.trim());

    sendSuccessResponse(res, 200, 'Broadcast email sent', result);
  } catch (error) {
    console.error('Error sending broadcast email:', error);
    sendErrorResponse(res, 500, 'Failed to send broadcast email', error.message);
  }
});

// =============================================================================
// DIGITAL SIGNATURE & QR CODE VERIFICATION ROUTES
// =============================================================================

const signatureService = require('../services/signatureService');
const QRCode = require('qrcode');

/**
 * POST /api/auth/sign
 * Generate signed QR code for document
 * Permission: Any authenticated user
 */
router.post('/sign', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { quotationNumber, documentHash, approverId } = req.body;

    if (!quotationNumber || !documentHash || !approverId) {
      return sendErrorResponse(res, 400, 'quotationNumber, documentHash, and approverId are required');
    }

    // Generate QR URL
    const qrUrl = signatureService.generateQRUrl({
      userId: approverId,
      quotationNumber,
      documentHash
    });

    // Generate QR code image as data URL
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 300
    });

    // Also generate as buffer for embedding
    const qrBuffer = await QRCode.toBuffer(qrUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 300
    });

    sendSuccessResponse(res, 200, 'QR code generated successfully', {
      qrUrl,
      qrImage: qrDataUrl,
      qrBuffer: qrBuffer.toString('base64'),
      payload: {
        quotationNumber,
        documentHash,
        approverId,
        timestamp: Math.floor(Date.now() / 1000)
      }
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    sendErrorResponse(res, 500, 'Failed to generate QR code', error.message);
  }
});

/**
 * GET /api/auth/test-signature
 * Test signature generation and verification
 * Permission: Any authenticated user (for debugging)
 */
router.get('/test-signature', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const signatureService = require('../services/signatureService');
    
    // Test data
    const testData = {
      userId: req.user.userId.toString(),
      quotationNumber: 'TEST-001',
      documentHash: 'test_hash_1234567890abcdef'
    };
    
    // Generate QR URL
    const qrUrl = signatureService.generateQRUrl(testData);
    
    // Extract payload and signature from URL
    const urlObj = new URL(qrUrl);
    const payload = urlObj.searchParams.get('p');
    const signature = urlObj.searchParams.get('s');
    
    // Verify
    const result = signatureService.verifyQRData(payload, signature);
    
    // Get key pair info
    const keys = signatureService.getKeyPair();
    const keysExist = !!(keys.privateKey && keys.publicKey);
    
    return res.json({
      success: true,
      data: {
        testData,
        qrUrl,
        payload,
        signature,
        verification: result,
        keysExist,
        privateKeyLength: keys.privateKey?.length || 0,
        publicKeyLength: keys.publicKey?.length || 0
      }
    });
  } catch (error) {
    console.error('Test signature error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * GET /api/auth/verify
 * Verify QR code signature
 * Permission: Public (no auth required)
 */
router.get('/verify', async (req, res) => {
  try {
    const { p, s } = req.query;

    if (!p || !s) {
      // Return HTML error page
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Verification Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <h1 class="error">Verification Error</h1>
          <p>Missing required parameters (p and s)</p>
        </body>
        </html>
      `);
    }

    // Verify QR data
    console.log('Verifying QR code - Payload length:', p?.length, 'Signature length:', s?.length);
    const result = signatureService.verifyQRData(p, s);
    console.log('Verification result:', result.valid ? 'VALID' : 'INVALID', result.error || '');
    console.log('Payload userId type:', typeof result.payload?.userId, 'Value:', result.payload?.userId);

    if (result.valid) {
      // Get user info for display
      let userInfo = null;
      let approvalTimestamp = null;
      
      try {
        // Ensure userId is a string (handle ObjectId or string)
        let userId = result.payload?.userId;
        
        // Convert to string properly
        if (userId) {
          if (typeof userId === 'string') {
            userId = userId;
          } else if (userId && typeof userId === 'object' && userId.toString) {
            userId = userId.toString();
          } else {
            userId = String(userId);
          }
        }
        
        if (userId) {
          const user = await User.findById(userId).select('fullName email');
          if (user) {
            userInfo = {
              name: user.fullName,
              email: user.email
            };
          }
        }
        
        // Try to get actual approval timestamp from quotation
        try {
          const QuotationHeader = require('../models/quotationHeader.model');
          const quotation = await QuotationHeader.findOne({ 
            quotationNumber: result.payload.quotationNumber 
          }).select('updatedAt createdAt');
          
          // Also check RFQ for approval timestamp
          if (quotation?.rfqId) {
            const RFQ = require('../models/rfq.model').RFQ;
            const rfq = await RFQ.findById(quotation.rfqId).select('approvedAt');
            if (rfq?.approvedAt) {
              approvalTimestamp = rfq.approvedAt;
            }
          }
          
          // Fallback to quotation updatedAt if no RFQ approval time
          if (!approvalTimestamp && quotation?.updatedAt) {
            approvalTimestamp = quotation.updatedAt;
          }
        } catch (err) {
          console.warn('Could not fetch approval timestamp:', err);
        }
      } catch (err) {
        console.warn('Could not fetch user info:', err);
      }

      // Return success HTML page
      return res.send(generateVerificationHTML(true, result, userInfo, approvalTimestamp));
    } else {
      // Return error HTML page
      return res.send(generateVerificationHTML(false, result, null));
    }
  } catch (error) {
    console.error('Error verifying QR code:', error);
    return res.status(500).send(generateVerificationHTML(false, {
      valid: false,
      error: 'Verification error',
      message: error.message || 'An error occurred during verification'
    }, null));
  }
});

// Email template constants (matching emailUtils.js)
const COMPANY_NAME = 'ASB';
const COMPANY_LOGO_URL = 'https://i.imgur.com/83wJQlA.png';
const BRAND_COLOR = '#b91c1c';
const BRAND_ACCENT = '#fee2e2';
const BASE_BG = '#f8fafc';

/**
 * Generate verification HTML page (matching email template style)
 */
function generateVerificationHTML(isValid, result, userInfo, approvalTimestamp = null) {
  // Use actual approval timestamp if available, otherwise use signature timestamp
  const approvedAt = approvalTimestamp 
    ? new Date(approvalTimestamp).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      })
    : (result.payload?.timestamp 
        ? new Date(result.payload.timestamp * 1000).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
          })
        : 'N/A');
  
  const quotationNumber = result.payload?.quotationNumber || 'N/A';
  const documentHash = result.payload?.documentHash 
    ? `${result.payload.documentHash.substring(0, 16)}...`
    : 'N/A';
  
  // Safely extract userId as string
  let userIdString = 'N/A';
  if (result.payload?.userId) {
    const userId = result.payload.userId;
    if (typeof userId === 'string') {
      userIdString = userId;
    } else if (userId && typeof userId === 'object') {
      // Handle ObjectId or other objects
      userIdString = userId.toString ? userId.toString() : String(userId);
    } else {
      userIdString = String(userId);
    }
  }

  if (isValid) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Verification - Valid | ${COMPANY_NAME}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background-color: ${BASE_BG};
      padding: 24px;
      min-height: 100vh;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid ${BRAND_ACCENT};
      box-shadow: 0 12px 30px rgba(185,28,28,0.12);
    }
    .header {
      background: ${BRAND_COLOR};
      padding: 24px;
      text-align: center;
    }
    .logo {
      height: 56px;
      display: block;
      margin: 0 auto 8px;
    }
    .header-title {
      margin: 0;
      font-size: 20px;
      color: #ffffff;
      font-weight: 600;
    }
    .content {
      padding: 24px;
      color: #1f2937;
      font-size: 15px;
      line-height: 1.7;
    }
    .status-badge {
      display: inline-block;
      margin: 16px 0;
      padding: 8px 14px;
      background: #d1fae5;
      color: #065f46;
      border-radius: 999px;
      font-weight: 600;
      letter-spacing: 0.5px;
      font-size: 14px;
    }
    .info-section {
      margin: 24px 0;
      padding: 20px;
      background: ${BRAND_ACCENT};
      border-radius: 10px;
      border: 1px solid rgba(185,28,28,0.15);
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid rgba(185,28,28,0.1);
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      color: ${BRAND_COLOR};
      font-weight: 600;
      font-size: 14px;
    }
    .info-value {
      color: #1f2937;
      font-weight: 500;
      font-size: 14px;
      text-align: right;
      word-break: break-word;
    }
    .hash-value {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      word-break: break-all;
    }
    .footer {
      padding: 16px 24px;
      background: #fff5f5;
      color: ${BRAND_COLOR};
      font-size: 12px;
      text-align: center;
      border-top: 1px solid ${BRAND_ACCENT};
    }
    .success-icon {
      display: inline-block;
      width: 48px;
      height: 48px;
      background: #10b981;
      border-radius: 50%;
      margin: 16px auto;
      position: relative;
    }
    .success-icon::after {
      content: '✓';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 28px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header">
      <img src="${COMPANY_LOGO_URL}" alt="${COMPANY_NAME} Logo" class="logo" />
      <h1 class="header-title">Document Verification</h1>
    </div>
    <div class="content">
      <div style="display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <div class="success-icon"></div>
        <div class="status-badge">✓ VERIFIED</div>
      </div>
      <p style="text-align: center; color: #6b7280;">This document signature has been cryptographically verified and is authentic.</p>
      
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">Quotation Number</span>
          <span class="info-value">${quotationNumber}</span>
        </div>
        ${userInfo ? `
        <div class="info-row">
          <span class="info-label">Approved By</span>
          <span class="info-value">${userInfo.name || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Approver Email</span>
          <span class="info-value">${userInfo.email || 'N/A'}</span>
        </div>
        ` : `
        <div class="info-row">
          <span class="info-label">Approved By</span>
          <span class="info-value">User ID: ${userIdString}</span>
        </div>
        `}
        <div class="info-row">
          <span class="info-label">Approved At</span>
          <span class="info-value">${approvedAt}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Document Hash</span>
          <span class="info-value hash-value">${documentHash}</span>
        </div>
      </div>
      
      <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 13px;">This document has been cryptographically signed and verified. The signature confirms the document's authenticity and integrity.</p>
    </div>
    <div class="footer">
      This is an automated verification from ${COMPANY_NAME}. Please do not reply to this page.
    </div>
  </div>
</body>
</html>
    `;
  } else {
    const errorMessage = result.message || 'The document signature is invalid or has been tampered with.';
    const errorTitle = result.error || 'Verification Failed';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Verification - Invalid | ${COMPANY_NAME}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background-color: ${BASE_BG};
      padding: 24px;
      min-height: 100vh;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid ${BRAND_ACCENT};
      box-shadow: 0 12px 30px rgba(185,28,28,0.12);
    }
    .header {
      background: ${BRAND_COLOR};
      padding: 24px;
      text-align: center;
    }
    .logo {
      height: 56px;
      display: block;
      margin: 0 auto 8px;
    }
    .header-title {
      margin: 0;
      font-size: 20px;
      color: #ffffff;
      font-weight: 600;
    }
    .content {
      padding: 24px;
      color: #1f2937;
      font-size: 15px;
      line-height: 1.7;
    }
    .error-badge {
      display: inline-block;
      margin: 16px 0;
      padding: 8px 14px;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 999px;
      font-weight: 600;
      letter-spacing: 0.5px;
      font-size: 14px;
    }
    .error-section {
      margin: 24px 0;
      padding: 20px;
      background: #fef2f2;
      border-radius: 10px;
      border: 1px solid #fecaca;
    }
    .error-title {
      color: #dc2626;
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 8px;
    }
    .error-message {
      color: #991b1b;
      font-size: 14px;
      line-height: 1.6;
    }
    .error-icon {
      display: inline-block;
      width: 48px;
      height: 48px;
      background: #ef4444;
      border-radius: 50%;
      margin: 16px auto;
      position: relative;
    }
    .error-icon::after {
      content: '✕';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 28px;
      font-weight: bold;
    }
    .footer {
      padding: 16px 24px;
      background: #fff5f5;
      color: ${BRAND_COLOR};
      font-size: 12px;
      text-align: center;
      border-top: 1px solid ${BRAND_ACCENT};
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header">
      <img src="${COMPANY_LOGO_URL}" alt="${COMPANY_NAME} Logo" class="logo" />
      <h1 class="header-title">Document Verification</h1>
    </div>
    <div class="content">
      <div style="display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <div class="error-icon"></div>
        <div class="error-badge">✕ INVALID</div>
      </div>
      <p style="margin: 16px 0; text-align: center; color: #6b7280;">This document signature could not be verified.</p>
      
      <div class="error-section">
        <div class="error-title">${errorTitle}</div>
        <div class="error-message">${errorMessage}</div>
      </div>
      
      <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 13px;">If you believe this is an error, please contact ${COMPANY_NAME} support.</p>
    </div>
    <div class="footer">
      This is an automated verification from ${COMPANY_NAME}. Please do not reply to this page.
    </div>
  </div>
</body>
</html>
    `;
  }
}

module.exports = router;
