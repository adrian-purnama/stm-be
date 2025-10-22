const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const TruckType = require('../models/truckType.model');
const DrawingSpecification = require('../models/drawingSpecification.model');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// ============================================================================
// TRUCK TYPE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/truck-types
 * Get all truck types with pagination and filtering
 * Required Permission: truck_view
 */
router.get('/', authenticateToken, authorize(['truck_view']), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      category, 
      search
    } = req.query;

    // Build filter
    const filter = {};
    
    if (category) {
      filter.category = new RegExp(category, 'i');
    }
    
    if (search) {
      filter.name = new RegExp(search, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const truckTypes = await TruckType.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await TruckType.countDocuments(filter);

    res.json({
      success: true,
      data: truckTypes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      message: 'Truck types retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/truck-types/list
 * Get simple truck types list for dropdowns
 * Required Permission: truck_view
 */
router.get('/list', authenticateToken, authorize(['truck_view']), async (req, res) => {
  try {
    const truckTypes = await TruckType.find({})
      .select('name category')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: truckTypes,
      message: 'Truck types list retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/truck-types/:id
 * Get specific truck type by ID
 * Required Permission: truck_view
 */
router.get('/:id', authenticateToken, authorize(['truck_view']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const truckType = await TruckType.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');

    if (!truckType) {
      return res.status(404).json({
        success: false,
        message: 'Truck type not found'
      });
    }

    res.json({
      success: true,
      data: truckType,
      message: 'Truck type retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * POST /api/truck-types
 * Create new truck type
 * Required Permission: truck_create
 */
router.post('/', authenticateToken, authorize(['truck_create']), async (req, res) => {
  try {
    const { name, description, category, defaultSpecifications } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Truck type name is required'
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
    
    const truckTypeData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      category: category || 'Commercial',
      defaultSpecifications: defaultSpecifications || [],
      createdBy: req.user.userId
    };

    const truckType = new TruckType(truckTypeData);
    await truckType.save();

    const populatedTruckType = await TruckType.findById(truckType._id)
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      data: populatedTruckType,
      message: 'Truck type created successfully'
    });
  } catch (error) {
    // console.error('Error creating truck type:', error);
    
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
      return res.status(400).json({
        success: false,
        message: 'Truck type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/truck-types/:id
 * Update existing truck type
 * Required Permission: truck_update
 */
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, defaultSpecifications } = req.body;
    
    // Validate required fields
    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Truck type name is required'
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

    const updateData = {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description ? description.trim() : '' }),
      ...(category !== undefined && { category }),
      ...(defaultSpecifications !== undefined && { defaultSpecifications }),
      lastModifiedBy: req.user.userId
    };

    const truckType = await TruckType.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('lastModifiedBy', 'fullName email');

    if (!truckType) {
      return res.status(404).json({
        success: false,
        message: 'Truck type not found'
      });
    }

    res.json({
      success: true,
      data: truckType,
      message: 'Truck type updated successfully'
    });
  } catch (error) {
    // console.error('Error updating truck type:', error);
    
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
      return res.status(400).json({
        success: false,
        message: 'Truck type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});


/**
 * DELETE /api/truck-types/:id
 * Delete truck type (checks for dependencies)
 * Required Permission: truck_delete
 */
router.delete('/:id', authenticateToken, authorize(['truck_delete']), async (req, res) => {
  try {
    const { id } = req.params;

    const truckType = await TruckType.findById(id);
    if (!truckType) {
      return res.status(404).json({
        success: false,
        message: 'Truck type not found'
      });
    }

    // Check if truck type is being used by any drawing specifications
    const usageCount = await DrawingSpecification.countDocuments({ truckType: id });

    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete truck type. It is being used by ${usageCount} drawing specification(s).`
      });
    }

    await TruckType.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Truck type deleted successfully'
    });
  } catch (error) {
    // console.error('Error deleting truck type:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get truck type statistics
/**
 * GET /api/truck-types/stats/overview
 * Get truck types statistics and overview
 * Required Permission: truck_view
 */
router.get('/stats/overview', authenticateToken, authorize(['truck_view']), async (req, res) => {
  try {
    const stats = await TruckType.aggregate([
      {
        $group: {
          _id: null,
          totalTruckTypes: { $sum: 1 },
          byCategory: {
            $push: '$category'
          }
        }
      },
      {
        $project: {
          _id: 0,
          totalTruckTypes: 1,
          categoryBreakdown: {
            $reduce: {
              input: '$byCategory',
              initialValue: {},
              in: {
                $mergeObjects: [
                  '$$value',
                  {
                    $arrayToObject: [
                      [{ k: '$$this', v: { $add: [{ $ifNull: [{ $getField: { field: '$$this', input: '$$value' } }, 0] }, 1] } }]
                    ]
                  }
                ]
              }
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalTruckTypes: 0,
        categoryBreakdown: {}
      },
      message: 'Statistics retrieved successfully'
    });
  } catch (error) {
    // console.error('Error getting statistics:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
