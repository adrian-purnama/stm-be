// =============================================================================
// QUOTATION MANAGEMENT ROUTES
// =============================================================================
// This module handles all quotation-related endpoints including creation,
// retrieval, updates, and management of quotations and their offers.

const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const QuotationHeader = require('../models/quotationHeader.model');
const QuotationOffer = require('../models/quotationOffer.model');
const OfferItem = require('../models/offerItem.model');
const User = require('../models/user.model');
const { sendQuotationNotificationEmail } = require('../utils/emailUtils');
const { hasPermission, hasAnyPermission, getAllUserPermissions } = require('../utils/permissionHelper');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/errorHandler');
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

const DEFAULT_PAYMENT_TERMS = 'Payment DP 50% sisa cash before delivery';

// ============================================================================
// QUOTATION MANAGEMENT ROUTES
// ============================================================================

// Get all quotations for the authenticated user
router.get('/', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const rawFilters = { ...req.query };
    const search = rawFilters.search || '';
    const page = parseInt(rawFilters.page, 10) || 1;
    const limit = parseInt(rawFilters.limit, 10) || 10;
    const filterMode = rawFilters.filterMode || 'all';
    const lightweight = rawFilters.lightweight || 'false';
    const isLightweight = lightweight === 'true' || lightweight === '1';

    delete rawFilters.search;
    delete rawFilters.page;
    delete rawFilters.limit;
    delete rawFilters.filterMode;
    delete rawFilters.lightweight;

    const filters = rawFilters;
    
    // Get user with permissions
    const user = await require('../models/user.model').findById(req.user.userId).populate('permissions');
    const userPermissions = user.permissions.map(p => p.name);
    
    // Gmail-style advanced search parser
    const ops = {};
    ops.global = []; // All search terms (fuzzy)
    ops.globalPhrases = []; // Exact phrases (quoted)
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = /([a-z]+):("[^"]+"|\S+)|"([^"]+)"|(\S+)/g;
    let m;
    while ((m = regex.exec(search))) {
      if (m[1] && m[2]) { // e.g., status:open
        const key = m[1];
        let val = m[2];
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        // Support multiple values for same key (e.g., status:open status:win)
        if (!ops[key]) ops[key] = [];
        if (Array.isArray(ops[key])) {
          ops[key].push(val);
        } else {
          ops[key] = [ops[key], val];
        }
      } else if (m[3]) { // "exact phrase" - quoted
        const phrase = m[3];
        ops.globalPhrases.push(phrase);
        ops.global.push(phrase);
      } else if (m[4]) { // fuzzy word - non-quoted
        ops.global.push(m[4]);
      }
    }
    
    // Convert single values to arrays for consistent handling (except 'global' and 'globalPhrases')
    Object.keys(ops).forEach(key => {
      if (key !== 'global' && key !== 'globalPhrases' && !Array.isArray(ops[key])) {
        ops[key] = [ops[key]];
      }
    });
    
    let userFilters = { ...filters };
    
    // Apply search operators to filters
    if (ops.status && ops.status.length > 0) {
      userFilters.status = ops.status.length === 1 ? ops.status[0] : { $in: ops.status };
    }
    if (ops.customer && ops.customer.length > 0) {
      const escapedCustomer = ops.customer.map(term => escapeRegex(term)).join('|');
      userFilters.customer = { $regex: escapedCustomer, $options: 'i' };
    }
    if (ops.marketing && ops.marketing.length > 0) {
      const escapedMarketing = ops.marketing.map(term => escapeRegex(term)).join('|');
      userFilters.marketing = { $regex: escapedMarketing, $options: 'i' };
    }
    if (ops.type && ops.type.length > 0) {
      userFilters['lineOfBusiness.type'] = ops.type.length === 1 ? ops.type[0] : { $in: ops.type };
    }
    
    // Handle array filters from advanced filters (status, lineOfBusiness)
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        userFilters.status = filters.status.length === 1 ? filters.status[0] : { $in: filters.status };
      } else {
        userFilters.status = filters.status;
      }
    }
    if (filters.lineOfBusiness) {
      if (Array.isArray(filters.lineOfBusiness)) {
        userFilters['lineOfBusiness.type'] = filters.lineOfBusiness.length === 1 ? filters.lineOfBusiness[0] : { $in: filters.lineOfBusiness };
      } else {
        userFilters['lineOfBusiness.type'] = filters.lineOfBusiness;
      }
    }
    
    // Global search (fuzzy terms and phrases) - will be handled in getQuotations helper
    if (ops.global.length > 0 || ops.globalPhrases.length > 0) {
      const allSearchTerms = [...ops.global, ...ops.globalPhrases];
      userFilters.search = allSearchTerms.join(' ');
    }
    
    // Apply role-based filtering based on filterMode
    if (filterMode === 'my_quotations') {
      userFilters.$and = userFilters.$and || [];
      userFilters.$and.push({
        $or: [
          { requesterId: req.user.userId },
          { creatorId: req.user.userId },
          { approverId: req.user.userId }
        ]
      });
    } else if (filterMode === 'created_by_me') {
      // Show only quotations created by this user
      userFilters.creatorId = req.user.userId;
    } else if (filterMode === 'approve_rfq') {
      // Show only RFQs where user is the approver (this is handled in RFQ route, not here)
      // This filter mode is not applicable for quotations
      return sendErrorResponse(res, 400, 'approve_rfq filter mode is not applicable for quotations');
    } else if (filterMode === 'all_viewer') {
      // filterMode === 'all_viewer' - Show all quotations for users with all_quotation_viewer permission
      const hasAllQuotationViewerPermission = userPermissions.includes('all_quotation_viewer');
      
      if (!hasAllQuotationViewerPermission) {
        return sendErrorResponse(res, 403, 'Access denied. All quotation viewer permission required.');
      }
      // No additional filtering needed for users with all_quotation_viewer permission
    } else {
      // filterMode === 'all' - Show all quotations (admin/manager view)
      const hasAdminPermission = userPermissions.includes('quotation_admin') || 
                                 userPermissions.includes('admin') ||
                                 userPermissions.includes('manager');
      
      if (!hasAdminPermission) {
        return sendErrorResponse(res, 403, 'Access denied. Admin permission required to view all quotations.');
      }
      // No additional filtering needed for admin users
    }
    
    const result = await getQuotations(userFilters, { page: parseInt(page), limit: parseInt(limit) }, { lightweight: isLightweight });
    
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
        // Handle both lightweight mode (just ID) and full mode (populated object)
        const header = quotation.header;
        
        // Extract user IDs - handle both ObjectId and populated object
        const getUserId = (userField) => {
          if (!userField) return null;
          if (typeof userField === 'object' && userField._id) {
            return userField._id.toString();
          }
          return userField.toString();
        };
        
        const creatorId = getUserId(header.creatorId);
        const requesterId = getUserId(header.requesterId);
        const approverId = getUserId(header.approverId);
        const userId = req.user.userId.toString();
        
        if (creatorId === userId || requesterId === userId || approverId === userId) {
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
    
    // If lightweight mode, return only minimal safe headers (fast initial load)
    // Use data directly from getQuotations helper which already handles lightweight mode
    if (isLightweight) {
      return sendSuccessResponse(res, 200, 'Quotation headers retrieved successfully', result.quotations, result.pagination);
    }
    
    // Full mode - include all offers and details
    // Simplify the response - only include essential data
    const simplifiedQuotations = result.quotations.map(quotation => ({
      header: {
        _id: quotation.header._id,
        quotationNumber: quotation.header.quotationNumber,
        customerName: quotation.header.customerName,
        contactPerson: quotation.header.contactPerson,
        status: quotation.header.status,
        deliveryTerms: quotation.header.deliveryTerms,
        deliveryNotes: quotation.header.deliveryNotes,
        targetCloseDate: quotation.header.targetCloseDate,
        paymentTerms: quotation.header.paymentTerms,
        inclusionNotes: quotation.header.inclusionNotes,
        exclusionNotes: quotation.header.exclusionNotes,
        isTaxIncluded: quotation.header.isTaxIncluded,
        includePPN: quotation.header.includePPN,
        selectedOfferId: quotation.header.selectedOfferId,
        selectedOfferItemIds: quotation.header.selectedOfferItemIds,
        lastFollowUpDate: quotation.header.lastFollowUpDate,
        followUpStatus: quotation.header.followUpStatus,
        marketingName: quotation.header.marketingName,
        createdAt: quotation.header.createdAt,
        updatedAt: quotation.header.updatedAt
      },
      rfq: quotation.rfq,
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
    
    
    return sendSuccessResponse(res, 200, 'Quotations retrieved successfully', simplifiedQuotations, result.pagination);
  } catch (error) {
    console.error('Error getting quotations:', error);
    return sendErrorResponse(res, 400, 'Failed to fetch quotations', error.message);
  }
});

// Get all quotations for users with all_quotation_viewer permission
/**
 * GET /api/quotations/all
 * Permission: all_quotation_viewer
 * Description: Get all quotations regardless of user role (for viewers with special permission)
 */
router.get('/all', authenticateToken, authorize(['all_quotation_viewer']), async (req, res) => {
  try {
    const { page = 1, limit = 10, filterMode = 'all_viewer', ...filters } = req.query;
    
    // Get user with permissions
    const user = await require('../models/user.model').findById(req.user.userId).populate('permissions');
    const userPermissions = user.permissions.map(p => p.name);
    
    // Check if user has all_quotation_viewer permission
    const hasAllQuotationViewerPermission = true
    
    if (!hasAllQuotationViewerPermission) {
      return sendErrorResponse(res, 403, 'Access denied. all_quotation_viewer permission required to view all quotations.');
    }
    
    // Set filterMode to all_viewer for this route
    const userFilters = { ...filters, filterMode: 'all_viewer' };
    
    // No additional filtering needed - show all quotations
    const result = await getQuotations(userFilters, { page: parseInt(page), limit: parseInt(limit) }, { lightweight: false });
    
    // Simplify the response - only include essential data
    const simplifiedQuotations = result.quotations.map(quotation => ({
      header: {
        _id: quotation.header._id,
        quotationNumber: quotation.header.quotationNumber,
        customerName: quotation.header.customerName,
        contactPerson: quotation.header.contactPerson,
        status: quotation.header.status,
        deliveryTerms: quotation.header.deliveryTerms,
        deliveryNotes: quotation.header.deliveryNotes,
        targetCloseDate: quotation.header.targetCloseDate,
        paymentTerms: quotation.header.paymentTerms,
        inclusionNotes: quotation.header.inclusionNotes,
        exclusionNotes: quotation.header.exclusionNotes,
        isTaxIncluded: quotation.header.isTaxIncluded,
        includePPN: quotation.header.includePPN,
        selectedOfferId: quotation.header.selectedOfferId,
        selectedOfferItemIds: quotation.header.selectedOfferItemIds,
        lastFollowUpDate: quotation.header.lastFollowUpDate,
        followUpStatus: quotation.header.followUpStatus,
        marketingName: quotation.header.marketingName,
        createdAt: quotation.header.createdAt,
        updatedAt: quotation.header.updatedAt
      },
      rfq: quotation.rfq,
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
    
    return sendSuccessResponse(res, 200, 'All quotations retrieved successfully', simplifiedQuotations, result.pagination);
  } catch (error) {
    console.error('Error fetching all quotations:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch all quotations');
  }
});

// Debug endpoint to check offer items (only available in development)
router.get('/debug/offer-items', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  // Gate debug endpoint behind development flag
  if (process.env.NODE_ENV_BUILD === 'production') {
    return sendErrorResponse(res, 404, 'Debug endpoint not available in production');
  }
  try {
    const { quotationNumber } = req.query;
    
    if (!quotationNumber) {
      return sendErrorResponse(res, 400, 'quotationNumber is required');
    }
    
    // Find the quotation header
    const header = await QuotationHeader.findOne({ quotationNumber });
    if (!header) {
      return sendErrorResponse(res, 404, 'Quotation not found');
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

    return sendSuccessResponse(res, 200, 'Debug data retrieved successfully', {
        header: {
          _id: header._id,
          quotationNumber: header.quotationNumber,
          customerName: header.customerName,
          contactPerson: header.contactPerson,
          status: header.status,
          deliveryTerms: header.deliveryTerms,
          deliveryNotes: header.deliveryNotes,
          targetCloseDate: header.targetCloseDate,
          paymentTerms: header.paymentTerms,
          inclusionNotes: header.inclusionNotes,
          exclusionNotes: header.exclusionNotes,
          isTaxIncluded: header.isTaxIncluded,
          includePPN: header.includePPN,
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
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch debug data', error.message);
  }
});

// Create new quotation (header + first offer)
// =============================================================================
// QUOTATION CRUD ROUTES
// =============================================================================

/**
 * POST /api/quotations
 * Permission: quotation_create
 * Description: Create a new quotation
 */
router.post('/', authenticateToken, authorize(['quotation_create']), async (req, res) => {
  try {
    const { headerData, offerData, rfqId } = req.body;
    
    // If rfqId is provided, validate and update RFQ status
    if (rfqId) {
      const { RFQ } = require('../models/rfq.model');
      const rfq = await RFQ.findById(rfqId);
      
      if (!rfq) {
        return sendErrorResponse(res, 404, 'RFQ not found');
      }
      
      if (rfq.status !== 'approved') {
        return sendErrorResponse(res, 400, 'RFQ must be approved before creating quotation');
      }
      
      if (rfq.quotationCreatorId.toString() !== req.user.userId.toString()) {
        return sendErrorResponse(res, 403, 'You are not authorized to create quotation for this RFQ');
      }
    }
    
    // If RFQ was provided, get RFQ data and transfer it to offerData
    if (rfqId) {
      const { RFQ, RFQItem } = require('../models/rfq.model');
      
      // Get RFQ with populated items
      const rfq = await RFQ.findById(rfqId).populate('items');
      
      if (rfq) {
        // Transfer RFQ data to header data
        // Always transfer customer contact info from RFQ to quotation (RFQ is the source of truth)
        // No need to copy RFQ snapshot onto the quotation header anymore.
        // Ensure offer data receives RFQ context when needed.
        
        // Transfer RFQ items to offer items only if frontend didn't send any
        // This allows users to modify values in the form and have them saved
        if ((!offerData.offerItems || offerData.offerItems.length === 0) && rfq.items && rfq.items.length > 0) {
          const rfqOfferItems = rfq.items.map((rfqItem, index) => {
            const itemEstimatedRevenue = rfqItem.estimatedRevenue || 0;
            const lineOfBusinessType = rfq.lineOfBusiness.type;
            
            const baseItem = {
            itemNumber: index + 1,
              quantity: rfqItem.quantity || 1,
              price: itemEstimatedRevenue,
              netto: itemEstimatedRevenue * 0.91,  // Apply 9% discount for netto
              discountType: 'percentage',
              discountValue: 0,
              notes: rfqItem.notes || ''
            };
            
            // Add type-specific fields
            if (lineOfBusinessType === 'karoseri') {
              return {
                ...baseItem,
                karoseri: rfqItem.karoseri,
                chassis: rfqItem.chassis,
                chassisModel: rfqItem.chassisModel || '',
                drawingSpecification: rfqItem.drawingSpecification,
                bodyTypeId: rfq.bodyTypeId || rfqItem.bodyTypeId, // Use RFQ-level or item-level
                chassisTypeId: rfq.chassisTypeId || rfqItem.chassisTypeId, // Use RFQ-level or item-level
                templateMode: rfqItem.templateMode,
                templateSourceModel: rfqItem.templateSourceModel,
                templateSourceId: rfqItem.templateSourceId,
                specifications: rfqItem.specifications
              };
            } else if (lineOfBusinessType === 'service') {
              return {
                ...baseItem,
                serviceName: rfqItem.serviceName || '',
                serviceDetails: rfqItem.serviceDetails || []
              };
            } else if (lineOfBusinessType === 'sparepart') {
              return {
                ...baseItem,
                sparepartName: rfqItem.sparepartName || '',
                pricePerUnit: rfqItem.pricePerUnit || 0
              };
            }
            
            return baseItem;
          });
          
          // Only use RFQ items if frontend didn't send any offerItems
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
      ...userFields,
      rfqId: rfqId || null
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

    // Send email notification to requester (quotation created)
    try {
      const requester = await User.findById(header.requesterId).select('email fullName');
      if (requester && requester.email) {
        sendQuotationNotificationEmail(
          requester.email,
          header.quotationNumber,
          'created',
          requester.fullName || requester.email
        );
      }
    } catch (emailError) {
      console.error('Error sending quotation creation email:', emailError);
      // Don't fail the request if email fails
    }

    await header.populate({
      path: 'rfqId',
      populate: [
        { path: 'requesterId', select: 'fullName email' },
        { path: 'approverId', select: 'fullName email' },
        { path: 'quotationCreatorId', select: 'fullName email' }
      ]
    });

    return sendSuccessResponse(res, 201, 'Quotation created successfully', { header, rfq: header.rfqId, offer });
  } catch (error) {
    console.error('Error creating quotation:', error);
    return sendErrorResponse(res, 400, 'Failed to create quotation', error.message);
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
      return sendErrorResponse(res, 404, 'Quotation not found');
    }
    
    // Get all offers for this quotation
    const result = await getQuotationOffers(header.quotationNumber);
    
    return sendSuccessResponse(res, 200, 'Quotation retrieved successfully', {
      header: result.header,
      rfq: result.rfq,
      offers: result.offers
    });
  } catch (error) {
    console.error('Error fetching quotation by ID:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch quotation', error.message);
  }
});

// Get full header details for a quotation (with populated fields) - for async loading
router.get('/:quotationNumber/header', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const { getFollowUpStatus } = require('../utils/quotationHelper');
    const QuotationHeader = require('../models/quotationHeader.model');
    
    const header = await QuotationHeader.findOne({ quotationNumber })
      .populate('requesterId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('creatorId', 'fullName email')
      .populate('downloads.userId', 'fullName email')
      .populate({
        path: 'rfqId',
        populate: [
          { path: 'requesterId', select: 'fullName email' },
          { path: 'approverId', select: 'fullName email' },
          { path: 'quotationCreatorId', select: 'fullName email' }
        ]
      });
    
    if (!header) {
      return sendErrorResponse(res, 404, 'Quotation not found');
    }

    const followUpStatus = getFollowUpStatus(header.lastFollowUpDate);

    const headerObj = header.toObject();
    const rfqSnapshot = headerObj.rfqId || null;
    delete headerObj.rfqId;

    if (rfqSnapshot) {
      headerObj.customerName = rfqSnapshot.customerName;
      headerObj.contactPerson = rfqSnapshot.contactPerson;
      headerObj.customerContacts = rfqSnapshot.customerContacts;
      headerObj.deliveryTerms = rfqSnapshot.deliveryTerms;
      headerObj.deliveryNotes = rfqSnapshot.deliveryNotes;
      headerObj.targetCloseDate = rfqSnapshot.targetCloseDate;
      headerObj.paymentTerms = rfqSnapshot.paymentTerms;
      headerObj.inclusionNotes = rfqSnapshot.inclusionNotes;
      headerObj.exclusionNotes = rfqSnapshot.exclusionNotes;
      headerObj.isTaxIncluded = rfqSnapshot.isTaxIncluded;
      headerObj.includePPN = rfqSnapshot.includePPN;
      headerObj.lineOfBusiness = rfqSnapshot.lineOfBusiness;
    }

    return sendSuccessResponse(res, 200, 'Header details retrieved successfully', {
      ...headerObj,
      rfq: rfqSnapshot,
      followUpStatus
    });
  } catch (error) {
    console.error('Error fetching header details:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch header details', error.message);
  }
});

// Get specific quotation by quotation number
router.get('/:quotationNumber', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const result = await getQuotationOffers(quotationNumber);


    return sendSuccessResponse(res, 200, 'Quotation retrieved successfully', result);
  } catch (error) {
    console.error('Error getting quotation:', error);
    return sendErrorResponse(res, 400, 'Failed to get quotation', error.message);
  }
});

// Update quotation header
router.put('/:quotationNumber', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const updateData = req.body;

    const result = await getQuotationOffers(quotationNumber);

    const updatedHeader = await updateQuotationHeader(result.header._id, updateData);

    return sendSuccessResponse(res, 200, 'Quotation header updated successfully', updatedHeader);
  } catch (error) {
    console.error('Error updating quotation header:', error);
    return sendErrorResponse(res, 400, 'Failed to update quotation header', error.message);
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

    return sendSuccessResponse(res, 200, `Quotation deleted successfully. ${cleanupResult.deletedCount} orphaned images deleted, ${cleanupResult.keptCount} images kept (still used elsewhere).`, {
        cleanupResult
    });
  } catch (error) {
    console.error('Error deleting quotation:', error);
    return sendErrorResponse(res, 400, 'Failed to delete quotation', error.message);
  }
});

// ============================================================================
// QUOTATION STATUS MANAGEMENT
// ============================================================================

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const isValidRomanMonth = (value) => ROMAN_MONTHS.includes((value || '').toUpperCase());

// Update quotation status
router.patch('/:quotationNumber/status', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const {
      status,
      reason,
      selectedOfferId,
      selectedOfferItemIds,
      winSubStatus,
      ocSequenceNumber,
      ocMonthRoman,
      ocYear,
      spkSequenceNumber,
      spkLetterCode,
      spkMonthRoman,
      spkYear
    } = req.body;

    const result = await getQuotationOffers(quotationNumber);


    // Validate reason for loss/close
    if (['loss', 'close'].includes(status) && (!reason || reason.trim() === '')) {
      return sendErrorResponse(res, 400, 'Reason is required for loss/close status');
    }

    // Update header
    const updateData = {
      status: { type: status || 'open', reason: reason || '' }
    };
    
    if (status === 'win') {
      const normalizedSubStatus = ['order', 'proceed', 'delivery'].includes((winSubStatus || '').toLowerCase())
        ? winSubStatus.toLowerCase()
        : 'order';
      updateData.winSubStatus = normalizedSubStatus;

      const now = new Date();
      const fallbackRoman = ROMAN_MONTHS[now.getMonth()];
      const fallbackYear = now.getFullYear();

      // Handle OC number generation
      const ocSequence = (ocSequenceNumber ?? '').toString().trim();
      if (ocSequence) {
        const ocMonth = isValidRomanMonth(ocMonthRoman) ? ocMonthRoman.toUpperCase() : fallbackRoman;
        const ocYearValue = Number.isFinite(Number(ocYear)) ? Number(ocYear) : fallbackYear;
        updateData.ocSequenceNumber = ocSequence;
        updateData.ocNumber = `${ocSequence}/${ocMonth}/${ocYearValue}`;
      } else {
        updateData.ocSequenceNumber = '';
        updateData.ocNumber = '';
      }

      // Handle SPK number generation
      const spkSequence = (spkSequenceNumber ?? '').toString().trim();
      const spkCodeNormalized = (spkLetterCode ?? '').toString().trim().toUpperCase();
      if (spkSequence) {
        if (!spkCodeNormalized) {
          return sendErrorResponse(res, 400, 'SPK code is required when SPK number is provided');
        }
        const spkMonth = isValidRomanMonth(spkMonthRoman) ? spkMonthRoman.toUpperCase() : fallbackRoman;
        const spkYearValue = Number.isFinite(Number(spkYear)) ? Number(spkYear) : fallbackYear;
        updateData.spkSequenceNumber = spkSequence;
        updateData.spkCode = spkCodeNormalized;
        updateData.spkNumber = `${spkSequence}/${spkCodeNormalized}/${spkMonth}/${spkYearValue}`;
      } else {
        updateData.spkSequenceNumber = '';
        updateData.spkCode = '';
        updateData.spkNumber = '';
      }
    } else {
      updateData.winSubStatus = null;
    }
    
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

    return sendSuccessResponse(res, 200, 'Quotation status updated successfully', updatedHeader);
  } catch (error) {
    console.error('Error updating quotation status:', error);
    return sendErrorResponse(res, 400, 'Failed to update quotation status', error.message);
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


    return sendSuccessResponse(res, 200, 'Offers retrieved successfully', result.offers);
  } catch (error) {
    console.error('Error getting offers:', error);
    return sendErrorResponse(res, 400, 'Failed to fetch offers', error.message);
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
      return sendErrorResponse(res, 404, 'Quotation not found');
    }

    const offer = await createQuotationOffer(header.quotationNumber, {
      ...offerData,
      requesterId: header.requesterId,
      approverId: header.approverId,
      creatorId: header.creatorId,
      marketingName: req.user.fullName ? req.user.fullName.split(' ')[0] : req.user.email
    });

    return sendSuccessResponse(res, 201, 'Offer created successfully', offer);
  } catch (error) {
    console.error('Error creating offer:', error);
    return sendErrorResponse(res, 400, 'Failed to create offer', error.message);
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
      return sendErrorResponse(res, 404, 'Quotation not found');
    }

    const updatedOffer = await updateQuotationOffer(offerId, updateData);

    return sendSuccessResponse(res, 200, 'Offer updated successfully', updatedOffer);
  } catch (error) {
    console.error('Error updating offer:', error);
    return sendErrorResponse(res, 400, 'Failed to update offer', error.message);
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
      return sendErrorResponse(res, 404, 'Quotation not found');
    }

    // Clean up orphaned notes images before deleting the offer
    const { cleanupOrphanedImages } = require('./notesImages');
    const cleanupResult = await cleanupOrphanedImages([offerId]);

    // Delete all offer items first
    await OfferItem.deleteMany({ quotationOfferId: offerId });

    // Delete the offer
    await deleteQuotationOffer(offerId);

    return sendSuccessResponse(res, 200, `Offer deleted successfully. ${cleanupResult.deletedCount} orphaned images deleted, ${cleanupResult.keptCount} images kept (still used elsewhere).`, {
        cleanupResult
    });
  } catch (error) {
    console.error('Error deleting offer:', error);
    return sendErrorResponse(res, 400, 'Failed to delete offer', error.message);
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

    return sendSuccessResponse(res, 200, 'Offer items retrieved successfully', items);
  } catch (error) {
    console.error('Error getting offer items:', error);
    return sendErrorResponse(res, 400, 'Failed to fetch offer items', error.message);
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

    return sendSuccessResponse(res, 201, 'Offer item created successfully', offerItem);
  } catch (error) {
    console.error('Error creating offer item:', error);
    return sendErrorResponse(res, 400, 'Failed to create offer item', error.message);
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
      return sendErrorResponse(res, 404, 'Offer item not found');
    }

    // Update offer totals
    const offer = await QuotationOffer.findById(offerId);
    if (offer) {
      await offer.save(); // This will trigger the pre-save hook to recalculate totals
    }

    return sendSuccessResponse(res, 200, 'Offer item updated successfully', offerItem);
  } catch (error) {
    console.error('Error updating offer item:', error);
    return sendErrorResponse(res, 400, 'Failed to update offer item', error.message);
  }
});

