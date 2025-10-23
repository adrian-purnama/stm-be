const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const QuotationHeader = require('../models/quotationHeader.model');
const QuotationOffer = require('../models/quotationOffer.model');
const OfferItem = require('../models/offerItem.model');
const User = require('../models/user.model');
const { sendQuotationNotificationEmail } = require('../utils/emailUtils');
const { hasPermission, hasAnyPermission, getAllUserPermissions } = require('../utils/permissionHelper');
const {
  createQuotationHeader,
  createQuotationOffer,
  getQuotationHeaderById,
  getQuotationOfferById,
  getQuotationOffers,
  updateQuotationHeader,
  updateQuotationOffer,
  deleteQuotationHeader,
  deleteQuotationOffer,
  getQuotations,
  updateLastFollowUp,
  updateLastFollowUpAll,
  generateQuotationNumber,
  formatPrice,
  migrateOfferNumbers
} = require('../utils/quotationHelper');

// ============================================================================
// QUOTATION MANAGEMENT ROUTES
// ============================================================================

// Get all quotations for the authenticated user
router.get('/', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { page = 1, limit = 10, filterMode = 'all', ...filters } = req.query;
    
    // Get user with permissions
    const user = await require('../models/user.model').findById(req.user.userId).populate('permissions');
    const userPermissions = user.permissions.map(p => p.name);
    
    let userFilters = { ...filters };
    
    // Apply role-based filtering based on filterMode
    if (filterMode === 'my_quotations') {
      // Show only quotations where user is the requester (from their RFQs)
      const { RFQ } = require('../models/rfq.model');
      
      // Find RFQs where this user is the requester and quotation was created
      const rfqsWithQuotations = await RFQ.find({
        requesterId: req.user.userId,
        quotationId: { $exists: true, $ne: null }
      }).select('quotationId');
      
      const quotationIds = rfqsWithQuotations.map(rfq => rfq.quotationId);
      
      if (quotationIds.length > 0) {
        userFilters._id = { $in: quotationIds };
      } else {
        // No quotations from user's RFQs, return empty result
        userFilters._id = { $in: [] };
      }
    } else if (filterMode === 'created_by_me') {
      // Show only quotations created by this user
      userFilters.creatorId = req.user.userId;
    } else if (filterMode === 'approve_rfq') {
      // Show only RFQs where user is the approver (this is handled in RFQ route, not here)
      // This filter mode is not applicable for quotations
      return res.status(400).json({
        success: false,
        message: 'approve_rfq filter mode is not applicable for quotations'
      });
    } else if (filterMode === 'all_viewer') {
      // filterMode === 'all_viewer' - Show all quotations for users with all_quotation_viewer permission
      const hasAllQuotationViewerPermission = userPermissions.includes('all_quotation_viewer');
      
      if (!hasAllQuotationViewerPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. All quotation viewer permission required.'
        });
      }
      // No additional filtering needed for users with all_quotation_viewer permission
    } else {
      // filterMode === 'all' - Show all quotations (admin/manager view)
      const hasAdminPermission = userPermissions.includes('quotation_admin') || 
                                 userPermissions.includes('admin') ||
                                 userPermissions.includes('manager');
      
      if (!hasAdminPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin permission required to view all quotations.'
        });
      }
      // No additional filtering needed for admin users
    }
    
    const result = await getQuotations(userFilters, { page: parseInt(page), limit: parseInt(limit) });
    
    // Additional security check: Filter out quotations the user shouldn't see
    const { RFQ } = require('../models/rfq.model');
    const filteredQuotations = [];
    
    // Check if user has all_quotation_viewer permission - if so, bypass individual access checks
    const hasAllQuotationViewerPermission = userPermissions.includes('all_quotation_viewer');
    const hasAdminPermission = userPermissions.includes('quotation_admin') || 
                               userPermissions.includes('admin') ||
                               userPermissions.includes('manager');
    
    for (const quotation of result.quotations) {
      let canAccess = false;
      
      // If user has all_quotation_viewer or admin permission, or if filterMode is all/all_viewer, they can see all quotations
      if (hasAllQuotationViewerPermission || hasAdminPermission || filterMode === 'all' || filterMode === 'all_viewer') {
        canAccess = true;
      } else {
      
        // Check if user is the creator, requester, or approver
        const header = quotation.header;
        if (header.creatorId && (header.creatorId._id ? header.creatorId._id.toString() : header.creatorId.toString()) === req.user.userId.toString()) {
          canAccess = true;
        } else if (header.requesterId && (header.requesterId._id ? header.requesterId._id.toString() : header.requesterId.toString()) === req.user.userId.toString()) {
          canAccess = true;
        } else if (header.approverId && (header.approverId._id ? header.approverId._id.toString() : header.approverId.toString()) === req.user.userId.toString()) {
          canAccess = true;
        }
        
        // Check if user is the requester (from RFQ)
        if (!canAccess) {
          const rfq = await RFQ.findOne({
            quotationId: quotation.header._id,
            requesterId: req.user.userId
          });
          if (rfq) {
            canAccess = true;
          }
        }
        
        // Check if user is the approver (from RFQ)
        if (!canAccess) {
          const rfq = await RFQ.findOne({
            quotationId: quotation.header._id,
            approverId: req.user.userId
          });
          if (rfq) {
            canAccess = true;
          }
        }
      }
      
      if (canAccess) {
        filteredQuotations.push(quotation);
      }
    }
    
    // Update result with filtered quotations
    result.quotations = filteredQuotations;
    
    // Simplify the response - only include essential data
    const simplifiedQuotations = result.quotations.map(quotation => ({
      header: {
        _id: quotation.header._id,
        quotationNumber: quotation.header.quotationNumber,
        customerName: quotation.header.customerName,
        contactPerson: quotation.header.contactPerson,
        status: quotation.header.status,
        selectedOfferId: quotation.header.selectedOfferId,
        selectedOfferItemIds: quotation.header.selectedOfferItemIds,
        lastFollowUpDate: quotation.header.lastFollowUpDate,
        followUpStatus: quotation.header.followUpStatus,
        marketingName: quotation.header.marketingName,
        createdAt: quotation.header.createdAt,
        updatedAt: quotation.header.updatedAt
      },
      offers: quotation.offers.map(offerGroup => ({
        original: offerGroup.original ? {
          _id: offerGroup.original._id,
          offerNumber: offerGroup.original.offerNumber,
          offerNumberInQuotation: offerGroup.original.offerNumberInQuotation,
          totalPrice: offerGroup.original.totalPrice,
          totalNetto: offerGroup.original.totalNetto,
          totalDiscount: offerGroup.original.totalDiscount,
          excludePPN: offerGroup.original.excludePPN,
          isFullyAccepted: offerGroup.original.isFullyAccepted,
          isPartiallyAccepted: offerGroup.original.isPartiallyAccepted,
          acceptedItemsCount: offerGroup.original.acceptedItemsCount,
          totalItemsCount: offerGroup.original.totalItemsCount,
          revision: offerGroup.original.revision,
          notes: offerGroup.original.notes,
          notesImages: offerGroup.original.notesImages || [],
          offerItems: offerGroup.original.offerItems || []
        } : null,
        revisions: offerGroup.revisions.map(revision => ({
          _id: revision._id,
          offerNumber: revision.offerNumber,
          offerNumberInQuotation: revision.offerNumberInQuotation,
          totalPrice: revision.totalPrice,
          totalNetto: revision.totalNetto,
          totalDiscount: revision.totalDiscount,
          excludePPN: revision.excludePPN,
          isFullyAccepted: revision.isFullyAccepted,
          isPartiallyAccepted: revision.isPartiallyAccepted,
          acceptedItemsCount: revision.acceptedItemsCount,
          totalItemsCount: revision.totalItemsCount,
          revision: revision.revision,
          notes: revision.notes,
          notesImages: revision.notesImages || [],
          offerItems: revision.offerItems || []
        }))
      }))
    }));
    
    
    res.json({
      success: true,
      data: simplifiedQuotations,
      pagination: result.pagination,
      message: 'Quotations retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting quotations:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get all quotations for users with all_quotation_viewer permission
router.get('/all', authenticateToken, authorize(['all_quotation_viewer']), async (req, res) => {
  try {
    const { page = 1, limit = 10, filterMode = 'all_viewer', ...filters } = req.query;
    
    // Get user with permissions
    const user = await require('../models/user.model').findById(req.user.userId).populate('permissions');
    const userPermissions = user.permissions.map(p => p.name);
    
    // Check if user has all_quotation_viewer permission
    const hasAllQuotationViewerPermission = true
    
    if (!hasAllQuotationViewerPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. all_quotation_viewer permission required to view all quotations.'
      });
    }
    
    // Set filterMode to all_viewer for this route
    const userFilters = { ...filters, filterMode: 'all_viewer' };
    
    // No additional filtering needed - show all quotations
    const result = await getQuotations(userFilters, { page: parseInt(page), limit: parseInt(limit) });
    
    // Simplify the response - only include essential data
    const simplifiedQuotations = result.quotations.map(quotation => ({
      header: {
        _id: quotation.header._id,
        quotationNumber: quotation.header.quotationNumber,
        customerName: quotation.header.customerName,
        contactPerson: quotation.header.contactPerson,
        status: quotation.header.status,
        selectedOfferId: quotation.header.selectedOfferId,
        selectedOfferItemIds: quotation.header.selectedOfferItemIds,
        lastFollowUpDate: quotation.header.lastFollowUpDate,
        followUpStatus: quotation.header.followUpStatus,
        marketingName: quotation.header.marketingName,
        createdAt: quotation.header.createdAt,
        updatedAt: quotation.header.updatedAt
      },
      offers: quotation.offers.map(offerGroup => ({
        original: offerGroup.original ? {
          _id: offerGroup.original._id,
          offerNumber: offerGroup.original.offerNumber,
          offerNumberInQuotation: offerGroup.original.offerNumberInQuotation,
          totalPrice: offerGroup.original.totalPrice,
          totalNetto: offerGroup.original.totalNetto,
          totalDiscount: offerGroup.original.totalDiscount,
          excludePPN: offerGroup.original.excludePPN,
          isFullyAccepted: offerGroup.original.isFullyAccepted,
          isPartiallyAccepted: offerGroup.original.isPartiallyAccepted,
          acceptedItemsCount: offerGroup.original.acceptedItemsCount,
          totalItemsCount: offerGroup.original.totalItemsCount,
          revision: offerGroup.original.revision,
          notes: offerGroup.original.notes,
          notesImages: offerGroup.original.notesImages || [],
          offerItems: offerGroup.original.offerItems || []
        } : null,
        revisions: offerGroup.revisions.map(revision => ({
          _id: revision._id,
          offerNumber: revision.offerNumber,
          offerNumberInQuotation: revision.offerNumberInQuotation,
          totalPrice: revision.totalPrice,
          totalNetto: revision.totalNetto,
          totalDiscount: revision.totalDiscount,
          excludePPN: revision.excludePPN,
          isFullyAccepted: revision.isFullyAccepted,
          isPartiallyAccepted: revision.isPartiallyAccepted,
          acceptedItemsCount: revision.acceptedItemsCount,
          totalItemsCount: revision.totalItemsCount,
          revision: revision.revision,
          notes: revision.notes,
          notesImages: revision.notesImages || [],
          offerItems: revision.offerItems || []
        }))
      }))
    }));
    
    res.json({
      success: true,
      data: simplifiedQuotations,
      pagination: result.pagination,
      message: 'All quotations retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching all quotations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch all quotations'
    });
  }
});

