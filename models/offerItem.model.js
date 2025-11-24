const mongoose = require('mongoose');

// Offer Item Schema - individual karoseri/chassis combinations within an offer
const offerItemSchema = new mongoose.Schema({
  // Reference to quotation offer
  quotationOfferId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuotationOffer',
    required: true
  },

  // Item identity
  itemNumber: {
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

  // Template mode: 'manual', 'bodyType', 'drawing' (matches RFQ)
  templateMode: {
    type: String,
    enum: ['manual', 'bodyType', 'drawing'],
    default: 'manual'
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
  
  // Reference fields for dropdowns (when template is not used)
  bodyTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BodyType'
  },
  chassisTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChassisType'
  },
  sizeTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SizeType'
  },

  // Specifications using the same structure as RFQ (category-based with key-value pairs)
  specifications: [{
    category: {
      type: String,
      required: true,
      trim: true
    },
    items: [{
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
    }]
  }],

  // Financial fields - specific to this item
  price: {
    type: Number,
    required: true,
    min: 0
  },
  discountType: {
    type: String,
    enum: ['flat', 'percentage'],
    default: 'percentage'
  },
  discountValue: {
    type: Number,
    default: 0,
    min: 0
  },
  netto: {
    type: Number,
    required: true,
    min: 0
  },
  commission: {
    type: Number,
    default: 0,
    min: 0
  },
  excludePPN: {
    type: Boolean,
    default: false
  },

  // Acceptance tracking
  isAccepted: {
    type: Boolean,
    default: false
  },
  acceptedAt: {
    type: Date
  },
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Quantity
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },

  // Notes specific to this item
  notes: {
    type: String,
    trim: true
  },

  // Service-specific fields (for service quotation items)
  serviceName: {
    type: String,
    trim: true,
    default: ''
  },
  serviceDetails: {
    type: [String],
    default: []
  },

  // Sparepart-specific fields (for sparepart quotation items)
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

// Indexes for better performance
offerItemSchema.index({ quotationOfferId: 1 });
offerItemSchema.index({ quotationOfferId: 1, itemNumber: 1 });
offerItemSchema.index({ isAccepted: 1 });
offerItemSchema.index({ createdAt: -1 });

// Pre-save middleware
offerItemSchema.pre('save', function(next) {
  // Set acceptedAt when isAccepted becomes true
  if (this.isModified('isAccepted') && this.isAccepted && !this.acceptedAt) {
    this.acceptedAt = new Date();
  }
  
  // Clear acceptedAt when isAccepted becomes false
  if (this.isModified('isAccepted') && !this.isAccepted) {
    this.acceptedAt = undefined;
    this.acceptedBy = undefined;
  }
  
  next();
});

module.exports = mongoose.model('OfferItem', offerItemSchema);
