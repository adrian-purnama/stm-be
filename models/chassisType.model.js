const mongoose = require('mongoose');

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

// Chassis Type Schema
const chassisTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  
  shortName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: 20
  },
  
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
chassisTypeSchema.pre('save', function(next) {
  if (this.name && this.isModified('name')) {
    this.name = toTitleCase(this.name);
  }
  if (this.shortName && this.isModified('shortName')) {
    this.shortName = this.shortName.trim().toUpperCase();
  }
  next();
});

// Pre-update middleware to ensure name is title case and shortName is uppercase
chassisTypeSchema.pre(['updateOne', 'findOneAndUpdate', 'findByIdAndUpdate'], function(next) {
  const update = this.getUpdate();
  if (update) {
    if (update.$set) {
      if (update.$set.name) {
        update.$set.name = toTitleCase(update.$set.name);
      }
      if (update.$set.shortName) {
        update.$set.shortName = update.$set.shortName.trim().toUpperCase();
      }
    } else {
      if (update.name) {
        update.name = toTitleCase(update.name);
      }
      if (update.shortName) {
        update.shortName = update.shortName.trim().toUpperCase();
      }
    }
  }
  next();
});

// Indexes
chassisTypeSchema.index({ name: 1 }, { unique: true });
chassisTypeSchema.index({ shortName: 1 }, { unique: true });

module.exports = mongoose.model('ChassisType', chassisTypeSchema);
