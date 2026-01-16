const mongoose = require('mongoose');

// Quotation Header Schema - shared information across all offers
const quotationHeaderSchema = new mongoose.Schema({
  // User roles - clear separation of responsibilities
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
  creatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  marketingName: {
    type: String,
    required: true,
    trim: true
  },
  rfqId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ',
    default: null
  },

  // Quotation identity - unique per quotation
  quotationNumber: {
    type: String,
    unique: true,
    required: true
  },

  // Customer information - shared across all offers
  // Line of Business - supports multiple business types (matches RFQ)
  lineOfBusiness: {
    type: {
      type: String,
      enum: ['karoseri', 'non_karoseri', 'service', 'sparepart'],
      default: 'karoseri',
      required: true
    }
    // Items for all types are stored in offerItems[] (in QuotationOffer)
  },

  // Header-level status and selection
  status: {
    type: {
      type: String,
      enum: ['open', 'loss', 'win', 'close'],
      default: 'open'
    },
    reason: {
      type: String,
      trim: true
    }
  },
  winSubStatus: {
    type: String,
    enum: ['order', 'proceed', 'delivery'],
    default: null
  },
  ocSequenceNumber: {
    type: String,
    trim: true,
    default: ''
  },
  ocNumber: {
    type: String,
    trim: true,
    default: ''
  },
  spkSequenceNumber: {
    type: String,
    trim: true,
    default: ''
  },
  spkCode: {
    type: String,
    trim: true,
    default: ''
  },
  spkNumber: {
    type: String,
    trim: true,
    default: ''
  },
  selectedOfferId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuotationOffer'
  },
  selectedOfferItemIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OfferItem'
  }],
  lastFollowUpDate: {
    type: Date
  },
  progress: [{
    type: String,
    trim: true
  }],
  
  // Download tracking
  downloads: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    downloadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for better performance
quotationHeaderSchema.index({ quotationNumber: 1 }, { unique: true });
quotationHeaderSchema.index({ requesterId: 1 });
quotationHeaderSchema.index({ approverId: 1 });
quotationHeaderSchema.index({ creatorId: 1 });
quotationHeaderSchema.index({ createdAt: -1 });
quotationHeaderSchema.index({ rfqId: 1 });

module.exports = mongoose.model('QuotationHeader', quotationHeaderSchema);
