const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const Company = require('../models/company.model');
const { sendErrorResponse, sendSuccessResponse, ERROR_MESSAGES } = require('../utils/errorHandler');
const { getBrevoQuota } = require('../utils/emailConfig');
const { sendEmail } = require('../utils/emailConfig');

const BRAND_COLOR = '#b91c1c';
const COMPANY_NAME = 'ASB';

// ============================================================================
// COMPANY INFORMATION ROUTES (Single Company Record)
// ============================================================================

/**
 * GET /api/companies/public
 * Get processed contact information for public display
 * Returns only processed contact links (WhatsApp, Email) - no auth required
 */
router.get('/public', async (req, res) => {
  try {
    let company = await Company.findOne()
      .select('companyName email whatsapp phone address website')
      .sort({ createdAt: -1 });

    // If no company exists, return empty structure
    if (!company) {
      return sendSuccessResponse(res, 200, 'No company information available', {
        companyName: 'ASB Catalogue',
        whatsappLink: null,
        email: null,
        phone: null,
        address: null,
        website: null
      });
    }

    // Convert to plain object
    const companyData = company.toObject ? company.toObject() : company;
    
    // Process contact information at backend
    let whatsappLink = null;
    
    // Process WhatsApp - prioritize WhatsApp contacts, fallback to phone
    if (companyData.whatsapp && companyData.whatsapp.length > 0) {
      const primaryWhatsApp = companyData.whatsapp[0];
      const phoneNumber = primaryWhatsApp.number.replace(/[^\d+]/g, '');
      const message = encodeURIComponent('Hello, I would like to inquire about your products.');
      whatsappLink = `https://wa.me/${phoneNumber}?text=${message}`;
    } else if (companyData.phone) {
      const phoneNumber = companyData.phone.replace(/[^\d+]/g, '');
      const message = encodeURIComponent('Hello, I would like to inquire about your products.');
      whatsappLink = `https://wa.me/${phoneNumber}?text=${message}`;
    }
    
    // Check if email exists (but don't expose it)
    const hasEmail = companyData.email && companyData.email.sendTo && companyData.email.sendTo.length > 0;
    
    // Return processed contact information (NO EMAIL ADDRESSES EXPOSED)
    const processedData = {
      companyName: companyData.companyName || 'ASB Catalogue',
      whatsappLink: whatsappLink,
      hasEmail: hasEmail, // Just a boolean to know if email option should be shown
      phone: companyData.phone || null,
      address: companyData.address || null,
      website: companyData.website || null
    };
    
    sendSuccessResponse(res, 200, 'Company contact information retrieved successfully', processedData);
  } catch (error) {
    console.error('Error fetching public company info:', error);
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * GET /api/companies
 * Get the company information (single record)
 * Creates a default record if none exists
 * Required Permission: placeholder_test
 */
router.get('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    let company = await Company.findOne()
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ createdAt: -1 });

    // If no company exists, create a default one
    if (!company) {
      const userId = req.user.userId;
      company = new Company({
        companyName: 'Company Name',
        email: {
          sendTo: [],
          cc: []
        },
        whatsapp: [],
        npwp: '',
        address: '',
        phone: '',
        fax: '',
        website: '',
        notes: '',
        createdBy: userId,
        lastModifiedBy: userId
      });
      await company.save();
      
      company = await Company.findById(company._id)
        .populate('createdBy', 'fullName email')
        .populate('lastModifiedBy', 'fullName email');
    }

    sendSuccessResponse(res, 200, 'Company information retrieved successfully', company);
  } catch (error) {
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * PUT /api/companies
 * Update the company information (single record)
 * Required Permission: placeholder_test
 */
router.put('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const {
      companyName,
      email,
      whatsapp,
      npwp,
      address,
      phone,
      fax,
      website,
      notes
    } = req.body;

    const userId = req.user.userId;

    // Find or create company
    let company = await Company.findOne();

    // Validation
    if (!companyName || !companyName.trim()) {
      return sendErrorResponse(res, 400, 'Company name is required');
    }

    // If company doesn't exist, create it
    if (!company) {
      company = new Company({
        companyName: companyName.trim(),
        email: {
          sendTo: Array.isArray(email?.sendTo) ? email.sendTo.filter(e => e.email && e.email.trim()) : [],
          cc: Array.isArray(email?.cc) ? email.cc.filter(e => e.email && e.email.trim()) : []
        },
        whatsapp: Array.isArray(whatsapp) ? whatsapp.filter(w => w.name && w.name.trim() && w.number && w.number.trim()) : [],
        npwp: npwp ? npwp.trim() : '',
        address: address ? address.trim() : '',
        phone: phone ? phone.trim() : '',
        fax: fax ? fax.trim() : '',
        website: website ? website.trim() : '',
        notes: notes ? notes.trim() : '',
        createdBy: userId,
        lastModifiedBy: userId
      });
    } else {
      // Update existing company
      company.companyName = companyName.trim();
      company.email = {
        sendTo: Array.isArray(email?.sendTo) ? email.sendTo.filter(e => e.email && e.email.trim()) : [],
        cc: Array.isArray(email?.cc) ? email.cc.filter(e => e.email && e.email.trim()) : []
      };
      company.whatsapp = Array.isArray(whatsapp) ? whatsapp.filter(w => w.name && w.name.trim() && w.number && w.number.trim()) : [];
      company.npwp = npwp ? npwp.trim() : '';
      company.address = address ? address.trim() : '';
      company.phone = phone ? phone.trim() : '';
      company.fax = fax ? fax.trim() : '';
      company.website = website ? website.trim() : '';
      company.notes = notes ? notes.trim() : '';
      company.lastModifiedBy = userId;
    }

    await company.save();

    const populatedCompany = await Company.findById(company._id)
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');

    sendSuccessResponse(res, 200, 'Company information updated successfully', populatedCompany);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message).join(', ');
      return sendErrorResponse(res, 400, messages);
    }
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

