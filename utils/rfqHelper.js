const { RFQ, RFQItem } = require('../models/rfq.model');

// Generate RFQ number
const generateRFQNumber = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; 
  
  // Convert month to Roman numerals
  const romanMonths = {
    1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
    7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII'
  };
  const romanMonth = romanMonths[month];
  
  // Find all RFQs for this month and year
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0);
  
  const rfqs = await RFQ.find({
    createdAt: {
      $gte: startOfMonth,
      $lte: endOfMonth
    }
  }, { rfqNumber: 1 });

  // Extract the highest number from existing RFQ numbers for this month
  let highestNumber = 0;
  const rfqPattern = new RegExp(`^(\\d+)/RFQ/STM/${romanMonth}/${year}$`);
  
  rfqs.forEach(rfq => {
    if (rfq.rfqNumber) {
      const match = rfq.rfqNumber.match(rfqPattern);
      if (match) {
        const number = parseInt(match[1], 10);
        if (number > highestNumber) {
          highestNumber = number;
        }
      }
    }
  });

  const nextNumber = highestNumber + 1;
  const rfqNumber = `${nextNumber}/RFQ/STM/${romanMonth}/${year}`;
  
  // Double-check that this number doesn't already exist (race condition protection)
  const existingRFQ = await RFQ.findOne({ rfqNumber });
  if (existingRFQ) {
    // If it exists, recursively call to get the next number
    return await generateRFQNumber();
  }
  
  return rfqNumber;
};

// Create RFQ
const createRFQ = async (rfqData) => {
  try {
    const rfqNumber = await generateRFQNumber();
    
    const rfq = new RFQ({
      ...rfqData,
      rfqNumber,
      submittedAt: new Date()
    });
    
    await rfq.save();
    return rfq;
  } catch (error) {
    throw new Error(`Failed to create RFQ: ${error.message}`);
  }
};

// Get RFQ by ID with population
const getRFQById = async (rfqId) => {
  try {
    const rfq = await RFQ.findById(rfqId)
      .populate('requesterId', 'email fullName')
      .populate('approverId', 'email fullName')
      .populate('quotationCreatorId', 'email fullName')
      .populate('quotationId')
      .populate({
        path: 'items',
        populate: {
          path: 'drawingSpecification',
          model: 'DrawingSpecification'
        }
      });
    
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
      .populate('requesterId', 'email fullName')
      .populate('approverId', 'email fullName')
      .populate('quotationCreatorId', 'email fullName')
      .populate('quotationId')
      .populate({
        path: 'items',
        populate: {
          path: 'drawingSpecification',
          model: 'DrawingSpecification'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
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
    // Get the next item number for this RFQ
    const existingItems = await RFQItem.find({ rfqId }).sort({ itemNumber: -1 });
    const nextItemNumber = existingItems.length > 0 ? existingItems[0].itemNumber + 1 : 1;
    
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
