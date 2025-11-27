const mongoose = require('mongoose');
const Catalogue = require('../models/catalogue.model');
const BodyType = require('../models/bodyType.model');
const SizeType = require('../models/sizeType.model');
const ChassisType = require('../models/chassisType.model');

// Generate cartesian product of arrays
const cartesianProduct = (arrays) => {
  if (arrays.length === 0) return [[]];
  if (arrays.length === 1) return arrays[0].map(item => [item]);
  
  const [first, ...rest] = arrays;
  const restProduct = cartesianProduct(rest);
  
  return first.flatMap(item => 
    restProduct.map(combination => [item, ...combination])
  );
};

// Generate a unique identifier for a combination
// This must match exactly with the frontend generateCombinationId function
const generateCombinationId = (sizeId, chassisId, chassisDetail, variantSelections) => {
  // Convert to string consistently - handle ObjectId, string, or null
  const sizeStr = sizeId 
    ? (typeof sizeId === 'string' ? sizeId : (sizeId.toString ? sizeId.toString() : String(sizeId)))
    : 'null';
  const chassisStr = chassisId 
    ? (typeof chassisId === 'string' ? chassisId : (chassisId.toString ? chassisId.toString() : String(chassisId)))
    : 'null';
  // Normalize chassisDetail: null, undefined, or empty string all become 'no-detail'
  const detailStr = (chassisDetail && String(chassisDetail).trim()) ? String(chassisDetail).trim() : 'no-detail';
  
  // Sort variant selections by key for consistent IDs
  const variantEntries = Object.entries(variantSelections || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${String(key).trim()}:${String(value).trim()}`)
    .join('_');
  
  return `${sizeStr}_${chassisStr}_${detailStr}_${variantEntries || 'no-variants'}`;
};

// Generate all combinations of sizes, chassis, and variants
const generateAllCombinations = (catalogue, includeDisabled = false) => {
  if (!catalogue) return [];
  
  // Convert overrides array to lookup object for easy access
  let overrides = {};
  const catObj = catalogue.toObject ? catalogue.toObject() : catalogue;
  
  if (catObj.shopCatalogueOverrides) {
    if (Array.isArray(catObj.shopCatalogueOverrides)) {
      // New format: array of override objects
      catObj.shopCatalogueOverrides.forEach((override) => {
        if (override && override.combinationId) {
          // Normalize combinationId to string for consistent lookup
          const normalizedId = String(override.combinationId);
          overrides[normalizedId] = {
            enabled: override.enabled !== false,
            price: override.price !== undefined ? String(override.price).trim() : 'ask',
            baseModel: override.baseModel === true
          };
        }
      });
    } else if (catalogue.shopCatalogueOverrides instanceof Map) {
      // Legacy format: Map (for backward compatibility during migration)
      catalogue.shopCatalogueOverrides.forEach((value, key) => {
        if (value && typeof value === 'object') {
          overrides[String(key)] = {
            enabled: value.enabled !== false,
            price: value.price !== undefined ? String(value.price).trim() : 'ask'
          };
        }
      });
    } else if (typeof catObj.shopCatalogueOverrides === 'object' && !Array.isArray(catObj.shopCatalogueOverrides)) {
      // Legacy format: plain object (for backward compatibility during migration)
      Object.entries(catObj.shopCatalogueOverrides).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          overrides[String(key)] = {
            enabled: value.enabled !== false,
            price: value.price !== undefined ? String(value.price).trim() : 'ask'
          };
        }
      });
    }
  }
  
  const sizes = catObj.sizes || [];
  const chassis = catObj.chassis || [];
  const variantCategories = catObj.variantCategories || [];
  
  // If no sizes or chassis, return empty
  if (sizes.length === 0 || chassis.length === 0) {
    return [];
  }
  
  // Generate all variant combinations (cartesian product of all variant category values)
  let variantCombinations = [[]]; // Start with one empty combination
  
  variantCategories.forEach(category => {
    if (category.values && category.values.length > 0) {
      const newCombinations = [];
      variantCombinations.forEach(combo => {
        category.values.forEach(value => {
          newCombinations.push({
            ...combo,
            [category.category]: value
          });
        });
      });
      variantCombinations = newCombinations;
    }
  });
  
  // Generate all combinations: size × chassis × chassis details × variant combinations
  const allCombinations = [];
  
  sizes.forEach(size => {
    chassis.forEach(ch => {
      const chassisDetails = Array.isArray(ch.chassisDetails) && ch.chassisDetails.length > 0 
        ? ch.chassisDetails 
        : [null]; // If no details, create one entry with null detail
      
      chassisDetails.forEach(chassisDetail => {
        variantCombinations.forEach(variantCombo => {
          // Normalize IDs to strings for consistent combination ID generation
          // This ensures that ObjectIds are converted to strings consistently,
          // matching the format used when overrides were originally saved
          const sizeId = size._id ? (typeof size._id === 'string' ? size._id : size._id.toString()) : (size._id || 'null');
          const chassisId = ch._id ? (typeof ch._id === 'string' ? ch._id : ch._id.toString()) : (ch._id || 'null');
          const combinationId = generateCombinationId(sizeId, chassisId, chassisDetail, variantCombo);
          
          // Normalize combinationId for lookup (ensure it's a string)
          // This ensures we can match overrides stored in the database
          const normalizedCombinationId = String(combinationId);
          
          // Debug log for combination ID generation
          // console.log(`[generateAllCombinations] Generated ID: ${normalizedCombinationId}, Size: ${sizeId}, Chassis: ${chassisId}`);
          
          // Get override settings (default: enabled=true, price='ask')
          // Try both normalized and original combinationId for backward compatibility
          const override = overrides[normalizedCombinationId] || overrides[combinationId];
          
          // If override exists, use its values; otherwise default to enabled=true, price='ask', baseModel=false
          const isEnabled = override !== undefined 
            ? (override.enabled !== false) 
            : true;
          const price = override !== undefined && override.price !== undefined
            ? String(override.price).trim()
            : 'ask';
          const baseModel = override !== undefined 
            ? (override.baseModel === true)
            : false;
          
          // Only include enabled combinations unless includeDisabled is true
          if (isEnabled || includeDisabled) {
            // Create chassisData with only the specific detail
            const chassisDataForEntry = {
              ...ch,
              chassisDetails: chassisDetail ? [chassisDetail] : []
            };
            
            allCombinations.push({
              combinationId: normalizedCombinationId,
              size: sizeId,
              sizeData: size,
              chassis: chassisId,
              chassisData: chassisDataForEntry,
              variantSelections: variantCombo,
              price: price,
              enabled: isEnabled, // Add enabled status to output
              baseModel: baseModel, // Add baseModel status to output
              isStandard: false
            });
          }
        });
      });
    });
  });
  
  return allCombinations;
};

// Helper to enrich catalogue with generated combinations
const enrichCatalogue = (catalogue) => {
  if (!catalogue) return catalogue;
  
  const catObj = catalogue.toObject ? catalogue.toObject() : catalogue;
  catObj.shopCatalogue = generateAllCombinations(catalogue, false); // Only include enabled for frontend view
  
  // Convert shopCatalogueOverrides to array format for JSON serialization
  // Clean and normalize to ensure only combinationId, enabled, and price fields
  if (catObj.shopCatalogueOverrides) {
    if (Array.isArray(catObj.shopCatalogueOverrides)) {
      // Already an array, clean it - preserve actual enabled values
      catObj.shopCatalogueOverrides = catObj.shopCatalogueOverrides
        .filter(override => override && override.combinationId)
        .map(override => ({
          combinationId: String(override.combinationId).trim(), // Normalize by trimming
          enabled: override.enabled !== undefined ? Boolean(override.enabled) : true,
          price: override.price !== undefined ? String(override.price).trim() : 'ask',
          baseModel: override.baseModel === true
        }));
    } else if (catalogue.shopCatalogueOverrides instanceof Map) {
      // Legacy Map format - convert to array
      const overridesArray = [];
      catalogue.shopCatalogueOverrides.forEach((value, key) => {
        if (value && typeof value === 'object') {
      overridesArray.push({
        combinationId: String(key),
        enabled: value.enabled !== false,
        price: value.price !== undefined ? String(value.price).trim() : 'ask',
        baseModel: value.baseModel === true
      });
        }
      });
      catObj.shopCatalogueOverrides = overridesArray;
    } else if (typeof catObj.shopCatalogueOverrides === 'object' && !Array.isArray(catObj.shopCatalogueOverrides)) {
      // Legacy plain object format - convert to array
      const overridesArray = [];
      Object.entries(catObj.shopCatalogueOverrides).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
      overridesArray.push({
        combinationId: String(key),
        enabled: value.enabled !== false,
        price: value.price !== undefined ? String(value.price).trim() : 'ask',
        baseModel: value.baseModel === true
      });
        }
      });
      catObj.shopCatalogueOverrides = overridesArray;
    }
  } else {
    catObj.shopCatalogueOverrides = [];
  }
  
  return catObj;
};

const validateBodyTypeReference = async (bodyTypeId) => {
  if (!bodyTypeId) {
    const error = new Error('Body type is required');
    error.statusCode = 400;
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(bodyTypeId)) {
    const error = new Error('Invalid body type reference');
    error.statusCode = 400;
    throw error;
  }

  const bodyType = await BodyType.findById(bodyTypeId);
  if (!bodyType) {
    const error = new Error('Body type not found');
    error.statusCode = 404;
    throw error;
  }

  return bodyType._id;
};

const validateSizeTypeReference = async (sizeTypeId) => {
  if (!sizeTypeId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(sizeTypeId)) {
    const error = new Error('Invalid size type reference');
    error.statusCode = 400;
    throw error;
  }

  const sizeType = await SizeType.findById(sizeTypeId);
  if (!sizeType) {
    const error = new Error('Size type not found');
    error.statusCode = 404;
    throw error;
  }

  return sizeType._id;
};

const validateChassisTypeReference = async (chassisTypeId) => {
  if (!chassisTypeId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(chassisTypeId)) {
    const error = new Error('Invalid chassis type reference');
    error.statusCode = 400;
    throw error;
  }

  const chassisType = await ChassisType.findById(chassisTypeId);
  if (!chassisType) {
    const error = new Error('Chassis type not found');
    error.statusCode = 404;
    throw error;
  }

  return chassisType._id;
};

const buildVariantCategories = (categories = []) => {
  if (!Array.isArray(categories)) {
    return [];
  }

  return categories
    .filter(cat => cat && cat.category && Array.isArray(cat.values) && cat.values.length > 0)
    .map(cat => ({
      category: cat.category.trim(),
      values: cat.values
        .filter(v => v && typeof v === 'string' && v.trim())
        .map(v => v.trim())
    }));
};

const buildSizeDefinition = async (sizeDef) => {
  const builtSize = {};

  if (sizeDef._id && mongoose.Types.ObjectId.isValid(sizeDef._id)) {
    builtSize._id = sizeDef._id;
  }

  if (sizeDef.sizeType) {
    builtSize.sizeType = await validateSizeTypeReference(sizeDef.sizeType);
  } else {
    builtSize.sizeType = null;
  }

  builtSize.sizeCustom = sizeDef.sizeCustom ? sizeDef.sizeCustom.trim() : '';

  return builtSize;
};

const buildChassisDefinition = async (chassisDef) => {
  const builtChassis = {};

  if (chassisDef._id && mongoose.Types.ObjectId.isValid(chassisDef._id)) {
    builtChassis._id = chassisDef._id;
  }

  if (chassisDef.chassisType) {
    builtChassis.chassisType = await validateChassisTypeReference(chassisDef.chassisType);
  } else {
    builtChassis.chassisType = null;
  }

  if (Array.isArray(chassisDef.chassisDetails)) {
    builtChassis.chassisDetails = chassisDef.chassisDetails
      .filter(detail => detail && typeof detail === 'string' && detail.trim())
      .map(detail => detail.trim());
  } else {
    builtChassis.chassisDetails = [];
  }

  return builtChassis;
};


const createCatalogue = async ({ bodyType, article, variantCategories, sizes, chassis, leadTime, notes, createdBy }) => {
  const validatedBodyType = await validateBodyTypeReference(bodyType);

  // Check if catalogue already exists for this body type
  const existingCatalogue = await Catalogue.findOne({ bodyType: validatedBodyType });
  if (existingCatalogue) {
    const error = new Error('Catalogue already exists for this body type');
    error.statusCode = 409;
    throw error;
  }

  const catalogue = new Catalogue({
    bodyType: validatedBodyType,
    article: article ? article.trim() : '',
    variantCategories: buildVariantCategories(variantCategories),
    sizes: [],
    chassis: [],
    leadTime: leadTime ? leadTime.trim() : '',
    notes: notes ? notes.trim() : '',
    createdBy
  });

  // Build sizes
  if (Array.isArray(sizes) && sizes.length > 0) {
    catalogue.sizes = await Promise.all(
      sizes.map(sizeDef => buildSizeDefinition(sizeDef))
    );
  }

  // Build chassis
  if (Array.isArray(chassis) && chassis.length > 0) {
    catalogue.chassis = await Promise.all(
      chassis.map(chassisDef => buildChassisDefinition(chassisDef))
    );
  }

  await catalogue.save();

  const populated = await Catalogue.findById(catalogue._id)
    .populate('bodyType', 'name shortName')
    .populate('sizes.sizeType', 'name shortName')
    .populate('chassis.chassisType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');

  return enrichCatalogue(populated);
};

const getCatalogues = async ({ page = 1, limit = 10, search, bodyType }) => {
  const filter = {};

  if (search) {
    const regex = new RegExp(search, 'i');
    filter.$or = [
      { article: regex },
      { leadTime: regex },
      { notes: regex },
      { 'bodyType.name': regex }
    ];
  }

  if (bodyType) {
    filter.bodyType = await validateBodyTypeReference(bodyType);
  }

  const skip = (page - 1) * limit;

  const [catalogues, total] = await Promise.all([
    Catalogue.find(filter)
      .populate('bodyType', 'name shortName')
      .populate('sizes.sizeType', 'name shortName')
      .populate('chassis.chassisType', 'name shortName')
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Catalogue.countDocuments(filter)
  ]);

  const enrichedCatalogues = catalogues.map(cat => enrichCatalogue(cat));

  return {
    catalogues: enrichedCatalogues,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const getCatalogueById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid catalogue id');
    error.statusCode = 400;
    throw error;
  }

  const catalogue = await Catalogue.findById(id)
    .populate('bodyType', 'name shortName')
    .populate('sizes.sizeType', 'name shortName')
    .populate('chassis.chassisType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');

  if (!catalogue) {
    const error = new Error('Catalogue not found');
    error.statusCode = 404;
    throw error;
  }

  return enrichCatalogue(catalogue);
};

const getCatalogueByBodyType = async (bodyTypeId) => {
  const validatedBodyType = await validateBodyTypeReference(bodyTypeId);

  const catalogue = await Catalogue.findOne({ bodyType: validatedBodyType })
    .populate('bodyType', 'name shortName')
    .populate('sizes.sizeType', 'name shortName')
    .populate('chassis.chassisType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');

  if (!catalogue) {
    const error = new Error('Catalogue not found for this body type');
    error.statusCode = 404;
    throw error;
  }

  return enrichCatalogue(catalogue);
};

const updateCatalogue = async (id, updates, userId) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid catalogue id');
    error.statusCode = 400;
    throw error;
  }

  const catalogue = await Catalogue.findById(id);
  if (!catalogue) {
    const error = new Error('Catalogue not found');
    error.statusCode = 404;
    throw error;
  }

  try {
    if (updates.article !== undefined) {
      catalogue.article = updates.article ? updates.article.trim() : '';
    }

    if (updates.variantCategories !== undefined) {
      catalogue.variantCategories = buildVariantCategories(updates.variantCategories);
    }

    if (updates.sizes !== undefined) {
      if (Array.isArray(updates.sizes)) {
        catalogue.sizes = await Promise.all(
          updates.sizes.map(sizeDef => buildSizeDefinition(sizeDef))
        );
      }
    }

    if (updates.chassis !== undefined) {
      if (Array.isArray(updates.chassis)) {
        catalogue.chassis = await Promise.all(
          updates.chassis.map(chassisDef => buildChassisDefinition(chassisDef))
        );
      }
    }


    if (updates.leadTime !== undefined) {
      catalogue.leadTime = updates.leadTime ? updates.leadTime.trim() : '';
    }

    if (updates.notes !== undefined) {
      catalogue.notes = updates.notes ? updates.notes.trim() : '';
    }

    // Handle shop catalogue overrides - merge with existing instead of replacing
    if (updates.shopCatalogueOverrides !== undefined) {
      // Generate all possible combinations to validate override combinationIds
      // Create a temporary catalogue object with current state + updates to validate against
      const catObj = catalogue.toObject ? catalogue.toObject() : catalogue;
      const tempCatalogue = {
        ...catObj,
        sizes: updates.sizes !== undefined ? updates.sizes : catObj.sizes,
        chassis: updates.chassis !== undefined ? updates.chassis : catObj.chassis,
        variantCategories: updates.variantCategories !== undefined ? updates.variantCategories : catObj.variantCategories
      };
      // Include disabled items to ensure we validate against ALL possible combinations
      const allCombinations = generateAllCombinations(tempCatalogue, true);
      const validCombinationIds = new Set(
        allCombinations.map(combo => String(combo.combinationId).trim())
      );
      
      console.log(`[updateCatalogue] Valid IDs (${validCombinationIds.size}):`, Array.from(validCombinationIds).slice(0, 5));
      if (Array.isArray(updates.shopCatalogueOverrides) && updates.shopCatalogueOverrides.length > 0) {
         console.log(`[updateCatalogue] Incoming overrides (${updates.shopCatalogueOverrides.length}):`, updates.shopCatalogueOverrides.slice(0, 5).map(o => o.combinationId));
         
         // Detailed mismatch analysis
         updates.shopCatalogueOverrides.forEach(o => {
            const id = String(o.combinationId).trim();
            if (!validCombinationIds.has(id)) {
                console.log(`[updateCatalogue] REJECTED ID: "${id}"`);
                // Find closest match or log all valid IDs for comparison
                Array.from(validCombinationIds).forEach(validId => {
                    if (validId.includes(id.substring(0, 20))) { // Partial match check
                        console.log(`  -> Closest valid ID: "${validId}"`);
                        console.log(`  -> Length diff: Incoming ${id.length}, Valid ${validId.length}`);
                        // Find first diff char
                        for(let i=0; i<Math.max(id.length, validId.length); i++) {
                            if (id[i] !== validId[i]) {
                                console.log(`  -> First diff at char ${i}: Incoming '${id[i]}' (${id.charCodeAt(i)}), Valid '${validId[i]}' (${validId.charCodeAt(i)})`);
                                break;
                            }
                        }
                    }
                });
            }
         });
      }
      
      if (Array.isArray(updates.shopCatalogueOverrides)) {
        // New format: array of override objects
        // REPLACE existing overrides with new ones (only valid combinations)
        // This allows deleting overrides by omitting them from the list
        
        const newOverridesMap = new Map();
        
        // Process new overrides
        updates.shopCatalogueOverrides.forEach(newOverride => {
          if (newOverride && newOverride.combinationId && typeof newOverride === 'object') {
            const combinationId = String(newOverride.combinationId).trim();
            if (validCombinationIds.has(combinationId)) {
          newOverridesMap.set(combinationId, {
            combinationId: combinationId,
            enabled: newOverride.enabled !== undefined ? Boolean(newOverride.enabled) : true,
            price: newOverride.price !== undefined ? String(newOverride.price).trim() : 'ask',
            baseModel: newOverride.baseModel === true
          });
            }
          }
        });
        
        // Convert to array and mark as modified
        catalogue.shopCatalogueOverrides = Array.from(newOverridesMap.values());
        catalogue.markModified('shopCatalogueOverrides');
      } else if (typeof updates.shopCatalogueOverrides === 'object' && updates.shopCatalogueOverrides !== null && !Array.isArray(updates.shopCatalogueOverrides)) {
        // Legacy format: plain object - convert to array format
        // REPLACE existing overrides with new ones (only valid combinations)
        
        const newOverridesMap = new Map();
        
        // Convert object to array format and map (only valid combinations)
        Object.entries(updates.shopCatalogueOverrides).forEach(([key, value]) => {
          if (value && typeof value === 'object') {
            const combinationId = String(key).trim();
            if (validCombinationIds.has(combinationId)) {
              newOverridesMap.set(combinationId, {
                combinationId: combinationId,
                enabled: value.enabled !== undefined ? Boolean(value.enabled) : true,
                price: value.price !== undefined ? String(value.price).trim() : 'ask'
              });
            }
          }
        });
        
        // Convert to array and mark as modified
        catalogue.shopCatalogueOverrides = Array.from(newOverridesMap.values());
        catalogue.markModified('shopCatalogueOverrides');
      } else if (updates.shopCatalogueOverrides === null) {
        // If explicitly set to null, clear overrides
        catalogue.shopCatalogueOverrides = [];
      }
    }

    catalogue.lastModifiedBy = userId;

    await catalogue.save();

    const populated = await Catalogue.findById(catalogue._id)
      .populate('bodyType', 'name shortName')
      .populate('sizes.sizeType', 'name shortName')
      .populate('chassis.chassisType', 'name shortName')
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');
    
    return enrichCatalogue(populated);
  } catch (error) {
    console.error('Error in updateCatalogue:', error);
    console.error('Update data:', JSON.stringify(updates, null, 2));
    console.error('Error stack:', error.stack);
    throw error;
  }
};

const updateVariantCategories = async (catalogueId, variantCategories, userId) => {
  if (!mongoose.Types.ObjectId.isValid(catalogueId)) {
    const error = new Error('Invalid catalogue id');
    error.statusCode = 400;
    throw error;
  }

  const catalogue = await Catalogue.findById(catalogueId);
  if (!catalogue) {
    const error = new Error('Catalogue not found');
    error.statusCode = 404;
    throw error;
  }

  catalogue.variantCategories = buildVariantCategories(variantCategories);
  catalogue.lastModifiedBy = userId;

  await catalogue.save();

  const populated = await Catalogue.findById(catalogue._id)
    .populate('bodyType', 'name shortName')
    .populate('sizes.sizeType', 'name shortName')
    .populate('chassis.chassisType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');
  
  return enrichCatalogue(populated);
};

const deleteCatalogue = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid catalogue id');
    error.statusCode = 400;
    throw error;
  }

  const catalogue = await Catalogue.findById(id);
  if (!catalogue) {
    const error = new Error('Catalogue not found');
    error.statusCode = 404;
    throw error;
  }

  await Catalogue.deleteOne({ _id: catalogue._id });
  return true;
};

const updateShopCatalogueOverrides = async (catalogueId, overrides, userId) => {
  if (!mongoose.Types.ObjectId.isValid(catalogueId)) {
    const error = new Error('Invalid catalogue id');
    error.statusCode = 400;
    throw error;
  }

  const catalogue = await Catalogue.findById(catalogueId);
  if (!catalogue) {
    const error = new Error('Catalogue not found');
    error.statusCode = 404;
    throw error;
  }

  // Generate all possible combinations to validate override combinationIds
  // Include disabled items to ensure we validate against ALL possible combinations
  const allCombinations = generateAllCombinations(catalogue, true);
  const validCombinationIds = new Set(
    allCombinations.map(combo => String(combo.combinationId).trim())
  );

  console.log(`[updateShopCatalogueOverrides] Valid IDs (${validCombinationIds.size}):`, Array.from(validCombinationIds).slice(0, 5));
  if (Array.isArray(overrides) && overrides.length > 0) {
     console.log(`[updateShopCatalogueOverrides] Incoming overrides (${overrides.length}):`, overrides.slice(0, 5).map(o => o.combinationId));
  }

  // Get existing overrides and create a map for merging (removing duplicates)
  const existingOverrides = Array.isArray(catalogue.shopCatalogueOverrides)
    ? [...catalogue.shopCatalogueOverrides]
    : [];
  
  const existingMap = new Map();
  existingOverrides.forEach(override => {
    if (override && override.combinationId) {
      // Normalize combinationId to string and trim for consistent lookup
      const normalizedId = String(override.combinationId).trim();
      // Only keep overrides for valid combinations (removes orphaned overrides)
      if (validCombinationIds.has(normalizedId)) {
        existingMap.set(normalizedId, {
          combinationId: normalizedId,
          enabled: override.enabled !== false,
          price: override.price !== undefined ? String(override.price).trim() : 'ask',
          baseModel: override.baseModel === true
        });
      }
    }
  });

  // Convert incoming overrides to array format and merge with existing
  let newOverridesArray = [];
  if (Array.isArray(overrides)) {
    // Already an array format
    newOverridesArray = overrides
      .filter(override => override && override.combinationId)
      .map(override => ({
        combinationId: String(override.combinationId).trim(),
        enabled: override.enabled !== undefined ? Boolean(override.enabled) : true,
        price: override.price !== undefined ? String(override.price).trim() : 'ask',
        baseModel: override.baseModel === true
      }))
      .filter(override => validCombinationIds.has(override.combinationId)); // Only keep valid combinations
  } else if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    // Legacy object format - convert to array
    Object.entries(overrides).forEach(([key, value]) => {
      if (value && typeof value === 'object') {
        const normalizedId = String(key).trim();
        // Only keep overrides for valid combinations
        if (validCombinationIds.has(normalizedId)) {
          newOverridesArray.push({
            combinationId: normalizedId,
            enabled: value.enabled !== undefined ? Boolean(value.enabled) : true,
            price: value.price !== undefined ? String(value.price).trim() : 'ask',
            baseModel: value.baseModel === true
          });
        }
      }
    });
  }

  // REPLACE existing overrides with new ones
  // This allows deleting overrides by omitting them from the list
  const newOverridesMap = new Map();

  // Process new overrides array
  newOverridesArray.forEach(newOverride => {
    if (newOverride && newOverride.combinationId) {
      const normalizedId = String(newOverride.combinationId).trim();
      // Only keep overrides for valid combinations
      if (validCombinationIds.has(normalizedId)) {
        newOverridesMap.set(normalizedId, {
          combinationId: normalizedId,
          enabled: newOverride.enabled !== undefined ? Boolean(newOverride.enabled) : true,
          price: newOverride.price !== undefined ? String(newOverride.price).trim() : 'ask',
          baseModel: newOverride.baseModel === true
        });
      }
    }
  });

  // Convert map to array
  const finalArray = Array.from(newOverridesMap.values());
  
  // Log for debugging
  console.log(`[updateShopCatalogueOverrides] Valid combinations: ${validCombinationIds.size}, New overrides: ${newOverridesArray.length}, Final: ${finalArray.length}`);
  
  // Mark the array as modified to ensure Mongoose saves it
  catalogue.shopCatalogueOverrides = finalArray;
  catalogue.markModified('shopCatalogueOverrides');
  catalogue.lastModifiedBy = userId;
  await catalogue.save();

  const populated = await Catalogue.findById(catalogue._id)
    .populate('bodyType', 'name shortName')
    .populate('sizes.sizeType', 'name shortName')
    .populate('chassis.chassisType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');

  return enrichCatalogue(populated);
};

module.exports = {
  createCatalogue,
  getCatalogues,
  getCatalogueById,
  getCatalogueByBodyType,
  updateCatalogue,
  updateVariantCategories,
  updateShopCatalogueOverrides,
  deleteCatalogue,
  generateAllCombinations,
  generateCombinationId
};

