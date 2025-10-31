const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const SizeType = require('../models/sizeType.model');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// Helper function to convert string to title case
const toTitleCase = (str) => {
  if (!str) return str;
  return str
    .trim()
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// ============================================================================
// SIZE TYPE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/size-types
 * Get all size types with pagination and filtering
 * Required Permission: placeholder_test
 */
router.get('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search
    } = req.query;

    // Build filter
    const filter = {};
    
    if (search) {
      filter.name = new RegExp(search, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const sizeTypes = await SizeType.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SizeType.countDocuments(filter);

    res.json({
      success: true,
      data: sizeTypes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      message: 'Size types retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/size-types/list
 * Get simple size types list for dropdowns
 * Required Permission: placeholder_test
 */
router.get('/list', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const sizeTypes = await SizeType.find({})
      .select('name shortName')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: sizeTypes,
      message: 'Size types list retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/size-types/:id
 * Get specific size type by ID
 * Required Permission: placeholder_test
 */
router.get('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const sizeType = await SizeType.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');

    if (!sizeType) {
      return res.status(404).json({
        success: false,
        message: 'Size type not found'
      });
    }

    res.json({
      success: true,
      data: sizeType,
      message: 'Size type retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * POST /api/size-types
 * Create new size type
 * Required Permission: placeholder_test
 */
router.post('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { name, shortName } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Size type name is required'
      });
    }
    
    if (!shortName || !shortName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Size type short name is required'
      });
    }
    
    if (shortName.trim().length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Short name must be 20 characters or less'
      });
    }
    
    const sizeTypeData = {
      name: toTitleCase(name),
      shortName: shortName.trim().toUpperCase(),
      createdBy: req.user.userId
    };

    const sizeType = new SizeType(sizeTypeData);
    await sizeType.save();

    const populatedSizeType = await SizeType.findById(sizeType._id)
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      data: populatedSizeType,
      message: 'Size type created successfully'
    });
  } catch (error) {
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    // Handle duplicate key error
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0];
      if (duplicateField === 'shortName') {
        return res.status(400).json({
          success: false,
          message: 'Size type short name already exists'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Size type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/size-types/:id
 * Update existing size type
 * Required Permission: placeholder_test
 */
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, shortName } = req.body;
    
    // Validate required fields
    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Size type name is required'
      });
    }
    
    if (shortName !== undefined) {
      if (!shortName || !shortName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Size type short name is required'
        });
      }
      if (shortName.trim().length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Short name must be 20 characters or less'
        });
      }
    }

    const updateData = {
      ...(name !== undefined && { name: toTitleCase(name) }),
      ...(shortName !== undefined && { shortName: shortName.trim().toUpperCase() }),
      lastModifiedBy: req.user.userId
    };

    const sizeType = await SizeType.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('lastModifiedBy', 'fullName email');

    if (!sizeType) {
      return res.status(404).json({
        success: false,
        message: 'Size type not found'
      });
    }

    res.json({
      success: true,
      data: sizeType,
      message: 'Size type updated successfully'
    });
  } catch (error) {
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    // Handle duplicate key error
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0];
      if (duplicateField === 'shortName') {
        return res.status(400).json({
          success: false,
          message: 'Size type short name already exists'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Size type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/size-types/:id
 * Delete size type
 * Required Permission: placeholder_test
 */
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;

    const sizeType = await SizeType.findById(id);
    if (!sizeType) {
      return res.status(404).json({
        success: false,
        message: 'Size type not found'
      });
    }

    await SizeType.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Size type deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;




