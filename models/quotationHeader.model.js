const mongoose = require('mongoose');

// Quotation Header Schema - shared information across all offers
const quotationHeaderSchema = new mongoose.Schema({
  // User ownership - tied to whoever created it
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  marketingName: {
    type: String,
    required: true,
    trim: true
  },

  // Quotation identity - unique per quotation
  quotationNumber: {
    type: String,
    unique: true,
    required: true
  },

  // Customer information - shared across all offers
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
  }]
}, {
  timestamps: true
});

// Indexes for better performance
quotationHeaderSchema.index({ quotationNumber: 1 }, { unique: true });
quotationHeaderSchema.index({ userId: 1 });
quotationHeaderSchema.index({ customerName: 1 });
quotationHeaderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('QuotationHeader', quotationHeaderSchema);
