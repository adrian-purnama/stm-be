const mongoose = require('mongoose');

const qnaItemSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const articleSchema = new mongoose.Schema({
  section: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    trim: true
  },
  bodyType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BodyType',
    default: null
  },
  qna: {
    type: [qnaItemSchema],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

articleSchema.index({ section: 1 });
articleSchema.index({ bodyType: 1 });

module.exports = mongoose.model('Article', articleSchema);









