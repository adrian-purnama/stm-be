// =============================================================================
// DRAWING SPECIFICATION MANAGEMENT ROUTES
// =============================================================================
// This module handles all drawing specification-related endpoints including
// creation, retrieval, updates, file uploads, and management of drawing specifications.

const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const DrawingSpecification = require('../models/drawingSpecification.model');
const BodyType = require('../models/bodyType.model');
const ChassisType = require('../models/chassisType.model');
const SizeType = require('../models/sizeType.model');
const FeatureType = require('../models/featureType.model');
const { drawingSpecificationGridFS } = require('../utils/gridfsHelper');
const { convertToDXF } = require('../utils/dwgConversionHelper');
const { compressBuffer, decompressBuffer } = require('../utils/compressionHelper');
const { optimizeImageAggressive } = require('../utils/imageOptimizationHelper');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const filename = file.originalname.toLowerCase();
    
    // Check field name to determine allowed file types
    if (file.fieldname === 'drawingFile') {
      // Only allow DWG and DXF files for drawingFile
      const allowedTypes = [
        'application/dwg',
        'application/dxf',
        'application/acad',
        'application/x-dwg',
        'application/x-dxf',
        'application/octet-stream' // For DWG/DXF files
      ];
      
      const isDWG = filename.endsWith('.dwg');
      const isDXF = filename.endsWith('.dxf');
      
      if (allowedTypes.includes(file.mimetype) || isDWG || isDXF) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type for drawing file. Only DWG and DXF files are allowed.'), false);
      }
    } else if (file.fieldname === 'quotationImage') {
      // Allow JPG/JPEG, PNG, and PDF files for quotationImage
      const isJPG = filename.endsWith('.jpg') || filename.endsWith('.jpeg');
      const isPNG = filename.endsWith('.png');
      const isPDF = filename.endsWith('.pdf');
      const isImageMime = file.mimetype.startsWith('image/');
      const isPDFMime = file.mimetype === 'application/pdf';
      
      if (isJPG || isPNG || isPDF || 
          (isImageMime && (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg' || file.mimetype === 'image/png')) ||
          isPDFMime) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type for quotation image. Only JPG/JPEG/PNG/PDF files are allowed.'), false);
      }
    } else {
      // Unknown field name
      cb(new Error(`Unexpected field name: ${file.fieldname}`), false);
    }
  }
});

// =============================================================================
// VALIDATION HELPER FUNCTIONS
// =============================================================================

/**
 * Validate master table references exist
 */
async function validateMasterReferences(bodyTypeId, chassisTypeId, sizeTypeId, featureIds = []) {
  const errors = [];
  
  // Validate body type
  if (bodyTypeId) {
    const bodyType = await BodyType.findById(bodyTypeId);
    if (!bodyType) {
      errors.push('Invalid bodyTypeId');
    }
  }
  
  // Validate chassis type
  if (chassisTypeId) {
    const chassisType = await ChassisType.findById(chassisTypeId);
    if (!chassisType) {
      errors.push('Invalid chassisTypeId');
    }
  }
  
  // Validate size type
  if (sizeTypeId) {
    const sizeType = await SizeType.findById(sizeTypeId);
    if (!sizeType) {
      errors.push('Invalid sizeTypeId');
    }
  }
  
  // Validate feature types
  if (featureIds && featureIds.length > 0) {
    const validFeatureIds = featureIds.filter(id => id);
    if (validFeatureIds.length > 0) {
      const featureTypes = await FeatureType.find({ _id: { $in: validFeatureIds } });
      if (featureTypes.length !== validFeatureIds.length) {
        errors.push('One or more featureIds are invalid');
      }
    }
  }
  
  return errors;
}

// =============================================================================
// DRAWING SPECIFICATION CRUD ROUTES
// =============================================================================

/**
 * GET /api/drawing-specifications/list
 * Permission: placeholder_test (temporary - should be drawing_view)
 * Description: Get simple list of drawing specifications for dropdowns
 */
