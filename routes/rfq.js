// =============================================================================
// REQUEST FOR QUOTATION (RFQ) ROUTES
// =============================================================================
// This module handles all RFQ-related endpoints including creation, retrieval,
// updates, approval/rejection, and management of RFQ items.

const express = require('express');
const router = express.Router();
const { RFQ, RFQItem } = require('../models/rfq.model');
const User = require('../models/user.model');
const { authenticateToken, authorize } = require('../middleware/auth');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/errorHandler');
const { addNotification } = require('../utils/notificationHelper');
const {
  createRFQ,
  getRFQById,
  getRFQs,
  updateRFQ,
  deleteRFQ,
  approveRFQ,
  rejectRFQ,
  markQuotationCreated,
  createRFQItem,
  getRFQItems,
  updateRFQItem,
  deleteRFQItem
} = require('../utils/rfqHelper');

// =============================================================================
// RFQ UTILITY ROUTES
// =============================================================================

/**
 * GET /api/rfq/approvers
 * Permission: Any authenticated user
 * Description: Get users with approve_rfq permission
 */
router.get('/approvers', authenticateToken, async (req, res) => {
  try {
    const approvers = await User.find()
      .populate('permissions')
      .where('permissions').in(
        await User.db.collection('permissions').distinct('_id', { name: 'approve_rfq' })
      )
      .select('_id email fullName')
      .sort({ fullName: 1 });

    res.status(200).json({
      success: true,
      data: { approvers },
      message: 'Approvers fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching approvers:', error);
    sendErrorResponse(res, 500, 'Failed to fetch approvers');
  }
});

/**
 * GET /api/rfq/quotation-creators
 * Permission: Any authenticated user
 * Description: Get users with quotation_create permission
 */
router.get('/quotation-creators', authenticateToken, async (req, res) => {
  try {
    const quotationCreators = await User.find()
      .populate('permissions')
      .where('permissions').in(
        await User.db.collection('permissions').distinct('_id', { name: 'quotation_create' })
      )
      .select('_id email fullName')
      .sort({ fullName: 1 });

    res.status(200).json({
      success: true,
      data: { quotationCreators },
      message: 'Quotation creators fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching quotation creators:', error);
    sendErrorResponse(res, 500, 'Failed to fetch quotation creators');
  }
});

// GET /api/rfq/approved-for-quotation - get approved RFQs for quotation creation
/**
 * GET /api/rfq/approved-for-quotation
 * Permission: quotation_create
 * Description: Get approved RFQs available for quotation creation
 */
router.get('/approved-for-quotation', authenticateToken, authorize(['quotation_create']), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;
    
    const filters = {
      status: 'approved',
      quotationCreatorId: userId
    };
    
    const result = await getRFQs(filters, { page, limit });
    res.status(200).json({
      success: true,
      data: result,
      message: 'Approved RFQs fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching approved RFQs:', error);
    sendErrorResponse(res, 500, 'Failed to fetch approved RFQs');
  }
});

// GET /api/rfq - get RFQs based on user role
// =============================================================================
// RFQ CRUD ROUTES
// =============================================================================

/**
 * GET /api/rfq
 * Permission: Any authenticated user
 * Description: Get RFQs with role-based filtering
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const userId = req.user.userId;
    
    // Check user permissions
    const user = await User.findById(userId).populate('permissions');
    const canApprove = user.permissions.some(p => p.name === 'approve_rfq');
    const canCreateQuotation = user.permissions.some(p => p.name === 'quotation_create');
    const canRequestQuotation = user.permissions.some(p => p.name === 'quotation_requester');
    
    let query = {};
    let userRole = 'viewer';
    
    if (canApprove) {
      // Approver view: show RFQs assigned to this user
      query.approverId = userId;
      userRole = 'approver';
    } else if (canCreateQuotation) {
      // Creator view: show RFQs assigned to this user for quotation creation
      query.quotationCreatorId = userId;
      userRole = 'creator';
    } else if (canRequestQuotation) {
      // Requester view: show RFQs created by this user
      query.requesterId = userId;
      userRole = 'requester';
    } else {
      return sendErrorResponse(res, 403, 'Access denied. No relevant permissions found.');
    }
    
    if (status) {
      query.status = status;
    }
    
    const result = await getRFQs(query, { page: parseInt(page), limit: parseInt(limit) });
    
    return sendSuccessResponse(res, 200, 'RFQs retrieved', {
      ...result,
      userRole
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

// GET /api/rfq/quotation-creators - get users with quotation_create permission
router.get('/quotation-creators', authenticateToken, async (req, res) => {
  try {
    const quotationCreators = await User.find({})
      .populate('permissions')
      .then(users => users.filter(user => 
        user.permissions.some(p => p.name === 'quotation_create')
      ))
      .then(users => users.map(user => ({
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      })));
    
    return sendSuccessResponse(res, 200, 'Quotation creators retrieved', { quotationCreators });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch quotation creators', e.message);
  }
});

// POST /api/rfq - create new RFQ
/**
 * POST /api/rfq
 * Permission: quotation_requester
 * Description: Create a new RFQ
 */
router.post('/', authenticateToken, authorize(['quotation_requester']), async (req, res) => {
  try {
    const { 
      approverId, 
      quotationCreatorId, 
      description, 
      customerName, 
      contactPerson,
      priority,
      expectedDeliveryDate,
      confidenceRate,
      deliveryLocation,
      competitor,
      canMake,
      projectOngoing,
      items
    } = req.body;
    const requesterId = req.user.userId;
    
    // Validation
    if (!approverId || !quotationCreatorId || !customerName || !contactPerson?.name) {
      return sendErrorResponse(res, 400, 'Approver, quotation creator, customer name, and contact person name are required');
    }
    
    if (confidenceRate === undefined || confidenceRate === null || confidenceRate < 0 || confidenceRate > 100) {
      return sendErrorResponse(res, 400, 'Confidence rate is required and must be between 0 and 100');
    }
    
    if (!Number.isInteger(parseFloat(confidenceRate))) {
      return sendErrorResponse(res, 400, 'Confidence rate must be an integer');
    }
    
    if (!deliveryLocation || !deliveryLocation.trim()) {
      return sendErrorResponse(res, 400, 'Delivery location is required');
    }
    
    if (!competitor || !competitor.trim()) {
      return sendErrorResponse(res, 400, 'Competitor is required');
    }
    
    if (canMake === undefined || canMake === null || typeof canMake !== 'boolean') {
      return sendErrorResponse(res, 400, 'Can Make flag is required and must be a boolean');
    }
    
    if (projectOngoing === undefined || projectOngoing === null || typeof projectOngoing !== 'boolean') {
      return sendErrorResponse(res, 400, 'Project Ongoing flag is required and must be a boolean');
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return sendErrorResponse(res, 400, 'At least one item is required');
    }
    
    // Validate items
    for (const item of items) {
      if (!item.karoseri || !item.chassis || !item.price || !item.priceNet) {
        return sendErrorResponse(res, 400, 'Each item must have karoseri, chassis, price, and price net');
      }
    }
    
    // Validate that approver has approve_rfq permission
    const approver = await User.findById(approverId).populate('permissions');
    if (!approver || !approver.permissions.some(p => p.name === 'approve_rfq')) {
      return sendErrorResponse(res, 400, 'Selected approver does not have approve_rfq permission');
    }
    
    // Validate that quotation creator has quotation_create permission
    const quotationCreator = await User.findById(quotationCreatorId).populate('permissions');
    if (!quotationCreator || !quotationCreator.permissions.some(p => p.name === 'quotation_create')) {
      return sendErrorResponse(res, 400, 'Selected quotation creator does not have quotation_create permission');
    }
    
    const rfqData = {
      requesterId,
      approverId,
      quotationCreatorId,
      description: description || '',
      customerName,
      contactPerson,
      priority: priority || 'medium',
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      confidenceRate: parseInt(confidenceRate),
      deliveryLocation: deliveryLocation.trim(),
      competitor: competitor.trim(),
      canMake: Boolean(canMake),
      projectOngoing: Boolean(projectOngoing)
    };
    
    const rfq = await createRFQ(rfqData);
    
    // Create RFQ items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await createRFQItem(rfq._id, {
        itemNumber: i + 1,
        karoseri: item.karoseri,
        chassis: item.chassis,
        price: parseFloat(item.price),
        priceNet: parseFloat(item.priceNet),
        specifications: item.specifications || [],
        notes: item.notes || ''
      });
    }
    
    // Send notification to approver
    await addNotification({
      userId: approverId,
      title: 'New RFQ Request',
      description: `New RFQ request for ${customerName} from ${req.user.fullName || req.user.email}`,
      path: '/quotations'
    });
    
    return sendSuccessResponse(res, 201, 'RFQ created successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to create RFQ', e.message);
  }
});

