const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const catalogueHelper = require('../utils/catalogueHelper');
const { sendSuccessResponse, sendErrorResponse, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../utils/errorHandler');
const { sendEmail } = require('../utils/emailConfig');
const Company = require('../models/company.model');
const Catalogue = require('../models/catalogue.model');

const BRAND_COLOR = '#b91c1c';
const COMPANY_NAME = 'ASB';

// GET /api/catalogues - List catalogues with pagination
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, bodyType } = req.query;

    // Validate pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return sendErrorResponse(res, 400, 'Page must be a positive integer');
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return sendErrorResponse(res, 400, 'Limit must be between 1 and 100');
    }

    const result = await catalogueHelper.getCatalogues({
      page: pageNum,
      limit: limitNum,
      search: search ? search.trim() : null,
      bodyType: bodyType || null
    });

    return sendSuccessResponse(res, 200, 'Catalogues retrieved successfully', result.catalogues, result.pagination);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error getting catalogues:', err);
    return sendErrorResponse(res, status, message);
  }
});

// GET /api/catalogues/body-type/:bodyTypeId - Get catalogue by body type
router.get('/body-type/:bodyTypeId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const catalogue = await catalogueHelper.getCatalogueByBodyType(req.params.bodyTypeId);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.RETRIEVED, catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error getting catalogue by body type:', err);
    return sendErrorResponse(res, status, message);
  }
});

// GET /api/catalogues/:id - Get catalogue by ID
router.get('/:id', async (req, res) => {
  try {
    const catalogue = await catalogueHelper.getCatalogueById(req.params.id);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.RETRIEVED, catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error getting catalogue:', err);
    return sendErrorResponse(res, status, message);
  }
});

// POST /api/catalogues - Create catalogue
router.post('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { bodyType, article, variantCategories, sizes, chassis, frontImage, carouselImages, featured, leadTime, notes } = req.body;

    // Validate required fields
    if (!bodyType) {
      return sendErrorResponse(res, 400, 'Body type is required');
    }

    if (!mongoose.Types.ObjectId.isValid(bodyType)) {
      return sendErrorResponse(res, 400, 'Invalid body type ID');
    }

    // Validate front image
    if (!frontImage || !frontImage.trim()) {
      return sendErrorResponse(res, 400, 'Front image is required');
    }

    // Validate carousel images
    if (carouselImages !== undefined && !Array.isArray(carouselImages)) {
      return sendErrorResponse(res, 400, 'Carousel images must be an array');
    }

    // Validate variant categories structure
    if (variantCategories && Array.isArray(variantCategories)) {
      for (const cat of variantCategories) {
        if (!cat.category || !cat.category.trim()) {
          return sendErrorResponse(res, 400, 'Variant category must have a category name');
        }
        if (!Array.isArray(cat.values) || cat.values.length === 0) {
          return sendErrorResponse(res, 400, 'Variant category must have at least one value');
        }
      }
    }

    // Validate sizes structure
    if (sizes && Array.isArray(sizes)) {
      for (const size of sizes) {
        if (size.sizeType && !mongoose.Types.ObjectId.isValid(size.sizeType)) {
          return sendErrorResponse(res, 400, 'Invalid size type ID');
        }
      }
    }

    // Validate chassis structure
    if (chassis && Array.isArray(chassis)) {
      for (const ch of chassis) {
        if (ch.chassisType && !mongoose.Types.ObjectId.isValid(ch.chassisType)) {
          return sendErrorResponse(res, 400, 'Invalid chassis type ID');
        }
        if (ch.chassisDetails && !Array.isArray(ch.chassisDetails)) {
          return sendErrorResponse(res, 400, 'Chassis details must be an array');
        }
      }
    }

    const catalogue = await catalogueHelper.createCatalogue({
      bodyType,
      article: article || '',
      variantCategories: variantCategories || [],
      sizes: sizes || [],
      chassis: chassis || [],
      frontImage: frontImage.trim(),
      carouselImages: Array.isArray(carouselImages) ? carouselImages.filter(img => img && img.trim()) : [],
      featured: featured === true,
      leadTime: leadTime || '',
      notes: notes || '',
      createdBy: req.user.userId
    });

    return sendSuccessResponse(res, 201, 'Catalogue created successfully', catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error creating catalogue:', err);
    return sendErrorResponse(res, status, message);
  }
});

