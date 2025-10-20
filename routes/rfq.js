const express = require('express');
const router = express.Router();
const RFQ = require('../models/rfq.model');
const User = require('../models/user.model');
const { authenticateToken } = require('../middleware/auth');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/errorHandler');
const { addNotification } = require('../utils/notificationHelper');

// GET /api/rfq - get RFQs based on user role
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const userId = req.user.userId;
    
    // Check if user has approve_rfq permission
    const user = await User.findById(userId).populate('permissions');
    const canApprove = user.permissions.some(p => p.name === 'approve_rfq');
    
    let query = {};
    
    if (canApprove) {
      // Approver view: show RFQs assigned to this user
      query.approverId = userId;
    } else {
      // Requester view: show RFQs created by this user
      query.userId = userId;
    }
    
    if (status) {
      query.status = status;
    }
    
    const [rfqs, total] = await Promise.all([
      RFQ.find(query)
        .populate('userId', 'email fullName')
        .populate('approverId', 'email fullName')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      RFQ.countDocuments(query)
    ]);
    
    return sendSuccessResponse(res, 200, 'RFQs retrieved', {
      rfqs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      userRole: canApprove ? 'approver' : 'requester'
    });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch RFQs', e.message);
  }
});

// GET /api/rfq/approvers - get users with approve_rfq permission
router.get('/approvers', authenticateToken, async (req, res) => {
  try {
    const approvers = await User.find({})
      .populate('permissions')
      .then(users => users.filter(user => 
        user.permissions.some(p => p.name === 'approve_rfq')
      ))
      .then(users => users.map(user => ({
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      })));
    
    return sendSuccessResponse(res, 200, 'Approvers retrieved', { approvers });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch approvers', e.message);
  }
});

// POST /api/rfq - create new RFQ
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, approverId, description } = req.body;
    const userId = req.user.userId;
    
    if (!title || !approverId) {
      return sendErrorResponse(res, 400, 'Title and approver are required');
    }
    
    const rfq = new RFQ({
      title,
      approverId,
      userId,
      description: description || ''
    });
    
    await rfq.save();
    
    // Populate the saved RFQ
    const populatedRFQ = await RFQ.findById(rfq._id)
      .populate('userId', 'email fullName')
      .populate('approverId', 'email fullName');
    
    // Send notification to approver
    await addNotification({
      userId: approverId,
      title: 'New RFQ Request',
      description: `New RFQ request: "${title}" from ${populatedRFQ.userId.email}`,
      path: '/quotations'
    });
    
    return sendSuccessResponse(res, 201, 'RFQ created successfully', { rfq: populatedRFQ });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to create RFQ', e.message);
  }
});

// PATCH /api/rfq/:id/approve - approve RFQ
router.patch('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const rfq = await RFQ.findOneAndUpdate(
      { _id: id, approverId: userId, status: 'pending' },
      { 
        isApproved: true, 
        status: 'approved',
        approvedAt: new Date()
      },
      { new: true }
    ).populate('userId', 'email fullName')
     .populate('approverId', 'email fullName');
    
    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found or already processed');
    }
    
    // Send notification to requester
    await addNotification({
      userId: rfq.userId._id,
      title: 'RFQ Approved',
      description: `Your RFQ "${rfq.title}" has been approved`,
      path: '/quotation'
    });
    
    return sendSuccessResponse(res, 200, 'RFQ approved successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to approve RFQ', e.message);
  }
});

// PATCH /api/rfq/:id/reject - reject RFQ
router.patch('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const rfq = await RFQ.findOneAndUpdate(
      { _id: id, approverId: userId, status: 'pending' },
      { 
        isApproved: false, 
        status: 'rejected',
        rejectedAt: new Date()
      },
      { new: true }
    ).populate('userId', 'email fullName')
     .populate('approverId', 'email fullName');
    
    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found or already processed');
    }
    
    // Send notification to requester
    await addNotification({
      userId: rfq.userId._id,
      title: 'RFQ Rejected',
      description: `Your RFQ "${rfq.title}" has been rejected`,
      path: '/quotation'
    });
    
    return sendSuccessResponse(res, 200, 'RFQ rejected successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to reject RFQ', e.message);
  }
});

// GET /api/rfq/pending-count - get count of pending RFQs for approver
router.get('/pending-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const count = await RFQ.countDocuments({
      approverId: userId,
      status: 'pending'
    });
    
    return sendSuccessResponse(res, 200, 'Pending count retrieved', { count });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch pending count', e.message);
  }
});

module.exports = router;
