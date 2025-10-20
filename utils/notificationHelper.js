const Notification = require('../models/notification.model');
const { EventEmitter } = require('events');
const notificationsEvents = new EventEmitter();

const FE_LINK = process.env.FE_LINK || 'http://localhost:5173';

/**
 * Create and persist a notification for a specific user.
 * @param {Object} params
 * @param {string} params.userId - User ObjectId
 * @param {string} params.title - Notification title
 * @param {string} [params.description] - Detail text
 * @param {string} [params.path] - Frontend-relative path, e.g. '/profile'
 * @param {Date} [params.expires] - Optional expiry override
 * @returns {Promise<Object>} Saved notification document
 */
async function addNotification({ userId, title, description = '', path = '', expires }) {
  const link = path ? `${FE_LINK}${path}` : '';
  const payload = { userId, title, description, link };
  if (expires) payload.expires = expires;
  const notif = new Notification(payload);
  await notif.save();
  // Emit event for websocket broadcasting
  notificationsEvents.emit('created', {
    id: notif._id,
    userId: String(notif.userId),
    title: notif.title,
    description: notif.description,
    link: notif.link,
    createdAt: notif.createdAt
  });
  return notif;
}

module.exports = {
  addNotification,
  notificationsEvents
};


