const mongoose = require('mongoose');

// Specification Item Schema
const specificationItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  specification: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

// Specification Category Schema
const specificationCategorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    trim: true
  },
  items: [specificationItemSchema]
}, { _id: false });

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

// Body Type Schema
const bodyTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  
  shortName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true,
    maxlength: 20
  },
  
  description: {
    type: String,
    trim: true
  },
  
  defaultSpecifications: [specificationCategorySchema],
  
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

// Pre-save middleware to ensure name is title case and shortName is uppercase
bodyTypeSchema.pre('save', function(next) {
  if (this.name && this.isModified('name')) {
    this.name = toTitleCase(this.name);
  }
  if (this.shortName && this.isModified('shortName')) {
    this.shortName = this.shortName.trim().toUpperCase();
  }
  next();
});

// Pre-update middleware to ensure name is title case and shortName is uppercase
bodyTypeSchema.pre(['updateOne', 'findOneAndUpdate', 'findByIdAndUpdate'], function(next) {
  const update = this.getUpdate();
  if (update) {
    if (update.name) {
      update.name = toTitleCase(update.name);
    }
    if (update.shortName) {
      update.shortName = update.shortName.trim().toUpperCase();
    }
  }
  next();
});

// Indexes
bodyTypeSchema.index({ name: 1 }, { unique: true });
bodyTypeSchema.index({ shortName: 1 }, { unique: true });

module.exports = mongoose.model('BodyType', bodyTypeSchema);
