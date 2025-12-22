const express = require('express');
const multer = require('multer');
const zlib = require('zlib');
const { promisify } = require('util');
const mongoose = require('mongoose');
const router = express.Router({ mergeParams: true });

const { authenticateToken } = require('../middleware/auth');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/errorHandler');
const { getRfqDocumentsGridFS } = require('../utils/gridfsHelper');
const RFQDocument = require('../models/rfqDocument.model');
const { RFQ } = require('../models/rfq.model');
const User = require('../models/user.model');
const { hasPermission, hasAllQuotationAccess } = require('../utils/permissionHelper');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const rfqDocumentsGridFS = getRfqDocumentsGridFS();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp'
];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed types: PDF, Word, Excel, Images (JPG, PNG, GIF, WEBP)'));
    }
  }
});

const ensureRfqAccess = async (rfqId, user) => {
  const rfq = await RFQ.findById(rfqId).select(
    'requesterId approverId quotationCreatorId engineeringId engineeringTransit.assignedTo'
  );
  if (!rfq) {
    return { error: { status: 404, message: 'RFQ not found' } };
  }

  // Check if user has all_quotation_viewer permission first
  const hasAllAccess = hasAllQuotationAccess(user);
  if (hasAllAccess) {
    return { rfq };
  }

  const canApprove = hasPermission(user, 'approve_rfq');
  const canCreate = hasPermission(user, 'quotation_create');
  const canRequest = hasPermission(user, 'quotation_requester');
  const canEngineer = hasPermission(user, 'engineer_review');

  const userIdString = user._id.toString();
  const isRequester = canRequest && rfq.requesterId && rfq.requesterId.toString() === userIdString;
  const isApprover = canApprove && rfq.approverId && rfq.approverId.toString() === userIdString;
  const isCreator =
    canCreate && rfq.quotationCreatorId && rfq.quotationCreatorId.toString() === userIdString;
  const engineerIds = [rfq.engineeringId, rfq.engineeringTransit?.assignedTo]
    .filter(Boolean)
    .map((id) => id.toString());
  const isEngineer = canEngineer && engineerIds.includes(userIdString);

  const hasAccess = isRequester || isApprover || isCreator || isEngineer;

  if (!hasAccess) {
    return { error: { status: 403, message: 'Access denied' } };
  }

  return { rfq };
};

const mapDocumentResponse = (document) => ({
  _id: document._id,
  rfqId: document.rfqId,
  originalName: document.file.originalName,
  mimeType: document.file.mimeType,
  fileSize: document.file.fileSize,
  compressedSize: document.file.compressedSize,
  compression: document.file.compression,
  uploadedAt: document.uploadedAt,
  uploadedBy: document.uploadedBy ? {
    _id: document.uploadedBy._id,
    fullName: document.uploadedBy.fullName,
    email: document.uploadedBy.email
  } : null
});

