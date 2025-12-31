const { RFQ, RFQItem } = require('../models/rfq.model');
const RFQDocument = require('../models/rfqDocument.model');
const { getRfqDocumentsGridFS } = require('./gridfsHelper');

const rfqDocumentsGridFS = getRfqDocumentsGridFS();

// Generate RFQ number
const generateRFQNumber = async (retryCount = 0, maxRetries = 10) => {
  if (retryCount >= maxRetries) {
    console.error('[generateRFQNumber] ERROR: Max retries reached!', { retryCount, maxRetries });
    throw new Error(`Failed to generate unique RFQ number after ${maxRetries} retries. Possible database issue.`);
  }
  
  console.log('[generateRFQNumber] ========== START (attempt ' + (retryCount + 1) + ') ==========');
  const memStart = process.memoryUsage();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; 
  
  // Convert month to Roman numerals
  const romanMonths = {
    1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
    7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII'
  };
  const romanMonth = romanMonths[month];
  
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0);
  
  console.log('[generateRFQNumber] Date range:', { 
    startOfMonth: startOfMonth.toISOString(), 
    endOfMonth: endOfMonth.toISOString(),
    year,
    month,
    romanMonth
  });
  
  // OPTIMIZED: Use aggregation pipeline to find max number directly in MongoDB
  // This is much more efficient than fetching all RFQs and processing in memory
  const pipeline = [
    {
      $match: {
        createdAt: {
          $gte: startOfMonth,
          $lte: endOfMonth
        },
        rfqNumber: { $exists: true, $ne: null }
      }
    },
    {
      $project: {
        rfqNumber: 1,
        number: {
          $toInt: {
            $arrayElemAt: [
              {
                $split: ['$rfqNumber', '/']
              },
              0
            ]
          }
        }
      }
    },
    {
      $match: {
        number: { $gte: 1 }
      }
    },
    {
      $group: {
        _id: null,
        maxNumber: { $max: '$number' },
        allNumbers: { $push: '$number' }
      }
    }
  ];
  
  console.log('[generateRFQNumber] Running aggregation pipeline...');
  let result;
  try {
    result = await RFQ.aggregate(pipeline).allowDiskUse(true);
    console.log('[generateRFQNumber] Aggregation result:', JSON.stringify(result, null, 2));
  } catch (aggError) {
    console.error('[generateRFQNumber] Aggregation error:', aggError);
    throw aggError;
  }
  
  const highestNumber = result.length > 0 && result[0].maxNumber ? result[0].maxNumber : 0;
  const allNumbers = result.length > 0 && result[0].allNumbers ? result[0].allNumbers.sort((a, b) => b - a).slice(0, 10) : [];
  
  const memAfterQuery = process.memoryUsage();
  console.log('[generateRFQNumber] Analysis:', {
    highestNumber,
    totalRFQsInRange: result.length > 0 ? result[0].allNumbers?.length || 0 : 0,
    top10Numbers: allNumbers,
    memoryDelta: `${((memAfterQuery.heapUsed - memStart.heapUsed) / 1024 / 1024).toFixed(2)} MB`
  });

  // Start from highestNumber + 1 and keep incrementing until we find an available number
  let candidateNumber = highestNumber + 1;
  let rfqNumber;
  let existingRFQ;
  
  console.log('[generateRFQNumber] Starting from candidate number:', candidateNumber);
  
  // Try numbers sequentially until we find one that doesn't exist
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    rfqNumber = `${candidateNumber}/RFQ/STM/${romanMonth}/${year}`;
    
    console.log(`[generateRFQNumber] Attempt ${attempt + 1}/${maxRetries}: Checking number ${rfqNumber}...`);
    
    // Check if this number exists
    try {
      existingRFQ = await RFQ.findOne({ rfqNumber }).select('_id rfqNumber createdAt').lean();
      
      if (!existingRFQ) {
        // Number is available!
        console.log(`[generateRFQNumber] ✅ Number ${rfqNumber} is available!`);
        break;
      }
      
      console.log(`[generateRFQNumber] ⚠️  Number ${rfqNumber} exists:`, {
        id: existingRFQ._id,
        createdAt: existingRFQ.createdAt,
        isInDateRange: existingRFQ.createdAt >= startOfMonth && existingRFQ.createdAt <= endOfMonth
      });
      
      // Number exists, try next one
      candidateNumber++;
      console.log(`[generateRFQNumber] 🔄 Trying next number: ${candidateNumber}`);
      
    } catch (checkError) {
      console.error('[generateRFQNumber] Error checking existence:', checkError);
      throw checkError;
    }
  }
  
  // Check if we exhausted all retries
  if (existingRFQ) {
    console.error('[generateRFQNumber] ❌ MAX RETRIES REACHED - Could not find available number');
    throw new Error(`Failed to generate unique RFQ number after ${maxRetries} attempts. Last checked: ${rfqNumber}`);
  }
  
  const memEnd = process.memoryUsage();
  console.log('[generateRFQNumber] ✅ SUCCESS - Number is unique:', {
    rfqNumber,
    retryCount,
    totalMemoryDelta: `${((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024).toFixed(2)} MB`
  });
  console.log('[generateRFQNumber] ========== END (attempt ' + (retryCount + 1) + ') ==========');
  
  return rfqNumber;
};

