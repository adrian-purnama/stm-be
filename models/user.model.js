const mongoose = require('mongoose');

/**
 * User Model - Updated for direct permission system
 * Users have permissions directly, no roles needed
 */
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumbers: [{
    label: {
      type: String,
      required: true,
      trim: true
    },
    value: {
      type: String,
      required: true,
      trim: true
    }
  }],
  
  // Direct permission system - users have permissions directly
  permissions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Permission'
  }],
  
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ permissions: 1 });

// Method to check if user has specific permission (handles both individual and multi permissions)
userSchema.methods.hasPermission = async function(permissionName) {
  const user = await this.populate('permissions');
  const Permission = mongoose.model('Permission');
  
  // Get all individual permissions this user has (including from multi-permissions)
  const allPermissions = await this.getAllIndividualPermissions();
  
  return allPermissions.includes(permissionName);
};

// Method to get all individual permissions (expands multi-permissions)
userSchema.methods.getAllIndividualPermissions = async function() {
  const user = await this.populate('permissions');
  const Permission = mongoose.model('Permission');
  const individualPermissions = [];
  
  for (const permission of user.permissions) {
    if (permission.type === 'individual') {
      individualPermissions.push(permission.name);
    } else if (permission.type === 'multi') {
      // Multi-permission includes multiple individual permissions
      individualPermissions.push(...permission.includes);
    }
  }
  
  return [...new Set(individualPermissions)]; // Remove duplicates
};

// Method to get all user permissions (both individual and multi)
userSchema.methods.getPermissions = async function() {
  const user = await this.populate('permissions');
  return user.permissions;
};

module.exports = mongoose.model('User', userSchema);
