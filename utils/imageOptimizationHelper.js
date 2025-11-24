/**
 * Image Optimization Helper
 * 
 * This utility handles compression, resizing, and optimization of image files
 * to make them as small as possible while maintaining acceptable quality.
 * Uses Sharp library for high-performance image processing.
 */

const sharp = require('sharp');

/**
 * Optimize image buffer (compress and resize)
 * 
 * @param {Buffer} imageBuffer - The image buffer to optimize
 * @param {Object} options - Optimization options
 * @param {number} options.maxWidth - Maximum width (default: 1920)
 * @param {number} options.maxHeight - Maximum height (default: 1920)
 * @param {number} options.quality - JPEG quality 1-100 (default: 75)
 * @param {boolean} options.progressive - Use progressive JPEG (default: true)
 * @param {boolean} options.mozjpeg - Use mozjpeg encoder (default: true)
 * @returns {Promise<{optimized: Buffer, originalSize: number, optimizedSize: number, ratio: number}>}
 */
async function optimizeImage(imageBuffer, options = {}) {
  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error('Input must be a Buffer');
  }

  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 75,
    progressive = true,
    mozjpeg = true
  } = options;

  const originalSize = imageBuffer.length;

  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    
    // Calculate new dimensions (maintain aspect ratio)
    let newWidth = metadata.width;
    let newHeight = metadata.height;
    
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      const ratio = Math.min(maxWidth / metadata.width, maxHeight / metadata.height);
      newWidth = Math.round(metadata.width * ratio);
      newHeight = Math.round(metadata.height * ratio);
    }

    // Optimize the image
    const optimized = await sharp(imageBuffer)
      .resize(newWidth, newHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({
        quality: quality,
        progressive: progressive,
        mozjpeg: mozjpeg,
        optimizeCoding: true,
        optimizeScans: true
      })
      .toBuffer();

    const optimizedSize = optimized.length;
    const ratio = ((1 - optimizedSize / originalSize) * 100).toFixed(2);

    console.log('[Image Optimization]', {
      original: `${(originalSize / 1024).toFixed(2)} KB`,
      optimized: `${(optimizedSize / 1024).toFixed(2)} KB`,
      reduction: `${ratio}%`,
      dimensions: `${metadata.width}x${metadata.height} → ${newWidth}x${newHeight}`
    });

    return {
      optimized,
      originalSize,
      optimizedSize,
      ratio: parseFloat(ratio),
      isOptimized: true,
      originalDimensions: {
        width: metadata.width,
        height: metadata.height
      },
      optimizedDimensions: {
        width: newWidth,
        height: newHeight
      }
    };
  } catch (error) {
    console.error('[Image Optimization] Error:', error);
    throw new Error(`Image optimization failed: ${error.message}`);
  }
}

/**
 * Optimize image with aggressive settings (smallest possible file size)
 * 
 * @param {Buffer} imageBuffer - The image buffer to optimize
 * @returns {Promise<{optimized: Buffer, originalSize: number, optimizedSize: number, ratio: number}>}
 */
async function optimizeImageAggressive(imageBuffer) {
  return optimizeImage(imageBuffer, {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 65, // Lower quality for smaller file size
    progressive: true,
    mozjpeg: true
  });
}

/**
 * Optimize image with balanced settings (good quality and size)
 * 
 * @param {Buffer} imageBuffer - The image buffer to optimize
 * @returns {Promise<{optimized: Buffer, originalSize: number, optimizedSize: number, ratio: number}>}
 */
async function optimizeImageBalanced(imageBuffer) {
  return optimizeImage(imageBuffer, {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 75,
    progressive: true,
    mozjpeg: true
  });
}

module.exports = {
  optimizeImage,
  optimizeImageAggressive,
  optimizeImageBalanced
};





