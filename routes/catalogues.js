const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const catalogueHelper = require('../utils/catalogueHelper');
const { sendSuccessResponse, sendErrorResponse, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// GET /api/catalogues - List catalogues with pagination
router.get('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search, bodyType } = req.query;

    // Validate pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return sendErrorResponse(res, 400, 'Page must be a positive integer');
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return sendErrorResponse(res, 400, 'Limit must be between 1 and 100');
    }

    const result = await catalogueHelper.getCatalogues({
      page: pageNum,
      limit: limitNum,
      search: search ? search.trim() : null,
      bodyType: bodyType || null
    });

    return sendSuccessResponse(res, 200, 'Catalogues retrieved successfully', result.catalogues, result.pagination);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error getting catalogues:', err);
    return sendErrorResponse(res, status, message);
  }
});

// GET /api/catalogues/body-type/:bodyTypeId - Get catalogue by body type
router.get('/body-type/:bodyTypeId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const catalogue = await catalogueHelper.getCatalogueByBodyType(req.params.bodyTypeId);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.RETRIEVED, catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error getting catalogue by body type:', err);
    return sendErrorResponse(res, status, message);
  }
});

// GET /api/catalogues/:id - Get catalogue by ID
router.get('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const catalogue = await catalogueHelper.getCatalogueById(req.params.id);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.RETRIEVED, catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error getting catalogue:', err);
    return sendErrorResponse(res, status, message);
  }
});

// POST /api/catalogues - Create catalogue
router.post('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { bodyType, article, variantCategories, sizes, chassis, leadTime, notes } = req.body;

    // Validate required fields
    if (!bodyType) {
      return sendErrorResponse(res, 400, 'Body type is required');
    }

    if (!mongoose.Types.ObjectId.isValid(bodyType)) {
      return sendErrorResponse(res, 400, 'Invalid body type ID');
    }

    // Validate variant categories structure
    if (variantCategories && Array.isArray(variantCategories)) {
      for (const cat of variantCategories) {
        if (!cat.category || !cat.category.trim()) {
          return sendErrorResponse(res, 400, 'Variant category must have a category name');
        }
        if (!Array.isArray(cat.values) || cat.values.length === 0) {
          return sendErrorResponse(res, 400, 'Variant category must have at least one value');
        }
      }
    }

    // Validate sizes structure
    if (sizes && Array.isArray(sizes)) {
      for (const size of sizes) {
        if (size.sizeType && !mongoose.Types.ObjectId.isValid(size.sizeType)) {
          return sendErrorResponse(res, 400, 'Invalid size type ID');
        }
      }
    }

    // Validate chassis structure
    if (chassis && Array.isArray(chassis)) {
      for (const ch of chassis) {
        if (ch.chassisType && !mongoose.Types.ObjectId.isValid(ch.chassisType)) {
          return sendErrorResponse(res, 400, 'Invalid chassis type ID');
        }
        if (ch.chassisDetails && !Array.isArray(ch.chassisDetails)) {
          return sendErrorResponse(res, 400, 'Chassis details must be an array');
        }
      }
    }

    const catalogue = await catalogueHelper.createCatalogue({
      bodyType,
      article: article || '',
      variantCategories: variantCategories || [],
      sizes: sizes || [],
      chassis: chassis || [],
      leadTime: leadTime || '',
      notes: notes || '',
      createdBy: req.user.userId
    });

    return sendSuccessResponse(res, 201, 'Catalogue created successfully', catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error creating catalogue:', err);
    return sendErrorResponse(res, status, message);
  }
});

