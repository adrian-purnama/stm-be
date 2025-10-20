const express = require('express');
const router = express.Router();
const Notification = require('../models/notification.model');
const { authenticateToken } = require('../middleware/auth');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/errorHandler');

// GET /api/notifications - list current user's notifications with pagination
router.get('/', authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const unreadOnly = String(req.query.unreadOnly || 'false') === 'true';
    const query = { userId: req.user.userId };
    if (unreadOnly) query.isRead = false;


    const [items, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(query)
    ]);

    return sendSuccessResponse(res, 200, 'Notifications retrieved', {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch notifications', e.message);
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.userId, isRead: false });
    return sendSuccessResponse(res, 200, 'Unread count', { count });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch unread count', e.message);
  }
});

// PATCH /api/notifications/:id/read - mark as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const notif = await Notification.findOneAndUpdate({ _id: id, userId: req.user.userId }, { isRead: true }, { new: true });
    if (!notif) return sendErrorResponse(res, 404, 'Notification not found');
    return sendSuccessResponse(res, 200, 'Marked as read', { notification: notif });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to update notification', e.message);
  }
});

module.exports = router;