router.get('/list', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const drawings = await DrawingSpecification.find({})
      .select('drawingNumber bodyTypeId chassisTypeId chassisModel sizeTypeId')
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name')
      .populate('sizeTypeId', 'name shortName')
      .sort({ drawingNumber: 1 });

    res.json({
      success: true,
      data: drawings,
      message: 'Drawing specifications list retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting drawing specifications list:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/drawing-specifications
 * Permission: placeholder_test (temporary - should be drawing_view)
 * Description: Get all drawing specifications with pagination and filtering
 */
router.get('/', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      bodyTypeId,
      chassisTypeId,
      sizeTypeId,
      search 
    } = req.query;

    // Build filter
    const filter = {};
    
    if (bodyTypeId) {
      filter.bodyTypeId = bodyTypeId;
    }
    
    if (chassisTypeId) {
      filter.chassisTypeId = chassisTypeId;
    }
    
    if (sizeTypeId) {
      filter.sizeTypeId = sizeTypeId;
    }
    
    if (search) {
      filter.$or = [
        { drawingNumber: new RegExp(search, 'i') },
        { chassisModel: new RegExp(search, 'i') }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const drawings = await DrawingSpecification.find(filter)
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name shortName')
      .populate('sizeTypeId', 'name shortName')
      .populate('features.featureId', 'name shortName')
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DrawingSpecification.countDocuments(filter);

    res.json({
      success: true,
      data: drawings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      message: 'Drawing specifications retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting drawing specifications:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get specific drawing specification
/**
 * GET /api/drawing-specifications/:id
 * Permission: placeholder_test (temporary - should be drawing_view)
 * Description: Get specific drawing specification by ID
 */
router.get('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const drawing = await DrawingSpecification.findById(id)
      .populate('bodyTypeId', 'name shortName description')
      .populate('chassisTypeId', 'name shortName')
      .populate('sizeTypeId', 'name shortName')
      .populate('features.featureId', 'name shortName')
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');

    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    res.json({
      success: true,
      data: drawing,
      message: 'Drawing specification retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting drawing specification:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Create new drawing specification with optional file uploads
/**
 * POST /api/drawing-specifications
 * Permission: placeholder_test (temporary - should be drawing_create)
 * Description: Create new drawing specification with file upload
 */
router.post('/', authenticateToken, authorize(['placeholder_test']), upload.fields([
  { name: 'drawingFile', maxCount: 1 },
  { name: 'quotationImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      bodyTypeId,
      chassisTypeId,
      chassisModel,
      sizeTypeId,
      dimension,
      features,
      customSpecifications
    } = req.body;
    
    const file = req.files && req.files['drawingFile'] ? req.files['drawingFile'][0] : null;
    const quotationImageFile = req.files && req.files['quotationImage'] ? req.files['quotationImage'][0] : null;

    // Validate required fields
    if (!bodyTypeId) {
      return res.status(400).json({
        success: false,
        message: 'Body type is required'
      });
    }

    // File upload is optional - validate only if provided
    let drawingFileData = null;
    if (file) {
      // Validate file is DWG or DXF
      const fileExtension = path.extname(file.originalname).toLowerCase();
      if (!['.dwg', '.dxf'].includes(fileExtension)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Only DWG and DXF files are allowed.'
        });
      }

      // Process file: Convert DWG to DXF (if conversion available), then compress
      const originalFileSize = file.size;
      const uploadedFormat = fileExtension === '.dwg' ? 'DWG' : 'DXF';
      
      // Step 1: Convert DWG to DXF if needed (if conversion is configured)
      let processedBuffer;
      let storedFormat;
      let converted = false;
      
      try {
        console.log('[Upload] Processing file:', file.originalname, `(${file.size} bytes)`);
        const conversionResult = await convertToDXF(file.buffer, file.originalname);
        processedBuffer = conversionResult.buffer;
        storedFormat = conversionResult.format;
        converted = conversionResult.converted || false;
        
        console.log('[Upload] Result:', {
          format: storedFormat,
          converted: converted ? 'YES' : 'NO',
          size: processedBuffer.length
        });
      } catch (conversionError) {
        console.error('[Upload] Processing failed:', conversionError.message);
        return res.status(400).json({
          success: false,
          message: `File processing failed: ${conversionError.message}`
        });
      }
      
      // Step 2: Compress file (DXF or DWG)
      let compressedBuffer;
      let compressedFileSize;
      try {
        const compressionResult = await compressBuffer(processedBuffer);
        compressedBuffer = compressionResult.compressed;
        compressedFileSize = compressionResult.compressedSize;
      } catch (compressionError) {
        return res.status(500).json({
          success: false,
          message: `File compression failed: ${compressionError.message}`
        });
      }
      
      // Step 3: Upload compressed file to GridFS
      const outputFileExtension = storedFormat === 'DXF' ? '.dxf' : '.dwg';
      const uploadResult = await drawingSpecificationGridFS.uploadBuffer(
        compressedBuffer,
        `drawing_${Date.now()}${outputFileExtension}`,
        {
          originalName: file.originalname,
          uploadedBy: req.user.userId,
          isCompressed: true,
          originalFormat: uploadedFormat,
          storedFormat: storedFormat
        }
      );

      drawingFileData = {
        fileId: uploadResult.fileId,
        filename: uploadResult.filename,
        originalName: file.originalname,
        uploadedFormat: uploadedFormat,
        storedFormat: storedFormat,
        originalFileSize: originalFileSize,
        compressedFileSize: compressedFileSize,
        isCompressed: true,
        uploadDate: new Date()
      };
    }

    // Parse features
    let parsedFeatures = [];
    if (features) {
      if (typeof features === 'string') {
        parsedFeatures = JSON.parse(features);
      } else if (Array.isArray(features)) {
        parsedFeatures = features;
      }
    }

    // Parse custom specifications
    let parsedCustomSpecs = [];
    if (customSpecifications) {
      if (typeof customSpecifications === 'string') {
        parsedCustomSpecs = JSON.parse(customSpecifications);
      } else if (Array.isArray(customSpecifications)) {
        parsedCustomSpecs = customSpecifications;
      }
    }

    // Extract feature IDs for validation
    const featureIds = parsedFeatures.map(f => f.featureId).filter(Boolean);

    // Validate master references (only validate if provided)
    const validationErrors = await validateMasterReferences(
      bodyTypeId, 
      chassisTypeId || null, 
      sizeTypeId || null, 
      featureIds
    );

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Process quotation image/document if provided
    let quotationImageData = null;
    if (quotationImageFile) {
      const imageFileExtension = path.extname(quotationImageFile.originalname).toLowerCase();
      const isJPG = ['.jpg', '.jpeg'].includes(imageFileExtension);
      const isPNG = imageFileExtension === '.png';
      const isPDF = imageFileExtension === '.pdf';
      
      // Validate file type
      if (!isJPG && !isPNG && !isPDF) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type for quotation image. Only JPG/JPEG/PNG/PDF files are allowed.'
        });
      }

      const originalFileSize = quotationImageFile.size;
      let processedBuffer;
      let processedFileSize;
      let mimeType;
      let filename;
      let isOptimized = false;
      
      if (isPDF) {
        // PDF files: store as-is without optimization
        processedBuffer = quotationImageFile.buffer;
        processedFileSize = originalFileSize;
        mimeType = 'application/pdf';
        filename = `quotation_document_${Date.now()}.pdf`;
      } else if (isPNG || isJPG) {
        // Image files: optimize
        try {
          const optimizationResult = await optimizeImageAggressive(quotationImageFile.buffer);
          processedBuffer = optimizationResult.optimized;
          processedFileSize = optimizationResult.optimizedSize;
          isOptimized = true;
          
          // Determine MIME type based on original file
          if (isPNG) {
            mimeType = 'image/png';
            filename = `quotation_image_${Date.now()}.png`;
          } else {
            mimeType = 'image/jpeg';
            filename = `quotation_image_${Date.now()}.jpg`;
          }
        } catch (optimizationError) {
          console.error('[Upload] Image optimization failed:', optimizationError.message);
          return res.status(400).json({
            success: false,
            message: `Image optimization failed: ${optimizationError.message}`
          });
        }
      }

      // Upload processed file to GridFS
      const imageUploadResult = await drawingSpecificationGridFS.uploadBuffer(
        processedBuffer,
        filename,
        {
          originalName: quotationImageFile.originalname,
          uploadedBy: req.user.userId,
          isOptimized: isOptimized,
          fileType: isPDF ? 'PDF' : (isPNG ? 'PNG' : 'JPG')
        },
        mimeType
      );

      quotationImageData = {
        fileId: imageUploadResult.fileId,
        filename: imageUploadResult.filename,
        originalName: quotationImageFile.originalname,
        fileSize: processedFileSize,
        originalFileSize: originalFileSize,
        isOptimized: isOptimized,
        fileType: isPDF ? 'PDF' : (isPNG ? 'PNG' : 'JPG'),
        mimeType: mimeType,
        uploadDate: new Date()
      };
    }

    // Build drawing data (drawingNumber will be auto-generated)
    const drawingData = {
      bodyTypeId,
      chassisTypeId: chassisTypeId || undefined,
      chassisModel: chassisModel ? chassisModel.trim() : '',
      sizeTypeId: sizeTypeId || undefined,
      dimension: dimension ? dimension.trim() : '',
      features: parsedFeatures.map(f => ({
        featureId: f.featureId,
        spec: f.spec || ''
      })),
      customSpecifications: parsedCustomSpecs
        .filter(cs => cs && cs.category && cs.items && Array.isArray(cs.items))
        .map(cs => ({
          category: cs.category.trim(),
          items: cs.items
            .filter(item => item && item.name && item.specification && item.name.trim() && item.specification.trim())
            .map(item => ({
              name: item.name.trim(),
              specification: item.specification.trim()
            }))
        }))
        .filter(cs => cs.items && cs.items.length > 0),
      createdBy: req.user.userId
    };

    // Add drawing file if provided
    if (drawingFileData) {
      drawingData.drawingFile = drawingFileData;
    }

    // Add quotation image if provided
    if (quotationImageData) {
      drawingData.quotationImage = quotationImageData;
    }

    const drawing = new DrawingSpecification(drawingData);
    await drawing.save();

    const populatedDrawing = await DrawingSpecification.findById(drawing._id)
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name shortName')
      .populate('sizeTypeId', 'name shortName')
      .populate('features.featureId', 'name shortName')
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      data: populatedDrawing,
      message: 'Drawing specification created successfully'
    });
  } catch (error) {
    console.error('Error creating drawing specification:', error);
    
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Drawing specification with this combination already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update drawing specification
router.put('/:id', authenticateToken, authorize(['placeholder_test']), upload.fields([
  { name: 'drawingFile', maxCount: 1 },
  { name: 'quotationImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      bodyTypeId,
      chassisTypeId,
      chassisModel,
      sizeTypeId,
      dimension,
      features,
      customSpecifications,
      removeDrawingFile,
      removeQuotationImage
    } = req.body;

    const file = req.files && req.files['drawingFile'] ? req.files['drawingFile'][0] : null;
    const quotationImageFile = req.files && req.files['quotationImage'] ? req.files['quotationImage'][0] : null;

    // Check if drawing exists
    const existingDrawing = await DrawingSpecification.findById(id);
    if (!existingDrawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    // Build update data
    const updateData = {
      lastModifiedBy: req.user.userId
    };

    // Update fields if provided
    if (bodyTypeId !== undefined) updateData.bodyTypeId = bodyTypeId;
    if (chassisTypeId !== undefined) updateData.chassisTypeId = chassisTypeId;
    if (chassisModel !== undefined) {
      // Allow empty string or null for optional chassisModel
      updateData.chassisModel = chassisModel ? chassisModel.trim() : '';
    }
    if (sizeTypeId !== undefined) updateData.sizeTypeId = sizeTypeId;
    if (dimension !== undefined) {
      // Allow empty string or null for optional dimension
      updateData.dimension = dimension ? dimension.trim() : '';
    }

    // Handle features
    if (features !== undefined) {
      let parsedFeatures = [];
      if (typeof features === 'string') {
        parsedFeatures = JSON.parse(features);
      } else if (Array.isArray(features)) {
        parsedFeatures = features;
      }
      updateData.features = parsedFeatures
        .map(f => ({
          featureId: (f?.featureId && typeof f.featureId === 'object')
            ? f.featureId._id || f.featureId.id || f.featureId
            : f?.featureId,
          spec: f?.spec ? String(f.spec).trim() : ''
        }))
        .filter(f => f.featureId);
    }

    // Handle custom specifications
    if (customSpecifications !== undefined) {
      let parsedCustomSpecs = [];
      if (typeof customSpecifications === 'string') {
        parsedCustomSpecs = JSON.parse(customSpecifications);
      } else if (Array.isArray(customSpecifications)) {
        parsedCustomSpecs = customSpecifications;
      }
      updateData.customSpecifications = parsedCustomSpecs
        .filter(cs => cs && (cs.category || (cs.items && cs.items.length > 0)))
        .map(cs => ({
          category: cs.category ? String(cs.category).trim() : '',
          items: Array.isArray(cs.items)
            ? cs.items
                .filter(item => item && (item.name || item.specification))
                .map(item => ({
                  name: item.name ? String(item.name).trim() : '',
                  specification: item.specification ? String(item.specification).trim() : ''
                }))
            : []
        }))
        .filter(cs => cs.category || cs.items.length > 0);
    }

    // Validate master references for updated fields
    const featureIds = updateData.features ? 
      updateData.features.map(f => f.featureId).filter(Boolean) : 
      [];
    
    const validationErrors = await validateMasterReferences(
      updateData.bodyTypeId || existingDrawing.bodyTypeId,
      updateData.chassisTypeId || existingDrawing.chassisTypeId,
      updateData.sizeTypeId || existingDrawing.sizeTypeId,
      featureIds.length > 0 ? featureIds : 
        (existingDrawing.features || []).map(f => f.featureId).filter(Boolean)
    );

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Get existing drawing and update manually to ensure composite key regeneration
    const drawing = await DrawingSpecification.findById(id);
    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    // Handle drawing file update/replace
    if (removeDrawingFile === 'true' || removeDrawingFile === true) {
      // Remove existing drawing file
      if (drawing.drawingFile && drawing.drawingFile.fileId) {
        try {
          await drawingSpecificationGridFS.deleteFile(drawing.drawingFile.fileId);
          drawing.drawingFile = null;
        } catch (error) {
          console.error('Error deleting drawing file:', error);
          // Continue even if deletion fails
        }
      }
    } else if (file) {
      // Replace existing drawing file with new one
      // Delete old file first if exists
      if (drawing.drawingFile && drawing.drawingFile.fileId) {
        try {
          await drawingSpecificationGridFS.deleteFile(drawing.drawingFile.fileId);
        } catch (error) {
          console.error('Error deleting old drawing file:', error);
          // Continue even if deletion fails
        }
      }

      // Validate file is DWG or DXF
      const fileExtension = path.extname(file.originalname).toLowerCase();
      if (!['.dwg', '.dxf'].includes(fileExtension)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Only DWG and DXF files are allowed.'
        });
      }

      // Process file: Convert DWG to DXF (if conversion available), then compress
      const originalFileSize = file.size;
      const uploadedFormat = fileExtension === '.dwg' ? 'DWG' : 'DXF';
      
      let processedBuffer;
      let storedFormat;
      
      try {
        const conversionResult = await convertToDXF(file.buffer, file.originalname);
        processedBuffer = conversionResult.buffer;
        storedFormat = conversionResult.format;
      } catch (conversionError) {
        console.error('[Upload] Processing failed:', conversionError.message);
        return res.status(400).json({
          success: false,
          message: `File processing failed: ${conversionError.message}`
        });
      }
      
      // Compress file
      let compressedBuffer;
      let compressedFileSize;
      try {
        const compressionResult = await compressBuffer(processedBuffer);
        compressedBuffer = compressionResult.compressed;
        compressedFileSize = compressionResult.compressedSize;
      } catch (compressionError) {
        return res.status(500).json({
          success: false,
          message: `File compression failed: ${compressionError.message}`
        });
      }
      
      // Upload compressed file to GridFS
      const outputFileExtension = storedFormat === 'DXF' ? '.dxf' : '.dwg';
      const uploadResult = await drawingSpecificationGridFS.uploadBuffer(
        compressedBuffer,
        `drawing_${Date.now()}${outputFileExtension}`,
        {
          originalName: file.originalname,
          uploadedBy: req.user.userId,
          isCompressed: true,
          originalFormat: uploadedFormat,
          storedFormat: storedFormat
        }
      );

      // Update drawing file data
      drawing.drawingFile = {
        fileId: uploadResult.fileId,
        filename: uploadResult.filename,
        originalName: file.originalname,
        uploadedFormat: uploadedFormat,
        storedFormat: storedFormat,
        originalFileSize: originalFileSize,
        compressedFileSize: compressedFileSize,
        isCompressed: true,
        uploadDate: new Date()
      };
    }

    // Handle quotation image update/replace
    if (removeQuotationImage === 'true' || removeQuotationImage === true) {
      // Remove existing quotation image
      if (drawing.quotationImage && drawing.quotationImage.fileId) {
        try {
          await drawingSpecificationGridFS.deleteFile(drawing.quotationImage.fileId);
          drawing.quotationImage = null;
        } catch (error) {
          console.error('Error deleting quotation image:', error);
          // Continue even if deletion fails
        }
      }
    } else if (quotationImageFile) {
      // Replace existing quotation image with new one
      // Delete old file first if exists
      if (drawing.quotationImage && drawing.quotationImage.fileId) {
        try {
          await drawingSpecificationGridFS.deleteFile(drawing.quotationImage.fileId);
        } catch (error) {
          console.error('Error deleting old quotation image:', error);
          // Continue even if deletion fails
        }
      }

      // Validate and process file type
      const imageFileExtension = path.extname(quotationImageFile.originalname).toLowerCase();
      const isJPG = ['.jpg', '.jpeg'].includes(imageFileExtension);
      const isPNG = imageFileExtension === '.png';
      const isPDF = imageFileExtension === '.pdf';
      
      if (!isJPG && !isPNG && !isPDF) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type for quotation image. Only JPG/JPEG/PNG/PDF files are allowed.'
        });
      }

      const originalFileSize = quotationImageFile.size;
      let processedBuffer;
      let processedFileSize;
      let mimeType;
      let filename;
      let isOptimized = false;
      
      if (isPDF) {
        // PDF files: store as-is without optimization
        processedBuffer = quotationImageFile.buffer;
        processedFileSize = originalFileSize;
        mimeType = 'application/pdf';
        filename = `quotation_document_${Date.now()}.pdf`;
      } else if (isPNG || isJPG) {
        // Image files: optimize
        try {
          const optimizationResult = await optimizeImageAggressive(quotationImageFile.buffer);
          processedBuffer = optimizationResult.optimized;
          processedFileSize = optimizationResult.optimizedSize;
          isOptimized = true;
          
          // Determine MIME type based on original file
          if (isPNG) {
            mimeType = 'image/png';
            filename = `quotation_image_${Date.now()}.png`;
          } else {
            mimeType = 'image/jpeg';
            filename = `quotation_image_${Date.now()}.jpg`;
          }
        } catch (optimizationError) {
          console.error('[Upload] Image optimization failed:', optimizationError.message);
          return res.status(400).json({
            success: false,
            message: `Image optimization failed: ${optimizationError.message}`
          });
        }
      }

      // Upload processed file to GridFS
      const imageUploadResult = await drawingSpecificationGridFS.uploadBuffer(
        processedBuffer,
        filename,
        {
          originalName: quotationImageFile.originalname,
          uploadedBy: req.user.userId,
          isOptimized: isOptimized,
          fileType: isPDF ? 'PDF' : (isPNG ? 'PNG' : 'JPG')
        },
        mimeType
      );

      // Update quotation image data
      drawing.quotationImage = {
        fileId: imageUploadResult.fileId,
        filename: imageUploadResult.filename,
        originalName: quotationImageFile.originalname,
        fileSize: processedFileSize,
        originalFileSize: originalFileSize,
        isOptimized: isOptimized,
        fileType: isPDF ? 'PDF' : (isPNG ? 'PNG' : 'JPG'),
        mimeType: mimeType,
        uploadDate: new Date()
      };
    }

    // Apply updates
    Object.assign(drawing, updateData);
    
    // Save to trigger pre-save middleware for composite key regeneration
    await drawing.save();

    // Populate and return
    await drawing.populate([
      { path: 'bodyTypeId', select: 'name shortName' },
      { path: 'chassisTypeId', select: 'name shortName' },
      { path: 'sizeTypeId', select: 'name shortName' },
      { path: 'features.featureId', select: 'name shortName' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'lastModifiedBy', select: 'fullName email' }
    ]);

    res.json({
      success: true,
      data: drawing,
      message: 'Drawing specification updated successfully'
    });
  } catch (error) {
    console.error('Error updating drawing specification:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Drawing specification with this combination already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Upload drawing files
router.post('/:id/files', authenticateToken,authorize(['placeholder_test']), upload.array('files', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const drawing = await DrawingSpecification.findById(id);
    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    const uploadedFiles = [];

    for (const file of files) {
      // Determine file type
      const fileExtension = path.extname(file.originalname).toLowerCase();
      let fileType = 'Other';
      
      if (['.pdf'].includes(fileExtension)) fileType = 'PDF';
      else if (['.dwg'].includes(fileExtension)) fileType = 'DWG';
      else if (['.dxf'].includes(fileExtension)) fileType = 'DXF';
      else if (['.jpg', '.jpeg'].includes(fileExtension)) fileType = 'JPG';
      else if (['.png'].includes(fileExtension)) fileType = 'PNG';

      // Upload to GridFS
      const uploadResult = await drawingSpecificationGridFS.uploadBuffer(
        file.buffer,
        `${drawing.drawingNumber}_${Date.now()}_${file.originalname}`,
        {
          originalName: file.originalname,
          drawingId: id,
          uploadedBy: req.user.userId
        }
      );

      // Add to drawing files array
      const fileData = {
        fileId: uploadResult.fileId,
        filename: uploadResult.filename,
        originalName: file.originalname,
        fileType: fileType,
        fileSize: file.size,
        uploadDate: new Date()
      };

      drawing.drawingFiles.push(fileData);
      uploadedFiles.push(fileData);
    }

    await drawing.save();

    res.json({
      success: true,
      data: {
        drawing: drawing,
        uploadedFiles: uploadedFiles
      },
      message: 'Files uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});


// Replace drawing file
router.put('/:id/files/:fileId/replace', authenticateToken,authorize(['placeholder_test']), upload.single('file'), async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided for replacement'
      });
    }

    const drawing = await DrawingSpecification.findById(id);
    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    // Check if file exists in drawing
    const fileIndex = drawing.drawingFiles.findIndex(file => file.fileId.toString() === fileId);
    if (fileIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'File not found in this drawing specification'
      });
    }

    // Determine file type
    const fileExtension = path.extname(file.originalname).toLowerCase();
    let fileType = 'Other';
    if (['.pdf'].includes(fileExtension)) fileType = 'PDF';
    else if (['.dwg'].includes(fileExtension)) fileType = 'DWG';
    else if (['.dxf'].includes(fileExtension)) fileType = 'DXF';
    else if (['.jpg', '.jpeg'].includes(fileExtension)) fileType = 'JPG';
    else if (['.png'].includes(fileExtension)) fileType = 'PNG';

    // Replace file using GridFS helper
    const replaceResult = await drawingSpecificationGridFS.replaceFile(
      fileId,
      file.buffer,
      `${drawing.drawingNumber}_${Date.now()}_${file.originalname}`,
      {
        originalName: file.originalname,
        uploadedBy: req.user.userId,
        drawingId: id,
        replacedAt: new Date()
      },
      file.mimetype
    );

    // Delete old file
    await drawingSpecificationGridFS.deleteFile(fileId);

    // Update drawing record with new file info
    drawing.drawingFiles[fileIndex] = {
      fileId: replaceResult.newFile.fileId,
      filename: replaceResult.newFile.filename,
      originalName: file.originalname,
      fileType: fileType,
      fileSize: file.size,
      uploadDate: replaceResult.newFile.uploadDate
    };

    await drawing.save();

    res.json({
      success: true,
      message: 'File replaced successfully',
      data: {
        oldFileId: fileId,
        newFile: drawing.drawingFiles[fileIndex]
      }
    });

  } catch (error) {
    console.error('Error replacing file:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Delete drawing file
router.delete('/:id/files/:fileId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id, fileId } = req.params;

    const drawing = await DrawingSpecification.findById(id);
    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    const fileIndex = drawing.drawingFiles.findIndex(file => file.fileId.toString() === fileId);
    if (fileIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Delete from GridFS
    await drawingSpecificationGridFS.deleteFile(fileId);

    // Remove from drawing files array
    drawing.drawingFiles.splice(fileIndex, 1);
    await drawing.save();

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Delete drawing specification
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;

    const drawing = await DrawingSpecification.findById(id);
    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }

    
    // Delete associated files from GridFS if they exist
    let message = 'Drawing specification deleted successfully';
    const deletedFiles = [];
    
    // Delete drawing file (DWG/DXF)
    if (drawing.drawingFile && drawing.drawingFile.fileId) {
      try {
        await drawingSpecificationGridFS.deleteFile(drawing.drawingFile.fileId);
        deletedFiles.push(`drawing file: ${drawing.drawingFile.originalName}`);
      } catch (error) {
        console.error(`Failed to delete drawing file ${drawing.drawingFile.originalName} (ID: ${drawing.drawingFile.fileId}):`, error);
        message += `. Warning: Failed to delete drawing file from storage.`;
      }
    }

    // Delete quotation image (JPG)
    if (drawing.quotationImage && drawing.quotationImage.fileId) {
      try {
        await drawingSpecificationGridFS.deleteFile(drawing.quotationImage.fileId);
        deletedFiles.push(`quotation image: ${drawing.quotationImage.originalName}`);
      } catch (error) {
        console.error(`Failed to delete quotation image ${drawing.quotationImage.originalName} (ID: ${drawing.quotationImage.fileId}):`, error);
        message += `. Warning: Failed to delete quotation image from storage.`;
      }
    }

    if (deletedFiles.length > 0) {
      message += `. Deleted ${deletedFiles.join(', ')}.`;
    }

    // Delete the drawing specification from database
    await DrawingSpecification.findByIdAndDelete(id);

    res.json({
      success: true,
      message: message
    });
  } catch (error) {
    console.error('Error deleting drawing specification:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/drawing-specifications/:id/download
 * Download drawing file (decompressed)
 * Required Permission: placeholder_test
 */
router.get('/:id/download', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const drawing = await DrawingSpecification.findById(id);
    if (!drawing) {
      return res.status(404).json({
        success: false,
        message: 'Drawing specification not found'
      });
    }
    
    if (!drawing.drawingFile || !drawing.drawingFile.fileId) {
      return res.status(404).json({
        success: false,
        message: 'No drawing file found for this specification'
      });
    }
    
    // Get compressed file buffer
    const compressedBuffer = await drawingSpecificationGridFS.getFileBuffer(drawing.drawingFile.fileId);
    
    // Decompress the file if it's compressed
    let fileBuffer;
    if (drawing.drawingFile.isCompressed) {
      fileBuffer = await decompressBuffer(compressedBuffer);
    } else {
      fileBuffer = compressedBuffer;
    }
    
    // Determine filename based on stored format
    const originalName = drawing.drawingFile.originalName;
    const baseName = path.parse(originalName).name;
    const storedFormat = drawing.drawingFile.storedFormat || 'DXF';
    const uploadedFormat = drawing.drawingFile.uploadedFormat || 'DWG';
    
    console.log('[Download] File info:', {
      originalName: originalName,
      uploadedFormat: uploadedFormat,
      storedFormat: storedFormat,
      isCompressed: drawing.drawingFile.isCompressed,
      fileBufferSize: fileBuffer.length
    });
    
    // If file was stored as DWG (conversion didn't happen), we need to check if it's actually DWG
    // The storedFormat should reflect what's actually in the file
    const downloadFilename = `${baseName}.${storedFormat.toLowerCase()}`;
    
    // Set appropriate content type
    const contentType = storedFormat === 'DXF' ? 'application/dxf' : 'application/dwg';
    
    console.log('[Download] Sending file:', {
      filename: downloadFilename,
      contentType: contentType,
      format: storedFormat
    });
    
    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    
    // Send the decompressed file
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error downloading drawing file:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message || 'Error downloading file'
      });
    }
  }
});

// Cleanup orphaned chunks (admin utility endpoint)
router.post('/cleanup-orphaned-chunks', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
        const result = await drawingSpecificationGridFS.cleanupOrphanedChunks();
    
    res.json({
      success: true,
      message: `Cleanup completed. Removed ${result.cleaned} orphaned chunks.`,
      cleaned: result.cleaned
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