// Create RFQ
const createRFQ = async (rfqData) => {
  try {
    console.log('[createRFQ] Starting RFQ creation');
    const memStart = process.memoryUsage();
    
    console.log('[createRFQ] Step 1: Generating RFQ number');
    const rfqNumber = await generateRFQNumber();
    console.log('[createRFQ] Step 1: RFQ number generated:', rfqNumber);
    
    console.log('[createRFQ] Step 2: Creating RFQ document instance');
    const memBeforeNew = process.memoryUsage();
    const rfq = new RFQ({
      ...rfqData,
      rfqNumber,
      submittedAt: new Date()
    });
    const memAfterNew = process.memoryUsage();
    console.log('[createRFQ] Step 2: RFQ document created', {
      memoryDelta: `${((memAfterNew.heapUsed - memBeforeNew.heapUsed) / 1024 / 1024).toFixed(2)} MB`
    });
    
    console.log('[createRFQ] Step 3: Saving RFQ to database');
    const memBeforeSave = process.memoryUsage();
    await rfq.save();
    const memAfterSave = process.memoryUsage();
    console.log('[createRFQ] Step 3: RFQ saved successfully', {
      rfqId: rfq._id,
      rfqNumber: rfq.rfqNumber,
      memoryDelta: `${((memAfterSave.heapUsed - memBeforeSave.heapUsed) / 1024 / 1024).toFixed(2)} MB`
    });
    
    const memEnd = process.memoryUsage();
    console.log('[createRFQ] RFQ creation complete:', {
      totalMemoryDelta: `${((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024).toFixed(2)} MB`
    });
    
    return rfq;
  } catch (error) {
    console.error('[createRFQ] Error creating RFQ:', error);
    throw new Error(`Failed to create RFQ: ${error.message}`);
  }
};

