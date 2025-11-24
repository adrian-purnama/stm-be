const mongoose = require('mongoose');

const rfqDocumentSchema = new mongoose.Schema({
  rfqId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ',
    required: true,
    index: true
  },
  file: {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    filename: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true,
      trim: true
    },
    mimeType: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    compressedSize: {
      type: Number,
      required: true
    },
    compression: {
      type: String,
      enum: ['gzip', 'none'],
      default: 'gzip'
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  description: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

rfqDocumentSchema.index({ uploadedAt: -1 });
rfqDocumentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RFQDocument', rfqDocumentSchema);









