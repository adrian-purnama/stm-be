const mongoose = require('mongoose');

/**
 * Session Model
 * Manages catalogue session tokens for temporary access
 */
const sessionSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastUsedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better query performance
sessionSchema.index({ token: 1 });
sessionSchema.index({ expiresAt: 1 });
sessionSchema.index({ isActive: 1 });
sessionSchema.index({ createdBy: 1 });
sessionSchema.index({ expiresAt: 1, isActive: 1 }); // Compound index for common queries

module.exports = mongoose.model('Session', sessionSchema);








