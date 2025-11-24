const mongoose = require('mongoose');

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  link: {
    type: String,
    default: '',
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  expires: {
    type: Date,
    default: () => new Date(Date.now() + TEN_DAYS_MS),
    index: { expires: 0 } // TTL index based on expires field
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);


