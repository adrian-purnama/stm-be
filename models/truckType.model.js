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

// Truck Type Schema
const truckTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  
  description: {
    type: String,
    trim: true
  },
  
  category: {
    type: String,
    enum: ['Commercial', 'Construction', 'Transportation', 'Specialized', 'Other'],
    default: 'Commercial'
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

// Indexes
truckTypeSchema.index({ name: 1 }, { unique: true });
truckTypeSchema.index({ category: 1 });

// Static method to find by category
truckTypeSchema.statics.findByCategory = function(category) {
  return this.find({ category: new RegExp(category, 'i') });
};

module.exports = mongoose.model('TruckType', truckTypeSchema);
