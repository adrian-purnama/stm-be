const mongoose = require('mongoose');

// Quotation Offer Schema - individual offers within a quotation
const quotationOfferSchema = new mongoose.Schema({
  // Reference to quotation header
  quotationHeaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuotationHeader',
    required: true
  },

  // Offer identity
  offerNumber: {
    type: String,
    unique: true,
    required: true
  },
  
  // Offer number within quotation (counter)
  offerNumberInQuotation: {
    type: Number,
    required: true,
    min: 1
  },

  // Offer-level information removed - simplified structure

  // Total financial summary (calculated from offer items)
  totalPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  totalNetto: {
    type: Number,
    default: 0,
    min: 0
  },
  totalDiscount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Offer-level settings
  excludePPN: {
    type: Boolean,
    default: false
  },

  // Acceptance tracking at offer level
  isFullyAccepted: {
    type: Boolean,
    default: false
  },
  isPartiallyAccepted: {
    type: Boolean,
    default: false
  },
  acceptedItemsCount: {
    type: Number,
    default: 0
  },
  totalItemsCount: {
    type: Number,
    default: 0
  },

  // Revision tracking
  revision: {
    type: Number,
    default: 0,
    min: 0
  },
  parentQuotationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuotationOffer'
  },

  // Notes for the entire offer
  notes: {
    type: String,
    trim: true
  },

  // Notes images - array of references to NotesImage documents
  notesImages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NotesImage'
  }]
}, {
  timestamps: true
});

// Indexes for better performance
quotationOfferSchema.index({ quotationHeaderId: 1 });
// offerNumber already has unique: true in schema definition
quotationOfferSchema.index({ quotationHeaderId: 1, offerNumberInQuotation: 1 });
quotationOfferSchema.index({ isFullyAccepted: 1 });
quotationOfferSchema.index({ isPartiallyAccepted: 1 });
quotationOfferSchema.index({ parentQuotationId: 1 });
quotationOfferSchema.index({ notesImages: 1 });
quotationOfferSchema.index({ createdAt: -1 });

// Virtual for offer items (will be populated)
quotationOfferSchema.virtual('offerItems', {
  ref: 'OfferItem',
  localField: '_id',
  foreignField: 'quotationOfferId'
});

// Virtual for notes images (will be populated)
quotationOfferSchema.virtual('notesImagesData', {
  ref: 'NotesImage',
  localField: 'notesImages',
  foreignField: '_id'
});

// Virtual for acceptance status
quotationOfferSchema.virtual('acceptanceStatus').get(function() {
  if (this.isFullyAccepted) return 'fully_accepted';
  if (this.isPartiallyAccepted) return 'partially_accepted';
  return 'not_accepted';
});

// Instance methods for notes images
quotationOfferSchema.methods.addNotesImage = function(imageId) {
  if (!this.notesImages.includes(imageId)) {
    this.notesImages.push(imageId);
  }
  return this.save();
};

quotationOfferSchema.methods.removeNotesImage = function(imageId) {
  this.notesImages = this.notesImages.filter(id => !id.equals(imageId));
  return this.save();
};

quotationOfferSchema.methods.getNotesImagesCount = function() {
  return this.notesImages.length;
};

// Pre-save middleware - calculate totals from offer items
quotationOfferSchema.pre('save', async function(next) {
  try {
    // If this is a new document, skip calculation
    if (this.isNew) {
      return next();
    }

    // Calculate totals from offer items
    const OfferItem = mongoose.model('OfferItem');
    const items = await OfferItem.find({ quotationOfferId: this._id });
    
    this.totalItemsCount = items.length;
    this.acceptedItemsCount = items.filter(item => item.isAccepted).length;
    
    this.totalPrice = items.reduce((sum, item) => sum + item.price, 0);
    this.totalNetto = items.reduce((sum, item) => sum + item.netto, 0);
    this.totalDiscount = this.totalPrice - this.totalNetto;
    
    // Update acceptance status
    this.isFullyAccepted = this.acceptedItemsCount === this.totalItemsCount && this.totalItemsCount > 0;
    this.isPartiallyAccepted = this.acceptedItemsCount > 0 && this.acceptedItemsCount < this.totalItemsCount;
    
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('QuotationOffer', quotationOfferSchema);
