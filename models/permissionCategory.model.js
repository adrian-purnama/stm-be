const mongoose = require('mongoose');

/**
 * Permission Category Model
 * Organizes permissions into logical groups
 */
const permissionCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
permissionCategorySchema.index({ name: 1 });
permissionCategorySchema.index({ isActive: 1 });
permissionCategorySchema.index({ createdBy: 1 });

// Virtual for permission count
permissionCategorySchema.virtual('permissionCount').get(function() {
  return this.permissions ? this.permissions.length : 0;
});

// Ensure virtual fields are serialized
permissionCategorySchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('PermissionCategory', permissionCategorySchema);
