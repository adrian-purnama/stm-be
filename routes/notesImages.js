const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const { notesImagesGridFS } = require('../utils/gridfsHelper');
const NotesImage = require('../models/notesImage.model');
const QuotationOffer = require('../models/quotationOffer.model');
const { cleanupUnusedNotesImages, getNotesImageStats } = require('../utils/notesImageCleanup');
const { getContentType } = require('../utils/contentTypeHelper');
const { verifyToken } = require('../utils/jwtHelper');
const { optimizeImageAggressive } = require('../utils/imageOptimizationHelper');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow image files and common document types
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/plain', // .txt
      'text/csv' // .csv
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Allowed types: Images (JPG, PNG, GIF, WEBP), PDF, DOC, DOCX, XLS, XLSX, TXT, CSV'), false);
    }
  }
});

// Upload notes image or document (standalone)
router.post('/upload', authenticateToken, authorize(['placeholder_test']), upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const isImage = req.file.mimetype.startsWith('image/');
    let fileBuffer = req.file.buffer;
    let originalFileSize = req.file.size;
    let optimizedFileSize = req.file.size;
    let isOptimized = false;

    // Only optimize images, not documents
    if (isImage) {
      try {
        console.log('[Upload] Optimizing notes image:', req.file.originalname, `(${req.file.size} bytes)`);
        const optimizationResult = await optimizeImageAggressive(req.file.buffer);
        fileBuffer = optimizationResult.optimized;
        originalFileSize = optimizationResult.originalSize;
        optimizedFileSize = optimizationResult.optimizedSize;
        isOptimized = true;
        
        console.log('[Upload] Image optimization result:', {
          original: `${(originalFileSize / 1024).toFixed(2)} KB`,
          optimized: `${(optimizedFileSize / 1024).toFixed(2)} KB`,
          reduction: `${optimizationResult.ratio}%`,
          dimensions: `${optimizationResult.originalDimensions.width}x${optimizationResult.originalDimensions.height} → ${optimizationResult.optimizedDimensions.width}x${optimizationResult.optimizedDimensions.height}`
        });
      } catch (optimizationError) {
        console.error('[Upload] Image optimization failed:', optimizationError.message);
        return res.status(400).json({
          success: false,
          message: `Image optimization failed: ${optimizationError.message}`
        });
      }
    }

    // Determine file type and category
    const mimeType = req.file.mimetype;
    let fileType = mimeType.split('/')[1]?.toUpperCase();
    let fileCategory = isImage ? 'image' : 'document';
    
    // Handle special cases for file types
    if (mimeType === 'application/pdf') {
      fileType = 'PDF';
    } else if (mimeType === 'application/msword') {
      fileType = 'DOC';
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      fileType = 'DOCX';
    } else if (mimeType === 'application/vnd.ms-excel') {
      fileType = 'XLS';
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      fileType = 'XLSX';
    } else if (mimeType === 'text/plain') {
      fileType = 'TXT';
    } else if (mimeType === 'text/csv') {
      fileType = 'CSV';
    }

    // Upload file to GridFS
    const uploadResult = await notesImagesGridFS.uploadBuffer(
      fileBuffer,
      req.file.originalname,
      {
        originalName: req.file.originalname,
        uploadedBy: userId,
        type: 'notes-attachment',
        originalFileSize: originalFileSize,
        optimizedFileSize: isOptimized ? optimizedFileSize : undefined,
        isOptimized: isOptimized
      },
      mimeType // Pass the content type
    );

    // Create notes image/document record
    const notesImageData = {
      imageFile: {
        fileId: uploadResult.fileId,
        filename: uploadResult.filename,
        originalName: req.file.originalname,
        fileType: fileType,
        fileCategory: fileCategory,
        mimeType: mimeType,
        fileSize: optimizedFileSize,
        originalFileSize: originalFileSize,
        isOptimized: isOptimized,
        uploadDate: new Date()
      }
    };

    // Add createdBy only if userId is available
    if (userId) {
      notesImageData.createdBy = userId;
    }

    const notesImage = new NotesImage(notesImageData);

    await notesImage.save();

    const responseData = {
      id: notesImage._id,
      imageFile: notesImage.imageFile,
      createdAt: notesImage.createdAt
    };

    // Add createdBy info only if available
    if (userId && req.user) {
      responseData.createdBy = {
        id: userId,
        name: req.user.fullName || 'Unknown User'
      };
    }

    res.status(201).json({
      success: true,
      message: isImage ? 'Notes image uploaded successfully' : 'Document uploaded successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message
    });
  }
});