// PUT /api/catalogues/:id - Update catalogue
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { article, variantCategories, sizes, chassis, frontImage, carouselImages, featured, shopCatalogueOverrides, leadTime, notes } = req.body;

    // Validate at least one field is provided
    if (!article && !variantCategories && !sizes && !chassis && frontImage === undefined && carouselImages === undefined && featured === undefined && shopCatalogueOverrides === undefined && leadTime === undefined && notes === undefined) {
      return sendErrorResponse(res, 400, 'At least one field must be provided for update');
    }

    // Validate carousel images if provided
    if (carouselImages !== undefined) {
      if (!Array.isArray(carouselImages)) {
        return sendErrorResponse(res, 400, 'Carousel images must be an array');
      }
    }

    // Validate variant categories structure if provided
    if (variantCategories !== undefined) {
      if (!Array.isArray(variantCategories)) {
        return sendErrorResponse(res, 400, 'Variant categories must be an array');
      }
      for (const cat of variantCategories) {
        if (!cat.category || !cat.category.trim()) {
          return sendErrorResponse(res, 400, 'Variant category must have a category name');
        }
        if (!Array.isArray(cat.values) || cat.values.length === 0) {
          return sendErrorResponse(res, 400, 'Variant category must have at least one value');
        }
      }
    }

    // Validate sizes structure if provided
    if (sizes !== undefined) {
      if (!Array.isArray(sizes)) {
        return sendErrorResponse(res, 400, 'Sizes must be an array');
      }
      for (const size of sizes) {
        if (size.sizeType && !mongoose.Types.ObjectId.isValid(size.sizeType)) {
          return sendErrorResponse(res, 400, 'Invalid size type ID');
        }
      }
    }

    // Validate chassis structure if provided
    if (chassis !== undefined) {
      if (!Array.isArray(chassis)) {
        return sendErrorResponse(res, 400, 'Chassis must be an array');
      }
      for (const ch of chassis) {
        if (ch.chassisType && !mongoose.Types.ObjectId.isValid(ch.chassisType)) {
          return sendErrorResponse(res, 400, 'Invalid chassis type ID');
        }
        if (ch.chassisDetails && !Array.isArray(ch.chassisDetails)) {
          return sendErrorResponse(res, 400, 'Chassis details must be an array');
        }
      }
    }

    const catalogue = await catalogueHelper.updateCatalogue(req.params.id, {
      article,
      variantCategories,
      sizes,
      chassis,
      frontImage: frontImage !== undefined ? frontImage.trim() : undefined,
      carouselImages: carouselImages !== undefined ? carouselImages.filter(img => img && img.trim()) : undefined,
      featured: featured !== undefined ? featured === true : undefined,
      shopCatalogueOverrides,
      leadTime,
      notes
    }, req.user.userId);

    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.UPDATED, catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error updating catalogue:', err);
    console.error('Error stack:', err.stack);
    return sendErrorResponse(res, status, message);
  }
});

// DELETE /api/catalogues/:id - Delete catalogue
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    await catalogueHelper.deleteCatalogue(req.params.id);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.DELETED);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error deleting catalogue:', err);
    return sendErrorResponse(res, status, message);
  }
});

// PUT /api/catalogues/:id/variant-categories - Update variant categories
router.put('/:id/variant-categories', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { variantCategories } = req.body;

    if (!variantCategories) {
      return sendErrorResponse(res, 400, 'Variant categories are required');
    }

    if (!Array.isArray(variantCategories)) {
      return sendErrorResponse(res, 400, 'Variant categories must be an array');
    }

    // Validate variant categories structure
    for (const cat of variantCategories) {
      if (!cat.category || !cat.category.trim()) {
        return sendErrorResponse(res, 400, 'Variant category must have a category name');
      }
      if (!Array.isArray(cat.values) || cat.values.length === 0) {
        return sendErrorResponse(res, 400, 'Variant category must have at least one value');
      }
    }

    const catalogue = await catalogueHelper.updateVariantCategories(
      req.params.id,
      variantCategories,
      req.user.userId
    );

    return sendSuccessResponse(res, 200, 'Variant categories updated successfully', catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error updating variant categories:', err);
    return sendErrorResponse(res, status, message);
  }
});

