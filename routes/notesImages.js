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

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Upload notes image (standalone)
router.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Upload file to GridFS
    const uploadResult = await notesImagesGridFS.uploadBuffer(
      req.file.buffer,
      req.file.originalname,
      {
        originalName: req.file.originalname,
        uploadedBy: userId,
        type: 'notes-image'
      },
      req.file.mimetype // Pass the content type
    );

    // Create notes image record
    const notesImageData = {
      imageFile: {
        fileId: uploadResult.fileId,
        filename: uploadResult.filename,
        originalName: req.file.originalname,
        fileType: req.file.mimetype.split('/')[1].toUpperCase(),
        fileSize: req.file.size,
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
      message: 'Notes image uploaded successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Error uploading notes image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload notes image',
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
router.get('/:imageId/usage', authenticateToken, async (req, res) => {
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
router.get('/offer/:offerId', authenticateToken, async (req, res) => {
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
router.post('/offer/:offerId/add/:imageId', authenticateToken, async (req, res) => {
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
router.delete('/offer/:offerId/remove/:imageId', authenticateToken, async (req, res) => {
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
        ? 'Notes image removed from offer and deleted (not used elsewhere)'
        : 'Notes image removed from offer (still used in other offers)',
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
      message: 'Failed to remove notes image from offer',
      error: error.message
    });
  }
});

// Replace notes image file
router.put('/:imageId/files/:fileId/replace', authenticateToken, upload.single('file'), async (req, res) => {
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

    // Validate it's an image file
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for notes images'
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

    // Replace file using GridFS helper
    const replaceResult = await notesImagesGridFS.replaceFile(
      fileId,
      file.buffer,
      `${imageId}_${Date.now()}_${file.originalname}`,
      {
        originalName: file.originalname,
        uploadedBy: userId,
        type: 'notes-image',
        replacedAt: new Date()
      },
      file.mimetype
    );

    // Delete old file
    await notesImagesGridFS.deleteFile(fileId);

    // Update notes image record with new file info
    notesImage.imageFile = {
      fileId: replaceResult.newFile.fileId,
      filename: replaceResult.newFile.filename,
      originalName: file.originalname,
      fileType: file.mimetype.split('/')[1].toUpperCase(),
      fileSize: file.size,
      uploadDate: replaceResult.newFile.uploadDate
    };

    notesImage.lastModifiedBy = userId;
    await notesImage.save();

    res.json({
      success: true,
      message: 'Notes image replaced successfully',
      data: {
        oldFileId: fileId,
        newFile: notesImage.imageFile
      }
    });

  } catch (error) {
    console.error('Error replacing notes image file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to replace notes image',
      error: error.message
    });
  }
});

// Delete notes image (standalone)
router.delete('/:imageId', authenticateToken, async (req, res) => {
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
        message: 'Cannot delete image - it is used in other offers',
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
      message: 'Notes image deleted successfully (not used in other offers)'
    });

  } catch (error) {
    console.error('Error deleting notes image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notes image',
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
