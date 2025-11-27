const mongoose = require('mongoose');

// Variant Category Schema
const variantCategorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    trim: true
  },
  values: {
    type: [String],
    required: true,
    default: []
  }
}, { _id: false });

// Size Definition Schema
const sizeDefinitionSchema = new mongoose.Schema({
  sizeType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SizeType',
    default: null
  },
  sizeCustom: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: true });

// Chassis Definition Schema
const chassisDefinitionSchema = new mongoose.Schema({
  chassisType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChassisType',
    default: null
  },
  chassisDetails: {
    type: [String],
    default: []
  }
}, { _id: true });

// Catalogue Schema
const catalogueSchema = new mongoose.Schema({
  bodyType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BodyType',
    required: true,
    unique: true
  },
  article: {
    type: String,
    trim: true,
    default: ''
  },
  variantCategories: {
    type: [variantCategorySchema],
    default: []
  },
  sizes: {
    type: [sizeDefinitionSchema],
    default: []
  },
  chassis: {
    type: [chassisDefinitionSchema],
    default: []
  },
  shopCatalogueOverrides: [{
    combinationId: {
      type: String,
      required: true,
      trim: true
    },
    enabled: {
      type: Boolean,
      default: true
    },
    price: {
      type: String,
      default: 'ask',
      trim: true
    },
    baseModel: {
      type: Boolean,
      default: false
    }
  }],
  leadTime: {
    type: String,
    trim: true,
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Indexes
catalogueSchema.index({ bodyType: 1 }, { unique: true });

module.exports = mongoose.model('Catalogue', catalogueSchema);