// PUT /api/catalogues/:id/shop-overrides - Update shop catalogue overrides
router.put('/:id/shop-overrides', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { overrides } = req.body;

    if (!overrides) {
      return sendErrorResponse(res, 400, 'Overrides are required');
    }

    // Accept both array format (new) and object format (legacy)
    let overridesArray = [];
    if (Array.isArray(overrides)) {
      // New format: array of override objects
      for (const override of overrides) {
        if (!override || typeof override !== 'object') {
          return sendErrorResponse(res, 400, 'Each override must be an object');
        }
        if (!override.combinationId || typeof override.combinationId !== 'string') {
          return sendErrorResponse(res, 400, 'Each override must have a combinationId string');
        }
        if (override.enabled !== undefined && typeof override.enabled !== 'boolean') {
          return sendErrorResponse(res, 400, `Override for ${override.combinationId}: enabled must be a boolean`);
        }
        if (override.price !== undefined && typeof override.price !== 'string') {
          return sendErrorResponse(res, 400, `Override for ${override.combinationId}: price must be a string`);
        }
      }
      overridesArray = overrides;
    } else if (typeof overrides === 'object' && !Array.isArray(overrides)) {
      // Legacy format: plain object - convert to array
      for (const [key, value] of Object.entries(overrides)) {
        if (value && typeof value === 'object') {
          if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
            return sendErrorResponse(res, 400, `Override for ${key}: enabled must be a boolean`);
          }
          if (value.price !== undefined && typeof value.price !== 'string') {
            return sendErrorResponse(res, 400, `Override for ${key}: price must be a string`);
          }
          overridesArray.push({
            combinationId: String(key),
            enabled: value.enabled !== false,
            price: value.price !== undefined ? String(value.price).trim() : 'ask'
          });
        }
      }
    } else {
      return sendErrorResponse(res, 400, 'Overrides must be an array or an object');
    }

    const catalogue = await catalogueHelper.updateShopCatalogueOverrides(
      req.params.id,
      overridesArray,
      req.user.userId
    );

    return sendSuccessResponse(res, 200, 'Shop catalogue overrides updated successfully', catalogue);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    console.error('Error updating shop overrides:', err);
    return sendErrorResponse(res, status, message);
  }
});