/**
 * POST /api/companies/contact-inquiry
 * Handle contact inquiry from public - sends email without exposing email addresses
 * No auth required
 */
router.post('/contact-inquiry', async (req, res) => {
  try {
    const {
      inquiryType, // 'personal' or 'company'
      name,
      companyName,
      gender,
      email,
      phone,
      message
    } = req.body;

    // Validation
    if (!inquiryType || !['personal', 'company'].includes(inquiryType)) {
      return sendErrorResponse(res, 400, 'Inquiry type must be "personal" or "company"');
    }
    if (!name || !name.trim()) {
      return sendErrorResponse(res, 400, 'Name is required');
    }
    if (inquiryType === 'company' && (!companyName || !companyName.trim())) {
      return sendErrorResponse(res, 400, 'Company name is required for company inquiries');
    }
    if (!email || !email.trim()) {
      return sendErrorResponse(res, 400, 'Email is required');
    }
    if (!phone || !phone.trim()) {
      return sendErrorResponse(res, 400, 'Phone is required');
    }
    if (!message || !message.trim()) {
      return sendErrorResponse(res, 400, 'Message is required');
    }

    // Get company email configuration
    const company = await Company.findOne();
    if (!company || !company.email ||
        (!company.email.sendTo || company.email.sendTo.length === 0)) {
      return sendErrorResponse(res, 500, 'Company email configuration not found');
    }

    // Build email content
    const customerInfo = `
      <h3 style="color:${BRAND_COLOR};margin-top:20px;margin-bottom:10px;font-size:16px;">Customer Information:</h3>
      <ul style="list-style:none;padding:0;">
        <li style="margin:5px 0;"><strong>Type:</strong> ${inquiryType === 'company' ? 'Company' : 'Personal'}</li>
        <li style="margin:5px 0;"><strong>Name:</strong> ${name}</li>
        ${inquiryType === 'company' ? `<li style="margin:5px 0;"><strong>Company Name:</strong> ${companyName}</li>` : ''}
        ${gender ? `<li style="margin:5px 0;"><strong>Gender:</strong> ${gender}</li>` : ''}
        <li style="margin:5px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></li>
        <li style="margin:5px 0;"><strong>Phone:</strong> ${phone}</li>
      </ul>
    `;

    const messageHtml = `
      <h3 style="color:${BRAND_COLOR};margin-top:20px;margin-bottom:10px;font-size:16px;">Customer Message:</h3>
      <div style="padding:15px;background:#f9f9f9;border-left:3px solid #ddd;margin-bottom:20px;white-space:pre-wrap;line-height:1.6;">
        ${message.trim()}
      </div>
    `;

    const emailBody = `
      <p style="font-size:16px;margin-bottom:20px;">You have received a new contact inquiry:</p>
      ${customerInfo}
      ${messageHtml}
      <div style="margin-top:30px;padding:15px;background:#fff5f5;border-radius:8px;border-left:4px solid ${BRAND_COLOR};">
        <p style="margin:0;font-size:14px;"><strong>Please respond to this inquiry promptly.</strong></p>
      </div>
    `;

    const sendToEmails = company.email.sendTo.map(e => e.email);
    const ccEmails = company.email.cc.map(e => e.email);

    const emailResult = await sendEmail({
      to: sendToEmails,
      cc: ccEmails,
      subject: `New Contact Inquiry from ${name}${inquiryType === 'company' ? ` (${companyName})` : ''}`,
      html: emailBody,
      from: `"${COMPANY_NAME} Catalogue System" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`
    });

    if (!emailResult.success) {
      console.error('Failed to send contact inquiry email:', emailResult.error);
      return sendErrorResponse(res, 500, 'Failed to send email. Please try again later.');
    }

    return sendSuccessResponse(res, 200, 'Contact inquiry submitted successfully');
  } catch (error) {
    console.error('Error submitting contact inquiry:', error);
    const status = error.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : error.message;
    return sendErrorResponse(res, status, message);
  }
});

/**
 * GET /api/companies/brevo-quota
 * Get Brevo email quota information
 * Required Permission: placeholder_test
 */
router.get('/brevo-quota', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const quotaResult = await getBrevoQuota();
    
    if (!quotaResult.success) {
      return sendErrorResponse(res, 500, quotaResult.error || 'Failed to get Brevo quota');
    }

    sendSuccessResponse(res, 200, 'Brevo quota retrieved successfully', quotaResult.data);
  } catch (error) {
    sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

module.exports = router;
