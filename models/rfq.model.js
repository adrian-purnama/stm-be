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

  // Quantity for this item (now required)
  quantity: {
    type: Number,
    required: true,
    min: 1
  },

  // Product information (optional - can use template instead)
  karoseri: {
    type: String,
    trim: true,
    default: ''
  },
  chassis: {
    type: String,
    trim: true,
    default: ''
  },
  drawingSpecification: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DrawingSpecification'
  },

  // Template mode: 'manual', 'bodyType', 'drawing'
  templateMode: {
    type: String,
    enum: ['manual', 'bodyType', 'drawing'],
    default: 'manual'
  },
  
  // Template source reference
  templateSourceId: {
    type: mongoose.Schema.Types.ObjectId,
    // References either BodyType or DrawingSpecification depending on templateMode
    refPath: 'templateMode === "bodyType" ? "BodyType" : templateMode === "drawing" ? "DrawingSpecification" : null'
  },

  // Specifications using truck type structure
  specifications: [rfqItemSpecificationCategorySchema],

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
  
  // User-specific folder assignment (optional, stored on RFQ for quick filtering)
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // User assignments - Multi-stage workflow: Sales -> Engineering -> Approver -> Quotation Creator
  requesterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  engineeringId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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
  
  // High-level stage tracking
  stage: {
    type: String,
    enum: ['sales', 'engineering', 'approver', 'quotation', 'completed'],
    default: 'sales'
  },
  
  // Engineering Transit - tracks engineering review and modifications
  engineeringTransit: {
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    specsOriginal: {
      type: Array,
      default: []
    },
    specsModified: {
      type: Array,
      default: []
    },
    canDo: {
      type: Boolean,
      default: null
    },
    comments: {
      type: String,
      default: '',
      trim: true
    },
      reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'reviewed'],
      default: 'pending'
    }
  },
  
  // Timeline tracking for stage changes
  timeline: [{
    stage: {
      type: String,
      enum: ['sales', 'engineering', 'approver', 'quotation', 'completed'],
      required: true
    },
    action: {
      type: String,
      enum: ['created', 'submitted_to_engineering', 'engineering_reviewed', 'submitted_to_approver', 'approved', 'rejected', 'quotation_created'],
      required: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      trim: true
    }
  }],
  
  // RFQ Details
  description: {
    type: String,
    default: '',
    trim: true
  },
  
  // Estimated Revenue - replaces price/priceNet at item level
  estimatedRevenue: {
    type: Number,
    required: true,
    min: 0
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
  
  // Karoseri-specific fields (only required when lineOfBusiness.type === 'karoseri')
  bodyTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BodyType'
  },
  chassisTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChassisType'
  },
  
  // Delivery location
  deliveryLocation: {
    type: String,
    required: true,
    trim: true
  },
  
  // Competitor information
  competitor: {
    type: String,
    required: true,
    trim: true
  },
  
  // Project flags
  canMake: {
    type: Boolean,
    required: true,
    default: false
  },
  
  projectOngoing: {
    type: Boolean,
    required: true,
    default: false
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
  },

  // Line of Business - supports multiple business types
  lineOfBusiness: {
    type: {
      type: String,
      enum: ['karoseri', 'service', 'sparepart'],
      default: 'karoseri',
      required: true
    },
    // Karoseri data - uses existing RFQItem structure (stored separately)
    // Service data
    service: {
      serviceName: {
        type: String,
        trim: true
      },
      serviceDetails: [{
        type: String,
        trim: true
      }]
    },
    // Sparepart data
    sparepart: {
      spareparts: [{
        sparepartName: {
          type: String,
          required: true,
          trim: true
        },
        quantity: {
          type: Number,
          required: true,
          min: 1
        }
      }]
    }
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



