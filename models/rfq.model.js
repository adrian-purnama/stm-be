const mongoose = require('mongoose');

const rfqSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  approverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  approvedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for efficient queries
rfqSchema.index({ userId: 1, createdAt: -1 });
rfqSchema.index({ approverId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('RFQ', rfqSchema);

