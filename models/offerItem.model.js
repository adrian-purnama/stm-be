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

  // Product information - specific to this item
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

  // Specification mode: 'simple' for array of strings, 'complex' for array of objects
  specificationMode: {
    type: String,
    enum: ['simple', 'complex'],
    default: 'simple'
  },

  // Specifications - can be either simple strings or complex objects with label/value
  specifications: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },

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