// Delete specific offer item
router.delete('/:quotationNumber/offers/:offerId/items/:itemId', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, offerId, itemId } = req.params;

    const result = await getQuotationOffers(quotationNumber);

    const offerItem = await OfferItem.findByIdAndDelete(itemId);

    if (!offerItem) {
      return sendErrorResponse(res, 404, 'Offer item not found');
    }

    // Update offer totals
    const offer = await QuotationOffer.findById(offerId);
    if (offer) {
      await offer.save(); // This will trigger the pre-save hook to recalculate totals
    }

    return sendSuccessResponse(res, 200, 'Offer item deleted successfully');
  } catch (error) {
    console.error('Error deleting offer item:', error);
    return sendErrorResponse(res, 400, 'Failed to delete offer item', error.message);
  }
});

// Toggle item acceptance status
router.patch('/:quotationNumber/offers/:offerId/items/:itemId/accept', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, offerId, itemId } = req.params;

    const result = await getQuotationOffers(quotationNumber);


    const offerItem = await OfferItem.findById(itemId);

    if (!offerItem) {
      return sendErrorResponse(res, 404, 'Offer item not found');
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

    return sendSuccessResponse(res, 200, 'Offer item acceptance status updated successfully', offerItem);
  } catch (error) {
    console.error('Error updating offer item acceptance:', error);
    return sendErrorResponse(res, 400, 'Failed to update offer item acceptance', error.message);
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

    return sendSuccessResponse(res, 200, 'Progress added successfully', updatedHeader);
  } catch (error) {
    console.error('Error adding progress:', error);
    return sendErrorResponse(res, 400, 'Failed to add progress', error.message);
  }
});