// Get RFQ by ID with population
const getRFQById = async (rfqId) => {
  try {
    const rfq = await RFQ.findById(rfqId)
      .select('rfqNumber requesterId approverId quotationCreatorId quotationId customerName contactPerson customerContacts deliveryTerms deliveryNotes targetCloseDate paymentTerms inclusionNotes exclusionNotes isTaxIncluded includePPN lineOfBusiness priority status description bodyTypeId chassisTypeId engineeringTransit timeline documents items createdAt updatedAt')
      .populate('requesterId', 'email fullName')
      .populate('approverId', 'email fullName')
      .populate('quotationCreatorId', 'email fullName')
      .populate('quotationId', 'quotationNumber status')
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name shortName')
      .populate('engineeringTransit.assignedTo', 'email fullName')
      .populate('engineeringTransit.reviewedBy', 'email fullName')
      .populate('timeline.user', 'email fullName')
      .populate({
        path: 'documents',
        select: 'originalName fileId fileCategory fileType uploadedBy createdAt',
        populate: {
          path: 'uploadedBy',
          select: 'fullName email'
        }
      })
      .populate({
        path: 'items',
        select: 'karoseri chassis chassisModel price priceNet quantity notes drawingSpecification templateSourceId specifications',
        populate: [
          { 
            path: 'drawingSpecification', 
            model: 'DrawingSpecification',
            select: 'drawingNumber bodyTypeId chassisTypeId sizeTypeId',
            populate: [
              { path: 'bodyTypeId', select: 'name shortName' },
              { path: 'chassisTypeId', select: 'name shortName' },
              { path: 'sizeTypeId', select: 'name shortName' }
            ]
          },
          { path: 'templateSourceId', select: 'name shortName' }
        ]
      })
      .lean();
    
    if (!rfq) {
      throw new Error('RFQ not found');
    }
    
    return rfq;
  } catch (error) {
    throw new Error(`Failed to get RFQ: ${error.message}`);
  }
};