router.post('/:rfqId/documents', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    const { rfqId } = req.params;
    const file = req.file;

    if (!file) {
      return sendErrorResponse(res, 400, 'Document file is required');
    }

    const user = await User.findById(req.user.userId).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const accessResult = await ensureRfqAccess(rfqId, user);
    if (accessResult.error) {
      return sendErrorResponse(res, accessResult.error.status, accessResult.error.message);
    }

    const rfq = accessResult.rfq;
    if (rfq.requesterId.toString() !== user._id.toString()) {
      return sendErrorResponse(res, 403, 'Only the RFQ requester can upload documents');
    }

    let compressionType = 'gzip';
    let bufferToStore;
    try {
      const compressedBuffer = await gzip(file.buffer, { level: zlib.constants.Z_BEST_COMPRESSION });
      if (compressedBuffer.length < file.buffer.length) {
        bufferToStore = compressedBuffer;
        compressionType = 'gzip';
      } else {
        bufferToStore = file.buffer;
        compressionType = 'none';
      }
    } catch (compressionError) {
      console.warn('RFQ document compression failed, storing original buffer:', compressionError);
      bufferToStore = file.buffer;
      compressionType = 'none';
    }

    const filename = `${rfqId}_${Date.now()}_${file.originalname}`;
    const uploadResult = await rfqDocumentsGridFS.uploadBuffer(
      bufferToStore,
      filename,
      {
        rfqId: new mongoose.Types.ObjectId(rfqId),
        uploader: user._id,
        originalName: file.originalname,
        mimeType: file.mimetype,
        originalSize: file.size,
        compressed: compressionType === 'gzip',
        compressionType
      },
      'application/octet-stream'
    );

    const document = await RFQDocument.create({
      rfqId,
      file: {
        fileId: uploadResult.fileId,
        filename: uploadResult.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        compressedSize: bufferToStore.length,
        compression: compressionType,
        uploadDate: uploadResult.uploadDate
      },
      uploadedBy: user._id,
      uploadedAt: new Date()
    });

    await RFQ.updateOne(
      { _id: rfqId },
      { $addToSet: { documents: document._id } }
    );

    return sendSuccessResponse(res, 201, 'Document uploaded successfully', {
      document: mapDocumentResponse(await document.populate('uploadedBy', 'fullName email'))
    });
  } catch (error) {
    console.error('Error uploading RFQ document:', error);
    if (error.message && error.message.includes('File too large')) {
      return sendErrorResponse(res, 400, `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
    }
    return sendErrorResponse(res, 500, 'Failed to upload document', error.message);
  }
});

router.get('/:rfqId/documents', authenticateToken, async (req, res) => {
  try {
    const { rfqId } = req.params;

    const user = await User.findById(req.user.userId).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const accessResult = await ensureRfqAccess(rfqId, user);
    if (accessResult.error) {
      return sendErrorResponse(res, accessResult.error.status, accessResult.error.message);
    }

    const documents = await RFQDocument.find({ rfqId })
      .sort({ uploadedAt: -1 })
      .populate('uploadedBy', 'fullName email');

    return sendSuccessResponse(res, 200, 'Documents retrieved successfully', {
      documents: documents.map(mapDocumentResponse)
    });
  } catch (error) {
    console.error('Error fetching RFQ documents:', error);
    return sendErrorResponse(res, 500, 'Failed to fetch documents', error.message);
  }
});

router.get('/documents/:documentId/download', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    const document = await RFQDocument.findById(documentId)
      .populate('uploadedBy', 'fullName email');

    if (!document) {
      return sendErrorResponse(res, 404, 'Document not found');
    }

    const user = await User.findById(req.user.userId).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const accessResult = await ensureRfqAccess(document.rfqId, user);
    if (accessResult.error) {
      return sendErrorResponse(res, accessResult.error.status, accessResult.error.message);
    }

    const buffer = await rfqDocumentsGridFS.getFileBuffer(document.file.fileId);
    const outputBuffer = document.file.compression === 'gzip'
      ? await gunzip(buffer)
      : buffer;

    res.setHeader('Content-Type', document.file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${document.file.originalName}"`);
    res.setHeader('Content-Length', outputBuffer.length);

    return res.status(200).send(outputBuffer);
  } catch (error) {
    console.error('Error downloading RFQ document:', error);
    return sendErrorResponse(res, 500, 'Failed to download document', error.message);
  }
});

router.delete('/:rfqId/documents/:documentId', authenticateToken, async (req, res) => {
  try {
    const { rfqId, documentId } = req.params;

    const user = await User.findById(req.user.userId).populate('permissions');
    if (!user) {
      return sendErrorResponse(res, 404, 'User not found');
    }

    const accessResult = await ensureRfqAccess(rfqId, user);
    if (accessResult.error) {
      return sendErrorResponse(res, accessResult.error.status, accessResult.error.message);
    }

    const rfq = accessResult.rfq;
    if (rfq.requesterId.toString() !== user._id.toString()) {
      return sendErrorResponse(res, 403, 'Only the RFQ requester can delete documents');
    }

    const document = await RFQDocument.findById(documentId);
    if (!document) {
      return sendErrorResponse(res, 404, 'Document not found');
    }

    await rfqDocumentsGridFS.deleteFile(document.file.fileId);
    await document.deleteOne();

    await RFQ.updateOne(
      { _id: rfqId },
      { $pull: { documents: documentId } }
    );

    return sendSuccessResponse(res, 200, 'Document deleted successfully');
  } catch (error) {
    console.error('Error deleting RFQ document:', error);
    return sendErrorResponse(res, 500, 'Failed to delete document', error.message);
  }
});

module.exports = router;

