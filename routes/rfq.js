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
const { sendRFQNotificationEmail } = require('../utils/emailUtils');
const { hasPermission } = require('../utils/permissionHelper');
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const filters = req.query;

    // Gmail-style advanced search parser
    const ops = {};
    ops.global = []; // All search terms (fuzzy)
    ops.globalPhrases = []; // Exact phrases (quoted)
    const regex = /([a-z]+):("[^"]+"|\S+)|"([^"]+)"|(\S+)/g;
    let m;
    while ((m = regex.exec(search))) {
      if (m[1] && m[2]) { // e.g., app:budi
        const key = m[1];
        let val = m[2];
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        // Support multiple values for same key (e.g., status:pending status:rejected)
        if (!ops[key]) ops[key] = [];
        if (Array.isArray(ops[key])) {
          ops[key].push(val);
        } else {
          ops[key] = [ops[key], val];
        }
      } else if (m[3]) { // "exact phrase" - quoted
        const phrase = m[3];
        ops.globalPhrases.push(phrase);
        ops.global.push(phrase); // Also add to global for tracking
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

    // Build Mongo query
    const query = {};
    
    // User lookups - search by email or fullName
    if (ops.app && ops.app.length > 0) {
      const approverUsers = await User.find({
        $or: [
          { email: { $regex: ops.app.join('|'), $options: 'i' } },
          { fullName: { $regex: ops.app.join('|'), $options: 'i' } }
        ]
      }).select('_id');
      const approverIds = approverUsers.map(u => u._id);
      if (approverIds.length > 0) {
        query.approverId = { $in: approverIds };
      } else {
        // If no users found, return empty results
        query.approverId = { $in: [] };
      }
    }
    
    if (ops.crt && ops.crt.length > 0) {
      const creatorUsers = await User.find({
        $or: [
          { email: { $regex: ops.crt.join('|'), $options: 'i' } },
          { fullName: { $regex: ops.crt.join('|'), $options: 'i' } }
        ]
      }).select('_id');
      const creatorIds = creatorUsers.map(u => u._id);
      if (creatorIds.length > 0) {
        query.requesterId = { $in: creatorIds };
      } else {
        query.requesterId = { $in: [] };
      }
    }
    
    if (ops.eng && ops.eng.length > 0) {
      const engineerUsers = await User.find({
        $or: [
          { email: { $regex: ops.eng.join('|'), $options: 'i' } },
          { fullName: { $regex: ops.eng.join('|'), $options: 'i' } }
        ]
      }).select('_id');
      const engineerIds = engineerUsers.map(u => u._id);
      if (engineerIds.length > 0) {
        query.engineeringId = { $in: engineerIds };
      } else {
        query.engineeringId = { $in: [] };
      }
    }
    
    // Business type filter
    if (ops.type && ops.type.length > 0) {
      query["lineOfBusiness.type"] = { $in: ops.type };
    }
    
    // Status filter - support multiple values
    if (ops.status && ops.status.length > 0) {
      query.status = { $in: ops.status };
    }
    
    // Stage filter - support multiple values
    if (ops.stage && ops.stage.length > 0) {
      query.stage = { $in: ops.stage };
    }
    
    // Priority filter
    if (ops.priority && ops.priority.length > 0) {
      query.priority = { $in: ops.priority };
    }
    
    // RFQ number filter
    if (ops.rf && ops.rf.length > 0) {
      query.rfqNumber = { $regex: ops.rf.join('|'), $options: 'i' };
    }
    
    // Customer name filter
    if (ops.customer && ops.customer.length > 0) {
      query.customerName = { $regex: ops.customer.join('|'), $options: 'i' };
    }
    
    // Contact person filter
    if (ops.contact && ops.contact.length > 0) {
      query['contactPerson.name'] = { $regex: ops.contact.join('|'), $options: 'i' };
    }
    
    // Date range support
    if (ops.from || ops.to) {
      query.createdAt = {};
      if (ops.from && ops.from.length > 0) {
        query.createdAt.$gte = new Date(ops.from[0]);
      }
      if (ops.to && ops.to.length > 0) {
        query.createdAt.$lte = new Date(ops.to[0]);
      }
    }
    
    // Helper function to create fuzzy regex pattern
    // For fuzzy matching: allows characters to be in order with some flexibility
    const createFuzzyPattern = (term) => {
      // Escape special regex characters except we want to allow flexibility
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Create pattern that matches characters in sequence, allowing some flexibility
      // This allows for typos like "Adrian" matching "Adrain" or "Adrian" matching "Adrian"
      return escaped.split('').join('.*?'); // Allows characters between letters (more fuzzy)
    };

    // Helper function to create exact pattern
    const createExactPattern = (term) => {
      // Escape special regex characters for exact matching
      return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // Global/phrase fuzzy search - enhanced to search more fields
    if (ops.global && ops.global.length > 0) {
      // Separate exact phrases from fuzzy terms
      const exactPhrases = ops.globalPhrases || [];
      const fuzzyTerms = ops.global.filter(term => !exactPhrases.includes(term));
      
      const orConditions = [];
      
      // Build conditions for each field
      const fieldsToSearch = [
        'customerName',
        'rfqNumber',
        'description',
        'contactPerson.name',
        'deliveryLocation',
        'competitor',
        'approvalNotes',
        'lineOfBusiness.service.serviceName',
        'lineOfBusiness.service.serviceDetails',
        'lineOfBusiness.sparepart.spareparts.sparepartName',
        'items.notes',
        'items.karoseri',
        'items.chassis',
        'items.specifications.category',
        'items.specifications.items.name',
        'items.specifications.items.specification',
        'engineeringTransit.comments'
      ];
      
      // For exact phrases: use exact word boundary matching
      if (exactPhrases.length > 0) {
        exactPhrases.forEach(phrase => {
          // Exact match - escape special chars and use word boundaries for precise matching
          const exactPattern = '\\b' + createExactPattern(phrase) + '\\b';
          fieldsToSearch.forEach(field => {
            orConditions.push({ [field]: { $regex: exactPattern, $options: 'i' } });
          });
        });
      }
      
      // For fuzzy terms: use substring matching (more lenient)
      if (fuzzyTerms.length > 0) {
        fuzzyTerms.forEach(term => {
          // For fuzzy matching, use simple substring match - this will match "Adrian" 
          // when searching "Adrain", "Adrian", "Adrian Smith", etc.
          const simplePattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          
          fieldsToSearch.forEach(field => {
            // Use substring matching for fuzzy - matches anywhere in the field
            orConditions.push({ [field]: { $regex: simplePattern, $options: 'i' } });
          });
        });
      }
      
      if (orConditions.length > 0) {
        query.$or = orConditions;
      }
    }
    
    // Normal query params (status, stage, etc.) - these override search operators if provided
    if (filters.status) query.status = filters.status;
    if (filters.stage) query.stage = filters.stage;
    if (filters.type) query["lineOfBusiness.type"] = filters.type;
    if (filters.priority) query.priority = filters.priority;
    if (filters.folderId) query.folderId = filters.folderId;
    
    // If stage is 'approver', automatically filter by current user's approverId
    // This ensures approvers only see RFQs assigned to them
    if (filters.stage === 'approver' || query.stage === 'approver') {
      const userId = req.user.userId;
      query.approverId = userId;
    }

    const RFQ = require('../models/rfq.model').RFQ;
    const skip = (page - 1) * limit;
    const rfqsQuery = RFQ.find(query)
      .populate('requesterId approverId quotationCreatorId engineeringId')
      .populate('engineeringTransit.assignedTo engineeringTransit.reviewedBy', 'email fullName')
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name shortName')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit);
    
    // Populate items if stage is approver (needed for approval tab)
    if (filters.stage === 'approver' || query.stage === 'approver') {
      rfqsQuery.populate({
        path: 'items',
        populate: [
          { path: 'drawingSpecification', model: 'DrawingSpecification' },
          { path: 'templateSourceId' }
        ]
      });
    }
    
    const rfqs = await rfqsQuery.exec();
    const total = await RFQ.countDocuments(query);
    res.json({
      success: true,
      data: rfqs,
      pagination: {
        page,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/rfq/approvers - get users with approve_rfq permission
router.get('/approvers', authenticateToken, async (req, res) => {
  try {
    const approvers = await User.find({})
      .populate('permissions')
      .then(users => users.filter(user => 
        hasPermission(user, 'approve_rfq')
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
        hasPermission(user, 'quotation_create')
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

// GET /api/rfq/engineers - get users with engineer_review permission
router.get('/engineers', authenticateToken, async (req, res) => {
  try {
    const engineers = await User.find({})
      .populate('permissions')
      .then(users => users.filter(user => 
        hasPermission(user, 'engineer_review')
      ))
      .then(users => users.map(user => ({
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      })));
    
    return sendSuccessResponse(res, 200, 'Engineers retrieved', { engineers });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch engineers', e.message);
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
      engineeringId,
      quotationCreatorId, 
      description, 
      customerName, 
      contactPerson,
      priority,
      expectedDeliveryDate,
      confidenceRate,
      estimatedRevenue,
      deliveryLocation,
      competitor,
      canMake,
      projectOngoing,
      bodyTypeId,
      chassisTypeId,
      items,
      lineOfBusiness
    } = req.body;
    const requesterId = req.user.userId;
    
    // Basic validation
    if (!approverId || !quotationCreatorId || !customerName || !contactPerson?.name) {
      return sendErrorResponse(res, 400, 'Approver, quotation creator, customer name, and contact person name are required');
    }
    
    // Validate estimatedRevenue (required for all RFQs)
    if (!estimatedRevenue || estimatedRevenue < 0) {
      return sendErrorResponse(res, 400, 'Estimated revenue is required and must be greater than or equal to 0');
    }
    
    // Engineering ID is optional
    if (engineeringId) {
      const engineer = await User.findById(engineeringId);
      if (!engineer) {
        return sendErrorResponse(res, 400, 'Selected engineer not found');
      }
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

    // Determine line of business type
    let lineOfBusinessType = 'karoseri';
    let lineOfBusinessData = { type: 'karoseri' };

    // Check if lineOfBusiness is provided, otherwise default to karoseri
    if (lineOfBusiness && lineOfBusiness.type) {
      lineOfBusinessType = lineOfBusiness.type;
      lineOfBusinessData.type = lineOfBusinessType;

      // Karoseri-specific validation
      if (lineOfBusinessType === 'karoseri') {
        // Body Type and Chassis Type are required for Karoseri
        if (!bodyTypeId) {
          return sendErrorResponse(res, 400, 'Body Type is required for Karoseri RFQ');
        }
        if (!chassisTypeId) {
          return sendErrorResponse(res, 400, 'Chassis Type is required for Karoseri RFQ');
        }
        
        // Validate bodyTypeId and chassisTypeId exist
        const BodyType = require('../models/bodyType.model');
        const ChassisType = require('../models/chassisType.model');
        const bodyType = await BodyType.findById(bodyTypeId);
        const chassisType = await ChassisType.findById(chassisTypeId);
        
        if (!bodyType) {
          return sendErrorResponse(res, 400, 'Invalid body type selected');
        }
        if (!chassisType) {
          return sendErrorResponse(res, 400, 'Invalid chassis type selected');
        }
        
        // For karoseri, validate items array
        if (!items || !Array.isArray(items) || items.length === 0) {
          return sendErrorResponse(res, 400, 'At least one item is required for karoseri type');
        }
        
        // Validate items with new template logic
        for (const item of items) {
          // Quantity is now required
          if (!item.quantity || item.quantity < 1) {
            return sendErrorResponse(res, 400, 'Each item must have a quantity of at least 1');
          }
          
          // Validate template mode
          if (!item.templateMode || !['manual', 'bodyType', 'drawing'].includes(item.templateMode)) {
            return sendErrorResponse(res, 400, 'Each item must have a valid template mode');
          }
          
          // For manual mode, require karoseri and chassis
          if (item.templateMode === 'manual') {
            if (!item.karoseri || !item.karoseri.trim()) {
              return sendErrorResponse(res, 400, 'Karoseri is required for manual mode');
            }
            if (!item.chassis || !item.chassis.trim()) {
              return sendErrorResponse(res, 400, 'Chassis is required for manual mode');
            }
          }
          
          // For bodyType or drawing mode, require templateSourceId
          if (item.templateMode === 'bodyType') {
            if (!item.templateSourceId) {
              return sendErrorResponse(res, 400, 'Body Type template source is required');
            }
          } else if (item.templateMode === 'drawing') {
            if (!item.templateSourceId) {
              return sendErrorResponse(res, 400, 'Drawing template source is required');
            }
          }
        }
      } else if (lineOfBusinessType === 'service') {
        if (!lineOfBusiness.service || !lineOfBusiness.service.serviceName) {
          return sendErrorResponse(res, 400, 'Service name is required for service type');
        }
        lineOfBusinessData.service = {
          serviceName: lineOfBusiness.service.serviceName.trim(),
          serviceDetails: (lineOfBusiness.service.serviceDetails || []).map(d => d.trim()).filter(d => d)
        };
      } else if (lineOfBusinessType === 'sparepart') {
        if (!lineOfBusiness.sparepart || !lineOfBusiness.sparepart.spareparts || !Array.isArray(lineOfBusiness.sparepart.spareparts) || lineOfBusiness.sparepart.spareparts.length === 0) {
          return sendErrorResponse(res, 400, 'At least one sparepart is required for sparepart type');
        }
        for (const sparepart of lineOfBusiness.sparepart.spareparts) {
          if (!sparepart.sparepartName || !sparepart.sparepartName.trim()) {
            return sendErrorResponse(res, 400, 'Each sparepart must have a name');
          }
          if (!sparepart.quantity || sparepart.quantity < 1) {
            return sendErrorResponse(res, 400, 'Each sparepart must have a quantity of at least 1');
          }
        }
        lineOfBusinessData.sparepart = {
          spareparts: lineOfBusiness.sparepart.spareparts.map(sp => ({
            sparepartName: sp.sparepartName.trim(),
            quantity: parseInt(sp.quantity)
          }))
        };
      }
    } else {
      // Default to karoseri if no lineOfBusiness specified
      return sendErrorResponse(res, 400, 'Line of business type is required');
    }
    
    // Validate that approver has approve_rfq permission
    const approver = await User.findById(approverId).populate('permissions');
    if (!approver || !hasPermission(approver, 'approve_rfq')) {
      return sendErrorResponse(res, 400, 'Selected approver does not have approve_rfq permission');
    }
    
    // Validate that quotation creator has quotation_create permission
    const quotationCreator = await User.findById(quotationCreatorId).populate('permissions');
    if (!quotationCreator || !hasPermission(quotationCreator, 'quotation_create')) {
      return sendErrorResponse(res, 400, 'Selected quotation creator does not have quotation_create permission');
    }
    
    const rfqData = {
      requesterId,
      engineeringId: engineeringId || null,
      approverId,
      quotationCreatorId,
      description: description || '',
      customerName,
      contactPerson,
      priority: priority || 'medium',
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      confidenceRate: parseInt(confidenceRate),
      estimatedRevenue: parseFloat(estimatedRevenue),
      deliveryLocation: deliveryLocation.trim(),
      competitor: competitor.trim(),
      canMake: Boolean(canMake),
      projectOngoing: Boolean(projectOngoing),
      bodyTypeId: lineOfBusinessType === 'karoseri' ? bodyTypeId : undefined,
      chassisTypeId: lineOfBusinessType === 'karoseri' ? chassisTypeId : undefined,
      lineOfBusiness: lineOfBusinessData,
      stage: 'sales',
      timeline: [{
        stage: 'sales',
        action: 'created',
        user: requesterId,
        timestamp: new Date(),
        notes: 'RFQ created by sales'
      }]
    };
    
    const rfq = await createRFQ(rfqData);
    
    // Create RFQ items only for karoseri type
    if (lineOfBusinessType === 'karoseri' && items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await createRFQItem(rfq._id, {
          itemNumber: i + 1,
          quantity: parseInt(item.quantity),
          karoseri: item.karoseri || '',
          chassis: item.chassis || '',
          drawingSpecification: item.drawingSpecification || undefined,
          templateMode: item.templateMode || 'manual',
          templateSourceId: item.templateSourceId || undefined,
          specifications: item.specifications || [],
          notes: item.notes || ''
        });
      }
    }
    
    // Send notification to approver
    await addNotification({
      userId: approverId,
      title: 'New RFQ Request',
      description: `New RFQ request for ${customerName} from ${req.user.fullName || req.user.email}`,
      path: '/quotations'
    });
    
    // Send email notification to approver
    const approverUser = await User.findById(approverId).select('email fullName');
    if (approverUser && approverUser.email) {
      sendRFQNotificationEmail(
        approverUser.email,
        rfq.rfqNumber,
        `New RFQ request for ${customerName} requires your approval. Please review and approve/reject the request.`,
        approverUser.fullName || approverUser.email
      );
    }
    
    return sendSuccessResponse(res, 201, 'RFQ created successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to create RFQ', e.message);
  }
});

// POST /api/rfq/:id/submit-to-engineering - submit RFQ to engineering
/**
 * POST /api/rfq/:id/submit-to-engineering
 * Permission: quotation_requester
 * Description: Submit RFQ from sales to engineering stage
 */
router.post('/:id/submit-to-engineering', authenticateToken, authorize(['quotation_requester']), async (req, res) => {
  try {
    const { id } = req.params;
    const { engineeringId } = req.body;
    const userId = req.user.userId;
    
    const rfq = await RFQ.findById(id).populate('items');
    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }
    
    // Check if user is the requester
    if (rfq.requesterId.toString() !== userId.toString()) {
      return sendErrorResponse(res, 403, 'You are not authorized to submit this RFQ to engineering');
    }
    
    // Check if RFQ is in sales stage
    if (rfq.stage !== 'sales') {
      return sendErrorResponse(res, 400, 'RFQ must be in sales stage to submit to engineering');
    }
    
    // Validate engineering ID
    if (!engineeringId) {
      return sendErrorResponse(res, 400, 'Engineering ID is required');
    }
    
    const engineer = await User.findById(engineeringId);
    if (!engineer) {
      return sendErrorResponse(res, 400, 'Selected engineer not found');
    }
    
    // Prepare specs snapshot for engineeringTransit.specsOriginal
    // Only store: karoseri, chassis, notes, and specifications (for diff checker)
    let specsOriginal = [];
    if (rfq.lineOfBusiness?.type === 'karoseri') {
      // For karoseri, snapshot only the fields visible in diff checker
      specsOriginal = (rfq.items || []).map(item => ({
        itemNumber: item.itemNumber,
        karoseri: item.karoseri,
        chassis: item.chassis,
        notes: item.notes || '',
        specifications: item.specifications || []
      }));
    } else if (rfq.lineOfBusiness?.type === 'service') {
      specsOriginal = [{
        serviceName: rfq.lineOfBusiness.service?.serviceName,
        serviceDetails: rfq.lineOfBusiness.service?.serviceDetails || []
      }];
    } else if (rfq.lineOfBusiness?.type === 'sparepart') {
      specsOriginal = rfq.lineOfBusiness.sparepart?.spareparts || [];
    }
    
    // Update RFQ to engineering stage
    rfq.stage = 'engineering';
    rfq.status = 'pending'; // Always set status back to pending on (re)submit
    rfq.engineeringTransit = rfq.engineeringTransit || {};
    rfq.engineeringTransit.status = 'in_progress';
    rfq.engineeringId = engineeringId;
    rfq.engineeringTransit = {
      assignedTo: engineeringId,
      assignedAt: new Date(),
      specsOriginal: specsOriginal,
      specsModified: [], // Will be populated by engineering
      canDo: null,
      comments: '',
      status: 'in_progress'
    };
    
    // Add timeline entry
    rfq.timeline.push({
      stage: 'engineering',
      action: 'submitted_to_engineering',
      user: userId,
      timestamp: new Date(),
      notes: `RFQ submitted to engineering (assigned to: ${engineer.fullName || engineer.email})`
    });
    
    await rfq.save();
    
    // Send notification to engineer
    await addNotification({
      userId: engineeringId,
      title: 'New RFQ Requires Engineering Review',
      description: `RFQ ${rfq.rfqNumber} for ${rfq.customerName} requires your engineering review.`,
      path: '/quotations'
    });
    
    return sendSuccessResponse(res, 200, 'RFQ submitted to engineering successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to submit RFQ to engineering', e.message);
  }
});

// PATCH /api/rfq/:id/engineering-review - submit engineering review
/**
 * PATCH /api/rfq/:id/engineering-review
 * Permission: engineer_review
 * Description: Engineering reviews and submits feedback. Any engineer with engineer_review permission can review any RFQ in engineering stage.
 */
router.patch('/:id/engineering-review', authenticateToken, authorize(['engineer_review']), async (req, res) => {
  try {
    const { id } = req.params;
    const { specsModified, canDo, comments } = req.body;
    const userId = req.user.userId;
    
    const rfq = await RFQ.findById(id).populate('items');
    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }
    
    // Check if RFQ is in engineering stage
    if (rfq.stage !== 'engineering') {
      return sendErrorResponse(res, 400, 'RFQ must be in engineering stage');
    }
    
    // Any engineer with engineer_review permission can review (not just assigned one)
    // Update assignedTo if not set
    if (!rfq.engineeringTransit?.assignedTo) {
      if (!rfq.engineeringTransit) {
        rfq.engineeringTransit = {};
      }
      rfq.engineeringTransit.assignedTo = userId;
      rfq.engineeringId = userId;
    }
    
    // Validate canDo
    if (canDo === undefined || canDo === null || typeof canDo !== 'boolean') {
      return sendErrorResponse(res, 400, 'Can Do decision is required (true/false)');
    }
    
    // Update engineering review
    rfq.engineeringTransit.specsModified = specsModified || [];
    rfq.engineeringTransit.canDo = canDo;
    rfq.engineeringTransit.comments = comments || '';
    rfq.engineeringTransit.reviewedBy = userId;
    rfq.engineeringTransit.reviewedAt = new Date();
    rfq.engineeringTransit.status = 'reviewed';
    rfq.stage = 'approver'; // Ensure moved to approver stage
    
    // Add timeline entry
    rfq.timeline.push({
      stage: 'approver',
      action: 'engineering_reviewed',
      user: userId,
      timestamp: new Date(),
      notes: `Engineering review completed. Can Do: ${canDo ? 'Yes' : 'No'}. ${comments ? `Comments: ${comments}` : ''}`
    });
    
    await rfq.save();
    
    // Send notification to approver
    await addNotification({
      userId: rfq.approverId,
      title: 'RFQ Ready for Approval',
      description: `RFQ ${rfq.rfqNumber} has completed engineering review and is ready for your approval.`,
      path: '/quotations'
    });
    
    return sendSuccessResponse(res, 200, 'Engineering review submitted successfully', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to submit engineering review', e.message);
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
    
    // Check if RFQ is in approver stage (engineering must have reviewed)
    if (existingRFQ.stage !== 'approver') {
      return sendErrorResponse(res, 400, `RFQ must be in approver stage. Current stage: ${existingRFQ.stage}`);
    }
    
    // Check if engineering has completed review
    if (!existingRFQ.engineeringTransit || existingRFQ.engineeringTransit.status !== 'reviewed') {
      return sendErrorResponse(res, 400, 'RFQ must complete engineering review before approval');
    }
    
    // If engineering says cannot do, only allow no_bid (but they should use reject endpoint)
    if (existingRFQ.engineeringTransit.canDo === false) {
      return sendErrorResponse(res, 400, 'Engineering marked this as "Cannot Do". Please use the reject endpoint instead.');
    }
    
    if (existingRFQ.status !== 'pending') {
      return sendErrorResponse(res, 400, 'RFQ has already been processed');
    }
    
    const approvalData = {
      approvalDecision: 'bid',
      approvalNotes: approvalNotes || ''
    };
    
    const rfq = await approveRFQ(id, approvalData);
    
    // Update stage to quotation and add timeline entry
    rfq.stage = 'quotation';
    rfq.timeline.push({
      stage: 'quotation',
      action: 'approved',
      user: userId,
      timestamp: new Date(),
      notes: `RFQ approved with bid decision. ${approvalNotes ? `Notes: ${approvalNotes}` : ''}`
    });
    await rfq.save();
    
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
    
    // Send email notifications
    const requester = await User.findById(rfq.requesterId._id).select('email fullName');
    const quotationCreator = await User.findById(rfq.quotationCreatorId._id).select('email fullName');
    
    // Email to requester
    if (requester && requester.email) {
      sendRFQNotificationEmail(
        requester.email,
        rfq.rfqNumber,
        `Your RFQ request has been approved with bid decision. The quotation creation process can now begin.`,
        requester.fullName || requester.email
      );
    }
    
    // Email to quotation creator
    if (quotationCreator && quotationCreator.email) {
      sendRFQNotificationEmail(
        quotationCreator.email,
        rfq.rfqNumber,
        `RFQ has been approved. You can now create the quotation for this request.`,
        quotationCreator.fullName || quotationCreator.email
      );
    }
    
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
    
    // Check if RFQ is in approver stage (engineering must have reviewed)
    if (existingRFQ.stage !== 'approver') {
      return sendErrorResponse(res, 400, `RFQ must be in approver stage. Current stage: ${existingRFQ.stage}`);
    }
    
    // Check if engineering has completed review
    if (!existingRFQ.engineeringTransit || existingRFQ.engineeringTransit.status !== 'reviewed') {
      return sendErrorResponse(res, 400, 'RFQ must complete engineering review before rejection');
    }
    
    if (existingRFQ.status !== 'pending') {
      return sendErrorResponse(res, 400, 'RFQ has already been processed');
    }
    
    const rejectionData = {
      approvalDecision: 'no_bid',
      approvalNotes: rejectionNotes || ''
    };
    
    const rfq = await rejectRFQ(id, rejectionData);
    
    // Update stage to sales and status to rejected (for re-edit/re-request)
    rfq.stage = 'sales';
    rfq.status = 'rejected';
    rfq.timeline.push({
      stage: 'sales',
      action: 'rejected',
      user: userId,
      timestamp: new Date(),
      notes: `RFQ rejected with no_bid decision. ${rejectionNotes ? `Notes: ${rejectionNotes}` : ''}`
    });
    await rfq.save();
    
    // Send notification to requester
    await addNotification({
      userId: rfq.requesterId._id,
      title: 'RFQ Rejected - No Bid Decision',
      description: `Your RFQ "${rfq.title}" has been rejected with no bid decision`,
      path: '/quotations'
    });
    
    // Send email notification to requester
    const requester = await User.findById(rfq.requesterId._id).select('email fullName');
    if (requester && requester.email) {
      sendRFQNotificationEmail(
        requester.email,
        rfq.rfqNumber,
        `Your RFQ request has been rejected with no bid decision. Please review the feedback and consider alternative approaches.`,
        requester.fullName || requester.email
      );
    }
    
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
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    
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
    const canApprove = hasPermission(user, 'approve_rfq');
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    const canRequestQuotation = hasPermission(user, 'quotation_requester');
    
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
    const canApprove = hasPermission(user, 'approve_rfq');
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    const canRequestQuotation = hasPermission(user, 'quotation_requester');
    
    const rfq = await getRFQById(id);
    
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

// =============================================================================
// RFQ FOLDER MANAGEMENT
// =============================================================================

/**
 * PATCH /api/rfq/move-to-folder
 * Permission: Any authenticated user
 * Description: Move one or more RFQs to a folder
 */
router.patch('/move-to-folder', authenticateToken, async (req, res) => {
  try {
    const { rfqIds, folderId } = req.body;
    
    if (!rfqIds || !Array.isArray(rfqIds) || rfqIds.length === 0) {
      return sendErrorResponse(res, 400, 'RFQ IDs are required');
    }

    // Verify user owns these RFQs or has proper permissions
    const userId = req.user.userId;
    const rfqs = await RFQ.find({
      _id: { $in: rfqIds },
      requesterId: userId
    });

    if (rfqs.length !== rfqIds.length) {
      return sendErrorResponse(res, 400, 'One or more RFQs not found or unauthorized');
    }

    // Update folderId for all RFQs
    await RFQ.updateMany(
      { _id: { $in: rfqIds } },
      { folderId: folderId || null }
    );

    sendSuccessResponse(res, 200, 'RFQs moved to folder successfully');
  } catch (error) {
    console.error('Error moving RFQs to folder:', error);
    sendErrorResponse(res, 500, 'Failed to move RFQs', error.message);
  }
});

/**
 * PATCH /api/rfq/:id/folder
 * Permission: Any authenticated user
 * Description: Move a single RFQ to a folder
 */
router.patch('/:id/folder', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body;
    
    const userId = req.user.userId;
    const rfq = await RFQ.findById(id);

    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ not found');
    }

    // Verify user owns this RFQ
    if (rfq.requesterId.toString() !== userId.toString()) {
      return sendErrorResponse(res, 403, 'You can only modify your own RFQs');
    }

    rfq.folderId = folderId || null;
    await rfq.save();

    sendSuccessResponse(res, 200, 'RFQ folder updated successfully', { rfq });
  } catch (error) {
    console.error('Error updating RFQ folder:', error);
    sendErrorResponse(res, 500, 'Failed to update RFQ folder', error.message);
  }
});

// PATCH /api/rfq/:id - Edit RFQ (requester/sales, only in sales stage)
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const allowedFields = [
      'description', 'customerName', 'contactPerson', 'priority', 'expectedDeliveryDate',
      'confidenceRate', 'deliveryLocation', 'competitor', 'canMake', 'projectOngoing',
      'lineOfBusiness', 'items', 'service', 'sparepart', 'approverId', 'quotationCreatorId', 'engineeringId'
    ];
    const rfq = await RFQ.findById(id);
    if (!rfq) return sendErrorResponse(res, 404, 'RFQ not found');
    if (rfq.requesterId.toString() !== userId.toString())
      return sendErrorResponse(res, 403, 'Not authorized to edit this RFQ');
    if (rfq.stage !== 'sales')
      return sendErrorResponse(res, 400, 'Can only edit RFQ in sales stage');
    // Only update allowed fields
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        rfq[field] = req.body[field];
      }
    }
    await rfq.save();
    return sendSuccessResponse(res, 200, 'RFQ updated', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to update RFQ', e.message);
  }
});

module.exports = router;