// PATCH /api/rfq/:id/approve - approve RFQ (Bid decision)
// =============================================================================
// RFQ APPROVAL/REJECTION ROUTES
// =============================================================================

/**
 * PATCH /api/rfq/:id/approve
 * Permission: approve_rfq
 * Description: Approve an RFQ
 */
router.patch('/:id/approve', authenticateToken, authorize(['approve_rfq']), async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalNotes } = req.body;
    const userId = req.user.userId;
    
    // Get the RFQ first to check permissions
    const existingRFQ = await RFQ.findById(id);
    if (!existingRFQ) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }

    if (existingRFQ.approverId.toString() !== userId.toString()) {
      return sendErrorResponse(res, 403, 'You are not authorized to approve this RFQ');
    }
    
    if (existingRFQ.status !== 'pending') {
      return sendErrorResponse(res, 400, 'RFQ has already been processed');
    }
    
    const approvalData = {
      approvalDecision: 'bid',
      approvalNotes: approvalNotes || ''
    };
    
    const rfq = await approveRFQ(id, approvalData);
    
    // Send notification to requester
    await addNotification({
      userId: rfq.requesterId._id,
      title: 'RFQ Approved - Bid Decision',
      description: `Your RFQ "${rfq.title}" has been approved with bid decision`,
      path: '/quotations'
    });
    
    // Send notification to quotation creator
    await addNotification({
      userId: rfq.quotationCreatorId._id,
      title: 'RFQ Approved - Create Quotation',
      description: `RFQ "${rfq.title}" has been approved. You can now create the quotation.`,
      path: '/quotations'
    });
    
    return sendSuccessResponse(res, 200, 'RFQ approved successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to approve RFQ', e.message);
  }
});