// Delete progress entry from quotation
router.delete('/:quotationNumber/progress/:index', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, index } = req.params;
    const progressIndex = parseInt(index, 10);

    if (Number.isNaN(progressIndex) || progressIndex < 0) {
      return sendErrorResponse(res, 400, 'Invalid progress index');
    }

    const result = await getQuotationOffers(quotationNumber);
    const currentProgress = Array.isArray(result.header.progress) ? [...result.header.progress] : [];

    if (progressIndex >= currentProgress.length) {
      return sendErrorResponse(res, 404, 'Progress entry not found');
    }

    const removedEntry = currentProgress.splice(progressIndex, 1)[0];

    const updatedHeader = await updateQuotationHeader(result.header._id, {
      progress: currentProgress
    });

    return sendSuccessResponse(res, 200, 'Progress deleted successfully', {
      header: updatedHeader,
      removedEntry
    });
  } catch (error) {
    console.error('Error deleting progress:', error);
    return sendErrorResponse(res, 400, 'Failed to delete progress', error.message);
  }
});

// Update progress entry
router.put('/:quotationNumber/progress/:index', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber, index } = req.params;
    const { progress } = req.body;
    const progressIndex = parseInt(index, 10);
    const trimmedProgress = (progress ?? '').toString().trim();

    if (Number.isNaN(progressIndex) || progressIndex < 0) {
      return sendErrorResponse(res, 400, 'Invalid progress index');
    }

    if (!trimmedProgress) {
      return sendErrorResponse(res, 400, 'Progress text is required');
    }

    const result = await getQuotationOffers(quotationNumber);
    const currentProgress = Array.isArray(result.header.progress) ? [...result.header.progress] : [];

    if (progressIndex >= currentProgress.length) {
      return sendErrorResponse(res, 404, 'Progress entry not found');
    }

    currentProgress[progressIndex] = trimmedProgress;

    const updatedHeader = await updateQuotationHeader(result.header._id, {
      progress: currentProgress
    });

    return sendSuccessResponse(res, 200, 'Progress updated successfully', {
      header: updatedHeader,
      index: progressIndex,
      value: trimmedProgress
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    return sendErrorResponse(res, 400, 'Failed to update progress', error.message);
  }
});

