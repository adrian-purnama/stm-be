const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const fs = require('fs');
const path = require('path');

class GridFSHelper {
  constructor(bucketName = 'files') {
    this.bucketName = bucketName;
    this.bucket = null;
  }

  // Initialize GridFS bucket
  initBucket() {
    if (!this.bucket) {
      if (!mongoose.connection.db) {
        throw new Error('Database connection not established. Make sure MongoDB is connected.');
      }
      this.bucket = new GridFSBucket(mongoose.connection.db, {
        bucketName: this.bucketName
      });
    }
    return this.bucket;
  }

  // Upload file to GridFS
  async uploadFile(filePath, filename, metadata = {}) {
    try {
      this.initBucket();
      
      const uploadStream = this.bucket.openUploadStream(filename, {
        metadata: {
          ...metadata,
          uploadDate: new Date()
        }
      });

      return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(filePath);
        
        readStream.pipe(uploadStream);
        
        uploadStream.on('error', (error) => {
          reject(error);
        });
        
        uploadStream.on('finish', () => {
          resolve({
            fileId: uploadStream.id,
            filename: uploadStream.filename,
            length: uploadStream.length,
            chunkSize: uploadStream.chunkSize,
            uploadDate: uploadStream.uploadDate,
            metadata: uploadStream.options.metadata
          });
        });
      });
    } catch (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  // Upload file from buffer
  async uploadBuffer(buffer, filename, metadata = {}, contentType = null) {
    try {
      this.initBucket();
      
      const uploadOptions = {
        metadata: {
          ...metadata,
          uploadDate: new Date()
        }
      };
      
      // Set content type if provided
      if (contentType) {
        uploadOptions.contentType = contentType;
      }
      
      const uploadStream = this.bucket.openUploadStream(filename, uploadOptions);

      return new Promise((resolve, reject) => {
        uploadStream.write(buffer);
        uploadStream.end();
        
        uploadStream.on('error', (error) => {
          reject(error);
        });
        
        uploadStream.on('finish', () => {
          resolve({
            fileId: uploadStream.id,
            filename: uploadStream.filename,
            length: uploadStream.length,
            chunkSize: uploadStream.chunkSize,
            uploadDate: uploadStream.uploadDate,
            metadata: uploadStream.options.metadata
          });
        });
      });
    } catch (error) {
      throw new Error(`Failed to upload buffer: ${error.message}`);
    }
  }

  // Download file to local path
  async downloadFile(fileId, outputPath) {
    try {
      this.initBucket();
      
      const downloadStream = this.bucket.openDownloadStream(fileId);
      const writeStream = fs.createWriteStream(outputPath);

      return new Promise((resolve, reject) => {
        downloadStream.pipe(writeStream);
        
        downloadStream.on('error', (error) => {
          reject(error);
        });
        
        writeStream.on('error', (error) => {
          reject(error);
        });
        
        writeStream.on('finish', () => {
          resolve(outputPath);
        });
      });
    } catch (error) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  // Get file as buffer
  async getFileBuffer(fileId) {
    try {
      this.initBucket();
      
      const downloadStream = this.bucket.openDownloadStream(fileId);
      const chunks = [];

      return new Promise((resolve, reject) => {
        downloadStream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        downloadStream.on('error', (error) => {
          reject(error);
        });
        
        downloadStream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });
    } catch (error) {
      throw new Error(`Failed to get file buffer: ${error.message}`);
    }
  }

  // Get file metadata
  async getFileMetadata(fileId) {
    try {
      this.initBucket();
      
      if (!this.bucket) {
        throw new Error('GridFS bucket not initialized');
      }
      
      const files = await this.bucket.find({ _id: fileId }).toArray();
      
      if (files.length === 0) {
        throw new Error(`File not found with ID: ${fileId}`);
      }
      
      return files[0];
    } catch (error) {
      console.error(`[GridFS Error] getFileMetadata failed for fileId: ${fileId}, bucketName: ${this.bucketName}`, error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }

  // List files with optional filter
  async listFiles(filter = {}) {
    try {
      this.initBucket();
      
      const files = await this.bucket.find(filter).toArray();
      return files;
    } catch (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  // Delete file
  async deleteFile(fileId) {
    try {
      this.initBucket();
      
      // First check if file exists
      const file = await this.bucket.find({ _id: fileId }).next();
      if (!file) {
        console.warn(`File with ID ${fileId} not found in GridFS`);
        return { success: true, message: 'File not found (already deleted or never existed)' };
      }
      
      console.log(`Deleting file from GridFS: ${file.filename} (ID: ${fileId})`);
      
      // Delete the file (this removes both metadata and chunks)
      await this.bucket.delete(fileId);
      
      console.log(`Successfully deleted file from GridFS: ${file.filename}`);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      console.error(`Failed to delete file ${fileId} from GridFS:`, error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  // Check if file exists
  async fileExists(fileId) {
    try {
      const metadata = await this.getFileMetadata(fileId);
      return !!metadata;
    } catch (error) {
      return false;
    }
  }

  // Clean up orphaned chunks (utility function)
  async cleanupOrphanedChunks() {
    try {
      this.initBucket();
      
      // Get all files in the files collection
      const files = await this.bucket.find({}).toArray();
      const fileIds = new Set(files.map(file => file._id.toString()));
      
      // Get all chunks
      const chunksCollection = this.bucket.s.db.collection(`${this.bucketName}.chunks`);
      const chunks = await chunksCollection.find({}).toArray();
      
      // Find orphaned chunks (chunks without corresponding files)
      const orphanedChunks = chunks.filter(chunk => 
        !fileIds.has(chunk.files_id.toString())
      );
      
      if (orphanedChunks.length > 0) {
        console.log(`Found ${orphanedChunks.length} orphaned chunks, cleaning up...`);
        
        // Delete orphaned chunks
        const orphanedChunkIds = orphanedChunks.map(chunk => chunk._id);
        await chunksCollection.deleteMany({ _id: { $in: orphanedChunkIds } });
        
        console.log(`Cleaned up ${orphanedChunks.length} orphaned chunks`);
        return { cleaned: orphanedChunks.length };
      } else {
        console.log('No orphaned chunks found');
        return { cleaned: 0 };
      }
    } catch (error) {
      console.error('Error cleaning up orphaned chunks:', error);
      throw new Error(`Failed to cleanup orphaned chunks: ${error.message}`);
    }
  }

  // Get file stream for serving
  getFileStream(fileId) {
    try {
      this.initBucket();
      return this.bucket.openDownloadStream(fileId);
    } catch (error) {
      throw new Error(`Failed to get file stream: ${error.message}`);
    }
  }

  // Get file stream by filename
  getFileStreamByName(filename) {
    try {
      this.initBucket();
      return this.bucket.openDownloadStreamByName(filename);
    } catch (error) {
      throw new Error(`Failed to get file stream by name: ${error.message}`);
    }
  }

  // Replace file (upload new, return new file info, let caller handle old file deletion)
  async replaceFile(oldFileId, newBuffer, newFilename, newMetadata = {}, contentType = null) {
    try {
      this.initBucket();
      
      // First, upload the new file
      const uploadResult = await this.uploadBuffer(newBuffer, newFilename, newMetadata, contentType);
      
      // Return both new file info and old file ID for cleanup
      return {
        newFile: uploadResult,
        oldFileId: oldFileId,
        success: true
      };
    } catch (error) {
      throw new Error(`Failed to replace file: ${error.message}`);
    }
  }
}

// Create instances for different buckets
// Create GridFS instances lazily to ensure database connection is established
let drawingSpecificationGridFS = null;
let notesImagesGridFS = null;

const getDrawingSpecificationGridFS = () => {
  if (!drawingSpecificationGridFS) {
    drawingSpecificationGridFS = new GridFSHelper('drawingspecification');
  }
  return drawingSpecificationGridFS;
};

const getNotesImagesGridFS = () => {
  if (!notesImagesGridFS) {
    notesImagesGridFS = new GridFSHelper('notesImages');
  }
  return notesImagesGridFS;
};

module.exports = {
  GridFSHelper,
  getDrawingSpecificationGridFS,
  getNotesImagesGridFS,
  // Keep the old exports for backward compatibility
  get drawingSpecificationGridFS() { return getDrawingSpecificationGridFS(); },
  get notesImagesGridFS() { return getNotesImagesGridFS(); }
};