// PATCH /api/rfq/:id/reject - reject RFQ (No Bid decision)
/**
 * PATCH /api/rfq/:id/reject
 * Permission: approve_rfq
 * Description: Reject an RFQ
 */
router.patch('/:id/reject', authenticateToken, authorize(['approve_rfq']), async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionNotes } = req.body;
    const userId = req.user.userId;
    
    // Get the RFQ first to check permissions
    const existingRFQ = await RFQ.findById(id);
    if (!existingRFQ) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }
    
    if (existingRFQ.approverId.toString() !== userId.toString()) {
      return sendErrorResponse(res, 403, 'You are not authorized to reject this RFQ');
    }
    
    if (existingRFQ.status !== 'pending') {
      return sendErrorResponse(res, 400, 'RFQ has already been processed');
    }
    
    const rejectionData = {
      approvalDecision: 'no_bid',
      approvalNotes: rejectionNotes || ''
    };
    
    const rfq = await rejectRFQ(id, rejectionData);
    
    // Send notification to requester
    await addNotification({
      userId: rfq.requesterId._id,
      title: 'RFQ Rejected - No Bid Decision',
      description: `Your RFQ "${rfq.title}" has been rejected with no bid decision`,
      path: '/quotations'
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

// GET /api/rfq/approved-for-quotation - get approved RFQs for quotation creator
router.get('/approved-for-quotation', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Check if user has quotation_create permission
    const user = await User.findById(userId).populate('permissions');
    const canCreateQuotation = user.permissions.some(p => p.name === 'quotation_create');
    
    if (!canCreateQuotation) {
      return sendErrorResponse(res, 403, 'Access denied. Quotation create permission required.');
    }
    
    const approvedRFQs = await RFQ.find({
      quotationCreatorId: userId,
      status: 'approved'
    })
      .populate('userId', 'email fullName')
      .populate('approverId', 'email fullName')
      .sort({ approvedAt: -1 });
    
    return sendSuccessResponse(res, 200, 'Approved RFQs retrieved', { rfqs: approvedRFQs });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch approved RFQs', e.message);
  }
});

// ============================================================================
// RFQ ITEM MANAGEMENT ROUTES
// ============================================================================

// GET /api/rfq/:id/items - get items for a specific RFQ
router.get('/:id/items', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    // Check if user has access to this RFQ
    const rfq = await RFQ.findById(id);
    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }
    
    // Check permissions
    const user = await User.findById(userId).populate('permissions');
    const canApprove = user.permissions.some(p => p.name === 'approve_rfq');
    const canCreateQuotation = user.permissions.some(p => p.name === 'quotation_create');
    const canRequestQuotation = user.permissions.some(p => p.name === 'quotation_requester');
    
    const hasAccess = (
      rfq.requesterId.toString() === userId.toString() ||
      (canApprove && rfq.approverId.toString() === userId.toString()) ||
      (canCreateQuotation && rfq.quotationCreatorId.toString() === userId.toString())
    );
    
    if (!hasAccess) {
      return sendErrorResponse(res, 403, 'Access denied');
    }
    
    const items = await getRFQItems(id);
    
    return sendSuccessResponse(res, 200, 'RFQ items retrieved', { items });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch RFQ items', e.message);
  }
});

