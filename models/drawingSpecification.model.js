const mongoose = require('mongoose');

// Feature Schema - Feature selection with optional spec value
const featureSchema = new mongoose.Schema({
  featureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeatureType',
    required: true
  },
  spec: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: false });

// Custom Specification Item Schema
const customSpecificationItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  specification: {
    type: String,
    required: true,
    trim: true
  },
  order: {
    type: Number,
    default: 0
  }
}, { _id: false });

// Custom Specification Category Schema
const customSpecificationCategorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    trim: true
  },
  items: [customSpecificationItemSchema]
}, { _id: false });

// Drawing Specification Schema
const drawingSpecificationSchema = new mongoose.Schema({
  // Note: drawingNumber is computed from aggregating all fields below
  // It is NOT stored in the database, but computed via virtual getter
  
  // Master table references
  bodyTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BodyType',
    required: true,
    index: true
  },
  
  // Optional fields per new requirements
  chassisTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChassisType',
    required: false,
    index: true
  },
  
  chassisModel: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  
  sizeTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SizeType',
    required: false,
    index: true
  },
  
  // Dimension as a single plain string (optional per new requirements)
  dimension: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  
  // Features array - each feature has featureId and optional spec
  features: [featureSchema],
  
  // Custom specifications - category-based specifications specific to this drawing
  customSpecifications: [customSpecificationCategorySchema],
  
  // GridFS file reference - AutoCAD file (DWG/DXF) for archive, compressed before storage
  drawingFile: {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false
    },
    filename: {
      type: String,
      required: false
    },
    originalName: {
      type: String,
      required: false
    },
    uploadedFormat: {
      type: String,
      enum: ['DWG', 'DXF'],
      required: false
    },
    storedFormat: {
      type: String,
      enum: ['DXF', 'DWG'], // Allow DWG if conversion not available
      required: false,
      default: 'DXF'
    },
    originalFileSize: {
      type: Number,
      required: false
    },
    compressedFileSize: {
      type: Number,
      required: false
    },
    isCompressed: {
      type: Boolean,
      default: true
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  
  // GridFS file reference - JPG image for quotation display
  quotationImage: {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false
    },
    filename: {
      type: String,
      required: false
    },
    originalName: {
      type: String,
      required: false
    },
    fileSize: {
      type: Number,
      required: false
    },
    originalFileSize: {
      type: Number,
      required: false
    },
    isOptimized: {
      type: Boolean,
      default: true
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  
  // User tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Pre-save middleware to normalize order values for custom specification items
drawingSpecificationSchema.pre('save', function(next) {
  // Normalize order values for custom specification items (ensure sequential ordering)
  if (this.customSpecifications && Array.isArray(this.customSpecifications)) {
    this.customSpecifications.forEach((spec) => {
      if (spec.items && Array.isArray(spec.items)) {
        // Sort items by order, then reassign sequential order values
        spec.items.sort((a, b) => {
          const orderA = a.order !== undefined && a.order !== null ? a.order : Number.MAX_SAFE_INTEGER;
          const orderB = b.order !== undefined && b.order !== null ? b.order : Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });
        // Assign sequential order values (0, 1, 2, ...)
        spec.items.forEach((item, index) => {
          item.order = index;
        });
      }
    });
  }
  
  next();
});

// Helper function to normalize key segments (UPPERCASE, remove spaces and slashes)
const normalizeKeySegment = (str) => {
  if (!str) return '';
  return String(str)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\//g, '')
    .replace(/-/g, '');
};

// Helper function to format features for composite key
const formatFeatures = (features) => {
  if (!features || features.length === 0) return '';
  
  return features
    .map(feature => {
      if (!feature.featureId) return null;
      // Get feature shortName if populated, otherwise use featureId
      const featureKey = feature.featureId.shortName || feature.featureId.toString();
      const specValue = feature.spec ? normalizeKeySegment(feature.spec) : '';
      return specValue ? `${normalizeKeySegment(featureKey)}_${specValue}` : normalizeKeySegment(featureKey);
    })
    .filter(Boolean)
    .join('-');
};

// Method to compute drawingNumber from aggregated fields
drawingSpecificationSchema.methods.getDrawingNumber = function() {
  // Build composite key segments (assuming fields are already populated)
  const bodyTypeKey = this.bodyTypeId?.shortName || this.bodyTypeId?.name || this.bodyTypeId?.toString() || '';
  const chassisKey = this.chassisTypeId?.shortName || this.chassisTypeId?.name || this.chassisTypeId?.toString() || '';
  const chassisModelKey = normalizeKeySegment(this.chassisModel || '');
  const sizeKey = this.sizeTypeId?.shortName || this.sizeTypeId?.name || this.sizeTypeId?.toString() || '';
  const dimensionKey = normalizeKeySegment(this.dimension || '');
  const featuresKey = formatFeatures(this.features || []);
  
  // Build composite key: BODYTYPE/CHASSIS/CHASSISMODEL/SIZE/DIMENSION/FEATURE1_SPEC-FEATURE2_SPEC-...
  // Always include all segments, use "-" for empty optional fields
  const keyParts = [
    normalizeKeySegment(bodyTypeKey) || '-', // Body type is required, but use "-" if somehow empty
    chassisKey ? normalizeKeySegment(chassisKey) : '-',
    chassisModelKey || '-',
    sizeKey ? normalizeKeySegment(sizeKey) : '-',
    dimensionKey || '-',
    featuresKey || '-'
  ];
  
  return keyParts.join('/');
};

// Virtual getter for drawingNumber - computed from aggregating all fields
// Note: Requires populated fields (bodyTypeId, chassisTypeId, sizeTypeId, features.featureId)
drawingSpecificationSchema.virtual('drawingNumber').get(function() {
  try {
    return this.getDrawingNumber();
  } catch (error) {
    console.error('Error computing drawingNumber:', error);
    return '-/-/-/-/-/-'; // Return default if computation fails
  }
});

// Enable virtuals in JSON and Object output
drawingSpecificationSchema.set('toJSON', { virtuals: true });
drawingSpecificationSchema.set('toObject', { virtuals: true });

// Note: drawingNumber is computed via virtual getter when document fields are accessed
// Make sure to populate required fields when querying: bodyTypeId, chassisTypeId, sizeTypeId, features.featureId

// Note: drawingNumber is now a virtual field computed from aggregated fields
// No pre-update hook needed - it's computed automatically when accessed

// Indexes for better performance
// Compound unique index on fields that make up drawingNumber
drawingSpecificationSchema.index({ 
  bodyTypeId: 1, 
  chassisTypeId: 1, 
  chassisModel: 1, 
  sizeTypeId: 1, 
  dimension: 1 
}, { unique: true });
drawingSpecificationSchema.index({ bodyTypeId: 1 });
drawingSpecificationSchema.index({ chassisTypeId: 1 });
drawingSpecificationSchema.index({ sizeTypeId: 1 });
drawingSpecificationSchema.index({ createdBy: 1 });

// Static method to find by body type
drawingSpecificationSchema.statics.findByBodyType = function(bodyTypeId) {
  return this.find({ bodyTypeId: bodyTypeId });
};

// Static method to find by chassis type
drawingSpecificationSchema.statics.findByChassisType = function(chassisTypeId) {
  return this.find({ chassisTypeId: chassisTypeId });
};

// Static method to find by size type
drawingSpecificationSchema.statics.findBySizeType = function(sizeTypeId) {
  return this.find({ sizeTypeId: sizeTypeId });
};

module.exports = mongoose.model('DrawingSpecification', drawingSpecificationSchema);
