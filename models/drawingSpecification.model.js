const mongoose = require('mongoose');

// Drawing Specification Schema
const drawingSpecificationSchema = new mongoose.Schema({
  // Drawing identification
  drawingNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true
  },
  
  // Truck type reference
  truckType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TruckType',
    required: true
  },
  
  // GridFS file reference (single file)
  drawingFile: {
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
      enum: ['PDF', 'DWG', 'DXF', 'JPG', 'PNG', 'Other'],
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
  
  // User tracking
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

// Indexes for better performance
drawingSpecificationSchema.index({ drawingNumber: 1 }, { unique: true });
drawingSpecificationSchema.index({ truckType: 1 });
drawingSpecificationSchema.index({ createdBy: 1 });

// Static method to find by truck type
drawingSpecificationSchema.statics.findByTruckType = function(truckTypeId) {
  return this.find({ truckType: truckTypeId });
};

module.exports = mongoose.model('DrawingSpecification', drawingSpecificationSchema);