// Update last follow-up date
router.patch('/:quotationNumber/follow-up', authenticateToken, authorize(['quotation_edit']), async (req, res) => {
  try {
    const { quotationNumber } = req.params;

    const result = await getQuotationOffers(quotationNumber);


    const updatedHeader = await updateLastFollowUp(result.header._id);

    return sendSuccessResponse(res, 200, 'Follow-up date updated successfully', updatedHeader);
  } catch (error) {
    console.error('Error updating follow-up:', error);
    return sendErrorResponse(res, 400, 'Failed to update follow-up', error.message);
  }
});

// Track quotation download
router.patch('/:quotationNumber/track-download', authenticateToken, async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const userId = req.user.userId;

    const result = await getQuotationOffers(quotationNumber);

    // Add download entry
    const updatedHeader = await updateQuotationHeader(result.header._id, {
      $push: { downloads: { userId, downloadedAt: new Date() } }
    });

    return sendSuccessResponse(res, 200, 'Download tracked successfully', updatedHeader);
  } catch (error) {
    console.error('Error tracking download:', error);
    return sendErrorResponse(res, 400, 'Failed to track download', error.message);
  }
});

/**
 * GET /api/quotations/:id/download
 * Permission: quotation_view
 * Description: Download quotation as DOCX document (server-side generation)
 */
