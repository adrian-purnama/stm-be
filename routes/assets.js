const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const { drawingSpecificationGridFS, notesImagesGridFS } = require('../utils/gridfsHelper');
const { getContentType } = require('../utils/contentTypeHelper');
const { verifyToken } = require('../utils/jwtHelper');
const NotesImage = require('../models/notesImage.model');

// Serve drawing files (images, PDFs, etc.)
router.get('/drawings/:drawingId/files/:fileId', async (req, res) => {
  try {
    const { drawingId, fileId } = req.params;
    
    
    // Handle authentication - check both header and query parameter
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token;
    
    if (!authHeader && !tokenFromQuery) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // Use token from query parameter if no header token
    const token = authHeader ? authHeader.replace('Bearer ', '') : tokenFromQuery;
    
    // Verify token
    try {
      const decoded = verifyToken(token);
      
      // Token is valid, allow access (no permission checks needed for viewing assets)
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    // Convert fileId to ObjectId
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(fileId);
    } catch (error) {
      console.error('Invalid ObjectId:', fileId);
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID'
      });
    }
    
        // Get file metadata first
        const fileMetadata = await drawingSpecificationGridFS.getFileMetadata(objectId);
    if (!fileMetadata) {
      console.error('File metadata not found for ID:', fileId);
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    
    // Set appropriate headers based on file type
    const contentType = getContentType(fileMetadata.filename);
    res.setHeader('Content-Type', contentType);
    
    // Check if this is a download request (has download query parameter)
    const isDownload = req.query.download === 'true';
    const disposition = isDownload ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileMetadata.metadata?.originalName || fileMetadata.filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
        // Stream the file
        const downloadStream = drawingSpecificationGridFS.getFileStream(objectId);
    
    downloadStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming file'
        });
      }
    });
    
    
    downloadStream.pipe(res);
    
  } catch (error) {
    console.error('Error serving file:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
});