// Helper function to clean up orphaned images when offers are deleted
const cleanupOrphanedImages = async (offerIds) => {
  try {
    // Get all notes images from the offers being deleted
    const offers = await QuotationOffer.find({ _id: { $in: offerIds } }).select('notesImages');
    const allImageIds = [];
    offers.forEach(offer => {
      if (offer.notesImages && offer.notesImages.length > 0) {
        allImageIds.push(...offer.notesImages);
      }
    });

    if (allImageIds.length === 0) {
      return { deletedCount: 0, keptCount: 0 };
    }

    // Check which images are still used in other offers
    const stillUsedImages = await QuotationOffer.find({
      _id: { $nin: offerIds }, // Exclude the offers being deleted
      notesImages: { $in: allImageIds }
    }).select('notesImages');

    const stillUsedImageIds = new Set();
    stillUsedImages.forEach(offer => {
      if (offer.notesImages) {
        offer.notesImages.forEach(imageId => stillUsedImageIds.add(imageId.toString()));
      }
    });

    // Find images that are no longer used anywhere
    const orphanedImageIds = allImageIds.filter(imageId => 
      !stillUsedImageIds.has(imageId.toString())
    );

    let deletedCount = 0;
    let keptCount = 0;

    // Delete orphaned images
    for (const imageId of orphanedImageIds) {
      try {
        const notesImage = await NotesImage.findById(imageId);
        if (notesImage) {
          // Delete file from GridFS
          await notesImagesGridFS.deleteFile(notesImage.imageFile.fileId);
          // Delete notes image record
          await NotesImage.findByIdAndDelete(imageId);
          deletedCount++;
        }
      } catch (error) {
        console.error(`Error deleting orphaned image ${imageId}:`, error);
      }
    }

    keptCount = allImageIds.length - deletedCount;

    return { deletedCount, keptCount, orphanedImageIds, stillUsedImageIds: Array.from(stillUsedImageIds) };
  } catch (error) {
    console.error('Error cleaning up orphaned images:', error);
    return { deletedCount: 0, keptCount: 0, error: error.message };
  }
};

// Check if an image is used in other offers
router.get('/:imageId/usage', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { imageId } = req.params;
    
    // Find all offers that reference this image
    const offersUsingImage = await QuotationOffer.find({
      notesImages: imageId
    }).select('_id offerNumberInQuotation revision quotationHeaderId');
    
    res.json({
      success: true,
      data: {
        imageId,
        isUsed: offersUsingImage.length > 0,
        usedInOffers: offersUsingImage,
        usageCount: offersUsingImage.length
      }
    });
  } catch (error) {
    console.error('Error checking image usage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check image usage',
      error: error.message
    });
  }
});

// Get all notes images for an offer
router.get('/offer/:offerId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { offerId } = req.params;

    // Validate offer exists and get notes images
    const offer = await QuotationOffer.findById(offerId).populate('notesImages');
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Quotation offer not found'
      });
    }

    res.json({
      success: true,
      data: {
        images: offer.notesImages.map(img => ({
          id: img._id,
          imageFile: img.imageFile,
          createdBy: img.createdBy,
          lastAccessed: img.lastAccessed,
          createdAt: img.createdAt,
          updatedAt: img.updatedAt
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching notes images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notes images',
      error: error.message
    });
  }
});

// Add notes image to offer
router.post('/offer/:offerId/add/:imageId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { offerId, imageId } = req.params;

    // Validate offer exists
    const offer = await QuotationOffer.findById(offerId);
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Quotation offer not found'
      });
    }

    // Validate notes image exists and update lastAccessed
    const notesImage = await NotesImage.findById(imageId);
    if (!notesImage) {
      return res.status(404).json({
        success: false,
        message: 'Notes image not found'
      });
    }

    // Update lastAccessed timestamp
    notesImage.lastAccessed = new Date();
    await notesImage.save();

    // Add image to offer's notesImages array
    await offer.addNotesImage(imageId);

    res.json({
      success: true,
      message: 'Notes image added to offer successfully'
    });

  } catch (error) {
    console.error('Error adding notes image to offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add notes image to offer',
      error: error.message
    });
  }
});

