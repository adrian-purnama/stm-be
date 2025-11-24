const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const BodyType = require('../models/bodyType.model');
const DrawingSpecification = require('../models/drawingSpecification.model');
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
// BODY TYPE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/body-types
 * Get all body types with pagination and filtering
 * Required Permission: truck_view
 */
router.get('/', authenticateToken, authorize(['truck_view']), async (req, res) => {
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
    
    const bodyTypes = await BodyType.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BodyType.countDocuments(filter);

    res.json({
      success: true,
      data: bodyTypes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      message: 'Body types retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/body-types/list
 * Get simple body types list for dropdowns
 * Required Permission: truck_view
 */
router.get('/list', authenticateToken, authorize(['truck_view']), async (req, res) => {
  try {
    const bodyTypes = await BodyType.find({})
      .select('name shortName defaultSpecifications')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: bodyTypes,
      message: 'Body types list retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/body-types/:id
 * Get specific body type by ID
 * Required Permission: truck_view
 */
router.get('/:id', authenticateToken, authorize(['truck_view']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const bodyType = await BodyType.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');

    if (!bodyType) {
      return res.status(404).json({
        success: false,
        message: 'Body type not found'
      });
    }

    res.json({
      success: true,
      data: bodyType,
      message: 'Body type retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * POST /api/body-types
 * Create new body type
 * Required Permission: truck_create
 */
router.post('/', authenticateToken, authorize(['truck_create']), async (req, res) => {
  try {
    const { name, shortName, description, defaultSpecifications } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Body type name is required'
      });
    }
    
    if (!shortName || !shortName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Body type short name is required'
      });
    }
    
    if (shortName.trim().length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Short name must be 20 characters or less'
      });
    }

    // Validate defaultSpecifications structure if provided
    if (defaultSpecifications && Array.isArray(defaultSpecifications)) {
      for (const spec of defaultSpecifications) {
        if (!spec.category || !spec.category.trim()) {
          return res.status(400).json({
            success: false,
            message: 'Each specification category must have a category name'
          });
        }
        
        if (!spec.items || !Array.isArray(spec.items)) {
          return res.status(400).json({
            success: false,
            message: 'Each specification category must have items array'
          });
        }
        
        for (const item of spec.items) {
          if (!item.name || !item.name.trim() || !item.specification || !item.specification.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Each specification item must have both name and specification'
            });
          }
        }
      }
    }
    
    const bodyTypeData = {
      name: toTitleCase(name),
      shortName: shortName.trim().toUpperCase(),
      description: description ? description.trim() : '',
      defaultSpecifications: defaultSpecifications || [],
      createdBy: req.user.userId
    };

    const bodyType = new BodyType(bodyTypeData);
    await bodyType.save();

    const populatedBodyType = await BodyType.findById(bodyType._id)
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      data: populatedBodyType,
      message: 'Body type created successfully'
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
          message: 'Body type short name already exists'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Body type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/body-types/:id
 * Update existing body type
 * Required Permission: placeholder_test
 */
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, shortName, description, defaultSpecifications } = req.body;
    
    // Validate required fields
    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Body type name is required'
      });
    }
    
    if (shortName !== undefined) {
      if (!shortName || !shortName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Body type short name is required'
        });
      }
      if (shortName.trim().length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Short name must be 20 characters or less'
        });
      }
    }

    // Validate defaultSpecifications structure if provided
    if (defaultSpecifications && Array.isArray(defaultSpecifications)) {
      for (const spec of defaultSpecifications) {
        if (!spec.category || !spec.category.trim()) {
          return res.status(400).json({
            success: false,
            message: 'Each specification category must have a category name'
          });
        }
        
        if (!spec.items || !Array.isArray(spec.items)) {
          return res.status(400).json({
            success: false,
            message: 'Each specification category must have items array'
          });
        }
        
        for (const item of spec.items) {
          if (!item.name || !item.name.trim() || !item.specification || !item.specification.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Each specification item must have both name and specification'
            });
          }
        }
      }
    }

    const updateData = {
      ...(name !== undefined && { name: toTitleCase(name) }),
      ...(shortName !== undefined && { shortName: shortName.trim().toUpperCase() }),
      ...(description !== undefined && { description: description ? description.trim() : '' }),
      ...(defaultSpecifications !== undefined && { defaultSpecifications }),
      lastModifiedBy: req.user.userId
    };

    const bodyType = await BodyType.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('lastModifiedBy', 'fullName email');

    if (!bodyType) {
      return res.status(404).json({
        success: false,
        message: 'Body type not found'
      });
    }

    res.json({
      success: true,
      data: bodyType,
      message: 'Body type updated successfully'
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
          message: 'Body type short name already exists'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Body type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/body-types/:id
 * Delete body type (checks for dependencies)
 * Required Permission: truck_delete
 */
router.delete('/:id', authenticateToken, authorize(['truck_delete']), async (req, res) => {
  try {
    const { id } = req.params;

    const bodyType = await BodyType.findById(id);
    if (!bodyType) {
      return res.status(404).json({
        success: false,
        message: 'Body type not found'
      });
    }

    // Check if body type is being used by any drawing specifications
    const usageCount = await DrawingSpecification.countDocuments({ truckType: id });

    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete body type. It is being used by ${usageCount} drawing specification(s).`
      });
    }

    await BodyType.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Body type deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