// PUT /api/catalogues/:id - Update catalogue
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { article, variantCategories, sizes, chassis, shopCatalogueOverrides, leadTime, notes } = req.body;

    // Validate at least one field is provided
    if (!article && !variantCategories && !sizes && !chassis && shopCatalogueOverrides === undefined && leadTime === undefined && notes === undefined) {
      return sendErrorResponse(res, 400, 'At least one field must be provided for update');
    }

    // Validate variant categories structure if provided
    if (variantCategories !== undefined) {
      if (!Array.isArray(variantCategories)) {
        return sendErrorResponse(res, 400, 'Variant categories must be an array');
      }
      for (const cat of variantCategories) {
        if (!cat.category || !cat.category.trim()) {
          return sendErrorResponse(res, 400, 'Variant category must have a category name');
        }
        if (!Array.isArray(cat.values) || cat.values.length === 0) {
          return sendErrorResponse(res, 400, 'Variant category must have at least one value');
        }
      }
    }

    // Validate sizes structure if provided
    if (sizes !== undefined) {
      if (!Array.isArray(sizes)) {
        return sendErrorResponse(res, 400, 'Sizes must be an array');
      }
      for (const size of sizes) {
        if (size.sizeType && !mongoose.Types.ObjectId.isValid(size.sizeType)) {
          return sendErrorResponse(res, 400, 'Invalid size type ID');
        }
      }
    }

    // Validate chassis structure if provided
    if (chassis !== undefined) {
      if (!Array.isArray(chassis)) {
        return sendErrorResponse(res, 400, 'Chassis must be an array');
      }
      for (const ch of chassis) {
        if (ch.chassisType && !mongoose.Types.ObjectId.isValid(ch.chassisType)) {
          return sendErrorResponse(res, 400, 'Invalid chassis type ID');
        }
        if (ch.chassisDetails && !Array.isArray(ch.chassisDetails)) {
          return sendErrorResponse(res, 400, 'Chassis details must be an array');
        }
      }
    }

    const catalogue = await catalogueHelper.updateCatalogue(req.params.id, {
      article,
      variantCategories,
      sizes,
      chassis,
      shopCatalogueOverrides,
      leadTime,
      notes
    }, req.user.userId);

    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.UPDATED, catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error updating catalogue:', err);
    console.error('Error stack:', err.stack);
    return sendErrorResponse(res, status, message);
  }
});

// DELETE /api/catalogues/:id - Delete catalogue
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    await catalogueHelper.deleteCatalogue(req.params.id);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.DELETED);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error deleting catalogue:', err);
    return sendErrorResponse(res, status, message);
  }
});

// PUT /api/catalogues/:id/variant-categories - Update variant categories
router.put('/:id/variant-categories', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { variantCategories } = req.body;

    if (!variantCategories) {
      return sendErrorResponse(res, 400, 'Variant categories are required');
    }

    if (!Array.isArray(variantCategories)) {
      return sendErrorResponse(res, 400, 'Variant categories must be an array');
    }

    // Validate variant categories structure
    for (const cat of variantCategories) {
      if (!cat.category || !cat.category.trim()) {
        return sendErrorResponse(res, 400, 'Variant category must have a category name');
      }
      if (!Array.isArray(cat.values) || cat.values.length === 0) {
        return sendErrorResponse(res, 400, 'Variant category must have at least one value');
      }
    }

    const catalogue = await catalogueHelper.updateVariantCategories(
      req.params.id,
      variantCategories,
      req.user.userId
    );

    return sendSuccessResponse(res, 200, 'Variant categories updated successfully', catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error updating variant categories:', err);
    return sendErrorResponse(res, status, message);
  }
});

// PUT /api/catalogues/:id/shop-overrides - Update shop catalogue overrides
router.put('/:id/shop-overrides', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { overrides } = req.body;

    if (!overrides) {
      return sendErrorResponse(res, 400, 'Overrides are required');
    }

    // Accept both array format (new) and object format (legacy)
    let overridesArray = [];
    if (Array.isArray(overrides)) {
      // New format: array of override objects
      for (const override of overrides) {
        if (!override || typeof override !== 'object') {
          return sendErrorResponse(res, 400, 'Each override must be an object');
        }
        if (!override.combinationId || typeof override.combinationId !== 'string') {
          return sendErrorResponse(res, 400, 'Each override must have a combinationId string');
        }
        if (override.enabled !== undefined && typeof override.enabled !== 'boolean') {
          return sendErrorResponse(res, 400, `Override for ${override.combinationId}: enabled must be a boolean`);
        }
        if (override.price !== undefined && typeof override.price !== 'string') {
          return sendErrorResponse(res, 400, `Override for ${override.combinationId}: price must be a string`);
        }
      }
      overridesArray = overrides;
    } else if (typeof overrides === 'object' && !Array.isArray(overrides)) {
      // Legacy format: plain object - convert to array
      for (const [key, value] of Object.entries(overrides)) {
        if (value && typeof value === 'object') {
          if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
            return sendErrorResponse(res, 400, `Override for ${key}: enabled must be a boolean`);
          }
          if (value.price !== undefined && typeof value.price !== 'string') {
            return sendErrorResponse(res, 400, `Override for ${key}: price must be a string`);
          }
          overridesArray.push({
            combinationId: String(key),
            enabled: value.enabled !== false,
            price: value.price !== undefined ? String(value.price).trim() : 'ask'
          });
        }
      }
    } else {
      return sendErrorResponse(res, 400, 'Overrides must be an array or an object');
    }

    const catalogue = await catalogueHelper.updateShopCatalogueOverrides(
      req.params.id,
      overridesArray,
      req.user.userId
    );

    return sendSuccessResponse(res, 200, 'Shop catalogue overrides updated successfully', catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error updating shop overrides:', err);
    return sendErrorResponse(res, status, message);
  }
});

module.exports = router;
