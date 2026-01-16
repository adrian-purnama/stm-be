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
  },
  order: {
    type: Number,
    default: 0
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

  // Estimated Revenue for this item (required)
  estimatedRevenue: {
    type: Number,
    required: true,
    min: 0
  },

  // Karoseri-specific fields (optional)
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
  // Chassis model (optional) - e.g., "Dutro 500", "Hino 200", etc.
  chassisModel: {
    type: String,
    trim: true,
    default: ''
  },
  drawingSpecification: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DrawingSpecification'
  },

  // Template mode: 'manual', 'bodyType', 'drawing' (for karoseri) or optional (for non_karoseri)
  templateMode: {
    type: String,
    enum: ['manual', 'bodyType', 'drawing'],
    required: false // Optional for non_karoseri, required for karoseri (handled in route)
  },
  
  // Template source model name (used by refPath)
  templateSourceModel: {
    type: String,
    enum: ['BodyType', 'DrawingSpecification', null],
    default: null
  },
  
  // Template source reference
  templateSourceId: {
    type: mongoose.Schema.Types.ObjectId,
    // References either BodyType or DrawingSpecification depending on templateSourceModel
    refPath: 'templateSourceModel'
  },

  // Specifications using truck type structure (for karoseri only)
  specifications: [rfqItemSpecificationCategorySchema],

  // Notes specific to this item
  notes: {
    type: String,
    trim: true
  },

  // Service-specific fields (for service RFQ items)
  serviceName: {
    type: String,
    trim: true,
    default: ''
  },
  serviceDetails: {
    type: [String],
    default: []
  },

  // Sparepart-specific fields (for sparepart RFQ items)
  sparepartName: {
    type: String,
    trim: true,
    default: ''
  },
  pricePerUnit: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Pre-save middleware for rfqItemSchema to normalize order values
rfqItemSchema.pre('save', function(next) {
  // Normalize order values for specification items (ensure sequential ordering)
  if (this.specifications && Array.isArray(this.specifications)) {
    this.specifications.forEach((spec) => {
      if (spec.items && Array.isArray(spec.items)) {
        // Sort items by order, then reassign sequential order values
        spec.items.sort((a, b) => {
          const orderA = a.order !== undefined && a.order !== null ? a.order : Number.MAX_SAFE_INTEGER;
          const orderB = b.order !== undefined && b.order !== null ? b.order : Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });
        // Assign sequential order values (0, 1, 2, ...)
        spec.items.forEach((item, index) => {
          item.order = index;
        });
      }
    });
  }
  
  next();
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
      enum: ['created', 'submitted_to_engineering', 'engineering_reviewed', 'submitted_to_approver', 'approved', 'rejected', 'quotation_created', 'updated'],
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
  
  // Flexible customer contact information (key-value pairs)
  customerContacts: [{
    key: {
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
  
  // End User (optional)
  endUser: {
    type: String,
    trim: true,
    default: ''
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
  documents: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RFQDocument'
    }],
    default: []
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
  targetCloseDate: {
    type: Date
  },
  deliveryTerms: {
    type: String,
    trim: true,
    default: ''
  },
  deliveryNotes: {
    type: String,
    trim: true,
    default: ''
  },
  paymentTerms: {
    type: String,
    trim: true,
    default: 'Payment DP 50% sisa cash before delivery'
  },
  inclusionNotes: {
    type: String,
    trim: true,
    default: ''
  },
  exclusionNotes: {
    type: String,
    trim: true,
    default: ''
  },
  isTaxIncluded: {
    type: Boolean,
    default: false
  },
  includePPN: {
    type: Boolean,
    default: true
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
      enum: ['karoseri', 'non_karoseri', 'service', 'sparepart'],
      default: 'karoseri',
      required: true
    }
    // Items for all types are stored in rfq_items[]
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