// POST /api/catalogues/price-inquiry - Submit price inquiry (supports single or bundle)
router.post('/price-inquiry', async (req, res) => {
  try {
    const {
      items, // Array of items for bundle inquiry
      catalogueId, // Legacy: single item inquiry
      variantCombinationId, // Legacy: single item inquiry
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

    // Handle bundle inquiry (multiple items) or single item inquiry
    const inquiryItems = items && Array.isArray(items) && items.length > 0
      ? items
      : [{ catalogueId, variantCombinationId: variantCombinationId || null, quantity: 1 }];

    if (inquiryItems.length === 0 || !inquiryItems[0].catalogueId) {
      return sendErrorResponse(res, 400, 'At least one catalogue item is required');
    }

    // Fetch all catalogues and build items list
    const itemsList = [];
    for (const item of inquiryItems) {
      try {
        // Use getCatalogueById which already enriches the catalogue with shopCatalogue
        const enrichedCatalogue = await catalogueHelper.getCatalogueById(item.catalogueId);
        
        if (!enrichedCatalogue) {
          console.warn(`Catalogue with ID ${item.catalogueId} not found for inquiry.`);
          continue; // Skip invalid items
        }

        let variantDetails = null;
        if (item.variantCombinationId && enrichedCatalogue.shopCatalogue) {
          variantDetails = enrichedCatalogue.shopCatalogue.find(
            v => String(v.combinationId) === String(item.variantCombinationId)
          );
        }

        itemsList.push({
          catalogue: enrichedCatalogue,
          variant: variantDetails,
          quantity: item.quantity || 1
        });
      } catch (err) {
        console.warn(`Error fetching catalogue ${item.catalogueId} for inquiry:`, err.message);
        continue; // Skip invalid items
      }
    }

    if (itemsList.length === 0) {
      return sendErrorResponse(res, 400, 'No valid catalogue items found');
    }

    // Get company email configuration
    const company = await Company.findOne();
    if (!company || !company.email || 
        (!company.email.sendTo || company.email.sendTo.length === 0)) {
      return sendErrorResponse(res, 500, 'Company email configuration not found');
    }

    // Helper to format size label
    const getSizeLabel = (size) => {
      if (!size) return 'Not specified';
      const sizeTypeLabel = size.sizeType?.name || '';
      const sizeCustom = size.sizeCustom || '';
      return sizeTypeLabel + (sizeCustom ? ` - ${sizeCustom}` : '') || sizeCustom || 'Not specified';
    };

    // Helper to format chassis label
    const getChassisLabel = (ch) => {
      if (!ch) return 'Not specified';
      const chassisTypeLabel = ch.chassisType?.name || ch.chassisType?.shortName || '';
      const chassisDetails = ch.chassisDetails && ch.chassisDetails.length > 0 
        ? ` (${ch.chassisDetails.join(', ')})` 
        : '';
      return chassisTypeLabel + chassisDetails || 'Not specified';
    };

    // Build email content for all items
    const isBundle = itemsList.length > 1;
    const itemsHtml = itemsList.map((item, index) => {
      const productName = item.catalogue.bodyType?.name || 'Product';
      const bodyTypeShortName = item.catalogue.bodyType?.shortName || '';
      const variant = item.variant;
      const quantity = item.quantity || 1;

      let itemDetails = '';
      itemDetails += `<li style="margin:8px 0;"><strong>Body Type:</strong> ${productName}${bodyTypeShortName ? ` (${bodyTypeShortName})` : ''}</li>`;
      
      if (variant) {
        // Specific variant selected
        if (variant.sizeData) {
          itemDetails += `<li style="margin:8px 0;"><strong>Size:</strong> ${getSizeLabel(variant.sizeData)}</li>`;
        }
        if (variant.chassisData) {
          itemDetails += `<li style="margin:8px 0;"><strong>Chassis:</strong> ${getChassisLabel(variant.chassisData)}</li>`;
        }
        if (variant.variantSelections && Object.keys(variant.variantSelections).length > 0) {
          Object.entries(variant.variantSelections).forEach(([key, value]) => {
            itemDetails += `<li style="margin:8px 0;"><strong>${key}:</strong> ${value}</li>`;
          });
        }
        if (variant.price) {
          itemDetails += `<li style="margin:8px 0;"><strong>Price Reference:</strong> ${variant.price === 'ask' ? 'Ask for Price' : variant.price}</li>`;
        }
      } else {
        // No specific variant - show available variant categories for this body type
        const catalogueObj = item.catalogue.toObject ? item.catalogue.toObject() : item.catalogue;
        const variantCategories = catalogueObj.variantCategories || [];
        
        // Always show variant categories if they exist, as these are the options available for this body type
        if (variantCategories.length > 0) {
          variantCategories.forEach(cat => {
            if (cat.category && cat.values && cat.values.length > 0) {
              itemDetails += `<li style="margin:8px 0;"><strong>${cat.category}:</strong> ${cat.values.join(', ')}</li>`;
            }
          });
          itemDetails += `<li style="margin:8px 0;color:#6b7280;font-style:italic;">Customer will specify exact configuration from these options</li>`;
        } else {
          // No variant categories available - show sizes and chassis if available
          const sizes = catalogueObj.sizes || [];
          const chassis = catalogueObj.chassis || [];
          
          if (sizes.length > 0 || chassis.length > 0) {
            if (sizes.length > 0) {
              itemDetails += `<li style="margin:8px 0;"><strong>Available Sizes:</strong> ${sizes.map(s => getSizeLabel(s)).join(', ')}</li>`;
            }
            if (chassis.length > 0) {
              itemDetails += `<li style="margin:8px 0;"><strong>Available Chassis:</strong> ${chassis.map(c => getChassisLabel(c)).join(', ')}</li>`;
            }
            itemDetails += `<li style="margin:8px 0;color:#6b7280;font-style:italic;">Customer will specify exact configuration</li>`;
          } else {
            itemDetails += `<li style="margin:8px 0;"><em>General product inquiry - no specific variant selected</em></li>`;
          }
        }
      }

      if (quantity > 1) {
        itemDetails += `<li style="margin:8px 0;"><strong>Quantity:</strong> ${quantity}</li>`;
      }

      return `
        <div style="margin-bottom:20px;padding:12px;background:#f8fafc;border-left:3px solid ${BRAND_COLOR};border-radius:4px;">
          <h4 style="color:${BRAND_COLOR};margin:0 0 10px 0;font-size:14px;font-weight:600;">
            ${isBundle ? `Item ${index + 1}:` : 'Product Configuration Requested:'}
          </h4>
          <ul style="list-style:none;padding:0;margin:0;">
            ${itemDetails}
          </ul>
        </div>
      `;
    }).join('');

    const productsSection = `
      <h3 style="color:${BRAND_COLOR};margin-top:20px;margin-bottom:10px;font-size:16px;">
        ${isBundle ? `Products Requested (${itemsList.length} items):` : 'Product Configuration Requested:'}
      </h3>
      ${itemsHtml}
    `;

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

    // Customer message section
    const customerMessage = message && message.trim() 
      ? `
        <h3 style="color:${BRAND_COLOR};margin-top:20px;margin-bottom:10px;font-size:16px;">Customer Message:</h3>
        <div style="margin:10px 0;padding:12px;background:#f8fafc;border-left:3px solid ${BRAND_COLOR};border-radius:4px;">
          <p style="margin:0;white-space:pre-wrap;color:#1f2937;line-height:1.6;">${message.trim()}</p>
        </div>
      `
      : '';

    const emailBody = `
      <p style="font-size:16px;margin-bottom:20px;">You have received a new price inquiry${isBundle ? ' (Bundle)' : ''}:</p>
      
      ${productsSection}
      ${customerInfo}
      ${customerMessage}
      
      <div style="margin-top:30px;padding:15px;background:#fff5f5;border-radius:8px;border-left:4px solid ${BRAND_COLOR};">
        <p style="margin:0;font-size:14px;"><strong>Please respond to this inquiry promptly.</strong></p>
      </div>
    `;
    
    // Wrap in email template
    const BASE_BG = '#f8fafc';
    const BRAND_ACCENT = '#fee2e2';
    const COMPANY_LOGO_URL = 'https://i.imgur.com/83wJQlA.png';
    const formattedEmailBody = `
      <div style="background-color:${BASE_BG};padding:24px;font-family:'Segoe UI',Arial,sans-serif;">
        <table style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND_ACCENT};box-shadow:0 12px 30px rgba(185,28,28,0.12);">
          <thead>
            <tr>
              <td style="background:${BRAND_COLOR};padding:24px;text-align:center;">
                <img src="${COMPANY_LOGO_URL}" alt="${COMPANY_NAME} Logo" style="height:56px;display:block;margin:0 auto 8px;" />
                <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:600;">Price Inquiry</h1>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:24px;color:#1f2937;font-size:15px;line-height:1.7;">
                ${emailBody}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td style="padding:16px 24px;background:#fff5f5;color:${BRAND_COLOR};font-size:12px;text-align:center;border-top:1px solid ${BRAND_ACCENT};">
                This is an automated message from ${COMPANY_NAME}. Please do not reply to this email.
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    // Prepare recipients
    const sendToEmails = company.email.sendTo.map(e => e.email);
    const ccEmails = company.email.cc && company.email.cc.length > 0 
      ? company.email.cc.map(e => e.email) 
      : [];

    // Build subject line
    const firstProductName = itemsList[0].catalogue.bodyType?.name || 'Product';
    const subject = isBundle
      ? `Price Inquiry (Bundle - ${itemsList.length} items): ${firstProductName}${itemsList.length > 1 ? ' + more' : ''} - ${inquiryType === 'company' ? companyName : name}`
      : `Price Inquiry: ${firstProductName} - ${inquiryType === 'company' ? companyName : name}`;

    // Send email
    const emailResult = await sendEmail({
      from: `"${COMPANY_NAME} Catalogue System" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
      to: sendToEmails,
      cc: ccEmails.length > 0 ? ccEmails : undefined,
      subject: subject,
      html: formattedEmailBody,
      replyTo: email
    });

    if (!emailResult.success) {
      console.error('Failed to send price inquiry email:', emailResult.error);
      return sendErrorResponse(res, 500, 'Failed to send inquiry email', emailResult.error);
    }

    return sendSuccessResponse(res, 200, 'Price inquiry submitted successfully. We will contact you soon.');
  } catch (error) {
    console.error('Error processing price inquiry:', error);
    return sendErrorResponse(res, 500, ERROR_MESSAGES.INTERNAL_ERROR, error.message);
  }
});

module.exports = router;
