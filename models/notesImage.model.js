const mongoose = require('mongoose');

// Notes Image Schema - standalone images that can be referenced by offers
const notesImageSchema = new mongoose.Schema({
  // Image file information
  imageFile: {
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
      required: true
    },
    fileType: {
      type: String,
      enum: ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP'],
      required: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  
  // User tracking (optional)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Track last access for cleanup
  lastAccessed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better performance
notesImageSchema.index({ createdBy: 1 });
notesImageSchema.index({ lastAccessed: 1 });
notesImageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('NotesImage', notesImageSchema);
