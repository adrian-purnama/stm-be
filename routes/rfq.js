// =============================================================================
// REQUEST FOR QUOTATION (RFQ) ROUTES
// =============================================================================
// This module handles all RFQ-related endpoints including creation, retrieval,
// updates, approval/rejection, and management of RFQ items.

const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const router = express.Router();
const { RFQ, RFQItem } = require('../models/rfq.model');
const QuotationHeader = require('../models/quotationHeader.model');
const User = require('../models/user.model');
const BodyType = require('../models/bodyType.model');
const ChassisType = require('../models/chassisType.model');
const { authenticateToken, authorize } = require('../middleware/auth');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/errorHandler');
const { addNotification } = require('../utils/notificationHelper');
const { sendRFQNotificationEmail } = require('../utils/emailUtils');
const { hasPermission, hasAnyPermission, isSuperAdmin, hasAllQuotationAccess } = require('../utils/permissionHelper');
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

const DEFAULT_PAYMENT_TERMS = 'Payment DP 50% sisa cash before delivery';

const toBoolean = (value, defaultValue = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return defaultValue;
};

const normalizeString = (value, fallback = '') => {
  if (typeof value === 'string') {
    return value.trim();
  }
  return fallback;
};

const normalizeTaxFlags = (isTaxIncluded, includePPN) => {
  const inclusive = Boolean(isTaxIncluded);
  const include = Boolean(includePPN);

  if (inclusive && include) {
    return { isTaxIncluded: true, includePPN: false };
  }

  if (!inclusive && !include) {
    return { isTaxIncluded: false, includePPN: true };
  }

  return { isTaxIncluded: inclusive, includePPN: include };
};

