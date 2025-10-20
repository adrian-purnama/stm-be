const mongoose = require('mongoose');

/**
 * Permission Model
 * Individual permissions and multi-permissions that can be assigned to users
 */
const permissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PermissionCategory',
    required: true
  },
  // Type of permission: 'individual' (linked to endpoint) or 'multi' (contains multiple permissions)
  type: {
    type: String,
    enum: ['individual', 'multi'],
    default: 'individual',
    required: true
  },
  // For multi-permissions, this contains the individual permission names
  // For individual permissions, this is empty
  includes: [{
    type: String,
    trim: true,
    lowercase: true
  }],
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
permissionSchema.index({ name: 1 });
permissionSchema.index({ category: 1 });
permissionSchema.index({ isActive: 1 });
permissionSchema.index({ createdBy: 1 });

// Ensure virtual fields are serialized
permissionSchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('Permission', permissionSchema);
