const QuotationHeader = require('../models/quotationHeader.model');
const QuotationOffer = require('../models/quotationOffer.model');
const OfferItem = require('../models/offerItem.model');

// Generate quotation number
const generateQuotationNumber = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; 
  
  // Convert month to Roman numerals
  const romanMonths = {
    1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
    7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII'
  };
  const romanMonth = romanMonths[month];
  
  // Find all quotation headers for this month and year
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0);
  
  const quotationHeaders = await QuotationHeader.find({
    createdAt: {
      $gte: startOfMonth,
      $lte: endOfMonth
    }
  }, { quotationNumber: 1 });

  // Extract the highest number from existing quotation numbers for this month
  let highestNumber = 0;
  const quotationPattern = new RegExp(`^(\\d+)/QUO/STM/${romanMonth}/${year}$`);
  
  quotationHeaders.forEach(header => {
    if (header.quotationNumber) {
      const match = header.quotationNumber.match(quotationPattern);
      if (match) {
        const number = parseInt(match[1], 10);
        if (number > highestNumber) {
          highestNumber = number;
        }
      }
    }
  });

  const nextNumber = highestNumber + 1;
  const quotationNumber = `${nextNumber}/QUO/STM/${romanMonth}/${year}`;
  
  
  // Double-check that this number doesn't already exist (race condition protection)
  const existingHeader = await QuotationHeader.findOne({ quotationNumber });
  if (existingHeader) {
    // Recursively generate a new number
    return await generateQuotationNumber();
  }
  
  return quotationNumber;
};

// Generate offer number for a specific quotation
const generateOfferNumber = async (quotationNumber, isRevision = false, parentOfferId = null) => {
  // Find quotation header
  const header = await QuotationHeader.findOne({ quotationNumber });
  if (!header) {
    throw new Error('Quotation header not found');
  }

  if (isRevision && parentOfferId) {
    // For revisions, use the same offer number as parent but with revision suffix
    const parentOffer = await QuotationOffer.findById(parentOfferId);
    if (!parentOffer) {
      throw new Error('Parent offer not found');
    }
    
    // Extract the base offer number (without revision suffix)
    const baseOfferNumber = parentOffer.offerNumber.split('-Rev')[0];
    
    // Find the highest revision number for this offer
    const existingRevisions = await QuotationOffer.find({
      quotationHeaderId: header._id,
      offerNumberInQuotation: parentOffer.offerNumberInQuotation,
      revision: { $gt: 0 }
    }).sort({ revision: -1 });
    
    let revision = 1;
    if (existingRevisions.length > 0) {
      revision = existingRevisions[0].revision + 1;
    }
    
    const offerNumber = `${baseOfferNumber}-Rev${revision}`;
    
    // Double-check that this revision number doesn't already exist
    const existingOffer = await QuotationOffer.findOne({ offerNumber });
    if (existingOffer) {
      throw new Error(`Revision ${offerNumber} already exists`);
    }
    
    return { offerNumber, offerNumberInQuotation: parentOffer.offerNumberInQuotation };
  } else {
    // For new offers, find the next offer number in quotation
    const existingOffers = await QuotationOffer.find({ 
      quotationHeaderId: header._id,
      revision: 0 // Only count original offers, not revisions
    }, { offerNumberInQuotation: 1 });
    
    // Find the highest offer number in quotation
    let highestOfferNumberInQuotation = 0;
  existingOffers.forEach(offer => {
      if (offer.offerNumberInQuotation > highestOfferNumberInQuotation) {
        highestOfferNumberInQuotation = offer.offerNumberInQuotation;
      }
    });

    const nextOfferNumberInQuotation = highestOfferNumberInQuotation + 1;
    const offerNumber = `${quotationNumber}-${nextOfferNumberInQuotation}`;
    
    
    // Double-check that this number doesn't already exist (race condition protection)
    const existingOffer = await QuotationOffer.findOne({ offerNumber });
    if (existingOffer) {
      throw new Error(`Offer number ${offerNumber} already exists`);
    }
    
    return { offerNumber, offerNumberInQuotation: nextOfferNumberInQuotation };
  }
};

