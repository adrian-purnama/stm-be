const mongoose = require('mongoose');

// Email contact schema
const emailContactSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  }
}, { _id: false });

// WhatsApp contact schema
const whatsappContactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  number: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

// Company Schema
const companySchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  
  // Email messaging information
  email: {
    sendTo: [emailContactSchema],
    cc: [emailContactSchema]
  },
  
  // WhatsApp messaging information
  whatsapp: [whatsappContactSchema],
  
  // Company information fields
  npwp: {
    type: String,
    trim: true,
    default: ''
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  fax: {
    type: String,
    trim: true,
    default: ''
  },
  website: {
    type: String,
    trim: true,
    default: ''
  },
  
  // Additional notes
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  
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

// Indexes
companySchema.index({ companyName: 1 });
companySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Company', companySchema);