// Remove notes image from offer (smart deletion)
router.delete('/offer/:offerId/remove/:imageId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { offerId, imageId } = req.params;

    // Validate offer exists
    const offer = await QuotationOffer.findById(offerId);
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Quotation offer not found'
      });
    }

    // Remove image from offer's notesImages array
    await offer.removeNotesImage(imageId);

    // Check if image is used in other offers
    const offersUsingImage = await QuotationOffer.find({
      notesImages: imageId
    }).select('_id offerNumberInQuotation revision quotationHeaderId');

    let deletionResult = null;
    if (offersUsingImage.length === 0) {
      // Image is not used anywhere else - delete it entirely
      const notesImage = await NotesImage.findById(imageId);
      if (notesImage) {
        // Delete file from GridFS
        await notesImagesGridFS.deleteFile(notesImage.imageFile.fileId);
        // Delete notes image record
        await NotesImage.findByIdAndDelete(imageId);
        deletionResult = 'deleted_entirely';
      }
    } else {
      deletionResult = 'removed_from_offer_only';
    }

    res.json({
      success: true,
      message: deletionResult === 'deleted_entirely' 
        ? 'File removed from offer and deleted (not used elsewhere)'
        : 'File removed from offer (still used in other offers)',
      data: {
        deletionResult,
        stillUsedInOffers: offersUsingImage,
        usageCount: offersUsingImage.length
      }
    });

  } catch (error) {
    console.error('Error removing notes image from offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove file from offer',
      error: error.message
    });
  }
});

