const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const PermissionCategory = require('../models/permissionCategory.model');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// ============================================================================
// PERMISSION CATEGORY MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/permission-categories
 * Get all permission categories
 * Required Permission: permission_view
 */
router.get('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const categories = await PermissionCategory.find({ isActive: true })
      .populate('createdBy', 'fullName email')
      .sort({ name: 1 });

    sendSuccessResponse(res, 200, 'Permission categories retrieved successfully', categories);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * GET /api/permission-categories/:id
 * Get specific permission category
 * Required Permission: permission_view
 */
router.get('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const category = await PermissionCategory.findById(req.params.id)
      .populate('createdBy', 'fullName email');

    if (!category) {
      return sendErrorResponse(res, 404, 'Permission category not found');
    }

    sendSuccessResponse(res, 200, 'Permission category retrieved successfully', category);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * POST /api/permission-categories
 * Create new permission category
 * Required Permission: permission_create
 */
router.post('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return sendErrorResponse(res, 400, 'Name is required');
    }

    const category = new PermissionCategory({
      name: name.toLowerCase().trim(),
      createdBy: req.user.userId
    });

    await category.save();

    sendSuccessResponse(res, 201, 'Permission category created successfully', category);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * PUT /api/permission-categories/:id
 * Update permission category
 * Required Permission: permission_edit
 */
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { name } = req.body;

    const updateData = {};
    if (name) updateData.name = name.toLowerCase().trim();

    const category = await PermissionCategory.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!category) {
      return sendErrorResponse(res, 404, 'Permission category not found');
    }

    sendSuccessResponse(res, 200, 'Permission category updated successfully', category);
  } catch (error) {
    handleValidationError(res, error);
  }
});

/**
 * DELETE /api/permission-categories/:id
 * Delete permission category (soft delete)
 * Required Permission: permission_delete
 */
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const category = await PermissionCategory.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!category) {
      return sendErrorResponse(res, 404, 'Permission category not found');
    }

    sendSuccessResponse(res, 200, 'Permission category deleted successfully');
  } catch (error) {
    handleValidationError(res, error);
  }
});

module.exports = router;