router.get('/:id/download', authenticateToken, authorize(['quotation_view']), async (req, res) => {
  try {
    const { id } = req.params;
    const { offerId } = req.query; // Optional: specific offer ID
    const selectedNotes = req.query.selectedNotes ? JSON.parse(req.query.selectedNotes) : [0, 1, 2, 3, 4, 5];
    const userId = req.user.userId;

    // Get quotation header by ID or quotationNumber
    let header;
    try {
      header = await getQuotationHeaderById(id);
    } catch (error) {
      header = await QuotationHeader.findOne({ quotationNumber: id });
    }
    
    if (!header) {
      return sendErrorResponse(res, 404, 'Quotation not found');
    }
    
    // Get all offers for this quotation
    const result = await getQuotationOffers(header.quotationNumber);
    
    // Generate document using the service
    const { generateQuotationDocument } = require('../services/quotationDocumentService');
    const docResult = await generateQuotationDocument(
      {
        header: result.header,
        rfq: result.rfq,
        offers: result.offers
      },
      offerId || null,
      selectedNotes
    );

    // Handle new return format (object with buffer and qrCode) or legacy format (just buffer)
    const docBuffer = docResult?.buffer || docResult;
    const qrCodeData = docResult?.qrCode || null;

    // Track download
    try {
      await updateQuotationHeader(result.header._id, {
        $push: { downloads: { userId, downloadedAt: new Date() } }
      });
    } catch (trackError) {
      console.warn('Failed to track download:', trackError);
      // Don't fail the download if tracking fails
    }

    // Determine filename
    const quotationNumber = header.quotationNumber.replace(/[/\\]/g, '_');
    let filename = `Quotation_${quotationNumber}`;
    
    if (offerId) {
      // Find offer to get offer number
      let foundOffer = null;
      for (const offerGroup of result.offers) {
        if (offerGroup.original?._id?.toString() === offerId.toString()) {
          foundOffer = offerGroup.original;
          break;
        }
        if (offerGroup.revisions) {
          const revision = offerGroup.revisions.find(
            (rev) => rev._id?.toString() === offerId.toString()
          );
          if (revision) {
            foundOffer = revision;
            break;
          }
        }
      }
      if (foundOffer && foundOffer.offerNumber) {
        filename += `_Offer_${foundOffer.offerNumber.replace(/[/\\]/g, '_')}`;
      }
    }
    filename += '.docx';

    // Ensure docBuffer is a proper Buffer instance
    const finalBuffer = Buffer.isBuffer(docBuffer) ? docBuffer : Buffer.from(docBuffer);
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', finalBuffer.length);
    
    // Add QR code metadata in response headers (optional, for frontend use)
    if (qrCodeData) {
      res.setHeader('X-QR-Code-URL', qrCodeData.qrUrl);
      res.setHeader('X-Document-Hash', qrCodeData.documentHash);
    }

    // Send the document as Buffer
    res.send(finalBuffer);
  } catch (error) {
    console.error('Error generating quotation document:', error);
    return sendErrorResponse(res, 500, 'Failed to generate quotation document', error.message);
  }
});

// ============================================================================
// UTILITY ROUTES
// ============================================================================

// Generate new quotation number
router.get('/generate/number', authenticateToken, authorize(['quotation_create']), async (req, res) => {
  try {
    const quotationNumber = await generateQuotationNumber();
    return sendSuccessResponse(res, 200, 'Quotation number generated successfully', { quotationNumber });
  } catch (error) {
    console.error('Error generating quotation number:', error);
    return sendErrorResponse(res, 400, 'Failed to generate quotation number', error.message);
  }
});


// Migrate offer numbers (utility for existing data)
router.post('/migrate/offer-numbers', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await migrateOfferNumbers();
    return sendSuccessResponse(res, 200, 'Offer numbers migrated successfully', result);
  } catch (error) {
    console.error('Error migrating offer numbers:', error);
    return sendErrorResponse(res, 400, 'Failed to migrate offer numbers', error.message);
  }
});

module.exports = router;