const summarizeValue = (value) => {
  if (value === undefined) return '—';
  if (value === null) return 'null';

  if (typeof value === 'string') {
    return value.length > 60 ? `${value.slice(0, 57)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value.toString();
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 60 ? `${serialized.slice(0, 57)}...` : serialized;
  } catch (error) {
    return '[complex]';
  }
};

const isDeepEqual = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) {
    return false;
  }

  if (typeA === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (error) {
      return false;
    }
  }

  return a === b;
};

// Helper function to escape regex special characters to prevent DoS attacks
const escapeRegex = (str) => {
  if (!str) return str;
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Configure multer for CSV file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for CSV
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || 
        file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// Helper function to auto-shorten name (e.g., "Dump Truck" → "DT")
const autoShorten = (name) => {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    // Single word: take first 3 uppercase letters
    return words[0].substring(0, 3).toUpperCase();
  }
  // Multiple words: take first letter of each word
  return words.map(w => w.charAt(0).toUpperCase()).join('');
};

// Helper function to extract chassis type from chassis string (first word)
const extractChassisType = (chassisStr) => {
  if (!chassisStr) return { type: '', model: '' };
  const parts = chassisStr.trim().split(/\s+/);
  if (parts.length === 0) return { type: '', model: '' };
  const type = parts[0];
  const model = parts.slice(1).join(' ');
  return { type, model };
};

// Helper function to generate short name for chassis type
const generateChassisShortName = (chassisType) => {
  if (!chassisType) return '';
  // Take first 3 letters and make uppercase
  return chassisType.substring(0, 3).toUpperCase();
};

// Helper function to convert string to title case (matching BodyType/ChassisType model behavior)
const toTitleCase = (str) => {
  if (!str) return str;
  return str
    .trim()
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};


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
    return sendSuccessResponse(res, 200, 'Approved RFQs fetched successfully', result);
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
    const rawFilters = { ...req.query };
    const viewScopeRaw = rawFilters.viewScope || rawFilters.scope || '';
    const search = rawFilters.search || '';
    const page = parseInt(rawFilters.page, 10) || 1;
    const limit = parseInt(rawFilters.limit, 10) || 10;

    delete rawFilters.viewScope;
    delete rawFilters.scope;
    delete rawFilters.search;
    delete rawFilters.page;
    delete rawFilters.limit;

    const filters = rawFilters;

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
    const requestedStages = new Set();
    
    // User lookups - search by email or fullName (escape regex to prevent DoS)
    // Optimize: Batch all user searches together if any exist
    const hasUserSearch = (ops.app && ops.app.length > 0) || (ops.crt && ops.crt.length > 0) || (ops.eng && ops.eng.length > 0);
    if (hasUserSearch) {
      const allUserSearchTerms = [];
      if (ops.app && ops.app.length > 0) allUserSearchTerms.push(...ops.app);
      if (ops.crt && ops.crt.length > 0) allUserSearchTerms.push(...ops.crt);
      if (ops.eng && ops.eng.length > 0) allUserSearchTerms.push(...ops.eng);
      
      // Single query to find all matching users
      const escapedTerms = allUserSearchTerms.map(term => escapeRegex(term)).join('|');
      const matchingUsers = await User.find({
        $or: [
          { email: { $regex: escapedTerms, $options: 'i' } },
          { fullName: { $regex: escapedTerms, $options: 'i' } }
        ]
      }).select('_id email fullName');
      
      // Now separate users for approver, creator, engineer based on their search terms
      if (ops.app && ops.app.length > 0) {
        const escapedApp = ops.app.map(term => escapeRegex(term)).join('|');
        const approverIds = matchingUsers
          .filter(u => u.email.match(new RegExp(escapedApp, 'i')) || u.fullName.match(new RegExp(escapedApp, 'i')))
          .map(u => u._id);
        query.approverId = approverIds.length > 0 ? { $in: approverIds } : { $in: [] };
      }
      
      if (ops.crt && ops.crt.length > 0) {
        const escapedCrt = ops.crt.map(term => escapeRegex(term)).join('|');
        const creatorIds = matchingUsers
          .filter(u => u.email.match(new RegExp(escapedCrt, 'i')) || u.fullName.match(new RegExp(escapedCrt, 'i')))
          .map(u => u._id);
        query.requesterId = creatorIds.length > 0 ? { $in: creatorIds } : { $in: [] };
      }
      
      if (ops.eng && ops.eng.length > 0) {
        const escapedEng = ops.eng.map(term => escapeRegex(term)).join('|');
        const engineerIds = matchingUsers
          .filter(u => u.email.match(new RegExp(escapedEng, 'i')) || u.fullName.match(new RegExp(escapedEng, 'i')))
          .map(u => u._id);
        query.engineeringId = engineerIds.length > 0 ? { $in: engineerIds } : { $in: [] };
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
      ops.stage.forEach((stageValue) => requestedStages.add(stageValue));
      query.stage = { $in: ops.stage };
    }
    
    // Priority filter
    if (ops.priority && ops.priority.length > 0) {
      query.priority = { $in: ops.priority };
    }
    
    // RFQ number filter (escape regex to prevent DoS)
    if (ops.rf && ops.rf.length > 0) {
      const escapedRf = ops.rf.map(term => escapeRegex(term)).join('|');
      query.rfqNumber = { $regex: escapedRf, $options: 'i' };
    }
    
    // Customer name filter (escape regex to prevent DoS)
    if (ops.customer && ops.customer.length > 0) {
      const escapedCustomer = ops.customer.map(term => escapeRegex(term)).join('|');
      query.customerName = { $regex: escapedCustomer, $options: 'i' };
    }
    
    // Contact person filter (escape regex to prevent DoS)
    if (ops.contact && ops.contact.length > 0) {
      const escapedContact = ops.contact.map(term => escapeRegex(term)).join('|');
      query['contactPerson.name'] = { $regex: escapedContact, $options: 'i' };
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

    // Helper function to create exact pattern (use escapeRegex for consistency)
    const createExactPattern = (term) => {
      return escapeRegex(term);
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
        // Unified item fields
        'items.notes',
        'items.karoseri',
        'items.chassis',
        'items.serviceName',
        'items.serviceDetails',
        'items.sparepartName',
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
          // Use escapeRegex helper for consistency and security
          const simplePattern = escapeRegex(term);
          
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
    if (filters.stage) {
      if (Array.isArray(filters.stage)) {
        filters.stage.forEach((stageValue) => requestedStages.add(stageValue));
        query.stage = { $in: filters.stage };
      } else if (typeof filters.stage === 'string') {
        requestedStages.add(filters.stage);
        query.stage = filters.stage;
      }
    }
    if (filters.type) query["lineOfBusiness.type"] = filters.type;
    if (filters.priority) query.priority = filters.priority;
    if (filters.folderId) query.folderId = filters.folderId;

    const userId = req.user.userId;
    const user = await User.findById(userId).populate('permissions');

    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const isAdminUser = isSuperAdmin(user) || hasAnyPermission(user, ['quotation_admin', 'admin', 'system_admin']);
    const hasAllAccess = hasAllQuotationAccess(user);
    const canApprove = hasPermission(user, 'approve_rfq');
    const canEngineer = hasPermission(user, 'engineer_review');
    const canRequest = hasPermission(user, 'quotation_requester');
    const canCreateQuotation = hasPermission(user, 'quotation_create');

    let scope = typeof viewScopeRaw === 'string' ? viewScopeRaw.toLowerCase() : '';

    if (!scope) {
      if (requestedStages.has('approver') && canApprove) {
        scope = 'approver';
      } else if (requestedStages.has('engineering') && canEngineer) {
        scope = 'engineer';
      } else if (requestedStages.has('quotation') && canCreateQuotation) {
        scope = 'creator';
      } else if (canRequest) {
        scope = 'requester';
      } else if (canApprove) {
        scope = 'approver';
      } else if (canEngineer) {
        scope = 'engineer';
      } else if (canCreateQuotation) {
        scope = 'creator';
      }
    }

    // Track if scope was explicitly provided
    const explicitScope = viewScopeRaw && viewScopeRaw.trim() !== '';
    
    if (!scope) {
      scope = 'requester';
    }

    // If user has all_quotation_viewer, bypass scope filtering to show all RFQs
    // UNLESS an explicit scope was provided (e.g., 'requester' from RequestQuotationTab)
    // This allows RequestQuotationTab to always show only user's own RFQs
    const shouldApplyScopeFilter = explicitScope || (!hasAllAccess && (!isAdminUser || scope === 'engineer'));

    if (shouldApplyScopeFilter) {
      const scopePermissionMap = {
        approver: canApprove,
        engineer: canEngineer,
        creator: canCreateQuotation,
        requester: canRequest
      };

      if (!scopePermissionMap[scope]) {
        if (canRequest) {
          scope = 'requester';
        } else if (canApprove) {
          scope = 'approver';
        } else if (canEngineer) {
          scope = 'engineer';
        } else if (canCreateQuotation) {
          scope = 'creator';
        } else {
          scope = 'requester';
        }
      }

      if (!Array.isArray(query.$and)) {
        if (query.$and) {
          query.$and = [query.$and];
        } else {
          query.$and = [];
        }
      }

      if (scope === 'approver') {
        query.$and.push({ approverId: userId });
      } else if (scope === 'engineer') {
        query.$and.push({
          $or: [
            { 'engineeringTransit.assignedTo': userId },
            { engineeringId: userId }
          ]
        });
      } else if (scope === 'creator') {
        query.$and.push({ quotationCreatorId: userId });
      } else {
        query.$and.push({ requesterId: userId });
      }
    }

    if (requestedStages.has('approver') && !query['engineeringTransit.status']) {
      query['engineeringTransit.status'] = 'reviewed';
    }

    const RFQ = require('../models/rfq.model').RFQ;
    const skip = (page - 1) * limit;
    const rfqsQuery = RFQ.find(query)
      .populate('requesterId approverId quotationCreatorId engineeringId')
      .populate('engineeringTransit.assignedTo engineeringTransit.reviewedBy', 'email fullName')
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name shortName')
      .populate({
        path: 'items',
        populate: [
          { path: 'drawingSpecification', model: 'DrawingSpecification' },
          { path: 'templateSourceId' }
        ]
      })
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit);
    
    const rfqs = await rfqsQuery.exec();
    const total = await RFQ.countDocuments(query);
    return sendSuccessResponse(res, 200, 'RFQs fetched successfully', {
      rfqs,
      pagination: {
        page,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching RFQs:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch RFQs', error.message);
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
 * Permission: quotation_requester or all_quotation_viewer
 * Description: Create a new RFQ
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Check permissions: allow quotation_requester or all_quotation_viewer
    const user = await User.findById(req.user.userId).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }
    
    const hasAllAccess = hasAllQuotationAccess(user);
    const canRequest = hasPermission(user, 'quotation_requester');
    
    if (!hasAllAccess && !canRequest) {
      return sendErrorResponse(res, 403, 'Insufficient permissions. Requires quotation_requester or all_quotation_viewer permission.');
    }
    
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
      deliveryLocation,
      competitor,
      canMake,
      projectOngoing,
      bodyTypeId,
      chassisTypeId,
      items,
      lineOfBusiness,
      endUser,
      deliveryTerms,
      deliveryNotes,
      targetCloseDate,
      paymentTerms,
      inclusionNotes,
      exclusionNotes,
      isTaxIncluded,
      includePPN
    } = req.body;
    const requesterId = req.user.userId;
    const normalizedDeliveryTerms = normalizeString(deliveryTerms);
    const normalizedDeliveryNotes = normalizeString(deliveryNotes);
    let normalizedPaymentTerms = normalizeString(paymentTerms, DEFAULT_PAYMENT_TERMS);
    if (!normalizedPaymentTerms) {
      normalizedPaymentTerms = DEFAULT_PAYMENT_TERMS;
    }
    const normalizedInclusionNotes = normalizeString(inclusionNotes);
    const normalizedExclusionNotes = normalizeString(exclusionNotes);
    const rawIsTaxIncluded = toBoolean(isTaxIncluded, false);
    const rawIncludePPN = toBoolean(includePPN, true);
    const { isTaxIncluded: normalizedIsTaxIncluded, includePPN: normalizedIncludePPN } = normalizeTaxFlags(rawIsTaxIncluded, rawIncludePPN);
    let parsedTargetCloseDate;
    if (targetCloseDate) {
      parsedTargetCloseDate = new Date(targetCloseDate);
      if (Number.isNaN(parsedTargetCloseDate.getTime())) {
        return sendErrorResponse(res, 400, 'Invalid target close date');
      }
    }

    // Check if this is a draft - drafts have relaxed validation
    const isDraft = req.body.isDraft === true;
    
    // Basic validation - required even for drafts
    if (!approverId || !quotationCreatorId || !customerName || !contactPerson?.name) {
      return sendErrorResponse(res, 400, 'Approver, quotation creator, customer name, and contact person name are required');
    }
    

    // Engineering ID is optional
    if (engineeringId) {
      const engineer = await User.findById(engineeringId);
      if (!engineer) {
        return sendErrorResponse(res, 400, 'Selected engineer not found');
      }
    }
    
    // For drafts, allow missing optional fields; for submit, require all fields
    if (!isDraft) {
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
    } else {
      // For drafts, set defaults for missing optional fields
      if (confidenceRate === undefined || confidenceRate === null || confidenceRate < 0 || confidenceRate > 100) {
        confidenceRate = 50; // Default value for drafts
      }
      if (!Number.isInteger(parseFloat(confidenceRate))) {
        confidenceRate = Math.round(parseFloat(confidenceRate) || 50);
      }
      if (!deliveryLocation || !deliveryLocation.trim()) {
        deliveryLocation = 'TBD';
      }
      if (!competitor || !competitor.trim()) {
        competitor = 'TBD';
      }
      if (canMake === undefined || canMake === null || typeof canMake !== 'boolean') {
        canMake = false;
      }
      if (projectOngoing === undefined || projectOngoing === null || typeof projectOngoing !== 'boolean') {
        projectOngoing = false;
      }
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
        
        // For karoseri, validate items array (allow empty for drafts)
        if (!isDraft && (!items || !Array.isArray(items) || items.length === 0)) {
          return sendErrorResponse(res, 400, 'At least one item is required for karoseri type');
        }
        
        // Validate items with new template logic (skip validation for drafts)
        if (!isDraft && items && items.length > 0) {
          for (const item of items) {
          // Quantity is now required
          if (!item.quantity || item.quantity < 1) {
            return sendErrorResponse(res, 400, 'Each item must have a quantity of at least 1');
          }
          
          // Estimated Revenue is required for each item (0 is a valid value)
          if (item.estimatedRevenue === undefined || item.estimatedRevenue === null || 
              isNaN(parseFloat(item.estimatedRevenue)) || parseFloat(item.estimatedRevenue) < 0) {
            return sendErrorResponse(res, 400, 'Each item must have an estimated revenue >= 0');
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
            // Set templateSourceModel for refPath to work correctly
            item.templateSourceModel = 'BodyType';
          } else if (item.templateMode === 'drawing') {
            if (!item.templateSourceId) {
              return sendErrorResponse(res, 400, 'Drawing template source is required');
            }
            // Set templateSourceModel for refPath to work correctly
            item.templateSourceModel = 'DrawingSpecification';
          } else {
            // Manual mode - no template source
            item.templateSourceModel = null;
          }
          }
        }
      } else if (lineOfBusinessType === 'service') {
        // For service, validate items array (allow empty for drafts)
        if (!isDraft && (!items || !Array.isArray(items) || items.length === 0)) {
          return sendErrorResponse(res, 400, 'At least one service item is required for service type');
        }
        
        // Validate service items (skip validation for drafts)
        if (!isDraft && items && items.length > 0) {
          for (const item of items) {
          if (!item.serviceName || !item.serviceName.trim()) {
            return sendErrorResponse(res, 400, 'Each service item must have a service name');
          }
          if (item.estimatedRevenue === undefined || item.estimatedRevenue === null || 
              isNaN(parseFloat(item.estimatedRevenue)) || parseFloat(item.estimatedRevenue) < 0) {
            return sendErrorResponse(res, 400, 'Each service item must have an estimated revenue >= 0');
          }
          // Quantity defaults to 1 for service items
          if (!item.quantity || item.quantity < 1) {
            item.quantity = 1;
          }
          }
        }
      } else if (lineOfBusinessType === 'sparepart') {
        // For sparepart, validate items array (allow empty for drafts)
        if (!isDraft && (!items || !Array.isArray(items) || items.length === 0)) {
          return sendErrorResponse(res, 400, 'At least one sparepart item is required for sparepart type');
        }
        
        // Validate sparepart items (skip validation for drafts)
        if (!isDraft && items && items.length > 0) {
          for (const item of items) {
          if (!item.sparepartName || !item.sparepartName.trim()) {
            return sendErrorResponse(res, 400, 'Each sparepart item must have a name');
          }
          if (!item.quantity || item.quantity < 1) {
            return sendErrorResponse(res, 400, 'Each sparepart item must have a quantity of at least 1');
          }
          if (item.pricePerUnit === undefined || item.pricePerUnit === null || 
              isNaN(parseFloat(item.pricePerUnit)) || parseFloat(item.pricePerUnit) < 0) {
            return sendErrorResponse(res, 400, 'Each sparepart item must have a price per unit >= 0');
          }
          // Calculate estimated revenue: quantity * price per unit
          item.estimatedRevenue = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
          }
        }
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
      customerContacts: req.body.customerContacts || [],
      endUser: endUser || '',
      priority: priority || 'medium',
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      targetCloseDate: parsedTargetCloseDate,
      confidenceRate: parseInt(confidenceRate) || (isDraft ? 50 : 0),
      deliveryLocation: deliveryLocation.trim(),
      competitor: competitor.trim(),
      canMake: Boolean(canMake),
      projectOngoing: Boolean(projectOngoing),
      deliveryTerms: normalizedDeliveryTerms,
      deliveryNotes: normalizedDeliveryNotes,
      paymentTerms: normalizedPaymentTerms,
      inclusionNotes: normalizedInclusionNotes,
      exclusionNotes: normalizedExclusionNotes,
      isTaxIncluded: normalizedIsTaxIncluded,
      includePPN: normalizedIncludePPN,
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
    
    // Get submit flag (isDraft already declared above)
    const submitToEngineering = req.body.submitToEngineering === true;
    
    const rfq = await createRFQ(rfqData);
    
    // Create RFQ items for all types
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Base item data
        const itemData = {
          itemNumber: i + 1,
          quantity: parseInt(item.quantity),
          estimatedRevenue: parseFloat(item.estimatedRevenue) || 0,
          notes: item.notes || ''
        };
        
        // Type-specific fields
        if (lineOfBusinessType === 'karoseri') {
          // Determine templateSourceModel based on templateMode
          let templateSourceModel = null;
          if (item.templateMode === 'bodyType') {
            templateSourceModel = 'BodyType';
          } else if (item.templateMode === 'drawing') {
            templateSourceModel = 'DrawingSpecification';
          }
          
          itemData.karoseri = item.karoseri || '';
          itemData.chassis = item.chassis || '';
          itemData.chassisModel = item.chassisModel || '';
          itemData.drawingSpecification = item.drawingSpecification || undefined;
          itemData.templateMode = item.templateMode || 'manual';
          itemData.templateSourceModel = templateSourceModel;
          itemData.templateSourceId = item.templateSourceId || undefined;
          itemData.specifications = item.specifications || [];
        } else if (lineOfBusinessType === 'service') {
          itemData.serviceName = item.serviceName || '';
          itemData.serviceDetails = Array.isArray(item.serviceDetails) ? item.serviceDetails.filter(d => d && d.trim()) : [];
        } else if (lineOfBusinessType === 'sparepart') {
          itemData.sparepartName = item.sparepartName || '';
          itemData.pricePerUnit = parseFloat(item.pricePerUnit) || 0;
        }
        
        await createRFQItem(rfq._id, itemData);
      }
    }
    
    // If submit (not draft) and engineeringId is provided, automatically submit to engineering with in_progress status
    if (!isDraft && engineeringId) {
      // Populate items first
      await rfq.populate('items');
      
      // Submit to engineering immediately
      const engineer = await User.findById(engineeringId);
      if (engineer) {
        // Prepare specsOriginal for engineering review
        let specsOriginal = [];
        if (lineOfBusinessType === 'karoseri') {
          specsOriginal = (rfq.items || []).map(item => ({
            itemNumber: item.itemNumber,
            karoseri: item.karoseri,
            chassis: item.chassis,
            chassisModel: item.chassisModel || '',
            notes: item.notes || '',
            specifications: item.specifications || []
          }));
        } else if (lineOfBusinessType === 'service') {
          specsOriginal = (rfq.items || []).map(item => ({
            itemNumber: item.itemNumber,
            serviceName: item.serviceName || '',
            serviceDetails: item.serviceDetails || [],
            estimatedRevenue: item.estimatedRevenue || 0,
            quantity: item.quantity || 1,
            notes: item.notes || ''
          }));
        } else if (lineOfBusinessType === 'sparepart') {
          specsOriginal = (rfq.items || []).map(item => ({
            itemNumber: item.itemNumber,
            sparepartName: item.sparepartName || '',
            quantity: item.quantity || 1,
            pricePerUnit: item.pricePerUnit || 0,
            estimatedRevenue: item.estimatedRevenue || 0,
            notes: item.notes || ''
          }));
        }
        
        // Update RFQ to engineering stage
        rfq.stage = 'engineering';
        rfq.status = 'pending';
        rfq.engineeringTransit = {
          assignedTo: engineeringId,
          assignedAt: new Date(),
          specsOriginal: specsOriginal,
          specsModified: [],
          canDo: null,
          comments: '',
          status: 'in_progress'
        };
        
        // Add timeline entry
        rfq.timeline.push({
          stage: 'engineering',
          action: 'submitted_to_engineering',
          user: requesterId,
          timestamp: new Date(),
          notes: `RFQ submitted to engineering for review`
        });
        
        await rfq.save();
        
        // Send notification to engineer
        try {
          await addNotification({
            userId: engineeringId,
            title: 'New RFQ Assigned',
            description: `A new RFQ ${rfq.rfqNumber} has been assigned to you for engineering review.`,
            path: '/quotations'
          });
        } catch (notifError) {
          console.error('Failed to send notification:', notifError);
        }
        
        // Send email notifications: requester (created) + engineer
        try {
          const requesterUser = await User.findById(requesterId).select('email fullName');
          const engineerUser = await User.findById(engineeringId).select('email fullName');
          
          // Email to requester (RFQ created)
          if (requesterUser?.email) {
            sendRFQNotificationEmail(
              requesterUser.email,
              rfq.rfqNumber,
              `Your RFQ for ${rfq.customerName} has been created and submitted to engineering for review.`,
              requesterUser.fullName || requesterUser.email
            );
          }
          
          // Email to engineer
          if (engineerUser?.email) {
            sendRFQNotificationEmail(
              engineerUser.email,
              rfq.rfqNumber,
              `A new RFQ for ${rfq.customerName} has been assigned to you for engineering review. Please log in to review and provide feedback.`,
              engineerUser.fullName || engineerUser.email
            );
          }
        } catch (emailError) {
          console.error('Failed to send RFQ creation emails:', emailError);
        }
      }
    } else {
      // Draft: Send email to requester that RFQ has been created
      if (isDraft) {
        try {
          const requesterUser = await User.findById(requesterId).select('email fullName');
          if (requesterUser?.email) {
          sendRFQNotificationEmail(
              requesterUser.email,
            rfq.rfqNumber,
              `Your RFQ for ${customerName} has been created and saved as draft.`,
              requesterUser.fullName || requesterUser.email
          );
        }
        } catch (emailError) {
          console.error('Failed to send draft creation email:', emailError);
      }
      }
      // If not draft and no engineeringId: No email (will go to approver later via submit-to-engineering)
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
    // All types now use items[] structure
    let specsOriginal = [];
    if (rfq.lineOfBusiness?.type === 'karoseri') {
      // For karoseri, snapshot only the fields visible in diff checker
      specsOriginal = (rfq.items || []).map(item => ({
        itemNumber: item.itemNumber,
        karoseri: item.karoseri,
        chassis: item.chassis,
        chassisModel: item.chassisModel || '',
        notes: item.notes || '',
        specifications: item.specifications || []
      }));
    } else if (rfq.lineOfBusiness?.type === 'service') {
      // For service, snapshot service fields
      specsOriginal = (rfq.items || []).map(item => ({
        itemNumber: item.itemNumber,
        serviceName: item.serviceName || '',
        serviceDetails: item.serviceDetails || [],
        estimatedRevenue: item.estimatedRevenue || 0,
        quantity: item.quantity || 1,
        notes: item.notes || ''
      }));
    } else if (rfq.lineOfBusiness?.type === 'sparepart') {
      // For sparepart, snapshot sparepart fields
      specsOriginal = (rfq.items || []).map(item => ({
        itemNumber: item.itemNumber,
        sparepartName: item.sparepartName || '',
        quantity: item.quantity || 1,
        pricePerUnit: item.pricePerUnit || 0,
        estimatedRevenue: item.estimatedRevenue || 0,
        notes: item.notes || ''
      }));
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
    
    // No emails sent here - emails are sent at creation time
    // This endpoint is only for moving from draft to engineering
    
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
    
    try {
      const approverUser = await User.findById(rfq.approverId).select('email fullName');
      if (approverUser?.email) {
        sendRFQNotificationEmail(
          approverUser.email,
          rfq.rfqNumber,
          `Engineering has finished reviewing RFQ ${rfq.rfqNumber}. Please review the decision and proceed with approval or rejection.`,
          approverUser.fullName || approverUser.email
        );
      }
    } catch (emailError) {
      console.error('Failed to send engineering review email:', emailError);
    }
    
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
    
    // Send email notification to quotation creator only
    try {
    const quotationCreator = await User.findById(rfq.quotationCreatorId._id).select('email fullName');
    if (quotationCreator && quotationCreator.email) {
      sendRFQNotificationEmail(
        quotationCreator.email,
        rfq.rfqNumber,
        `RFQ has been approved. You can now create the quotation for this request.`,
        quotationCreator.fullName || quotationCreator.email
      );
      }
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
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
// Only counts RFQs that have completed engineering review and are ready for approval
router.get('/pending-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Count RFQs that:
    // 1. Are assigned to current user as approver
    // 2. Are in 'approver' stage (engineering review completed)
    // 3. Have 'pending' status (not yet approved/rejected)
    // 4. Have engineering review completed (engineeringTransit.status === 'reviewed')
    const count = await RFQ.countDocuments({
      approverId: userId,
      stage: 'approver',
      status: 'pending',
      'engineeringTransit.status': 'reviewed'
    });
    
    return sendSuccessResponse(res, 200, 'Pending count retrieved', { count });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to fetch pending count', e.message);
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
    const hasAllAccess = hasAllQuotationAccess(user);
    const canApprove = hasPermission(user, 'approve_rfq');
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    
    const hasAccess = hasAllAccess || (
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

router.get('/by-quotation/:quotationNumber', authenticateToken, async (req, res) => {
  try {
    const { quotationNumber } = req.params;
    const userId = req.user.userId;

    const quotationHeader = await QuotationHeader.findOne({ quotationNumber });
    if (!quotationHeader) {
      return sendErrorResponse(res, 404, 'Quotation not found');
    }

    let rfq = null;
    if (quotationHeader.rfqId) {
      rfq = await RFQ.findById(quotationHeader.rfqId);
    }

    if (!rfq) {
      rfq = await RFQ.findOne({ quotationId: quotationHeader._id });
    }

    if (!rfq) {
      return sendErrorResponse(res, 404, 'RFQ associated with this quotation not found');
    }

    const user = await User.findById(userId).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const hasAllAccess = hasAllQuotationAccess(user);
    const canApprove = hasPermission(user, 'approve_rfq');
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    const canRequestQuotation = hasPermission(user, 'quotation_requester');

    const hasAccess = hasAllAccess ||
      rfq.requesterId.toString() === userId.toString() ||
      (canApprove && rfq.approverId && rfq.approverId.toString() === userId.toString()) ||
      (canCreateQuotation && rfq.quotationCreatorId && rfq.quotationCreatorId.toString() === userId.toString());

    if (!hasAccess) {
      return sendErrorResponse(res, 403, 'Access denied');
    }

    const rfqDetails = await getRFQById(rfq._id);
    return sendSuccessResponse(res, 200, 'RFQ retrieved', { rfq: rfqDetails });
  } catch (error) {
    console.error('Error fetching RFQ by quotation:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch RFQ', error.message);
  }
});

// GET /api/rfq/:id - get single RFQ by ID (must be last to avoid conflicts with specific routes)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    // Check if user has access to this RFQ
    const user = await User.findById(userId).populate('permissions');
    const hasAllAccess = hasAllQuotationAccess(user);
    const canApprove = hasPermission(user, 'approve_rfq');
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    const canRequestQuotation = hasPermission(user, 'quotation_requester');
    
    const rfq = await getRFQById(id);
    
    const hasAccess = hasAllAccess || (
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

    // Validate folder ownership if folderId is provided
    if (folderId) {
      const user = await User.findById(userId);
      if (!user) {
        return sendErrorResponse(res, 404, 'User not found');
      }
      
      const folder = user.rfqFolders.id(folderId);
      if (!folder) {
        return sendErrorResponse(res, 403, 'Folder not found or you do not have permission to use this folder');
      }
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

    // Validate folder ownership if folderId is provided
    if (folderId) {
      const user = await User.findById(userId);
      if (!user) {
        return sendErrorResponse(res, 404, 'User not found');
      }
      
      const folder = user.rfqFolders.id(folderId);
      if (!folder) {
        return sendErrorResponse(res, 403, 'Folder not found or you do not have permission to use this folder');
      }
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
      'description', 'customerName', 'contactPerson', 'customerContacts', 'endUser', 'priority', 'expectedDeliveryDate',
      'confidenceRate', 'deliveryLocation', 'competitor', 'canMake', 'projectOngoing',
      'lineOfBusiness', 'service', 'sparepart', 'approverId', 'quotationCreatorId', 'engineeringId',
      'deliveryTerms', 'deliveryNotes', 'targetCloseDate', 'paymentTerms', 'inclusionNotes', 'exclusionNotes',
      'isTaxIncluded', 'includePPN'
    ];
    const rfq = await RFQ.findById(id);
    if (!rfq) return sendErrorResponse(res, 404, 'RFQ not found');
    const user = await User.findById(userId).populate('permissions');
    const hasAllAccess = hasAllQuotationAccess(user);
    const canCreateQuotation = hasPermission(user, 'quotation_create');
    const isRequester = rfq.requesterId && rfq.requesterId.toString() === userId.toString();
    const isQuotationCreator = rfq.quotationCreatorId && rfq.quotationCreatorId.toString() === userId.toString();

    if (!hasAllAccess && !isRequester && !isQuotationCreator && !canCreateQuotation) {
      return sendErrorResponse(res, 403, 'Not authorized to edit this RFQ');
    }

    if (rfq.stage !== 'sales' && rfq.stage !== 'quotation') {
      return sendErrorResponse(res, 400, 'Can only edit RFQ in sales or quotation stage');
    }
    const original = rfq.toObject();
    const incomingItems = Array.isArray(req.body.items) ? req.body.items : null;
    if (incomingItems) {
      delete req.body.items;
    }

    const existingItems = await RFQItem.find({ rfqId: id }).sort({ itemNumber: 1 });

    const normalizeItem = (item, index) => {
      const templateMode = item.templateMode || 'manual';
      const bodyTypeId = item.bodyTypeId?._id || item.bodyTypeId || null;
      const chassisTypeId = item.chassisTypeId?._id || item.chassisTypeId || null;
      const rawTemplateSourceId = item.templateSourceId?._id || item.templateSourceId || null;
      let templateSourceId = rawTemplateSourceId;
      if (!templateSourceId && templateMode === 'bodyType') {
        templateSourceId = bodyTypeId;
      }
      return {
        itemNumber: index + 1,
        templateMode,
        templateSourceModel: templateMode === 'bodyType' ? 'BodyType' : templateMode === 'drawing' ? 'DrawingSpecification' : null,
        templateSourceId: templateSourceId ? templateSourceId.toString() : null,
        quantity: Number(item.quantity) || 1,
        estimatedRevenue: Number(item.estimatedRevenue) || 0,
        karoseri: item.karoseri || '',
        chassis: item.chassis || '',
        chassisModel: item.chassisModel || '',
        bodyTypeId: bodyTypeId ? bodyTypeId.toString() : null,
        chassisTypeId: chassisTypeId ? chassisTypeId.toString() : null,
        specifications: Array.isArray(item.specifications) ? item.specifications : [],
        serviceName: item.serviceName || '',
        serviceDetails: Array.isArray(item.serviceDetails) ? item.serviceDetails : [],
        sparepartName: item.sparepartName || '',
        pricePerUnit: Number(item.pricePerUnit) || 0,
        notes: item.notes || ''
      };
    };

    const existingNormalized = existingItems.map((item, index) => normalizeItem(item, index));

    // Only update allowed fields
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        rfq[field] = req.body[field];
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'isTaxIncluded') || Object.prototype.hasOwnProperty.call(req.body, 'includePPN')) {
      const { isTaxIncluded: normalizedIsTaxIncluded, includePPN: normalizedIncludePPN } = normalizeTaxFlags(
        toBoolean(req.body.isTaxIncluded, rfq.isTaxIncluded),
        toBoolean(req.body.includePPN, rfq.includePPN)
      );
      rfq.isTaxIncluded = normalizedIsTaxIncluded;
      rfq.includePPN = normalizedIncludePPN;
    }

    let itemsChanged = false;
    if (incomingItems) {
      const incomingNormalized = incomingItems.map((item, index) => normalizeItem(item, index));
      itemsChanged = !isDeepEqual(existingNormalized, incomingNormalized);

      const existingMap = new Map(existingItems.map(item => [item._id.toString(), item]));
      const processedExistingIds = new Set();

      for (let index = 0; index < incomingItems.length; index++) {
        const incoming = incomingItems[index];
        const templateMode = incoming.templateMode || 'manual';
        let templateSourceId = incoming.templateSourceId || null;
        let templateSourceModel = null;

        if (templateMode === 'bodyType') {
          templateSourceModel = 'BodyType';
          templateSourceId = templateSourceId || incoming.bodyTypeId || null;
        } else if (templateMode === 'drawing') {
          templateSourceModel = 'DrawingSpecification';
        } else {
          templateSourceId = null;
        }

        const cleaned = {
          itemNumber: index + 1,
          rfqId: id,
          quantity: Number(incoming.quantity) || 1,
          estimatedRevenue: Number(incoming.estimatedRevenue) || 0,
          karoseri: incoming.karoseri || '',
          chassis: incoming.chassis || '',
          chassisModel: incoming.chassisModel || '',
          specifications: Array.isArray(incoming.specifications) ? incoming.specifications : [],
          serviceName: incoming.serviceName || '',
          serviceDetails: Array.isArray(incoming.serviceDetails) ? incoming.serviceDetails : [],
          sparepartName: incoming.sparepartName || '',
          pricePerUnit: Number(incoming.pricePerUnit) || 0,
          notes: incoming.notes || '',
          templateMode,
          templateSourceId: templateSourceId || null,
          templateSourceModel,
          bodyTypeId: incoming.bodyTypeId || null,
          chassisTypeId: incoming.chassisTypeId || null,
          drawingSpecification: incoming.drawingSpecification || null
        };

        if (cleaned.bodyTypeId === '') cleaned.bodyTypeId = null;
        if (cleaned.chassisTypeId === '') cleaned.chassisTypeId = null;
        if (cleaned.templateSourceId === '') cleaned.templateSourceId = null;

        if (incoming._id && existingMap.has(incoming._id.toString())) {
          await RFQItem.findByIdAndUpdate(
            incoming._id,
            cleaned,
            { new: true, runValidators: true }
          );
          processedExistingIds.add(incoming._id.toString());
        } else {
          await RFQItem.create(cleaned);
        }
      }

      const idsToDelete = existingItems
        .filter(item => !processedExistingIds.has(item._id.toString()))
        .map(item => item._id);

      if (idsToDelete.length > 0) {
        await RFQItem.deleteMany({ _id: { $in: idsToDelete } });
      }
    }

    const updatedSnapshot = rfq.toObject();
    const changedFields = allowedFields.filter((field) => {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) {
        return false;
      }
      return !isDeepEqual(original[field], updatedSnapshot[field]);
    });

    if (itemsChanged) {
      changedFields.push('items');
    }

    if (changedFields.length > 0) {
      const snapshot = changedFields.map((field) => {
        if (field === 'items') {
          return 'items updated';
        }
        const before = summarizeValue(original[field]);
        const after = summarizeValue(updatedSnapshot[field]);
        return `${field}: ${before} -> ${after}`;
      }).join('; ');

      rfq.timeline.push({
        stage: rfq.stage,
        action: 'updated',
        user: userId,
        timestamp: new Date(),
        notes: `Updated fields: ${snapshot}`
      });
    }

    await rfq.save();
    if (incomingItems) {
      await rfq.populate('items');
    }
    return sendSuccessResponse(res, 200, 'RFQ updated', { rfq });
  } catch (e) {
    return sendErrorResponse(res, 500, 'Failed to update RFQ', e.message);
  }
});

// POST /api/rfq/upload-seed - upload CSV and seed RFQ data
/**
 * POST /api/rfq/upload-seed
 * Permission: quotation_requester
 * Description: Upload CSV file and seed RFQ data into MongoDB
 */
router.post('/upload-seed', authenticateToken, authorize(['quotation_requester']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return sendErrorResponse(res, 400, 'CSV file is required');
    }

    const userId = req.user.userId;
    const placeholderUserId = new mongoose.Types.ObjectId('000000000000000000000000');
    
    // Statistics
    const stats = {
      totalRows: 0,
      processed: 0,
      errors: [],
      newBodyTypes: 0,
      newChassisTypes: 0,
      rfqsCreated: 0,
      foldersCreated: 0
    };

    // Parse CSV
    const rows = [];
    const stream = Readable.from(req.file.buffer.toString());
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => {
          stats.totalRows++;
          rows.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Get user with folders
    const user = await User.findById(userId);
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    // Cache for BodyTypes and ChassisTypes to avoid duplicate queries/creates
    const bodyTypeCache = new Map();
    const chassisTypeCache = new Map();

    // Process each row
    for (const row of rows) {
      try {
        // Extract CSV columns (case-insensitive matching)
        const getColumn = (possibleNames) => {
          const lowerKeys = Object.keys(row).reduce((acc, key) => {
            acc[key.toLowerCase()] = row[key];
            return acc;
          }, {});
          
          for (const name of possibleNames) {
            const lowerName = name.toLowerCase();
            if (lowerKeys[lowerName]) {
              return lowerKeys[lowerName].trim();
            }
          }
          return '';
        };

        const cutoffDate = getColumn(['Cutoff Date', 'cutoff date', 'CutoffDate']);
        const category = getColumn(['Category', 'category']);
        const lineOfBusiness = getColumn(['Line of Business', 'line of business', 'LineOfBusiness']);
        const productType = getColumn(['Product Type', 'product type', 'ProductType']);
        const opportunityDescription = getColumn(['Opportunity Description', 'opportunity description', 'OpportunityDescription']);
        const customer = getColumn(['Customer', 'customer']) || '-';
        const chassis = getColumn(['Chassis', 'chassis']);
        const probability = getColumn(['Probability', 'probability']);
        const location = getColumn(['Location', 'location']) || '-';
        const totalEstRevenue = getColumn(['Total Est Revenue', 'total est revenue', 'TotalEstRevenue']);
        const endUser = getColumn(['End User', 'end user', 'EndUser']);

        // Validate required fields (only Line of Business is truly required now)
        if (!lineOfBusiness) {
          stats.errors.push(`Row ${stats.processed + 1}: Missing required field (Line of Business)`);
          continue;
        }

        // Normalize line of business
        const lobType = lineOfBusiness.toLowerCase().trim();
        let normalizedLob = 'karoseri';
        if (lobType.includes('service')) {
          normalizedLob = 'service';
        } else if (lobType.includes('sparepart') || lobType.includes('spare part')) {
          normalizedLob = 'sparepart';
        }

        // Handle folder (Category)
        let folderId = null;
        if (category) {
          const folderName = category.trim();
          // Check if folder exists for this user
          let folder = user.rfqFolders.find(f => f.name === folderName);
          
          if (!folder) {
            // Check if user has < 5 folders
            if (user.rfqFolders.length < 5) {
              // Create new folder
              user.rfqFolders.push({
                name: folderName,
                color: '#3B82F6'
              });
              await user.save();
              folder = user.rfqFolders[user.rfqFolders.length - 1];
              stats.foldersCreated++;
            } else {
              // Use "Miscellaneous" folder or create it
              folder = user.rfqFolders.find(f => f.name === 'Miscellaneous');
              if (!folder) {
                user.rfqFolders.push({
                  name: 'Miscellaneous',
                  color: '#6B7280'
                });
                await user.save();
                folder = user.rfqFolders[user.rfqFolders.length - 1];
                stats.foldersCreated++;
              }
            }
          }
          folderId = folder._id;
        }

        // Handle BodyType (Product Type)
        let bodyTypeId = null;
        if (productType && normalizedLob === 'karoseri') {
          // Normalize to title case to match model's pre-save middleware
          const bodyTypeName = toTitleCase(productType.trim());
          
          // Check cache first
          if (bodyTypeCache.has(bodyTypeName)) {
            bodyTypeId = bodyTypeCache.get(bodyTypeName);
          } else {
            let bodyType = await BodyType.findOne({ name: bodyTypeName });
            
            if (!bodyType) {
              try {
                // Create new BodyType with tmp- prefix for shortName
                // Generate unique shortName by checking existing ones
                const baseShortName = autoShorten(bodyTypeName);
                let shortName = `tmp-${baseShortName}`;
                
                // Check if shortName already exists, if so, append number
                let existingShortName = await BodyType.findOne({ shortName: shortName });
                if (existingShortName) {
                  let counter = 1;
                  while (existingShortName) {
                    shortName = `tmp-${baseShortName}${counter}`;
                    existingShortName = await BodyType.findOne({ shortName: shortName });
                    counter++;
                    // Safety limit to prevent infinite loop
                    if (counter > 100) {
                      // Fallback: use timestamp
                      shortName = `tmp-${baseShortName}-${Date.now().toString().slice(-4)}`;
                      break;
                    }
                  }
                }
                
                bodyType = new BodyType({
                  name: bodyTypeName,
                  shortName: shortName,
                  createdBy: userId,
                  lastModifiedBy: userId
                });
                await bodyType.save();
                stats.newBodyTypes++;
              } catch (createError) {
                // Handle duplicate key error (could be name or shortName)
                if (createError.code === 11000) {
                  // Check if it's a duplicate name (already exists)
                  bodyType = await BodyType.findOne({ name: bodyTypeName });
                  if (bodyType) {
                    // BodyType with this name already exists, use it
                  } else {
                    // It's a duplicate shortName, try to find or create with unique shortName
                    // This shouldn't happen with our check above, but handle it just in case
                    const baseShortName = autoShorten(bodyTypeName);
                    let shortName = `tmp-${baseShortName}`;
                    let counter = 1;
                    let existingShortName = await BodyType.findOne({ shortName: shortName });
                    while (existingShortName && counter < 100) {
                      shortName = `tmp-${baseShortName}${counter}`;
                      existingShortName = await BodyType.findOne({ shortName: shortName });
                      counter++;
                    }
                    if (counter >= 100) {
                      shortName = `tmp-${baseShortName}-${Date.now().toString().slice(-4)}`;
                    }
                    
                    // Try creating again with unique shortName
                    bodyType = new BodyType({
                      name: bodyTypeName,
                      shortName: shortName,
                      createdBy: userId,
                      lastModifiedBy: userId
                    });
                    await bodyType.save();
                    stats.newBodyTypes++;
                  }
                } else {
                  throw createError;
                }
              }
            }
            bodyTypeId = bodyType._id;
            // Cache it
            bodyTypeCache.set(bodyTypeName, bodyTypeId);
          }
        }

        // Handle ChassisType (from Chassis)
        let chassisTypeId = null;
        let chassisModel = '';
        if (chassis && normalizedLob === 'karoseri') {
          const { type, model } = extractChassisType(chassis);
          chassisModel = model;
          
          if (type) {
            // Normalize to title case to match model's pre-save middleware
            const normalizedType = toTitleCase(type);
            
            // Check cache first
            if (chassisTypeCache.has(normalizedType)) {
              chassisTypeId = chassisTypeCache.get(normalizedType);
            } else {
              let chassisType = await ChassisType.findOne({ name: normalizedType });
              
              if (!chassisType) {
                try {
                  // Create new ChassisType
                  const shortName = generateChassisShortName(normalizedType);
                  chassisType = new ChassisType({
                    name: normalizedType,
                    shortName: shortName,
                    createdBy: userId,
                    lastModifiedBy: userId
                  });
                  await chassisType.save();
                  stats.newChassisTypes++;
                } catch (createError) {
                  // Handle duplicate key error (race condition - another row created it)
                  if (createError.code === 11000) {
                    // Try to find it again
                    chassisType = await ChassisType.findOne({ name: normalizedType });
                    if (!chassisType) {
                      throw createError; // Re-throw if still not found
                    }
                  } else {
                    throw createError;
                  }
                }
              }
              chassisTypeId = chassisType._id;
              // Cache it
              chassisTypeCache.set(normalizedType, chassisTypeId);
            }
          }
        }

        // Parse date
        let expectedDeliveryDate = null;
        if (cutoffDate) {
          const parsedDate = new Date(cutoffDate);
          if (!isNaN(parsedDate.getTime())) {
            expectedDeliveryDate = parsedDate;
          }
        }

        // Parse probability (confidence rate)
        let confidenceRate = 50; // default
        if (probability) {
          const parsed = parseFloat(probability);
          if (!isNaN(parsed)) {
            confidenceRate = Math.max(0, Math.min(100, Math.round(parsed)));
          }
        }

        // Parse estimated revenue
        let estimatedRevenue = 0;
        if (totalEstRevenue) {
          const parsed = parseFloat(totalEstRevenue.toString().replace(/[^0-9.-]/g, ''));
          if (!isNaN(parsed)) {
            estimatedRevenue = Math.max(0, parsed);
          }
        }

        // Generate RFQ number (ensure uniqueness by using timestamp + microseconds + row index)
        const timestamp = Date.now();
        const rowIndex = stats.processed;
        const microsecondOffset = Math.floor(Math.random() * 1000); // Add randomness to avoid collisions
        const rfqNumber = `HIST-${timestamp}${microsecondOffset}-${rowIndex}`;

        // Create RFQ
        const rfqData = {
          rfqNumber,
          folderId,
          requesterId: userId,
          approverId: placeholderUserId,
          quotationCreatorId: placeholderUserId,
          description: opportunityDescription || '',
          customerName: customer,
          contactPerson: {
            name: '-',
            gender: 'Male'
          },
          customerContacts: [{ key: 'Phone', value: '-' }],
          endUser: endUser || '',
          confidenceRate,
          deliveryLocation: location || '-',
          competitor: '-', // Default since not in CSV
          canMake: false,
          projectOngoing: false,
          bodyTypeId: normalizedLob === 'karoseri' ? bodyTypeId : null,
          chassisTypeId: normalizedLob === 'karoseri' ? chassisTypeId : null,
          expectedDeliveryDate,
          lineOfBusiness: {
            type: normalizedLob
          },
          stage: 'sales',
          status: 'pending',
          timeline: [{
            stage: 'sales',
            action: 'created',
            user: userId,
            timestamp: new Date(),
            notes: 'RFQ created from CSV seed'
          }]
        };

        const rfq = await createRFQ(rfqData);
        stats.rfqsCreated++;

        // Create RFQ Item
        const itemData = {
          itemNumber: 1,
          quantity: 1,
          estimatedRevenue,
          templateMode: bodyTypeId ? 'bodyType' : 'manual', // Set to 'bodyType' if bodyTypeId exists
          notes: ''
        };

        if (normalizedLob === 'karoseri') {
          // Use normalized product type (title case) for consistency
          itemData.karoseri = productType ? toTitleCase(productType.trim()) : '';
          // Use normalized chassis type (title case) for consistency
          const chassisTypeName = chassis ? toTitleCase(extractChassisType(chassis).type) : '';
          itemData.chassis = chassisTypeName;
          itemData.chassisModel = chassisModel;
          // Map bodyTypeId and chassisTypeId to item
          itemData.templateSourceId = bodyTypeId || undefined;
          itemData.templateSourceModel = bodyTypeId ? 'BodyType' : null;
          // Note: bodyTypeId and chassisTypeId are also stored at RFQ level (lines 1767-1768)
        } else if (normalizedLob === 'service') {
          itemData.serviceName = opportunityDescription || productType || 'Service';
          itemData.serviceDetails = [];
        } else if (normalizedLob === 'sparepart') {
          itemData.sparepartName = productType || 'Sparepart';
          itemData.pricePerUnit = estimatedRevenue; // Use estimated revenue as price per unit
        }

        await createRFQItem(rfq._id, itemData);
        stats.processed++;

      } catch (rowError) {
        stats.errors.push(`Row ${stats.processed + 1}: ${rowError.message}`);
        console.error(`Error processing row ${stats.processed + 1}:`, rowError);
      }
    }

    return sendSuccessResponse(res, 200, 'CSV processed successfully', {
      summary: {
        totalRows: stats.totalRows,
        processed: stats.processed,
        errors: stats.errors.length,
        rfqsCreated: stats.rfqsCreated,
        newBodyTypes: stats.newBodyTypes,
        newChassisTypes: stats.newChassisTypes,
        foldersCreated: stats.foldersCreated
      },
      errors: stats.errors.slice(0, 10) // Limit errors to first 10
    });

  } catch (error) {
    console.error('Error processing CSV upload:', error);
    return sendErrorResponse(res, 500, 'Failed to process CSV file', error.message);
  }
});

module.exports = router;