// Debug endpoint to check offer items
router.get('/debug/offer-items', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationNumber } = req.query;
    
    if (!quotationNumber) {
      return res.status(400).json({
        success: false,
        message: 'quotationNumber is required'
      });
    }
    
    // Find the quotation header
    const header = await QuotationHeader.findOne({ quotationNumber });
    if (!header) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }
    
    // Find offers for this header
    const offers = await QuotationOffer.find({ quotationHeaderId: header._id });
    // Find offer items for these offers
    const offerIds = offers.map(offer => offer._id);
    const offerItems = await OfferItem.find({ quotationOfferId: { $in: offerIds } });
    
    // Group offer items by offer ID
    const itemsByOffer = {};
    offerItems.forEach(item => {
      const offerId = item.quotationOfferId.toString();
      if (!itemsByOffer[offerId]) {
        itemsByOffer[offerId] = [];
      }
      itemsByOffer[offerId].push(item);
    });

    // Attach offer items to offers
    offers.forEach(offer => {
      const offerId = offer._id.toString();
      offer.offerItems = itemsByOffer[offerId] || [];
    });

    // Group offers by offerNumberInQuotation (same logic as getQuotationOffers)
    const groupedOffers = [];
    const offerGroups = {};

    offers.forEach(offer => {
      let offerNumber = offer.offerNumberInQuotation;
      if (!offerNumber) {
        const match = offer.offerNumber.match(/-(\d+)(?:-Rev\d+)?$/);
        offerNumber = match ? parseInt(match[1], 10) : 1;
      }
      
      if (!offerGroups[offerNumber]) {
        offerGroups[offerNumber] = {
          original: null,
          revisions: []
        };
      }

      if (offer.revision === 0) {
        offerGroups[offerNumber].original = offer;
      } else {
        offerGroups[offerNumber].revisions.push(offer);
      }
    });

    // Convert to array and sort
    Object.keys(offerGroups).forEach(offerNumber => {
      const group = offerGroups[offerNumber];
      if (group.original) {
        group.revisions.sort((a, b) => a.revision - b.revision);
        groupedOffers.push(group);
      }
    });

    groupedOffers.sort((a, b) => {
      const aNumber = a.original.offerNumberInQuotation || 1;
      const bNumber = b.original.offerNumberInQuotation || 1;
      return aNumber - bNumber;
    });

    res.json({
      success: true,
      data: {
        header: {
          _id: header._id,
          quotationNumber: header.quotationNumber,
          customerName: header.customerName,
          contactPerson: header.contactPerson,
          status: header.status,
          selectedOfferId: header.selectedOfferId,
          selectedOfferItemIds: header.selectedOfferItemIds,
          lastFollowUpDate: header.lastFollowUpDate,
          createdAt: header.createdAt,
          updatedAt: header.updatedAt
        },
        offers: groupedOffers.map(offerGroup => ({
          original: offerGroup.original ? {
            _id: offerGroup.original._id,
            offerNumber: offerGroup.original.offerNumber,
            offerNumberInQuotation: offerGroup.original.offerNumberInQuotation,
            totalPrice: offerGroup.original.totalPrice,
            totalNetto: offerGroup.original.totalNetto,
            totalDiscount: offerGroup.original.totalDiscount,
            excludePPN: offerGroup.original.excludePPN,
            isFullyAccepted: offerGroup.original.isFullyAccepted,
            isPartiallyAccepted: offerGroup.original.isPartiallyAccepted,
            acceptedItemsCount: offerGroup.original.acceptedItemsCount,
            totalItemsCount: offerGroup.original.totalItemsCount,
            revision: offerGroup.original.revision,
            notes: offerGroup.original.notes,
            notesImages: offerGroup.original.notesImages || [],
            offerItems: offerGroup.original.offerItems || []
          } : null,
          revisions: offerGroup.revisions.map(revision => ({
            _id: revision._id,
            offerNumber: revision.offerNumber,
            offerNumberInQuotation: revision.offerNumberInQuotation,
            totalPrice: revision.totalPrice,
            totalNetto: revision.totalNetto,
            totalDiscount: revision.totalDiscount,
            excludePPN: revision.excludePPN,
            isFullyAccepted: revision.isFullyAccepted,
            isPartiallyAccepted: revision.isPartiallyAccepted,
            acceptedItemsCount: revision.acceptedItemsCount,
            totalItemsCount: revision.totalItemsCount,
            revision: revision.revision,
            notes: revision.notes,
            notesImages: revision.notesImages || [],
            offerItems: revision.offerItems || []
          }))
        }))
      }
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Create new quotation (header + first offer)
router.post('/', authenticateToken, authorize(['quotation_create']), async (req, res) => {
  try {
    const { headerData, offerData, rfqId } = req.body;
    
    // If rfqId is provided, validate and update RFQ status
    if (rfqId) {
      const { RFQ } = require('../models/rfq.model');
      const rfq = await RFQ.findById(rfqId);
      
      if (!rfq) {
        return res.status(404).json({
          success: false,
          message: 'RFQ not found'
        });
      }
      
      if (rfq.status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'RFQ must be approved before creating quotation'
        });
      }
      
      if (rfq.quotationCreatorId.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to create quotation for this RFQ'
        });
      }
    }
    
    // If RFQ was provided, get RFQ data and transfer it to offerData
    if (rfqId) {
      const { RFQ, RFQItem } = require('../models/rfq.model');
      
      // Get RFQ with populated items
      const rfq = await RFQ.findById(rfqId).populate('items');
      
      if (rfq) {
        // Transfer RFQ data to header data if not already provided
        if (!headerData.customerName) {
          headerData.customerName = rfq.customerName;
          headerData.contactPerson = rfq.contactPerson;
        }
        
        // Transfer RFQ items to offer items
        if (rfq.items && rfq.items.length > 0) {
          const rfqOfferItems = rfq.items.map((rfqItem, index) => ({
            itemNumber: index + 1,
            karoseri: rfqItem.karoseri,
            chassis: rfqItem.chassis,
            drawingSpecification: rfqItem.drawingSpecification,
            specifications: rfqItem.specifications, // Already in the correct format
            price: rfqItem.price,
            netto: rfqItem.priceNet,  // Map RFQ priceNet to offer item netto
            discountType: 'percentage',  // Default discount type
            discountValue: 0,            // Default discount value
            notes: rfqItem.notes
          }));
          
          // Replace offerData.offerItems with RFQ items
          offerData.offerItems = rfqOfferItems;
        }
      }
    }

    // Prepare user fields for quotation header
    let userFields = {
      requesterId: req.user.userId,
      approverId: req.user.userId, // Default to current user, can be updated later
      creatorId: req.user.userId,
      marketingName: req.user.fullName ? req.user.fullName.split(' ')[0] : req.user.email
    };
    
    // If RFQ was provided, use RFQ user assignments
    if (rfqId) {
      const { RFQ } = require('../models/rfq.model');
      const rfq = await RFQ.findById(rfqId);
      if (rfq) {
        // Get requester details for marketing name
        const requester = await User.findById(rfq.requesterId).select('fullName email');
        const marketingName = requester?.fullName ? requester.fullName.split(' ')[0] : requester?.email || 'Unknown';
        
        userFields = {
          requesterId: rfq.requesterId,
          approverId: rfq.approverId,
          creatorId: rfq.quotationCreatorId,
          marketingName: marketingName
        };
      }
    }
    
    // Create quotation header
    const header = await createQuotationHeader({
      ...headerData,
      ...userFields
    });

    // Create first offer (now with RFQ data if applicable)
    const offer = await createQuotationOffer(header.quotationNumber, {
      ...offerData,
      requesterId: header.requesterId,
      approverId: header.approverId,
      creatorId: header.creatorId,
      marketingName: header.marketingName
    });

    // If RFQ was provided, update its status
    if (rfqId) {
      const { RFQ } = require('../models/rfq.model');
      
      // Update RFQ status and link to quotation
      await RFQ.findByIdAndUpdate(rfqId, {
        status: 'quotation_created',
        quotationId: header._id,
        quotationCreatedAt: new Date()
      });
    }

    // Send email notifications
    try {
      // Get user details for email notifications
      const requester = await User.findById(header.requesterId).select('email fullName');
      const approver = await User.findById(header.approverId).select('email fullName');
      
      // Email to requester
      if (requester && requester.email) {
        sendQuotationNotificationEmail(
          requester.email,
          header.quotationNumber,
          'created',
          requester.fullName || requester.email
        );
      }
      
      // Email to approver (if different from requester)
      if (approver && approver.email && approver._id.toString() !== requester._id.toString()) {
        sendQuotationNotificationEmail(
          approver.email,
          header.quotationNumber,
          'created',
          approver.fullName || approver.email
        );
      }
    } catch (emailError) {
      console.error('Error sending email notifications:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      data: { header, offer },
      message: 'Quotation created successfully'
    });
  } catch (error) {
    console.error('Error creating quotation:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get specific quotation by ID
router.get('/by-id/:quotationId', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationId } = req.params;
    
    
    // Get quotation header by ID or quotationNumber
    let header;
    try {
      // First try to find by ObjectId
      header = await getQuotationHeaderById(quotationId);
    } catch (error) {
      // If that fails, try to find by quotationNumber
      header = await QuotationHeader.findOne({ quotationNumber: quotationId });
    }
    
    if (!header) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }
    
    // Get all offers for this quotation
    const result = await getQuotationOffers(header.quotationNumber);
    
    
    res.json({
      success: true,
      data: {
        header: result.header,
        offers: result.offers
      }
    });
  } catch (error) {
    console.error('Error fetching quotation by ID:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get specific quotation by quotation number
router.get('/:quotationNumber', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const result = await getQuotationOffers(quotationNumber);


    res.json({
      success: true,
      data: result,
      message: 'Quotation retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting quotation:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update quotation header
router.put('/:quotationNumber', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const updateData = req.body;

    const result = await getQuotationOffers(quotationNumber);

    const updatedHeader = await updateQuotationHeader(result.header._id, updateData);

    res.json({
      success: true,
      data: updatedHeader,
      message: 'Quotation header updated successfully'
    });
  } catch (error) {
    console.error('Error updating quotation header:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Delete quotation (header + all offers + all items)
router.delete('/:quotationNumber', authenticateToken, authorize(['quotation_delete']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const result = await getQuotationOffers(quotationNumber);

    // Collect all offer IDs for cleanup
    const offerIds = [];
    result.offers.forEach(offerGroup => {
      if (offerGroup.original) {
        offerIds.push(offerGroup.original._id);
        offerGroup.revisions.forEach(revision => {
          offerIds.push(revision._id);
        });
      } else {
        offerIds.push(offerGroup._id);
      }
    });

    // Clean up orphaned notes images before deleting offers
    const { cleanupOrphanedImages } = require('./notesImages');
    const cleanupResult = await cleanupOrphanedImages(offerIds);

    // Delete all offer items first
    await OfferItem.deleteMany({ quotationOfferId: { $in: offerIds } });

    // Delete all offers
    await QuotationOffer.deleteMany({ quotationHeaderId: result.header._id });

    // Delete header
    await deleteQuotationHeader(result.header._id);

    res.json({
      success: true,
      message: `Quotation deleted successfully. ${cleanupResult.deletedCount} orphaned images deleted, ${cleanupResult.keptCount} images kept (still used elsewhere).`,
      data: {
        cleanupResult
      }
    });
  } catch (error) {
    console.error('Error deleting quotation:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================================
// QUOTATION STATUS MANAGEMENT
// ============================================================================

// Update quotation status
router.patch('/:quotationNumber/status', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const { status, reason, selectedOfferId, selectedOfferItemIds } = req.body;

    const result = await getQuotationOffers(quotationNumber);


    // Validate reason for loss/close
    if (['loss', 'close'].includes(status) && (!reason || reason.trim() === '')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reason is required for loss/close status' 
      });
    }

    // Update header
    const updateData = {
      status: { type: status || 'open', reason: reason || '' }
    };
    
    // Only set selectedOfferId and selectedOfferItemIds for 'win' status, clear them for other statuses
    if (status === 'win' && selectedOfferId) {
      updateData.selectedOfferId = selectedOfferId;
      updateData.selectedOfferItemIds = selectedOfferItemIds || [];
      
      // Mark selected items as accepted and unmark others
      const allOfferItems = await OfferItem.find({ quotationOfferId: selectedOfferId });
      
      for (const item of allOfferItems) {
        const isSelected = selectedOfferItemIds && selectedOfferItemIds.includes(item._id.toString());
        await OfferItem.findByIdAndUpdate(item._id, {
          isAccepted: isSelected,
          acceptedAt: isSelected ? new Date() : null,
          acceptedBy: isSelected ? req.user.userId : null
        });
      }
    } else if (status !== 'win') {
      updateData.selectedOfferId = null;
      updateData.selectedOfferItemIds = [];
      
      // Clear acceptance status for all items when status is not 'win'
      const allOffers = result.offers.flatMap(offerGroup => [
        ...(offerGroup.original ? [offerGroup.original] : []),
        ...(offerGroup.revisions || [])
      ]);
      
      for (const offer of allOffers) {
        await OfferItem.updateMany(
          { quotationOfferId: offer._id },
          { 
            isAccepted: false,
            acceptedAt: null,
            acceptedBy: null
          }
        );
      }
    }
    
    const updatedHeader = await updateQuotationHeader(result.header._id, updateData);

    res.json({
      success: true,
      data: updatedHeader,
      message: 'Quotation status updated successfully'
    });
  } catch (error) {
    console.error('Error updating quotation status:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================================
// OFFER MANAGEMENT ROUTES
// ============================================================================

// Get all offers for a quotation
router.get('/:quotationNumber/offers', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const result = await getQuotationOffers(quotationNumber);


    res.json({
      success: true,
      data: result.offers,
      message: 'Offers retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting offers:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Create new offer for a quotation
router.post('/:quotationId/offers', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationId } = req.params;
    const offerData = req.body;

    // Find the quotation header by ID or quotationNumber
    let header;
    try {
      // First try to find by ObjectId
      header = await getQuotationHeaderById(quotationId);
    } catch (error) {
      // If that fails, try to find by quotationNumber
      header = await QuotationHeader.findOne({ quotationNumber: quotationId });
    }
    
    if (!header) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quotation not found' 
      });
    }

    const offer = await createQuotationOffer(header.quotationNumber, {
      ...offerData,
      requesterId: header.requesterId,
      approverId: header.approverId,
      creatorId: header.creatorId,
      marketingName: req.user.fullName ? req.user.fullName.split(' ')[0] : req.user.email
    });

    res.status(201).json({
      success: true,
      data: offer,
      message: 'Offer created successfully'
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update specific offer
router.put('/:quotationId/offers/:offerId', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationId, offerId } = req.params;
    const updateData = req.body;

    // Find the quotation header by ID or quotationNumber
    let header;
    try {
      // First try to find by ObjectId
      header = await getQuotationHeaderById(quotationId);
    } catch (error) {
      // If that fails, try to find by quotationNumber
      header = await QuotationHeader.findOne({ quotationNumber: quotationId });
    }
    
    if (!header) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quotation not found' 
      });
    }

    const updatedOffer = await updateQuotationOffer(offerId, updateData);

    res.json({
      success: true,
      data: updatedOffer,
      message: 'Offer updated successfully'
    });
  } catch (error) {
    console.error('Error updating offer:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Delete specific offer
router.delete('/:quotationId/offers/:offerId', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationId, offerId } = req.params;

    // Find the quotation header by ID or quotationNumber
    let header;
    try {
      // First try to find by ObjectId
      header = await getQuotationHeaderById(quotationId);
    } catch (error) {
      // If that fails, try to find by quotationNumber
      header = await QuotationHeader.findOne({ quotationNumber: quotationId });
    }
    
    if (!header) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quotation not found' 
      });
    }

    // Clean up orphaned notes images before deleting the offer
    const { cleanupOrphanedImages } = require('./notesImages');
    const cleanupResult = await cleanupOrphanedImages([offerId]);

    // Delete all offer items first
    await OfferItem.deleteMany({ quotationOfferId: offerId });

    // Delete the offer
    await deleteQuotationOffer(offerId);

    res.json({
      success: true,
      message: `Offer deleted successfully. ${cleanupResult.deletedCount} orphaned images deleted, ${cleanupResult.keptCount} images kept (still used elsewhere).`,
      data: {
        cleanupResult
      }
    });
  } catch (error) {
    console.error('Error deleting offer:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================================
// OFFER ITEMS MANAGEMENT ROUTES
// ============================================================================

// Get all items for a specific offer
router.get('/:quotationNumber/offers/:offerId/items', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationNumber, offerId } = req.params;

    const result = await getQuotationOffers(quotationNumber);


    const items = await OfferItem.find({ quotationOfferId: offerId })
      .sort({ itemNumber: 1 });

    res.json({
      success: true,
      data: items,
      message: 'Offer items retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting offer items:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Create new item for a specific offer
router.post('/:quotationNumber/offers/:offerId/items', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, offerId } = req.params;
    const itemData = req.body;

    const result = await getQuotationOffers(quotationNumber);


    // Get the next item number
    const existingItems = await OfferItem.find({ quotationOfferId: offerId })
      .sort({ itemNumber: -1 })
      .limit(1);
    
    const nextItemNumber = existingItems.length > 0 ? existingItems[0].itemNumber + 1 : 1;

    const offerItem = new OfferItem({
      ...itemData,
      quotationOfferId: offerId,
      itemNumber: nextItemNumber
    });

    await offerItem.save();

    // Update offer totals
    const offer = await QuotationOffer.findById(offerId);
    if (offer) {
      await offer.save(); // This will trigger the pre-save hook to recalculate totals
    }

    res.status(201).json({
      success: true,
      data: offerItem,
      message: 'Offer item created successfully'
    });
  } catch (error) {
    console.error('Error creating offer item:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update specific offer item
router.put('/:quotationNumber/offers/:offerId/items/:itemId', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, offerId, itemId } = req.params;
    const updateData = req.body;

    const result = await getQuotationOffers(quotationNumber);


    // Handle empty string for drawingSpecification
    const processedUpdateData = { ...updateData };
    if (processedUpdateData.drawingSpecification === '') {
      processedUpdateData.drawingSpecification = null;
    }

    const offerItem = await OfferItem.findByIdAndUpdate(
      itemId,
      { ...processedUpdateData, quotationOfferId: offerId },
      { new: true, runValidators: true }
    );

    if (!offerItem) {
      return res.status(404).json({
        success: false,
        message: 'Offer item not found'
      });
    }

    // Update offer totals
    const offer = await QuotationOffer.findById(offerId);
    if (offer) {
      await offer.save(); // This will trigger the pre-save hook to recalculate totals
    }

    res.json({
      success: true,
      data: offerItem,
      message: 'Offer item updated successfully'
    });
  } catch (error) {
    console.error('Error updating offer item:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Delete specific offer item
router.delete('/:quotationNumber/offers/:offerId/items/:itemId', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, offerId, itemId } = req.params;

    const result = await getQuotationOffers(quotationNumber);

    const offerItem = await OfferItem.findByIdAndDelete(itemId);

    if (!offerItem) {
      return res.status(404).json({
        success: false,
        message: 'Offer item not found'
      });
    }

    // Update offer totals
    const offer = await QuotationOffer.findById(offerId);
    if (offer) {
      await offer.save(); // This will trigger the pre-save hook to recalculate totals
    }

    res.json({
      success: true,
      message: 'Offer item deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting offer item:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Toggle item acceptance status
router.patch('/:quotationNumber/offers/:offerId/items/:itemId/accept', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, offerId, itemId } = req.params;

    const result = await getQuotationOffers(quotationNumber);


    const offerItem = await OfferItem.findById(itemId);

    if (!offerItem) {
      return res.status(404).json({
        success: false,
        message: 'Offer item not found'
      });
    }

    // Toggle acceptance status
    offerItem.isAccepted = !offerItem.isAccepted;
    if (offerItem.isAccepted) {
      offerItem.acceptedAt = new Date();
      offerItem.acceptedBy = req.user.userId;
    } else {
      offerItem.acceptedAt = undefined;
      offerItem.acceptedBy = undefined;
    }

    await offerItem.save();

    // Update offer totals
    const offer = await QuotationOffer.findById(offerId);
    if (offer) {
      await offer.save(); // This will trigger the pre-save hook to recalculate totals
    }

    res.json({
      success: true,
      data: offerItem,
      message: 'Offer item acceptance status updated successfully'
    });
  } catch (error) {
    console.error('Error updating offer item acceptance:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================================
// PROGRESS AND FOLLOW-UP ROUTES
// ============================================================================

// Add progress entry to quotation
router.post('/:quotationNumber/progress', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const { progress } = req.body;

    const result = await getQuotationOffers(quotationNumber);

    const updatedHeader = await updateQuotationHeader(result.header._id, {
      $push: { progress: progress }
    });

    res.json({
      success: true,
      data: updatedHeader,
      message: 'Progress added successfully'
    });
  } catch (error) {
    console.error('Error adding progress:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update last follow-up date
router.patch('/:quotationNumber/follow-up', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;

    const result = await getQuotationOffers(quotationNumber);


    const updatedHeader = await updateLastFollowUp(result.header._id);

    res.json({
      success: true,
      data: updatedHeader,
      message: 'Follow-up date updated successfully'
    });
  } catch (error) {
    console.error('Error updating follow-up:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================================
// UTILITY ROUTES
// ============================================================================

// Generate new quotation number
router.get('/generate/number', authenticateToken, authorize(['quotation_create']), async (req, res) => {
  try {
    const quotationNumber = await generateQuotationNumber();
    res.json({
      success: true,
      data: { quotationNumber },
      message: 'Quotation number generated successfully'
    });
  } catch (error) {
    console.error('Error generating quotation number:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});


// Migrate offer numbers (utility for existing data)
router.post('/migrate/offer-numbers', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await migrateOfferNumbers();
    res.json({
      success: true,
      data: result,
      message: 'Offer numbers migrated successfully'
    });
  } catch (error) {
    console.error('Error migrating offer numbers:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
