const mongoose = require('mongoose');

// RFQ Item Specification Schema (similar to truck type specifications)
const rfqItemSpecificationSchema = new mongoose.Schema({
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

// RFQ Item Specification Category Schema
const rfqItemSpecificationCategorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    trim: true
  },
  items: [rfqItemSpecificationSchema]
}, { _id: false });

// RFQ Item Schema (similar to offer item but for RFQ)
const rfqItemSchema = new mongoose.Schema({
  // Reference to RFQ
  rfqId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ',
    required: true
  },

  // Item identity
  itemNumber: {
    type: Number,
    required: true,
    min: 1
  },

  // Product information
  karoseri: {
    type: String,
    required: true,
    trim: true
  },
  chassis: {
    type: String,
    required: true,
    trim: true
  },
  drawingSpecification: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DrawingSpecification'
  },

  // Specifications using truck type structure
  specifications: [rfqItemSpecificationCategorySchema],

  // Pricing information
  price: {
    type: Number,
    required: true,
    min: 0
  },
  priceNet: {
    type: Number,
    required: true,
    min: 0
  },

  // Notes specific to this item
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

const rfqSchema = new mongoose.Schema({
  // RFQ Identity
  rfqNumber: {
    type: String,
    unique: true,
    required: true
  },
  
  // User assignments - 3-stage flow
  requesterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quotationCreatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // RFQ Status and Flow
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'quotation_created'],
    default: 'pending'
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  
  // RFQ Details
  description: {
    type: String,
    default: '',
    trim: true
  },
  
  // Confidence rate for the RFQ (0-100)
  confidenceRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    validate: {
      validator: function(v) {
        return Number.isInteger(v) && v >= 0 && v <= 100;
      },
      message: 'Confidence rate must be an integer between 0 and 100'
    }
  },
  
  // Customer information - aligned with quotation model
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  contactPerson: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: true
    }
  },
  
  // Approval details
  approvalDecision: {
    type: String,
    enum: ['bid', 'no_bid', null],
    default: null
  },
  approvalNotes: {
    type: String,
    trim: true
  },
  
  // Timestamps for each stage
  submittedAt: {
    type: Date,
    default: Date.now
  },
  approvedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  },
  quotationCreatedAt: {
    type: Date
  },
  
  // Link to created quotation
  quotationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuotationHeader'
  },
  
  // Additional fields for future extensibility
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  expectedDeliveryDate: {
    type: Date
  },
  budget: {
    type: Number,
    min: 0
  },
  currency: {
    type: String,
    default: 'IDR'
  }
}, {
  timestamps: true
});

// Add virtual for items
rfqSchema.virtual('items', {
  ref: 'RFQItem',
  localField: '_id',
  foreignField: 'rfqId'
});

// Ensure virtuals are included in JSON output
rfqSchema.set('toJSON', { virtuals: true });
rfqSchema.set('toObject', { virtuals: true });

// Indexes for efficient queries
rfqSchema.index({ rfqNumber: 1 }, { unique: true });
rfqSchema.index({ requesterId: 1, createdAt: -1 });
rfqSchema.index({ approverId: 1, status: 1, createdAt: -1 });
rfqSchema.index({ quotationCreatorId: 1, status: 1, createdAt: -1 });
rfqSchema.index({ status: 1, createdAt: -1 });
rfqSchema.index({ customerName: 1 });

// Export both models
module.exports = {
  RFQ: mongoose.model('RFQ', rfqSchema),
  RFQItem: mongoose.model('RFQItem', rfqItemSchema)
};