// Get file as base64 for document generation
router.get('/drawings/:drawingId/files/:fileId/base64', async (req, res) => {
  try {
    const { drawingId, fileId } = req.params;
    
    // Handle authentication - check both header and query parameter
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token;
    
    if (!authHeader && !tokenFromQuery) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // Use token from query parameter if no header token
    const token = authHeader ? authHeader.replace('Bearer ', '') : tokenFromQuery;
    
    // Verify token
    try {
      const decoded = verifyToken(token);
      
      // Token is valid, allow access (no permission checks needed for viewing assets)
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    // Convert fileId to ObjectId
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(fileId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID'
      });
    }
    
    // Get file metadata first
    const fileMetadata = await drawingSpecificationGridFS.getFileMetadata(objectId);
    if (!fileMetadata) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    // Check if it's an image file
    const contentType = getContentType(fileMetadata.filename);
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'File is not an image'
      });
    }
    
    // Get file as buffer
    const fileBuffer = await drawingSpecificationGridFS.getFileBuffer(objectId);
    
    // Convert to base64
    const base64String = fileBuffer.toString('base64');
    const dataUrl = `data:${contentType};base64,${base64String}`;
    
    res.json({
      success: true,
      data: {
        filename: fileMetadata.filename,
        originalName: fileMetadata.metadata?.originalName || fileMetadata.filename,
        contentType: contentType,
        size: fileMetadata.length,
        uploadDate: fileMetadata.uploadDate,
        base64: base64String,
        dataUrl: dataUrl
      }
    });
    
  } catch (error) {
    console.error('Error getting file as base64:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Serve notes image files
router.get('/notes-images/:imageId/files/:fileId', async (req, res) => {
  try {
    const { imageId, fileId } = req.params;
    
    
    // Handle authentication - check both header and query parameter
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token;
    
    if (!authHeader && !tokenFromQuery) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // Use token from query parameter if no header token
    const token = authHeader ? authHeader.replace('Bearer ', '') : tokenFromQuery;
    
    // Verify token
    try {
      const decoded = verifyToken(token);
      
      // Token is valid, allow access (no permission checks needed for viewing assets)
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    // Convert fileId to ObjectId
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(fileId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID format'
      });
    }
    
    // Get file metadata first
    const fileMetadata = await notesImagesGridFS.getFileMetadata(objectId);
    if (!fileMetadata) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    
    // Check if it's an image file - be more flexible with content type validation
    const contentType = fileMetadata.contentType || fileMetadata.metadata?.contentType;
    const filename = fileMetadata.filename || fileMetadata.metadata?.filename || fileMetadata.metadata?.originalName || '';
    const isImageByContentType = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(contentType);
    const isImageByExtension = /\.(jpg|jpeg|png|gif|webp)$/i.test(filename);
    const isImage = isImageByContentType || isImageByExtension;
    
    if (!isImage) {
      return res.status(400).json({
        success: false,
        message: 'File is not an image'
      });
    }
    
    // Update lastAccessed for notes image
    await NotesImage.findByIdAndUpdate(imageId, { lastAccessed: new Date() });
    
    // Set appropriate headers
    res.set({
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': fileMetadata.length,
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'Last-Modified': fileMetadata.uploadDate.toUTCString()
    });
    
    // Stream the file
    const stream = await notesImagesGridFS.getFileStream(objectId);
    stream.pipe(res);
    
    stream.on('error', (error) => {
      console.error('Error streaming notes image file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming file'
        });
      }
    });
    
  } catch (error) {
    console.error('Error serving notes image file:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get notes image as base64 for document generation
router.get('/notes-images/:imageId/files/:fileId/base64', async (req, res) => {
  try {
    const { imageId, fileId } = req.params;
    
    // Handle authentication - check both header and query parameter
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token;
    
    if (!authHeader && !tokenFromQuery) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // Use token from query parameter if no header token
    const token = authHeader ? authHeader.replace('Bearer ', '') : tokenFromQuery;
    
    // Verify token
    try {
      const decoded = verifyToken(token);
      
      // Token is valid, allow access (no permission checks needed for viewing assets)
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    // Convert fileId to ObjectId
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(fileId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID'
      });
    }
    
    // Get file metadata first
    const fileMetadata = await notesImagesGridFS.getFileMetadata(objectId);
    if (!fileMetadata) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    // Update lastAccessed for notes image
    await NotesImage.findByIdAndUpdate(imageId, { lastAccessed: new Date() });
    
    // Check if it's an image file
    const contentType = getContentType(fileMetadata.filename);
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'File is not an image'
      });
    }
    
    // Get file as buffer
    const fileBuffer = await notesImagesGridFS.getFileBuffer(objectId);
    
    // Convert to base64
    const base64String = fileBuffer.toString('base64');
    const dataUrl = `data:${contentType};base64,${base64String}`;
    
    res.json({
      success: true,
      data: {
        filename: fileMetadata.filename,
        originalName: fileMetadata.metadata?.originalName || fileMetadata.filename,
        contentType: contentType,
        size: fileMetadata.length,
        uploadDate: fileMetadata.uploadDate,
        base64: base64String,
        dataUrl: dataUrl
      }
    });
    
  } catch (error) {
    console.error('Error getting notes image as base64:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get file info without downloading
router.get('/drawings/:drawingId/files/:fileId/info', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Handle authentication - check both header and query parameter
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token;
    
    if (!authHeader && !tokenFromQuery) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // Use token from query parameter if no header token
    const token = authHeader ? authHeader.replace('Bearer ', '') : tokenFromQuery;
    
    // Verify token
    try {
      const decoded = verifyToken(token);
      
      // Token is valid, allow access (no permission checks needed for viewing assets)
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    // Convert fileId to ObjectId
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(fileId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID'
      });
    }
    
        const fileMetadata = await drawingSpecificationGridFS.getFileMetadata(objectId);
    if (!fileMetadata) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        filename: fileMetadata.filename,
        originalName: fileMetadata.metadata?.originalName || fileMetadata.filename,
        contentType: getContentType(fileMetadata.filename),
        size: fileMetadata.length,
        uploadDate: fileMetadata.uploadDate
      }
    });
    
  } catch (error) {
    console.error('Error getting file info:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


module.exports = router;
