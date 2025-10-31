/**
 * File Compression Helper
 * 
 * This utility handles compression of DXF files before storage in GridFS.
 * Uses Node.js built-in zlib for gzip compression.
 */

const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Compress buffer using gzip
 * 
 * @param {Buffer} buffer - The file buffer to compress
 * @returns {Promise<{compressed: Buffer, originalSize: number, compressedSize: number, ratio: number}>}
 */
async function compressBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Input must be a Buffer');
  }
  
  const originalSize = buffer.length;
  const compressed = await gzip(buffer);
  const compressedSize = compressed.length;
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2);
  
  return {
    compressed,
    originalSize,
    compressedSize,
    ratio: parseFloat(ratio),
    isCompressed: true
  };
}

/**
 * Decompress gzip buffer
 * 
 * @param {Buffer} compressedBuffer - The compressed buffer
 * @returns {Promise<Buffer>} - Decompressed buffer
 */
async function decompressBuffer(compressedBuffer) {
  if (!Buffer.isBuffer(compressedBuffer)) {
    throw new Error('Input must be a Buffer');
  }
  
  try {
    const decompressed = await gunzip(compressedBuffer);
    return decompressed;
  } catch (error) {
    // If decompression fails, assume it's not compressed and return as-is
    if (error.code === 'Z_DATA_ERROR' || error.code === 'UNKNOWN') {
      console.warn('Failed to decompress - file may not be compressed:', error.message);
      return compressedBuffer;
    }
    throw error;
  }
}

/**
 * Get compression info without actually compressing
 * Useful for estimating compression ratio
 * 
 * @param {Buffer} buffer - The file buffer
 * @returns {Promise<{estimatedRatio: string}>}
 */
async function estimateCompression(buffer) {
  const { ratio } = await compressBuffer(buffer);
  return {
    estimatedRatio: `${ratio}%`
  };
}

module.exports = {
  compressBuffer,
  decompressBuffer,
  estimateCompression
};



