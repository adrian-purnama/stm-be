const express = require('express');
const router = express.Router();
const { authenticateToken, authorize, authorizeAll } = require('../middleware/auth');
const Role = require('../models/role.model');
const User = require('../models/user.model');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// ============================================================================
// ROLE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/roles
 * Get all active roles with their permissions
 * Required Permission: role_view
 */
router.get('/', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const roles = await Role.find({ isActive: true })
      .populate('createdBy', 'fullName email')
      .populate('permissions', 'name displayName description category')
      .populate('permissions.category', 'name')
      .sort({ displayName: 1 });

    sendSuccessResponse(res, 200, 'Roles retrieved successfully', roles);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * GET /api/roles/:id
 * Get specific role by ID
 * Required Permission: role_view
 */
router.get('/:id', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const role = await Role.findById(req.params.id)
      .populate('createdBy', 'fullName email');

    if (!role) {
      return sendErrorResponse(res, 404, 'Role not found');
    }

    sendSuccessResponse(res, 200, 'Role retrieved successfully', role);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/roles
 * Create new role with specific permissions
 * Required Permission: role_create
 */
router.post('/', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { name, displayName, description, permissions } = req.body;

    // Validate required fields
    if (!name || !displayName || !permissions || !Array.isArray(permissions)) {
      return sendErrorResponse(res, 400, 'Name, displayName, and permissions are required');
    }

    // Check if role already exists
    const existingRole = await Role.findOne({ name: name.toLowerCase() });
    if (existingRole) {
      return sendErrorResponse(res, 400, 'Role with this name already exists');
    }

    const role = new Role({
      name: name.toLowerCase(),
      displayName,
      description,
      permissions,
      createdBy: req.user.userId
    });

    await role.save();
    
    // Populate permissions for response
    await role.populate('permissions', 'name displayName description category');
    await role.populate('permissions.category', 'name');

    sendSuccessResponse(res, 201, 'Role created successfully', role);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * PUT /api/roles/:id
 * Update existing role
 * Required Permission: role_update
 */
router.put('/:id', authenticateToken, authorizeAll(), async (req, res) => {
  console.log('PUT /api/roles/:id - Request body:', req.body);
  try {
    const { id } = req.params;
    const { displayName, description, permissions } = req.body;

    console.log('PUT /api/roles/:id - Role ID:', id);
    console.log('PUT /api/roles/:id - Request body:', req.body);
    console.log('PUT /api/roles/:id - Permissions:', permissions);

    const role = await Role.findById(id);
    if (!role) {
      console.log('Role not found with ID:', id);
      return sendErrorResponse(res, 404, 'Role not found');
    }

    console.log('Found role:', role);

    // Prepare update data
    const updateData = {};
    if (displayName) updateData.displayName = displayName;
    if (description !== undefined) updateData.description = description;
    if (permissions && Array.isArray(permissions)) updateData.permissions = permissions;

    console.log('Update data:', updateData);

    // Use findByIdAndUpdate to avoid validation issues with required fields
    const updatedRole = await Role.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('permissions', 'name displayName description category')
    .populate('permissions.category', 'name');

    console.log('Role updated successfully');
    sendSuccessResponse(res, 200, 'Role updated successfully', updatedRole);
  } catch (error) {
    console.error('Error updating role:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    handleValidationError(res, error);
  }
});

/**
 * DELETE /api/roles/:id
 * Delete role (soft delete by setting isActive to false)
 * Required Permission: role_delete
 */
router.delete('/:id', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if role is assigned to any users
    const usersWithRole = await User.find({ roles: id });
    if (usersWithRole.length > 0) {
      return sendErrorResponse(res, 400, `Cannot delete role. It is assigned to ${usersWithRole.length} user(s).`);
    }

    const role = await Role.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!role) {
      return sendErrorResponse(res, 404, 'Role not found');
    }

    sendSuccessResponse(res, 200, 'Role deleted successfully');
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/roles/:roleId/assign/:userId
 * Assign role to user
 * Required Permission: user_manage
 */
router.post('/:roleId/assign/:userId', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { roleId, userId } = req.params;

    const role = await Role.findById(roleId);
    if (!role) {
      return sendErrorResponse(res, 404, 'Role not found');
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Check if user already has this role
    if (user.roles.includes(roleId)) {
      return sendErrorResponse(res, 400, 'User already has this role');
    }

    user.roles.push(roleId);
    await user.save();

    sendSuccessResponse(res, 200, 'Role assigned successfully');
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * DELETE /api/roles/:roleId/remove/:userId
 * Remove role from user
 * Required Permission: user_manage
 */
router.delete('/:roleId/remove/:userId', authenticateToken,authorizeAll(), async (req, res) => {
  try {
    const { roleId, userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    user.roles = user.roles.filter(role => role.toString() !== roleId);
    await user.save();

    sendSuccessResponse(res, 200, 'Role removed successfully');
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * GET /api/roles/:id/users
 * Get all users with specific role
 * Required Permission: role_view
 */
router.get('/:id/users', authenticateToken, authorizeAll(), async (req, res) => {
  try {
    const { id } = req.params;

    const users = await User.find({ roles: id })
      .select('fullName email isActive createdAt')
      .sort({ fullName: 1 });

    sendSuccessResponse(res, 200, 'Users with role retrieved successfully', users);
  } catch (error) {
    handleValidationError(res, error);
  }
});

module.exports = router;
