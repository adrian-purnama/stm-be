const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const ChassisType = require('../models/chassisType.model');
const { sendErrorResponse, sendSuccessResponse, handleValidationError, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// ============================================================================
// CHASSIS TYPE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/chassis-types
 * Get all chassis types with pagination and filtering
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
    
    const chassisTypes = await ChassisType.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ChassisType.countDocuments(filter);

    res.json({
      success: true,
      data: chassisTypes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      message: 'Chassis types retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/chassis-types/list
 * Get simple chassis types list for dropdowns
 * Required Permission: placeholder_test
 */
router.get('/list', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const chassisTypes = await ChassisType.find({})
      .select('name shortName')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: chassisTypes,
      message: 'Chassis types list retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/chassis-types/:id
 * Get specific chassis type by ID
 * Required Permission: placeholder_test
 */
router.get('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const chassisType = await ChassisType.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');

    if (!chassisType) {
      return res.status(404).json({
        success: false,
        message: 'Chassis type not found'
      });
    }

    res.json({
      success: true,
      data: chassisType,
      message: 'Chassis type retrieved successfully'
    });
  } catch (error) {
    sendErrorResponse(res, 400, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * POST /api/chassis-types
 * Create new chassis type
 * Required Permission: placeholder_test
 */
router.post('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { name, shortName } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Chassis type name is required'
      });
    }
    
    if (!shortName || !shortName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Chassis type short name is required'
      });
    }
    
    if (shortName.trim().length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Short name must be 20 characters or less'
      });
    }
    
    // Normalize for checking (title case for name, uppercase for shortName)
    const normalizedName = name.trim().split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    const normalizedShortName = shortName.trim().toUpperCase();
    
    // Check if name already exists
    const existingByName = await ChassisType.findOne({ 
      $or: [
        { name: normalizedName },
        { shortName: normalizedShortName }
      ]
    });
    
    if (existingByName) {
      if (existingByName.name === normalizedName) {
        return res.status(400).json({
          success: false,
          message: 'Chassis type name already exists'
        });
      }
      if (existingByName.shortName === normalizedShortName) {
        return res.status(400).json({
          success: false,
          message: 'Chassis type short name already exists'
        });
      }
    }
    
    const chassisTypeData = {
      name: normalizedName,
      shortName: normalizedShortName,
      createdBy: req.user.userId
    };

    let chassisType;
    try {
      chassisType = new ChassisType(chassisTypeData);
      await chassisType.save();
    } catch (saveError) {
      // If we get a duplicate key error on shortname_1 (old index), fix it automatically
      if (saveError.code === 11000 && saveError.keyPattern && saveError.keyPattern.shortname) {
        console.log('Detected old shortname index conflict, fixing automatically...');
        
        try {
          const collection = ChassisType.collection;
          const indexes = await collection.indexes();
          const oldIndex = indexes.find(idx => idx.name === 'shortname_1');
          
          if (oldIndex) {
            await collection.dropIndex('shortname_1');
            console.log('Dropped old shortname_1 index');
          }
          
          // Also ensure all existing records have shortName
          const recordsWithoutShortName = await ChassisType.find({
            $or: [
              { shortName: { $exists: false } },
              { shortName: null },
              { shortName: '' }
            ]
          });
          
          for (const record of recordsWithoutShortName) {
            let generatedShortName = '';
            if (record.name) {
              const words = record.name.trim().toUpperCase().split(/\s+/);
              if (words.length === 1) {
                generatedShortName = words[0].substring(0, 4).replace(/[^A-Z0-9]/g, '');
              } else {
                generatedShortName = words.map(w => w.charAt(0)).join('').substring(0, 4);
              }
              if (!generatedShortName) {
                generatedShortName = 'CH' + record._id.toString().substring(0, 2).toUpperCase();
              }
              
              let finalShortName = generatedShortName;
              let counter = 1;
              while (await ChassisType.findOne({ shortName: finalShortName, _id: { $ne: record._id } })) {
                finalShortName = generatedShortName.substring(0, 3) + counter;
                counter++;
              }
              
              record.shortName = finalShortName;
              await record.save();
            }
          }
          
          // Retry saving
          chassisType = new ChassisType(chassisTypeData);
          await chassisType.save();
        } catch (retryError) {
          console.error('Error fixing index issue:', retryError);
          throw saveError; // Return original error
        }
      } else {
        throw saveError;
      }
    }

    const populatedChassisType = await ChassisType.findById(chassisType._id)
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      data: populatedChassisType,
      message: 'Chassis type created successfully'
    });
  } catch (error) {
    console.log(error);
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
        message: 'Chassis type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/chassis-types/:id
 * Update existing chassis type
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
        message: 'Chassis type name is required'
      });
    }

    if (shortName !== undefined && (!shortName || !shortName.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Chassis type short name is required'
      });
    }

    if (shortName !== undefined && shortName.trim().length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Short name must be 20 characters or less'
      });
    }

    // Get existing chassis type to check for duplicates
    const existingChassisType = await ChassisType.findById(id);
    if (!existingChassisType) {
      return res.status(404).json({
        success: false,
        message: 'Chassis type not found'
      });
    }

    // Build update data with normalization
    const updateData = {
      lastModifiedBy: req.user.userId
    };

    if (name !== undefined) {
      updateData.name = name.trim().split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
    }

    if (shortName !== undefined) {
      updateData.shortName = shortName.trim().toUpperCase();
    }

    // Check for duplicates if name or shortName is being updated
    if (name !== undefined || shortName !== undefined) {
      const normalizedName = updateData.name || existingChassisType.name;
      const normalizedShortName = updateData.shortName || existingChassisType.shortName;

      const duplicateCheck = await ChassisType.findOne({
        _id: { $ne: id },
        $or: [
          { name: normalizedName },
          { shortName: normalizedShortName }
        ]
      });

      if (duplicateCheck) {
        if (duplicateCheck.name === normalizedName) {
          return res.status(400).json({
            success: false,
            message: 'Chassis type name already exists'
          });
        }
        if (duplicateCheck.shortName === normalizedShortName) {
          return res.status(400).json({
            success: false,
            message: 'Chassis type short name already exists'
          });
        }
      }
    }

    const chassisType = await ChassisType.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('lastModifiedBy', 'fullName email');

    if (!chassisType) {
      return res.status(404).json({
        success: false,
        message: 'Chassis type not found'
      });
    }

    res.json({
      success: true,
      data: chassisType,
      message: 'Chassis type updated successfully'
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
      return res.status(400).json({
        success: false,
        message: 'Chassis type name already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/chassis-types/:id
 * Delete chassis type
 * Required Permission: placeholder_test
 */
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;

    const chassisType = await ChassisType.findById(id);
    if (!chassisType) {
      return res.status(404).json({
        success: false,
        message: 'Chassis type not found'
      });
    }

    await ChassisType.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Chassis type deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/chassis-types/fix-indexes
 * Fix old index issues and update existing records
 * Required Permission: placeholder_test
 * This is a one-time migration endpoint
 */
router.post('/fix-indexes', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const collection = ChassisType.collection;
    
    // Step 1: Get all indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(idx => idx.name));
    
    // Step 2: Drop old lowercase shortname index if it exists
    const oldIndex = indexes.find(idx => 
      idx.name === 'shortname_1' || 
      (idx.key && idx.key.shortname && !idx.key.shortName)
    );
    
    if (oldIndex) {
      try {
        await collection.dropIndex(oldIndex.name);
        console.log(`Dropped old index: ${oldIndex.name}`);
      } catch (err) {
        if (err.code !== 27) { // 27 = IndexNotFound
          throw err;
        }
      }
    }
    
    // Step 3: Find all chassis types without shortName
    const chassisTypesWithoutShortName = await ChassisType.find({ 
      $or: [
        { shortName: { $exists: false } },
        { shortName: null },
        { shortName: '' }
      ]
    });
    
    console.log(`Found ${chassisTypesWithoutShortName.length} chassis types without shortName`);
    
    // Step 4: Generate shortName for each (use first 3 letters of name in uppercase)
    for (const chassisType of chassisTypesWithoutShortName) {
      let generatedShortName = '';
      
      if (chassisType.name) {
        // Take first 3-4 letters, remove spaces, make uppercase
        const words = chassisType.name.trim().toUpperCase().split(/\s+/);
        if (words.length === 1) {
          generatedShortName = words[0].substring(0, 4).replace(/[^A-Z0-9]/g, '');
        } else {
          // Use first letter of each word
          generatedShortName = words.map(w => w.charAt(0)).join('').substring(0, 4);
        }
        
        // Ensure it's not empty and make it unique if needed
        if (!generatedShortName || generatedShortName.length === 0) {
          generatedShortName = 'CH' + chassisType._id.toString().substring(0, 2).toUpperCase();
        }
        
        // Check if this shortName already exists
        let finalShortName = generatedShortName;
        let counter = 1;
        while (await ChassisType.findOne({ shortName: finalShortName, _id: { $ne: chassisType._id } })) {
          finalShortName = generatedShortName.substring(0, 3) + counter;
          counter++;
        }
        
        chassisType.shortName = finalShortName;
        await chassisType.save();
        console.log(`Updated ${chassisType.name} with shortName: ${finalShortName}`);
      }
    }
    
    // Step 5: Ensure the new index exists
    try {
      await ChassisType.collection.createIndex({ shortName: 1 }, { unique: true, name: 'shortName_1' });
      console.log('Created new shortName index');
    } catch (err) {
      if (err.code !== 85) { // 85 = IndexOptionsConflict
        console.error('Error creating index:', err.message);
      }
    }
    
    res.json({
      success: true,
      message: `Fixed indexes and updated ${chassisTypesWithoutShortName.length} chassis types`,
      updatedCount: chassisTypesWithoutShortName.length
    });
  } catch (error) {
    console.error('Error fixing indexes:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

