const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const Permission = require('../models/permission.model');
const PermissionCategory = require('../models/permissionCategory.model');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// ============================================================================
// PERMISSION MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/permissions
 * Get all permissions with their categories
 * Required Permission: permission_view
 */
router.get('/', authenticateToken, authorize(['permission_view']), async (req, res) => {
  try {
    const permissions = await Permission.find({ isActive: true })
      .populate('category', 'name')
      .populate('createdBy', 'fullName email')
      .sort({ displayName: 1 });

    sendSuccessResponse(res, 200, 'Permissions retrieved successfully', permissions);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * GET /api/permissions/category/:categoryId
 * Get permissions by category
 * Required Permission: permission_view
 */
router.get('/category/:categoryId', authenticateToken, authorize(['permission_view']), async (req, res) => {
  try {
    const permissions = await Permission.find({ 
      category: req.params.categoryId,
      isActive: true 
    })
      .populate('category', 'name')
      .populate('createdBy', 'fullName email')
      .sort({ displayName: 1 });

    sendSuccessResponse(res, 200, 'Permissions retrieved successfully', permissions);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * GET /api/permissions/:id
 * Get specific permission
 * Required Permission: permission_view
 */
router.get('/:id', authenticateToken, authorize(['permission_view']), async (req, res) => {
  try {
    const permission = await Permission.findById(req.params.id)
      .populate('category', 'name')
      .populate('createdBy', 'fullName email');

    if (!permission) {
      return sendErrorResponse(res, 404, 'Permission not found');
    }

    sendSuccessResponse(res, 200, 'Permission retrieved successfully', permission);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/permissions
 * Create new permission
 * Required Permission: permission_create
 */
router.post('/', authenticateToken, authorize(['permission_create']), async (req, res) => {
  try {
    console.log('Creating permission with data:', req.body);
    const { name, displayName, description, categoryId, categoryName, type, includes } = req.body;

    if (!name || !displayName) {
      return sendErrorResponse(res, 400, 'Name and display name are required');
    }

    if (!categoryId && !categoryName) {
      return sendErrorResponse(res, 400, 'Either categoryId or categoryName is required');
    }

    let category;

    // If categoryId is provided, use it
    if (categoryId) {
      category = await PermissionCategory.findById(categoryId);
      if (!category) {
        return sendErrorResponse(res, 404, 'Permission category not found');
      }
    }
    // If categoryName is provided, find or create category
    else if (categoryName) {
      category = await PermissionCategory.findOne({ 
        name: categoryName.toLowerCase().trim() 
      });
      
      if (!category) {
        // Create new category
        category = new PermissionCategory({
          name: categoryName.toLowerCase().trim(),
          createdBy: req.user.userId
        });
        await category.save();
      }
    }

    // Determine type automatically if not provided
    const permissionType = type || (includes && includes.length > 0 ? 'multi' : 'individual');

    const permission = new Permission({
      name: name.toLowerCase().trim(),
      displayName: displayName.trim(),
      description: description?.trim(),
      category: category._id,
      type: permissionType,
      includes: includes || [],
      createdBy: req.user.userId
    });

    await permission.save();
    await permission.populate('category', 'name');

    sendSuccessResponse(res, 201, 'Permission created successfully', permission);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * PUT /api/permissions/:id
 * Update permission
 * Required Permission: permission_edit
 */
router.put('/:id', authenticateToken, authorize(['permission_edit']), async (req, res) => {
  try {
    const { name, displayName, description, categoryId, type, includes } = req.body;

    console.log('=== PERMISSION UPDATE DEBUG ===');
    console.log('Permission ID:', req.params.id);
    console.log('Update data received:', req.body);

    const updateData = {};
    
    // Handle name update
    if (name !== undefined) {
      const trimmedName = name.trim().toLowerCase();
      console.log('Updating permission name to:', trimmedName);
      
      // Get the current permission to check if name is changing
      const currentPermission = await Permission.findById(req.params.id);
      const oldName = currentPermission.name;
      
      // Check if another permission with this name already exists
      const existingPermission = await Permission.findOne({ 
        name: trimmedName, 
        _id: { $ne: req.params.id },
        isActive: true 
      });
      
      if (existingPermission) {
        console.log('ERROR: Permission name already exists:', existingPermission.name);
        return sendErrorResponse(res, 400, 'Permission name already exists');
      }
      
      updateData.name = trimmedName;
      
      // If name is changing, update all multi-permissions that reference the old name
      if (oldName !== trimmedName) {
        console.log(`Permission name changing from "${oldName}" to "${trimmedName}"`);
        
        const multiPermissions = await Permission.find({ 
          type: 'multi', 
          includes: oldName,
          isActive: true 
        });

        let multiPermissionsUpdated = 0;
        for (const multiPerm of multiPermissions) {
          const updatedIncludes = multiPerm.includes.map(perm => 
            perm === oldName ? trimmedName : perm
          );
          await Permission.findByIdAndUpdate(multiPerm._id, { includes: updatedIncludes });
          multiPermissionsUpdated++;
          console.log(`Updated multi-permission "${multiPerm.name}" to use new name "${trimmedName}"`);
        }
        
        console.log(`Updated ${multiPermissionsUpdated} multi-permissions with new permission name`);
      }
    }
    
    if (displayName) updateData.displayName = displayName.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (type) updateData.type = type;
    if (includes !== undefined) updateData.includes = includes;
    if (categoryId) {
      const category = await PermissionCategory.findById(categoryId);
      if (!category) {
        return sendErrorResponse(res, 404, 'Permission category not found');
      }
      updateData.category = categoryId;
    }

    console.log('Final update data:', updateData);

    const permission = await Permission.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('category', 'name');

    if (!permission) {
      console.log('ERROR: Permission not found with ID:', req.params.id);
      return sendErrorResponse(res, 404, 'Permission not found');
    }

    console.log('Permission updated successfully:', {
      id: permission._id,
      name: permission.name,
      displayName: permission.displayName
    });
    console.log('=== END PERMISSION UPDATE DEBUG ===');

    sendSuccessResponse(res, 200, 'Permission updated successfully', permission);
  } catch (error) {
    console.error('=== PERMISSION UPDATE ERROR ===');
    console.error('Error updating permission:', error);
    console.error('=== END PERMISSION UPDATE ERROR ===');
    handleValidationError(res, error);
  }
});

/**
 * DELETE /api/permissions/:id
 * Delete permission with cascade deletion
 * Required Permission: permission_delete
 */
router.delete('/:id', authenticateToken, authorize(['permission_delete']), async (req, res) => {
  try {
    const permissionId = req.params.id;
    
    // Find the permission first
    const permission = await Permission.findById(permissionId);
    if (!permission) {
      return sendErrorResponse(res, 404, 'Permission not found');
    }

    console.log(`Starting cascade deletion for permission: ${permission.name}`);

    // 1. Remove this permission from all multi-permissions that include it
    const multiPermissions = await Permission.find({ 
      type: 'multi', 
      includes: permission.name,
      isActive: true 
    });

    let multiPermissionsUpdated = 0;
    for (const multiPerm of multiPermissions) {
      const updatedIncludes = multiPerm.includes.filter(perm => perm !== permission.name);
      await Permission.findByIdAndUpdate(multiPerm._id, { includes: updatedIncludes });
      multiPermissionsUpdated++;
      console.log(`Removed ${permission.name} from multi-permission: ${multiPerm.name}`);
    }

    // 2. Remove this permission from all users who have it
    const User = require('../models/user.model');
    const usersWithPermission = await User.find({ 
      permissions: permissionId,
      isActive: true 
    });

    let usersUpdated = 0;
    for (const user of usersWithPermission) {
      const updatedPermissions = user.permissions.filter(permId => 
        permId.toString() !== permissionId.toString()
      );
      await User.findByIdAndUpdate(user._id, { permissions: updatedPermissions });
      usersUpdated++;
      console.log(`Removed ${permission.name} from user: ${user.email}`);
    }

    // 3. Soft delete the permission
    await Permission.findByIdAndUpdate(permissionId, { isActive: false });

    console.log(`Cascade deletion completed for ${permission.name}:`);
    console.log(`- Updated ${multiPermissionsUpdated} multi-permissions`);
    console.log(`- Updated ${usersUpdated} users`);

    sendSuccessResponse(res, 200, 'Permission deleted successfully with cascade cleanup', {
      permissionName: permission.name,
      multiPermissionsUpdated,
      usersUpdated
    });
  } catch (error) {
    console.error('Error during cascade permission deletion:', error);
    handleValidationError(res, error);
  }
});

module.exports = router;