// Replace notes image file
router.put('/:imageId/files/:fileId/replace', authenticateToken, authorize(['placeholder_test']), upload.single('file'), async (req, res) => {
  try {
    const { imageId, fileId } = req.params;
    const file = req.file;
    const userId = req.user.id;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided for replacement'
      });
    }

    // Validate it's an allowed file type (image or document)
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv'
    ];
    
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'File type not allowed. Allowed types: Images (JPG, PNG, GIF, WEBP), PDF, DOC, DOCX, XLS, XLSX, TXT, CSV'
      });
    }

    const notesImage = await NotesImage.findById(imageId);
    if (!notesImage) {
      return res.status(404).json({
        success: false,
        message: 'Notes image not found'
      });
    }

    // Check if user has permission (creator or admin)
    if (notesImage.createdBy && notesImage.createdBy.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    // Check if the fileId matches the current file
    if (notesImage.imageFile.fileId.toString() !== fileId) {
      return res.status(404).json({
        success: false,
        message: 'File not found in this notes image'
      });
    }

    const isImage = file.mimetype.startsWith('image/');
    let fileBuffer = file.buffer;
    let originalFileSize = file.size;
    let optimizedFileSize = file.size;
    let isOptimized = false;

    // Only optimize images, not documents
    if (isImage) {
      try {
        const optimizationResult = await optimizeImageAggressive(file.buffer);
        fileBuffer = optimizationResult.optimized;
        originalFileSize = optimizationResult.originalSize;
        optimizedFileSize = optimizationResult.optimizedSize;
        isOptimized = true;
      } catch (optimizationError) {
        console.error('[Replace] Image optimization failed:', optimizationError.message);
        // Continue with original file if optimization fails
      }
    }

    // Determine file type and category
    const mimeType = file.mimetype;
    let fileType = mimeType.split('/')[1]?.toUpperCase();
    let fileCategory = isImage ? 'image' : 'document';
    
    // Handle special cases for file types
    if (mimeType === 'application/pdf') {
      fileType = 'PDF';
    } else if (mimeType === 'application/msword') {
      fileType = 'DOC';
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      fileType = 'DOCX';
    } else if (mimeType === 'application/vnd.ms-excel') {
      fileType = 'XLS';
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      fileType = 'XLSX';
    } else if (mimeType === 'text/plain') {
      fileType = 'TXT';
    } else if (mimeType === 'text/csv') {
      fileType = 'CSV';
    }

    // Replace file using GridFS helper
    const replaceResult = await notesImagesGridFS.replaceFile(
      fileId,
      fileBuffer,
      `${imageId}_${Date.now()}_${file.originalname}`,
      {
        originalName: file.originalname,
        uploadedBy: userId,
        type: 'notes-attachment',
        originalFileSize: originalFileSize,
        optimizedFileSize: isOptimized ? optimizedFileSize : undefined,
        isOptimized: isOptimized,
        replacedAt: new Date()
      },
      mimeType
    );

    // Delete old file
    await notesImagesGridFS.deleteFile(fileId);

    // Update notes image record with new file info
    notesImage.imageFile = {
      fileId: replaceResult.newFile.fileId,
      filename: replaceResult.newFile.filename,
      originalName: file.originalname,
      fileType: fileType,
      fileCategory: fileCategory,
      mimeType: mimeType,
      fileSize: optimizedFileSize,
      originalFileSize: originalFileSize,
      isOptimized: isOptimized,
      uploadDate: replaceResult.newFile.uploadDate
    };

    notesImage.lastModifiedBy = userId;
    await notesImage.save();

    res.json({
      success: true,
      message: 'File replaced successfully',
      data: {
        oldFileId: fileId,
        newFile: notesImage.imageFile
      }
    });

  } catch (error) {
    console.error('Error replacing notes image file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to replace file',
      error: error.message
    });
  }
});

// Delete notes image (standalone)
router.delete('/:imageId', authenticateToken, authorize(['placeholder_test']), async (req, res) => {
  try {
    const { imageId } = req.params;
    const userId = req.user.id;

    const notesImage = await NotesImage.findById(imageId);
    if (!notesImage) {
      return res.status(404).json({
        success: false,
        message: 'Notes image not found'
      });
    }

    // Check if user has permission (creator or admin)
    // If createdBy is null/undefined, allow deletion (for images created without user context)
    if (notesImage.createdBy && notesImage.createdBy.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    // Check if image is used in other offers
    const offersUsingImage = await QuotationOffer.find({
      notesImages: imageId
    }).select('_id offerNumberInQuotation revision quotationHeaderId');

    if (offersUsingImage.length > 0) {
      // Image is used in other offers - don't delete, just return info
      res.json({
        success: false,
        message: 'Cannot delete file - it is used in other offers',
        data: {
          imageId,
          usedInOffers: offersUsingImage,
          usageCount: offersUsingImage.length
        }
      });
      return;
    }

    // Image is not used anywhere - safe to delete entirely
    // Delete file from GridFS
    await notesImagesGridFS.deleteFile(notesImage.imageFile.fileId);

    // Delete notes image record
    await NotesImage.findByIdAndDelete(imageId);

    res.json({
      success: true,
      message: 'File deleted successfully (not used in other offers)'
    });

  } catch (error) {
    console.error('Error deleting notes image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file',
      error: error.message
    });
  }
});


// Get notes images statistics (admin only)
router.get('/stats', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const stats = await getNotesImageStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting notes image stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error.message
    });
  }
});

// Cleanup unused notes images (admin only)
router.post('/cleanup', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { daysOld = 30, dryRun = true } = req.body;
    
    const results = await cleanupUnusedNotesImages(daysOld, dryRun);
    
    res.json({
      success: true,
      message: dryRun ? 'Cleanup simulation completed' : 'Cleanup completed',
      data: results
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Cleanup failed',
      error: error.message
    });
  }
});


module.exports = { router, cleanupOrphanedImages };