// Get RFQs with filters
const getRFQs = async (filters = {}, options = {}) => {
  try {
    const { page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;
    
    const query = RFQ.find(filters)
      .select('rfqNumber requesterId approverId quotationCreatorId quotationId customerName contactPerson status priority lineOfBusiness bodyTypeId chassisTypeId engineeringTransit createdAt updatedAt')
      .populate('requesterId', 'email fullName')
      .populate('approverId', 'email fullName')
      .populate('quotationCreatorId', 'email fullName')
      .populate('quotationId', 'quotationNumber status')
      .populate('bodyTypeId', 'name shortName')
      .populate('chassisTypeId', 'name shortName')
      .populate('engineeringTransit.assignedTo', 'email fullName')
      .populate('engineeringTransit.reviewedBy', 'email fullName')
      .populate({
        path: 'documents',
        select: 'originalName fileId fileCategory fileType uploadedBy createdAt',
        populate: {
          path: 'uploadedBy',
          select: 'fullName email'
        }
      })
      .populate({
        path: 'items',
        select: 'karoseri chassis chassisModel price priceNet quantity notes drawingSpecification templateSourceId',
        populate: [
          { 
            path: 'drawingSpecification', 
            model: 'DrawingSpecification',
            select: 'drawingNumber bodyTypeId chassisTypeId sizeTypeId'
          },
          { path: 'templateSourceId', select: 'name shortName' }
        ]
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const [rfqs, total] = await Promise.all([
      query.exec(),
      RFQ.countDocuments(filters)
    ]);
    
    return {
      rfqs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    throw new Error(`Failed to get RFQs: ${error.message}`);
  }
};

// Update RFQ
const updateRFQ = async (rfqId, updateData) => {
  try {
    const rfq = await RFQ.findByIdAndUpdate(
      rfqId,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('requesterId', 'email fullName')
      .populate('approverId', 'email fullName')
      .populate('quotationCreatorId', 'email fullName')
      .populate('quotationId');
    
    if (!rfq) {
      throw new Error('RFQ not found');
    }
    
    return rfq;
  } catch (error) {
    throw new Error(`Failed to update RFQ: ${error.message}`);
  }
};

// Delete RFQ
const deleteRFQ = async (rfqId) => {
  try {
    const documents = await RFQDocument.find({ rfqId });

    for (const document of documents) {
      try {
        await rfqDocumentsGridFS.deleteFile(document.file.fileId);
      } catch (gridFsError) {
        console.error(`Failed to delete RFQ document file ${document.file.fileId}:`, gridFsError);
      }
      await document.deleteOne();
    }

    const rfq = await RFQ.findByIdAndDelete(rfqId);
    
    if (!rfq) {
      throw new Error('RFQ not found');
    }
    
    return rfq;
  } catch (error) {
    throw new Error(`Failed to delete RFQ: ${error.message}`);
  }
};

// Approve RFQ
const approveRFQ = async (rfqId, approvalData) => {
  try {
    const updateData = {
      status: 'approved',
      isApproved: true,
      approvedAt: new Date(),
      ...approvalData
    };
    
    return await updateRFQ(rfqId, updateData);
  } catch (error) {
    throw new Error(`Failed to approve RFQ: ${error.message}`);
  }
};

// Reject RFQ
const rejectRFQ = async (rfqId, rejectionData) => {
  try {
    const updateData = {
      status: 'rejected',
      isApproved: false,
      rejectedAt: new Date(),
      ...rejectionData
    };
    
    return await updateRFQ(rfqId, updateData);
  } catch (error) {
    throw new Error(`Failed to reject RFQ: ${error.message}`);
  }
};

// Mark RFQ as quotation created
const markQuotationCreated = async (rfqId, quotationId) => {
  try {
    const updateData = {
      status: 'quotation_created',
      quotationId,
      quotationCreatedAt: new Date()
    };
    
    return await updateRFQ(rfqId, updateData);
  } catch (error) {
    throw new Error(`Failed to mark quotation created: ${error.message}`);
  }
};

// RFQ Item Management Functions
const createRFQItem = async (rfqId, itemData) => {
  try {
    // Optimize: Only get the max item number instead of all items
    // This reduces memory usage significantly for RFQs with many items
    const maxItem = await RFQItem.findOne({ rfqId })
      .select('itemNumber')
      .sort({ itemNumber: -1 })
      .lean();
    const nextItemNumber = maxItem ? maxItem.itemNumber + 1 : 1;
    
    const item = new RFQItem({
      ...itemData,
      rfqId,
      itemNumber: nextItemNumber
    });
    
    await item.save();
    return item;
  } catch (error) {
    throw new Error(`Failed to create RFQ item: ${error.message}`);
  }
};

const getRFQItems = async (rfqId) => {
  try {
    const items = await RFQItem.find({ rfqId })
      .populate('drawingSpecification')
      .sort({ itemNumber: 1 });
    
    return items;
  } catch (error) {
    throw new Error(`Failed to get RFQ items: ${error.message}`);
  }
};

const updateRFQItem = async (itemId, updateData) => {
  try {
    const item = await RFQItem.findByIdAndUpdate(
      itemId,
      updateData,
      { new: true, runValidators: true }
    ).populate('drawingSpecification');
    
    if (!item) {
      throw new Error('RFQ item not found');
    }
    
    return item;
  } catch (error) {
    throw new Error(`Failed to update RFQ item: ${error.message}`);
  }
};

const deleteRFQItem = async (itemId) => {
  try {
    const item = await RFQItem.findByIdAndDelete(itemId);
    
    if (!item) {
      throw new Error('RFQ item not found');
    }
    
    // Reorder remaining items
    const remainingItems = await RFQItem.find({ rfqId: item.rfqId })
      .sort({ itemNumber: 1 });
    
    for (let i = 0; i < remainingItems.length; i++) {
      if (remainingItems[i].itemNumber !== i + 1) {
        await RFQItem.findByIdAndUpdate(remainingItems[i]._id, { itemNumber: i + 1 });
      }
    }
    
    return item;
  } catch (error) {
    throw new Error(`Failed to delete RFQ item: ${error.message}`);
  }
};

module.exports = {
  generateRFQNumber,
  createRFQ,
  getRFQById,
  getRFQs,
  updateRFQ,
  deleteRFQ,
  approveRFQ,
  rejectRFQ,
  markQuotationCreated,
  createRFQItem,
  getRFQItems,
  updateRFQItem,
  deleteRFQItem
};
