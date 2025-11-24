const NotesImage = require('../models/notesImage.model');
const { notesImagesGridFS } = require('./gridfsHelper');

/**
 * Clean up unused notes images older than specified days
 * @param {number} daysOld - Number of days after which unused images are considered for cleanup
 * @param {boolean} dryRun - If true, only log what would be deleted without actually deleting
 * @returns {Object} Cleanup results
 */
const cleanupUnusedNotesImages = async (daysOld = 30, dryRun = true) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    console.log(`[CLEANUP] Looking for notes images not accessed since: ${cutoffDate.toISOString()}`);

    // Find images that haven't been accessed in the specified period
    const unusedImages = await NotesImage.find({
      lastAccessed: { $lt: cutoffDate }
    });

    console.log(`[CLEANUP] Found ${unusedImages.length} potentially unused images`);

    const results = {
      totalFound: unusedImages.length,
      deleted: 0,
      errors: 0,
      details: []
    };

    for (const image of unusedImages) {
      try {
        // Check if image is still referenced by any offers
        const QuotationOffer = require('../models/quotationOffer.model');
        const referencedOffers = await QuotationOffer.find({
          notesImages: image._id
        });

        if (referencedOffers.length > 0) {
          console.log(`[CLEANUP] Image ${image._id} is still referenced by ${referencedOffers.length} offers, skipping`);
          results.details.push({
            imageId: image._id,
            filename: image.imageFile.originalName,
            status: 'skipped',
            reason: `Referenced by ${referencedOffers.length} offers`,
            lastAccessed: image.lastAccessed
          });
          continue;
        }

        if (dryRun) {
          console.log(`[CLEANUP] DRY RUN: Would delete image ${image._id} (${image.imageFile.originalName})`);
          results.details.push({
            imageId: image._id,
            filename: image.imageFile.originalName,
            status: 'would_delete',
            reason: 'Not referenced by any offers',
            lastAccessed: image.lastAccessed
          });
        } else {
          // Delete file from GridFS
          await notesImagesGridFS.deleteFile(image.imageFile.fileId);
          
          // Delete image record
          await NotesImage.findByIdAndDelete(image._id);
          
          console.log(`[CLEANUP] Deleted image ${image._id} (${image.imageFile.originalName})`);
          results.details.push({
            imageId: image._id,
            filename: image.imageFile.originalName,
            status: 'deleted',
            reason: 'Not referenced by any offers',
            lastAccessed: image.lastAccessed
          });
          results.deleted++;
        }
      } catch (error) {
        console.error(`[CLEANUP] Error processing image ${image._id}:`, error);
        results.errors++;
        results.details.push({
          imageId: image._id,
          filename: image.imageFile.originalName,
          status: 'error',
          reason: error.message,
          lastAccessed: image.lastAccessed
        });
      }
    }

    console.log(`[CLEANUP] Cleanup completed:`, {
      total: results.totalFound,
      deleted: results.deleted,
      errors: results.errors,
      dryRun: dryRun
    });

    return results;
  } catch (error) {
    console.error('[CLEANUP] Error during cleanup:', error);
    throw error;
  }
};

/**
 * Get statistics about notes images usage
 * @returns {Object} Usage statistics
 */
const getNotesImageStats = async () => {
  try {
    const totalImages = await NotesImage.countDocuments();
    
    const QuotationOffer = require('../models/quotationOffer.model');
    const totalReferences = await QuotationOffer.aggregate([
      { $unwind: '$notesImages' },
      { $count: 'total' }
    ]);

    const unusedImages = await NotesImage.countDocuments({
      lastAccessed: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    const totalSize = await NotesImage.aggregate([
      { $group: { _id: null, totalSize: { $sum: '$imageFile.fileSize' } } }
    ]);

    return {
      totalImages,
      totalReferences: totalReferences[0]?.total || 0,
      unusedImages,
      totalSizeBytes: totalSize[0]?.totalSize || 0,
      totalSizeMB: Math.round((totalSize[0]?.totalSize || 0) / 1024 / 1024 * 100) / 100
    };
  } catch (error) {
    console.error('Error getting notes image stats:', error);
    throw error;
  }
};

module.exports = {
  cleanupUnusedNotesImages,
  getNotesImageStats
};
