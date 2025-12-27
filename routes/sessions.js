const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const Session = require('../models/session.model');
const { sendSuccessResponse, sendErrorResponse, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');

// ============================================================================
// SESSION MANAGEMENT ROUTES
// ============================================================================

/**
 * POST /api/sessions
 * Generate a new catalogue session token
 * Required Permission: placeholder_test (or appropriate permission)
 */
router.post('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { expiresInHours, expiresAt, notes } = req.body;

    // Calculate expiration date
    let expirationDate;
    if (expiresAt) {
      expirationDate = new Date(expiresAt);
      if (isNaN(expirationDate.getTime())) {
        return sendErrorResponse(res, 400, 'Invalid expiresAt date format');
      }
      if (expirationDate <= new Date()) {
        return sendErrorResponse(res, 400, 'Expiration date must be in the future');
      }
    } else if (expiresInHours) {
      const hours = parseFloat(expiresInHours);
      if (isNaN(hours) || hours <= 0) {
        return sendErrorResponse(res, 400, 'expiresInHours must be a positive number');
      }
      expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + hours);
    } else {
      // Default to 24 hours if not specified
      expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + 24);
    }

    // Generate unique hex token (32 characters)
    let token;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      token = crypto.randomBytes(16).toString('hex');
      const existing = await Session.findOne({ token });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return sendErrorResponse(res, 500, 'Failed to generate unique token. Please try again.');
    }

    // Create session
    const session = new Session({
      token,
      expiresAt: expirationDate,
      createdBy: req.user.userId,
      notes: notes || '',
      isActive: true
    });

    await session.save();

    // Populate createdBy for response
    await session.populate('createdBy', 'fullName email');

    // Generate catalogue URL with session token
    const catalogueUrl = process.env.CATALOGUE_URL || '';
    const catalogueLink = catalogueUrl 
      ? `${catalogueUrl}${catalogueUrl.endsWith('/') ? '' : '/'}?session=${session.token}`
      : null;

    return sendSuccessResponse(res, 201, 'Session created successfully', {
      _id: session._id,
      token: session.token,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      notes: session.notes,
      createdBy: session.createdBy,
      catalogueLink
    });
  } catch (err) {
    console.error('Error creating session:', err);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, err.message);
  }
});

/**
 * GET /api/sessions
 * List all sessions with pagination and filtering
 * Required Permission: placeholder_test
 */
router.get('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { page = 1, limit = 20, isActive, expired } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return sendErrorResponse(res, 400, 'Page must be a positive integer');
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return sendErrorResponse(res, 400, 'Limit must be between 1 and 100');
    }

    // Build query
    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (expired === 'true') {
      query.expiresAt = { $lt: new Date() };
    } else if (expired === 'false') {
      query.expiresAt = { $gte: new Date() };
    }

    // Get total count
    const total = await Session.countDocuments(query);

    // Get sessions
    const sessions = await Session.find(query)
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    // Generate catalogue URL base
    const catalogueUrl = process.env.CATALOGUE_URL || '';

    // Add computed fields
    const sessionsWithStatus = sessions.map(session => {
      const now = new Date();
      const isExpired = session.expiresAt < now;
      const isValid = session.isActive && !isExpired;
      const catalogueLink = catalogueUrl 
        ? `${catalogueUrl}${catalogueUrl.endsWith('/') ? '' : '/'}?session=${session.token}`
        : null;

      return {
        ...session,
        isExpired,
        isValid,
        status: isValid ? 'Active' : (isExpired ? 'Expired' : 'Inactive'),
        catalogueLink
      };
    });

    const pagination = {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    };

    return sendSuccessResponse(res, 200, 'Sessions retrieved successfully', sessionsWithStatus, pagination);
  } catch (err) {
    console.error('Error listing sessions:', err);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, err.message);
  }
});

/**
 * GET /api/sessions/:id
 * Get specific session by ID
 * Required Permission: placeholder_test
 */
router.get('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate('createdBy', 'fullName email')
      .lean();

    if (!session) {
      return sendErrorResponse(res, 404, 'Session not found');
    }

    const now = new Date();
    const isExpired = session.expiresAt < now;
    const isValid = session.isActive && !isExpired;
    
    // Generate catalogue URL with session token
    const catalogueUrl = process.env.CATALOGUE_URL || '';
    const catalogueLink = catalogueUrl 
      ? `${catalogueUrl}${catalogueUrl.endsWith('/') ? '' : '/'}?session=${session.token}`
      : null;

    return sendSuccessResponse(res, 200, 'Session retrieved successfully', {
      ...session,
      isExpired,
      isValid,
      status: isValid ? 'Active' : (isExpired ? 'Expired' : 'Inactive'),
      catalogueLink
    });
  } catch (err) {
    console.error('Error getting session:', err);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, err.message);
  }
});

/**
 * PATCH /api/sessions/:id
 * Update session (extend expiration, update notes, etc.)
 * Required Permission: placeholder_test
 */
router.patch('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { expiresAt, expiresInHours, isActive, notes } = req.body;

    const session = await Session.findById(req.params.id);

    if (!session) {
      return sendErrorResponse(res, 404, 'Session not found');
    }

    // Update expiration
    if (expiresAt !== undefined) {
      const newExpiration = new Date(expiresAt);
      if (isNaN(newExpiration.getTime())) {
        return sendErrorResponse(res, 400, 'Invalid expiresAt date format');
      }
      if (newExpiration <= new Date()) {
        return sendErrorResponse(res, 400, 'Expiration date must be in the future');
      }
      session.expiresAt = newExpiration;
    } else if (expiresInHours !== undefined) {
      const hours = parseFloat(expiresInHours);
      if (isNaN(hours) || hours <= 0) {
        return sendErrorResponse(res, 400, 'expiresInHours must be a positive number');
      }
      session.expiresAt = new Date();
      session.expiresAt.setHours(session.expiresAt.getHours() + hours);
    }

    // Update active status
    if (isActive !== undefined) {
      session.isActive = isActive === true;
    }

    // Update notes
    if (notes !== undefined) {
      session.notes = notes.trim();
    }

    await session.save();
    await session.populate('createdBy', 'fullName email');

    const now = new Date();
    const isExpired = session.expiresAt < now;
    const isValid = session.isActive && !isExpired;
    
    // Generate catalogue URL with session token
    const catalogueUrl = process.env.CATALOGUE_URL || '';
    const catalogueLink = catalogueUrl 
      ? `${catalogueUrl}${catalogueUrl.endsWith('/') ? '' : '/'}?session=${session.token}`
      : null;

    return sendSuccessResponse(res, 200, 'Session updated successfully', {
      ...session.toObject(),
      isExpired,
      isValid,
      status: isValid ? 'Active' : (isExpired ? 'Expired' : 'Inactive'),
      catalogueLink
    });
  } catch (err) {
    console.error('Error updating session:', err);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, err.message);
  }
});

/**
 * DELETE /api/sessions/:id
 * Revoke session (set isActive to false)
 * Required Permission: placeholder_test
 */
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);

    if (!session) {
      return sendErrorResponse(res, 404, 'Session not found');
    }

    session.isActive = false;
    await session.save();

    return sendSuccessResponse(res, 200, 'Session revoked successfully');
  } catch (err) {
    console.error('Error revoking session:', err);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, err.message);
  }
});

module.exports = router;