// POST /api/rfq/:id/items - create new item for RFQ
router.post('/:id/items', authenticateToken, authorize(['quotation_requester']), async (req, res) => {
  try {
    const { id } = req.params;
    const itemData = req.body;
    const userId = req.user.userId;
    
    // Check if RFQ exists and user is the requester
    const rfq = await RFQ.findById(id);
    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }
    
    if (rfq.requesterId.toString() !== userId) {
      return sendErrorResponse(res, 403, 'Only the RFQ requester can add items');
    }
    
    if (rfq.status !== 'pending') {
      return sendErrorResponse(res, 400, 'Cannot add items to processed RFQ');
    }
    
    const item = await createRFQItem(id, itemData);
    
    return sendSuccessResponse(res, 201, 'RFQ item created successfully', { item });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to create RFQ item', e.message);
  }
});

// PUT /api/rfq/items/:itemId - update RFQ item
router.put('/items/:itemId', authenticateToken, authorize(['quotation_requester']), async (req, res) => {
  try {
    const { itemId } = req.params;
    const updateData = req.body;
    const userId = req.user.userId;
    
    // Get the item and check permissions
    const item = await RFQItem.findById(itemId).populate('rfqId');
    if (!item) {
      return sendErrorResponse(res, 404, 'RFQ item not found');
    }
    
    if (item.rfqId.requesterId.toString() !== userId) {
      return sendErrorResponse(res, 403, 'Only the RFQ requester can update items');
    }
    
    if (item.rfqId.status !== 'pending') {
      return sendErrorResponse(res, 400, 'Cannot update items in processed RFQ');
    }
    
    const updatedItem = await updateRFQItem(itemId, updateData);
    
    return sendSuccessResponse(res, 200, 'RFQ item updated successfully', { item: updatedItem });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to update RFQ item', e.message);
  }
});

// DELETE /api/rfq/items/:itemId - delete RFQ item
router.delete('/items/:itemId', authenticateToken, authorize(['quotation_requester']), async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.userId;
    
    // Get the item and check permissions
    const item = await RFQItem.findById(itemId).populate('rfqId');
    if (!item) {
      return sendErrorResponse(res, 404, 'RFQ item not found');
    }
    
    if (item.rfqId.requesterId.toString() !== userId) {
      return sendErrorResponse(res, 403, 'Only the RFQ requester can delete items');
    }
    
    if (item.rfqId.status !== 'pending') {
      return sendErrorResponse(res, 400, 'Cannot delete items from processed RFQ');
    }
    
    await deleteRFQItem(itemId);
    
    return sendSuccessResponse(res, 200, 'RFQ item deleted successfully');
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to delete RFQ item', e.message);
  }
});

// GET /api/rfq/:id - get single RFQ by ID (must be last to avoid conflicts with specific routes)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    // Check if user has access to this RFQ
    const user = await User.findById(userId).populate('permissions');
    const canApprove = user.permissions.some(p => p.name === 'approve_rfq');
    const canCreateQuotation = user.permissions.some(p => p.name === 'quotation_create');
    const canRequestQuotation = user.permissions.some(p => p.name === 'quotation_requester');
    
    const rfq = await getRFQById(id);
    
    // Debug: Check if RFQ items exist in database
    const { RFQItem } = require('../models/rfq.model');
    const directItems = await RFQItem.find({ rfqId: id });
    console.log('RFQ Route: Direct query for RFQ items:', directItems);
    console.log('RFQ Route: Direct query items length:', directItems.length);
    
    console.log('RFQ Route: Retrieved RFQ:', rfq);
    console.log('RFQ Route: RFQ items (virtual):', rfq.items);
    console.log('RFQ Route: RFQ items length (virtual):', rfq.items?.length);
    
    // If virtual population didn't work, manually add items
    if (!rfq.items || rfq.items.length === 0) {
      console.log('RFQ Route: Virtual population failed, manually adding items');
      rfq.items = directItems;
    }
    
    const hasAccess = (
      rfq.requesterId._id.toString() === userId.toString() ||
      (canApprove && rfq.approverId._id.toString() === userId.toString()) ||
      (canCreateQuotation && rfq.quotationCreatorId._id.toString() === userId.toString())
    );
    
    if (!hasAccess) {
      return sendErrorResponse(res, 403, 'Access denied');
    }
    
    return sendSuccessResponse(res, 200, 'RFQ retrieved', { rfq });
  } catch (error) {
    console.error('Error fetching RFQ:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch RFQ', error.message);
  }
});

module.exports = router;