// Format price to Indonesian Rupiah format
const formatPrice = (price) => {
  if (price === null || price === undefined || isNaN(price)) {
    return '0,00';
  }

  const numPrice = parseFloat(price);
  const parts = numPrice.toFixed(2).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${integerPart},${parts[1]}`;
};

// Calculate follow-up status and color
const getFollowUpStatus = (lastFollowUpDate) => {
  if (!lastFollowUpDate) {
    return { status: 'danger', color: 'red', label: 'Never Followed Up' };
  }
  
  const now = new Date();
  const followUpDate = new Date(lastFollowUpDate);
  const daysSinceFollowUp = Math.floor((now - followUpDate) / (24 * 60 * 60 * 1000));
  
  if (daysSinceFollowUp <= 3) {
    return { status: 'good', color: 'green', label: `${daysSinceFollowUp} day${daysSinceFollowUp !== 1 ? 's' : ''} ago` };
  } else if (daysSinceFollowUp <= 6) {
    return { status: 'warning', color: 'yellow', label: `${daysSinceFollowUp} day${daysSinceFollowUp !== 1 ? 's' : ''} ago` };
  } else {
    return { status: 'danger', color: 'red', label: `${daysSinceFollowUp} day${daysSinceFollowUp !== 1 ? 's' : ''} ago` };
  }
};

// Format data for storage
const formatDataForStorage = (data) => {
  const formatted = { ...data };
  
  
  // Format header data
  if (formatted.customerName) {
    formatted.customerName = formatted.customerName.trim().toUpperCase();
  }
  
  if (formatted.contactPerson && formatted.contactPerson.name) {
    // Capitalize first letter of each word in contact person name
    formatted.contactPerson.name = formatted.contactPerson.name.trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  // Format offer data
  if (formatted.karoseri) {
    formatted.karoseri = formatted.karoseri.trim().toUpperCase();
  }
  
  if (formatted.chassis) {
    formatted.chassis = formatted.chassis.trim().toUpperCase();
  }
  
  // Handle drawingSpecification field - convert empty strings to null
  if (formatted.drawingSpecification === '') {
    formatted.drawingSpecification = null;
  }
  
  
  return formatted;
};


// Create quotation header
const createQuotationHeader = async (headerData) => {
  // Format data before saving
  const formattedData = formatDataForStorage(headerData);

  // Generate quotation number
  const quotationNumber = await generateQuotationNumber();

  // Create quotation header
  const header = new QuotationHeader({
    ...formattedData,
    quotationNumber,
    lastFollowUpDate: new Date() // Set initial follow-up date to now
  });

  await header.save();
  return header;
};

// Create quotation offer
const createQuotationOffer = async (quotationNumber, offerData) => {
  try {
    // Format data before saving
    const formattedData = formatDataForStorage(offerData);


    // Find quotation header
    const header = await QuotationHeader.findOne({ quotationNumber });
    if (!header) {
      throw new Error(`Quotation header not found for quotation number: ${quotationNumber}`);
    }

    // Handle revision logic
    let revision = 0;
    let parentQuotationId = null;
    let offerNumberInQuotation = 1;
    
    if (formattedData.isRevision && formattedData.parentOfferId) {
      // This is a revision - find the parent offer and increment revision
      const parentOffer = await QuotationOffer.findById(formattedData.parentOfferId).populate('notesImages');
      if (!parentOffer) {
        throw new Error(`Parent offer not found for ID: ${formattedData.parentOfferId}`);
      }
      revision = parentOffer.revision + 1;
      parentQuotationId = parentOffer._id;
      offerNumberInQuotation = parentOffer.offerNumberInQuotation;
      
      // Copy notes images from parent offer and merge with new ones
      const parentNotesImages = parentOffer.notesImages ? parentOffer.notesImages.map(img => img._id) : [];
      const newNotesImages = formattedData.notesImages || [];
      
      // Merge parent images with new images (avoid duplicates)
      const allNotesImages = [...new Set([...parentNotesImages, ...newNotesImages])];
      formattedData.notesImages = allNotesImages;
    }

    // Generate offer number
    const offerNumberResult = await generateOfferNumber(
      quotationNumber, 
      formattedData.isRevision, 
      formattedData.parentOfferId
    );
    
    const offerNumber = offerNumberResult.offerNumber;
    if (offerNumberResult.offerNumberInQuotation) {
      offerNumberInQuotation = offerNumberResult.offerNumberInQuotation;
    }

    // Extract offer items from offerData
    const offerItems = formattedData.offerItems || [];
    console.log('Backend: Received offerItems:', offerItems);
    console.log('Backend: offerItems length:', offerItems.length);
    delete formattedData.offerItems; // Remove from offer data

    // Create quotation offer

    const offer = new QuotationOffer({
      ...formattedData,
      quotationHeaderId: header._id,
      offerNumber,
      offerNumberInQuotation,
      revision,
      parentQuotationId
    });

    await offer.save();

    // Create offer items if provided
    if (offerItems.length > 0) {
      console.log('Backend: Creating', offerItems.length, 'offer items');
      for (let i = 0; i < offerItems.length; i++) {
        const itemData = offerItems[i];
        console.log('Backend: Processing offer item', i + 1, ':', itemData);
        const formattedItemData = formatDataForStorage(itemData);
        
        // Remove _id and other fields that shouldn't be copied for new items
        delete formattedItemData._id;
        delete formattedItemData.createdAt;
        delete formattedItemData.updatedAt;
        delete formattedItemData.__v;
        delete formattedItemData.quotationOfferId; // Will be set to new offer ID
        
        console.log('Backend: Formatted item data:', formattedItemData);
        
        const offerItem = new OfferItem({
          ...formattedItemData,
          quotationOfferId: offer._id,
          itemNumber: i + 1
        });
        
        console.log('Backend: Saving offer item:', offerItem);
        await offerItem.save();
        console.log('Backend: Offer item saved successfully');
      }
      
      // Update offer totals
      await offer.save();
      console.log('Backend: Offer totals updated');
    } else {
      console.log('Backend: No offer items to create');
    }

    return offer;
  } catch (error) {
    console.error('Error creating quotation offer:', error);
    throw error;
  }
};

// Get quotation header by ID
const getQuotationHeaderById = async (headerId) => {
  const header = await QuotationHeader.findById(headerId);
  if (!header) {
    throw new Error('Quotation header not found');
  }
  return header;
};

// Get quotation offer by ID
const getQuotationOfferById = async (offerId) => {
  const offer = await QuotationOffer.findById(offerId).populate('quotationHeaderId');
  if (!offer) {
    throw new Error('Quotation offer not found');
  }
  return offer;
};

// Get all offers for a quotation with revision hierarchy
const getQuotationOffers = async (quotationNumber) => {
  const header = await QuotationHeader.findOne({ quotationNumber })
    .populate('requesterId', 'fullName email')
    .populate('approverId', 'fullName email')
    .populate('creatorId', 'fullName email');
  if (!header) {
    throw new Error('Quotation header not found');
  }

  const offers = await QuotationOffer.find({ quotationHeaderId: header._id })
    .populate('quotationHeaderId')
    .populate('parentQuotationId')
    .populate({
      path: 'notesImages',
      model: 'NotesImage'
    })
    .sort({ offerNumberInQuotation: 1, revision: 1 }); // Sort by offer number, then revision


  // Get offer items for all offers
  const offerIds = offers.map(offer => offer._id);
  
  const offerItems = await OfferItem.find({ quotationOfferId: { $in: offerIds } })
    .populate({
      path: 'drawingSpecification',
      model: 'DrawingSpecification'
    })
    .sort({ quotationOfferId: 1, itemNumber: 1 });


  // Group offer items by offer ID
  const itemsByOffer = {};
  offerItems.forEach(item => {
    const offerId = item.quotationOfferId.toString();
    if (!itemsByOffer[offerId]) {
      itemsByOffer[offerId] = [];
    }
    itemsByOffer[offerId].push(item);
  });

  // Add offer items to offers and convert to plain objects
  const offersWithItems = offers.map(offer => {
    const offerId = offer._id.toString();
    const offerObj = offer.toObject();
    offerObj.offerItems = itemsByOffer[offerId] || [];
    
    
    return offerObj;
  });

  // Group offers by offerNumberInQuotation
  const groupedOffers = [];
  const offerGroups = {};

  offersWithItems.forEach(offer => {
    // Handle existing data that might not have offerNumberInQuotation
    let offerNumber = offer.offerNumberInQuotation;
    
    if (!offerNumber) {
      // For existing data, extract offer number from offerNumber string
      const match = offer.offerNumber.match(/-(\d+)(?:-Rev\d+)?$/);
      offerNumber = match ? parseInt(match[1], 10) : 1;
    }
    
    if (!offerGroups[offerNumber]) {
      offerGroups[offerNumber] = {
        original: null,
        revisions: []
      };
    }

    if (offer.revision === 0) {
      // This is the original offer
      offerGroups[offerNumber].original = offer;
    } else {
      // This is a revision
      offerGroups[offerNumber].revisions.push(offer);
    }
  });

  // Convert to array and sort by offer number
  Object.keys(offerGroups).forEach(offerNumber => {
    const group = offerGroups[offerNumber];
    if (group.original) {
      // Sort revisions by revision number
      group.revisions.sort((a, b) => a.revision - b.revision);
      groupedOffers.push(group);
    }
  });

  // Sort groups by offer number
  groupedOffers.sort((a, b) => {
    const aNumber = a.original.offerNumberInQuotation || 1;
    const bNumber = b.original.offerNumberInQuotation || 1;
    return aNumber - bNumber;
  });


  return { 
    header: {
      ...header.toObject(),
      followUpStatus: getFollowUpStatus(header.lastFollowUpDate)
    }, 
    offers: groupedOffers 
  };
};

// Update quotation header
const updateQuotationHeader = async (headerId, updateData) => {
  // Format data before saving
  const formattedData = formatDataForStorage(updateData);
  
  const header = await QuotationHeader.findByIdAndUpdate(
    headerId,
    formattedData,
    { new: true, runValidators: true }
  );
  
  if (!header) {
    throw new Error('Quotation header not found');
  }
  
  return header;
};

// Update quotation offer
const updateQuotationOffer = async (offerId, updateData) => {
  try {
    if (!offerId) {
      throw new Error('Offer ID is required for update');
    }


    // Format data before saving
    const formattedData = formatDataForStorage(updateData);
    
    // Extract offer items from updateData
    const offerItems = formattedData.offerItems || [];
    delete formattedData.offerItems; // Remove from offer data

    // Update the offer

    const offer = await QuotationOffer.findByIdAndUpdate(
      offerId,
      formattedData,
      { new: true, runValidators: true }
    ).populate('quotationHeaderId');
    
    if (!offer) {
      throw new Error(`Quotation offer not found for ID: ${offerId}`);
    }


    // Handle offer items
    if (offerItems.length > 0) {
      // Delete existing offer items
      await OfferItem.deleteMany({ quotationOfferId: offerId });
      
      // Create new offer items
      for (let i = 0; i < offerItems.length; i++) {
        const itemData = offerItems[i];
        const formattedItemData = formatDataForStorage(itemData);
        
        // Remove _id and other fields that shouldn't be copied for new items
        delete formattedItemData._id;
        delete formattedItemData.createdAt;
        delete formattedItemData.updatedAt;
        delete formattedItemData.__v;
        delete formattedItemData.quotationOfferId; // Will be set to new offer ID
        
        const offerItem = new OfferItem({
          ...formattedItemData,
          quotationOfferId: offerId,
          itemNumber: i + 1
        });
        await offerItem.save();
      }
      
      // Update offer totals
      await offer.save();
    }
    
    return offer;
  } catch (error) {
    console.error('Error updating quotation offer:', error);
    throw error;
  }
};

// Delete quotation header (and all its offers)
const deleteQuotationHeader = async (headerId) => {
  // Delete all offers first
  await QuotationOffer.deleteMany({ quotationHeaderId: headerId });
  
  // Delete header
  const header = await QuotationHeader.findByIdAndDelete(headerId);
  if (!header) {
    throw new Error('Quotation header not found');
  }
  
  return header;
};

// Delete quotation offer
const deleteQuotationOffer = async (offerId) => {
  const offer = await QuotationOffer.findByIdAndDelete(offerId);
  if (!offer) {
    throw new Error('Quotation offer not found');
  }
  return offer;
};

// Get quotations with pagination and filters
const getQuotations = async (filters = {}, pagination = { page: 1, limit: 10 }) => {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  // Build query for headers
  const headerQuery = {};
  
  // Handle specific user field filters first
  if (filters.requesterId) {
    headerQuery.requesterId = filters.requesterId;
  }
  if (filters.approverId) {
    headerQuery.approverId = filters.approverId;
  }
  if (filters.creatorId) {
    headerQuery.creatorId = filters.creatorId;
  }
  
  // Handle generic userId filter (for backward compatibility)
  if (filters.userId && !filters.requesterId && !filters.approverId && !filters.creatorId) {
    // Support both old userId filter and new user field filters
    headerQuery.$or = [
      { requesterId: filters.userId },
      { approverId: filters.userId },
      { creatorId: filters.userId }
    ];
  }
  if (filters.customer) {
    headerQuery.customerName = new RegExp(filters.customer, 'i');
  }
  if (filters.marketing) {
    headerQuery.marketingName = new RegExp(filters.marketing, 'i');
  }
  if (filters.status) {
    headerQuery['status.type'] = filters.status;
  }
  if (filters.startDate || filters.endDate) {
    headerQuery.createdAt = {};
    if (filters.startDate) {
      headerQuery.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      headerQuery.createdAt.$lte = endDate;
    }
    if (!Object.keys(headerQuery.createdAt).length) {
      delete headerQuery.createdAt;
    }
  }

  // Get headers with pagination and populate user data
  const headers = await QuotationHeader.find(headerQuery)
    .populate('requesterId', 'fullName email')
    .populate('approverId', 'fullName email')
    .populate('creatorId', 'fullName email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Get total count
  const total = await QuotationHeader.countDocuments(headerQuery);

  // For each header, get its offers with grouping
  const quotations = [];
  for (const header of headers) {
    try {
      // Use the grouped structure from getQuotationOffers
      const result = await getQuotationOffers(header.quotationNumber);
      let groupedOffers = result.offers;

    // If filtering by search term, filter offers
    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
        const filteredGroups = [];
        
        groupedOffers.forEach(offerGroup => {
          const originalMatches = searchRegex.test(offerGroup.original.karoseri) ||
                                 searchRegex.test(offerGroup.original.chassis) ||
                                 offerGroup.original.specifications.some(spec => searchRegex.test(spec));
          
          const revisionMatches = offerGroup.revisions.filter(revision =>
            searchRegex.test(revision.karoseri) ||
            searchRegex.test(revision.chassis) ||
            revision.specifications.some(spec => searchRegex.test(spec))
          );
          
          if (originalMatches || revisionMatches.length > 0) {
            filteredGroups.push({
              original: offerGroup.original,
              revisions: originalMatches ? offerGroup.revisions : revisionMatches
            });
          }
        });
        
        groupedOffers = filteredGroups;
    }

    // If no offers match filters when searching, skip this header
      if (filters.search && groupedOffers.length === 0) {
      continue;
    }

    quotations.push({
        header: {
          ...header.toObject(),
          followUpStatus: getFollowUpStatus(header.lastFollowUpDate)
        },
        offers: groupedOffers
      });
    } catch (error) {
      console.error(`Error getting offers for quotation ${header.quotationNumber}:`, error);
      // Fallback to empty offers if there's an error
      quotations.push({
        header: {
          ...header.toObject(),
          followUpStatus: getFollowUpStatus(header.lastFollowUpDate)
        },
        offers: []
      });
    }
  }

  return {
    quotations,
    pagination: {
      current: page,
      pages: Math.ceil(total / limit),
      total
    }
  };
};

// Update last follow-up date for an offer
const updateLastFollowUp = async (headerId) => {
  const header = await QuotationHeader.findByIdAndUpdate(
    headerId,
    { lastFollowUpDate: new Date() },
    { new: true }
  );

  if (!header) {
    throw new Error('Quotation header not found');
  }

  return header;
};

// Update last follow-up date for all offers in a quotation
const updateLastFollowUpAll = async (quotationNumber) => {
  const header = await QuotationHeader.findOneAndUpdate(
    { quotationNumber },
    { lastFollowUpDate: new Date() },
    { new: true }
  );

  if (!header) {
    throw new Error('Quotation header not found');
  }

  return header;
};

// Migration function to populate offerNumberInQuotation for existing data
const migrateOfferNumbers = async () => {
  try {
    console.log('Starting migration of offer numbers...');
    
    // Find all offers that don't have offerNumberInQuotation
    const offersToMigrate = await QuotationOffer.find({ 
      offerNumberInQuotation: { $exists: false } 
    }).populate('quotationHeaderId');
    
    console.log(`Found ${offersToMigrate.length} offers to migrate`);
    
    // Group by quotation header
    const quotationGroups = {};
    offersToMigrate.forEach(offer => {
      const quotationNumber = offer.quotationHeaderId?.quotationNumber;
      if (quotationNumber) {
        if (!quotationGroups[quotationNumber]) {
          quotationGroups[quotationNumber] = [];
        }
        quotationGroups[quotationNumber].push(offer);
      }
    });
    
    // Process each quotation
    for (const [quotationNumber, offers] of Object.entries(quotationGroups)) {
      // Sort offers by creation date to maintain order
      offers.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      // Extract offer numbers from offerNumber string
      const offerNumberMap = {};
      offers.forEach(offer => {
        const match = offer.offerNumber.match(/-(\d+)(?:-Rev\d+)?$/);
        if (match) {
          const offerNum = parseInt(match[1], 10);
          if (!offerNumberMap[offerNum]) {
            offerNumberMap[offerNum] = [];
          }
          offerNumberMap[offerNum].push(offer);
        }
      });
      
      // Update offers with offerNumberInQuotation
      for (const [offerNum, offerList] of Object.entries(offerNumberMap)) {
        for (const offer of offerList) {
          await QuotationOffer.findByIdAndUpdate(offer._id, {
            offerNumberInQuotation: parseInt(offerNum, 10)
          });
        }
      }
      
      console.log(`Migrated ${offers.length} offers for quotation ${quotationNumber}`);
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error during migration:', error);
    throw error;
  }
};

// Get quotation analysis data
const getQuotationAnalysis = async ({ startDate, endDate, metric, userId, export: isExport = false }) => {
  try {
    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        dateFilter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }

    // Get all quotations for all users (headers only)
    const quotations = await QuotationHeader.find({
      ...dateFilter
    });


    // Calculate basic metrics (counts only)
    const totalQuotations = quotations.length;

    // Calculate rates
    const wonQuotations = quotations.filter(q => q.status?.type === 'win');
    const lostQuotations = quotations.filter(q => q.status?.type === 'loss');
    const closedQuotations = quotations.filter(q => q.status?.type === 'close');
    
    const winRate = totalQuotations > 0 ? Math.round((wonQuotations.length / totalQuotations) * 100) : 0;
    const lossRate = totalQuotations > 0 ? Math.round((lostQuotations.length / totalQuotations) * 100) : 0;
    const closeRate = totalQuotations > 0 ? Math.round((closedQuotations.length / totalQuotations) * 100) : 0;

    // Detailed status breakdown (counts only)
    const statusBreakdown = {
      open: { count: 0 },
      win: { count: 0 },
      loss: { count: 0 },
      close: { count: 0 }
    };

    quotations.forEach(q => {
      const status = q.status?.type || 'open';
      statusBreakdown[status].count += 1;
    });

    // Reason analytics for loss and close (counts only)
    const reasonAnalytics = {
      loss: {},
      close: {}
    };

    quotations.forEach(q => {
      const status = q.status?.type;
      const reason = q.status?.reason;
      
      if ((status === 'loss' || status === 'close') && reason) {
        if (!reasonAnalytics[status][reason]) {
          reasonAnalytics[status][reason] = { count: 0 };
        }
        reasonAnalytics[status][reason].count += 1;
      }
    });

    // Monthly stats (last 12 months) - counts only
    const monthlyStats = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      
      const monthQuotations = quotations.filter(q => 
        q.createdAt >= month && q.createdAt < nextMonth
      );

      // Monthly status breakdown
      const monthStatusBreakdown = {
        open: 0, win: 0, loss: 0, close: 0
      };
      monthQuotations.forEach(q => {
        const status = q.status?.type || 'open';
        monthStatusBreakdown[status] += 1;
      });

      monthlyStats.push({
        month: month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        count: monthQuotations.length,
        statusBreakdown: monthStatusBreakdown
      });
    }

    // Top customers (by count)
    const customerStats = {};
    quotations.forEach(q => {
      const customerName = q.customerName || 'Unknown';
      if (!customerStats[customerName]) {
        customerStats[customerName] = {
          name: customerName,
          quotations: 0,
          statusBreakdown: { open: 0, win: 0, loss: 0, close: 0 }
        };
      }
      const status = q.status?.type || 'open';
      
      customerStats[customerName].quotations += 1;
      customerStats[customerName].statusBreakdown[status] += 1;
    });

    const topCustomers = Object.values(customerStats)
      .sort((a, b) => b.quotations - a.quotations)
      .slice(0, 5);

    // Follow-up status analysis
    const followUpStatus = {
      currentlyOpen: { count: 0 },
      notFollowedUp: { count: 0 },
      mediumWarning: { count: 0 },
      upToDate: { count: 0 }
    };

    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

    quotations.forEach(q => {
      const status = q.status?.type || 'open';
      const lastFollowUp = q.lastFollowUpDate;
      
      if (status === 'open') {
        followUpStatus.currentlyOpen.count += 1;
        
        if (!lastFollowUp) {
          // Never been followed up
          followUpStatus.notFollowedUp.count += 1;
        } else {
          const followUpDate = new Date(lastFollowUp);
          const daysSinceFollowUp = Math.floor((now - followUpDate) / (24 * 60 * 60 * 1000));
          
          if (daysSinceFollowUp > 7) {
            // More than 7 days since last follow-up (danger)
            followUpStatus.notFollowedUp.count += 1;
          } else if (daysSinceFollowUp > 3) {
            // 3-7 days since last follow-up (medium warning)
            followUpStatus.mediumWarning.count += 1;
          } else {
            // Within 3 days (up to date)
            followUpStatus.upToDate.count += 1;
          }
        }
      }
    });

    // Recent activity (last 10 activities)
    const recentActivity = quotations
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 10)
      .map(q => ({
        description: `Quotation ${q.quotationNumber} - ${q.customerName}`,
        date: q.updatedAt.toLocaleDateString('id-ID'),
        type: q.status?.type || 'open'
      }));

    // Time period summary
    const timePeriodSummary = {
      startDate: startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
      endDate: endDate || new Date().toISOString().split('T')[0],
      period: startDate && endDate ? 'custom' : 'year-to-date'
    };

    return {
      totalQuotations,
      winRate,
      lossRate,
      closeRate,
      statusBreakdown,
      reasonAnalytics,
      monthlyStats,
      topCustomers,
      recentActivity,
      timePeriodSummary,
      followUpStatus
    };
  } catch (error) {
    console.error('Error in getQuotationAnalysis:', error);
    throw error;
  }
};

module.exports = {
  generateQuotationNumber,
  generateOfferNumber,
  formatPrice,
  getFollowUpStatus,
  createQuotationHeader,
  createQuotationOffer,
  getQuotationHeaderById,
  getQuotationOfferById,
  getQuotationOffers,
  updateQuotationHeader,
  updateQuotationOffer,
  deleteQuotationHeader,
  deleteQuotationOffer,
  getQuotations,
  updateLastFollowUp,
  updateLastFollowUpAll,
  migrateOfferNumbers,
  getQuotationAnalysis
};