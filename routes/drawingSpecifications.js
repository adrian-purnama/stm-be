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
const { drawingSpecificationGridFS } = require('../utils/gridfsHelper');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types for drawings
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/webp',
      'application/dwg',
      'application/dxf',
      'application/octet-stream' // For DWG/DXF files
    ];
    
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.toLowerCase().match(/\.(pdf|dwg|dxf|jpg|jpeg|png)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DWG, DXF, JPG, and PNG files are allowed.'), false);
    }
  }
});

// Get all drawing specifications
// =============================================================================
// DRAWING SPECIFICATION CRUD ROUTES
// =============================================================================

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
      truckType, 
      search 
    } = req.query;

    // Build filter
    const filter = {};
    
    if (truckType) {
      filter.truckType = truckType;
    }
    
    if (search) {
      filter.drawingNumber = new RegExp(search, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const drawings = await DrawingSpecification.find(filter)
      .populate('truckType', 'name')
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
router.get('/:id', authenticateToken,authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const drawing = await DrawingSpecification.findById(id)
      .populate('truckType', 'name description')
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
router.post('/', authenticateToken, authorize(['placeholder_test']), upload.single('file'), async (req, res) => {
  try {
    const { drawingNumber, truckType } = req.body;
    const file = req.file;

    // Validate required fields
    if (!drawingNumber || !truckType) {
      return res.status(400).json({
        success: false,
        message: 'Drawing number and truck type are required'
      });
    }

    // Validate file is provided
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Drawing file is required'
      });
    }

    const drawingData = {
      drawingNumber,
      truckType,
      createdBy: req.user.userId
    };

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
      `${drawingNumber}_${Date.now()}_${file.originalname}`,
      {
        originalName: file.originalname,
        uploadedBy: req.user.userId
      }
    );

    // Add file data to drawing
    drawingData.drawingFile = {
      fileId: uploadResult.fileId,
      filename: uploadResult.filename,
      originalName: file.originalname,
      fileType: fileType,
      fileSize: file.size,
      uploadDate: new Date()
    };

    const drawing = new DrawingSpecification(drawingData);
    await drawing.save();

    const populatedDrawing = await DrawingSpecification.findById(drawing._id)
      .populate('truckType', 'name')
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      data: populatedDrawing,
      message: 'Drawing specification created successfully with file'
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
        message: 'Drawing number already exists'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update drawing specification
router.put('/:id', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {
      ...req.body,
      lastModifiedBy: req.user.userId
    };

    const drawing = await DrawingSpecification.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('truckType', 'name')
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
      message: 'Drawing specification updated successfully'
    });
  } catch (error) {
    console.error('Error updating drawing specification:', error);
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

    
    // Delete associated file from GridFS if it exists
    let message = 'Drawing specification deleted successfully';
    
    if (drawing.drawingFile && drawing.drawingFile.fileId) {
      try {
        await drawingSpecificationGridFS.deleteFile(drawing.drawingFile.fileId);
        message += `. Deleted file: ${drawing.drawingFile.originalName}`;
      } catch (error) {
        console.error(`Failed to delete file ${drawing.drawingFile.originalName} (ID: ${drawing.drawingFile.fileId}):`, error);
        message += `. Warning: Failed to delete file from storage.`;
      }
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
