const QuotationHeader = require('../models/quotationHeader.model');
const QuotationOffer = require('../models/quotationOffer.model');
const OfferItem = require('../models/offerItem.model');
const { RFQ } = require('../models/rfq.model');
const BodyType = require('../models/bodyType.model');

// Helper function to add timeout to promises
const withTimeout = (promise, timeoutMs, fallback) => {
  return Promise.race([
    promise,
    new Promise((resolve) => 
      setTimeout(() => {
        console.warn(`[withTimeout] Promise timed out after ${timeoutMs}ms, using fallback`);
        resolve(fallback);
      }, timeoutMs)
    )
  ]);
};

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
const generateOfferNumber = async (quotationNumber, isRevision = false, parentOfferId = null, retryCount = 0) => {
  // Safety limit to prevent infinite recursion
  const MAX_RETRIES = 100;
  if (retryCount >= MAX_RETRIES) {
    throw new Error(`Failed to generate unique offer number after ${MAX_RETRIES} attempts`);
  }

  console.log(`[generateOfferNumber] Generating offer number for quotation: ${quotationNumber}, isRevision: ${isRevision}, retryCount: ${retryCount}`);
  
  // Find quotation header
  const header = await QuotationHeader.findOne({ quotationNumber });
  if (!header) {
    console.error(`[generateOfferNumber] Quotation header not found for: ${quotationNumber}`);
    throw new Error('Quotation header not found');
  }
  console.log(`[generateOfferNumber] Found header: ${header._id}`);

  if (isRevision && parentOfferId) {
    // For revisions, use the same offer number as parent but with revision suffix
    console.log(`[generateOfferNumber] Processing revision for parentOfferId: ${parentOfferId}`);
    const parentOffer = await QuotationOffer.findById(parentOfferId);
    if (!parentOffer) {
      throw new Error('Parent offer not found');
    }
    
    console.log(`[generateOfferNumber] Found parent offer: ${parentOffer.offerNumber}, offerNumberInQuotation: ${parentOffer.offerNumberInQuotation}`);
    
    // Extract the base offer number (without revision suffix)
    const baseOfferNumber = parentOffer.offerNumber.split('-Rev')[0];
    
    // Find the highest revision number for this offer using aggregation for atomicity
    console.log(`[generateOfferNumber] Finding highest revision for offerNumberInQuotation: ${parentOffer.offerNumberInQuotation}`);
    const revisionAggregationPromise = QuotationOffer.aggregate([
      {
        $match: {
          quotationHeaderId: header._id,
          offerNumberInQuotation: parentOffer.offerNumberInQuotation,
          revision: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          maxRevision: { $max: '$revision' }
        }
      }
    ]);
    
    const revisionResult = await withTimeout(
      revisionAggregationPromise,
      5000, // 5 second timeout
      [] // fallback to empty array if timeout
    );
    
    console.log(`[generateOfferNumber] Revision aggregation result:`, JSON.stringify(revisionResult));
    
    let revision = 1;
    if (revisionResult.length > 0 && revisionResult[0].maxRevision) {
      revision = revisionResult[0].maxRevision + 1;
      console.log(`[generateOfferNumber] Found max revision: ${revisionResult[0].maxRevision}, using next revision: ${revision}`);
    } else {
      console.log(`[generateOfferNumber] No existing revisions found, using revision: ${revision}`);
    }
    
    const offerNumber = `${baseOfferNumber}-Rev${revision}`;
    console.log(`[generateOfferNumber] Calculated revision offer number: ${offerNumber}`);
    
    // Double-check that this revision number doesn't already exist
    // Check both by offerNumber string and by revision number to be safe
    console.log(`[generateOfferNumber] Checking for existing revision offer...`);
    const existingOffer = await QuotationOffer.findOne({
      $or: [
        { offerNumber },
        {
          quotationHeaderId: header._id,
          offerNumberInQuotation: parentOffer.offerNumberInQuotation,
          revision: revision
        }
      ]
    });
    
    if (existingOffer) {
      console.warn(`[generateOfferNumber] Found existing revision offer that conflicts!`, {
        existingOfferId: existingOffer._id,
        existingOfferNumber: existingOffer.offerNumber,
        existingRevision: existingOffer.revision,
        calculatedOfferNumber: offerNumber,
        calculatedRevision: revision,
        retryCount: retryCount + 1
      });
      // Add a small delay to allow database to catch up, then recursively retry
      await new Promise(resolve => setTimeout(resolve, 50 * (retryCount + 1)));
      return await generateOfferNumber(quotationNumber, isRevision, parentOfferId, retryCount + 1);
    }
    
    console.log(`[generateOfferNumber] No existing revision offer found, returning: ${offerNumber}, offerNumberInQuotation: ${parentOffer.offerNumberInQuotation}`);
    return { offerNumber, offerNumberInQuotation: parentOffer.offerNumberInQuotation };
  } else {
    // For new offers, find the next offer number in quotation
    
    // Pre-check: If no offers exist, skip aggregation and return 1 directly
    // This optimizes the common rebuild case where we know there are no offers
    console.log(`[generateOfferNumber] Checking if any offers exist for header: ${header._id}`);
    const offerCount = await QuotationOffer.countDocuments({ 
      quotationHeaderId: header._id,
      revision: 0 
    });
    
    if (offerCount === 0) {
      console.log(`[generateOfferNumber] No offers found (count: ${offerCount}), trying to use offerNumberInQuotation = 1`);
      // Try starting from 1, but if it exists (for any reason), increment until we find an available number
      let nextOfferNumberInQuotation = 1;
      let nextOfferNumber = `${quotationNumber}-${nextOfferNumberInQuotation}`;
      
      // Keep incrementing until we find a number that doesn't exist globally
      // This handles cases where orphaned offers exist from previous failed rebuilds
      while (nextOfferNumberInQuotation < 100) { // Safety limit
        const existingOffer = await QuotationOffer.findOne({ offerNumber: nextOfferNumber });
        if (!existingOffer) {
          // Number is available, use it
          console.log(`[generateOfferNumber] Found available offer number: ${nextOfferNumber}, offerNumberInQuotation: ${nextOfferNumberInQuotation}`);
          return { offerNumber: nextOfferNumber, offerNumberInQuotation: nextOfferNumberInQuotation };
        }
        
        // Check if it belongs to this header (which would be weird since count is 0, but handle it)
        if (existingOffer.quotationHeaderId.toString() === header._id.toString()) {
          console.warn(`[generateOfferNumber] Found existing offer ${nextOfferNumber} for this header even though count was 0. Incrementing...`);
        } else {
          console.warn(`[generateOfferNumber] Found orphaned offer ${nextOfferNumber} belonging to different header (${existingOffer.quotationHeaderId}). Incrementing...`);
        }
        
        // Number is taken, try next
        nextOfferNumberInQuotation++;
        nextOfferNumber = `${quotationNumber}-${nextOfferNumberInQuotation}`;
      }
      
      // If we've exhausted all numbers (shouldn't happen), throw error
      throw new Error(`Failed to find available offer number after checking up to ${nextOfferNumberInQuotation}`);
    }
    
    console.log(`[generateOfferNumber] Found ${offerCount} existing offers, running aggregation...`);
    
    // Use aggregation to get the max offerNumberInQuotation atomically
    // Wrap with timeout to prevent hanging
    const aggregationPromise = QuotationOffer.aggregate([
      {
        $match: {
          quotationHeaderId: header._id,
          revision: 0 // Only count original offers, not revisions
        }
      },
      {
        $group: {
          _id: null,
          maxOfferNumber: { $max: '$offerNumberInQuotation' }
        }
      }
    ]);
    
    console.log(`[generateOfferNumber] Starting aggregation query...`);
    const result = await withTimeout(
      aggregationPromise,
      5000, // 5 second timeout
      [] // fallback to empty array if timeout
    );
    
    console.log(`[generateOfferNumber] Aggregation result:`, JSON.stringify(result));
    
    // Find the highest offer number in quotation
    let highestOfferNumberInQuotation = 0;
    if (result.length > 0 && result[0].maxOfferNumber) {
      highestOfferNumberInQuotation = result[0].maxOfferNumber;
      console.log(`[generateOfferNumber] Highest offerNumberInQuotation found: ${highestOfferNumberInQuotation}`);
    } else {
      console.log(`[generateOfferNumber] No max offer number found in aggregation result, using 0`);
    }

    const nextOfferNumberInQuotation = highestOfferNumberInQuotation + 1;
    const offerNumber = `${quotationNumber}-${nextOfferNumberInQuotation}`;
    
    console.log(`[generateOfferNumber] Calculated next offer number: ${offerNumber}, offerNumberInQuotation: ${nextOfferNumberInQuotation}`);
    
    // Double-check that this offerNumberInQuotation doesn't already exist (race condition protection)
    // Check both by offerNumber string and by offerNumberInQuotation to be safe
    console.log(`[generateOfferNumber] Checking for existing offer with offerNumber: ${offerNumber} or offerNumberInQuotation: ${nextOfferNumberInQuotation}`);
    const existingOffer = await QuotationOffer.findOne({
      $or: [
        { offerNumber },
        {
          quotationHeaderId: header._id,
          offerNumberInQuotation: nextOfferNumberInQuotation,
          revision: 0
        }
      ]
    });
    
    if (existingOffer) {
      console.warn(`[generateOfferNumber] Found existing offer that conflicts!`, {
        existingOfferId: existingOffer._id,
        existingOfferNumber: existingOffer.offerNumber,
        existingOfferNumberInQuotation: existingOffer.offerNumberInQuotation,
        calculatedOfferNumber: offerNumber,
        calculatedOfferNumberInQuotation: nextOfferNumberInQuotation,
        retryCount: retryCount + 1
      });
      // Add a small delay to allow database to catch up, then recursively retry
      await new Promise(resolve => setTimeout(resolve, 50 * (retryCount + 1)));
      return await generateOfferNumber(quotationNumber, isRevision, parentOfferId, retryCount + 1);
    }
    
    console.log(`[generateOfferNumber] No existing offer found, returning: ${offerNumber}, offerNumberInQuotation: ${nextOfferNumberInQuotation}`);
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

// Calculate follow-up status and color (exported for use in routes)
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
    
    // Handle ObjectId fields - convert empty strings to null to prevent MongoDB cast errors
    const objectIdFields = [
      'drawingSpecification',
      'bodyTypeId',
      'chassisTypeId',
      'sizeTypeId',
    'templateSourceId',
    'rfqId',
      'acceptedBy'
    ];
    
    objectIdFields.forEach(field => {
      // Convert empty strings to null (empty string cannot be cast to ObjectId)
      // Leave undefined as-is (optional fields can be undefined)
      if (formatted[field] === '') {
        formatted[field] = null;
      }
    });

    const stringFieldsToTrim = [];

    stringFieldsToTrim.forEach(field => {
      if (typeof formatted[field] === 'string') {
        formatted[field] = formatted[field].trim();
      }
    });
    
    
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
    console.log('[createQuotationOffer] Starting for quotation:', quotationNumber);
    // Format data before saving
    const formattedData = formatDataForStorage(offerData);
    console.log('[createQuotationOffer] Formatted data keys:', Object.keys(formattedData));

    // Find quotation header
    console.log('[createQuotationOffer] Looking for header with quotationNumber:', quotationNumber);
    const header = await QuotationHeader.findOne({ quotationNumber });
    if (!header) {
      console.error('[createQuotationOffer] Header not found for:', quotationNumber);
      throw new Error(`Quotation header not found for quotation number: ${quotationNumber}`);
    }
    console.log('[createQuotationOffer] Found header:', header._id);

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
    
    let offerNumber = offerNumberResult.offerNumber;
    if (offerNumberResult.offerNumberInQuotation) {
      offerNumberInQuotation = offerNumberResult.offerNumberInQuotation;
    }

    // Extract offer items from offerData (save before deletion)
    const offerItems = formattedData.offerItems || [];
    console.log('Backend: Received offerItems:', offerItems);
    console.log('Backend: offerItems length:', offerItems.length);
    delete formattedData.offerItems; // Remove from offer data

    // Create quotation offer with retry logic for duplicate key errors
    let offer;
    let retryAttempts = 0;
    const MAX_SAVE_RETRIES = 10;
    
    while (retryAttempts < MAX_SAVE_RETRIES) {
      try {
        offer = new QuotationOffer({
          ...formattedData,
          quotationHeaderId: header._id,
          offerNumber,
          offerNumberInQuotation,
          revision,
          parentQuotationId
        });

        await offer.save();
        
        // If save succeeds, break out of retry loop
        break;
      } catch (saveError) {
        // Check if it's a duplicate key error (E11000)
        if (saveError.code === 11000 || saveError.message?.includes('duplicate key') || saveError.message?.includes('E11000')) {
          retryAttempts++;
          console.warn(`Offer number ${offerNumber} already exists, auto-incrementing (attempt ${retryAttempts}/${MAX_SAVE_RETRIES})`);
          
          if (retryAttempts >= MAX_SAVE_RETRIES) {
            throw new Error(`Failed to create offer after ${MAX_SAVE_RETRIES} attempts due to duplicate offer numbers`);
          }
          
          // For new offers (not revisions), manually find the next available number
          if (!formattedData.isRevision) {
            // Find the highest offer number in quotation
            const existingOffers = await QuotationOffer.find({
              quotationHeaderId: header._id,
              revision: 0
            }).sort({ offerNumberInQuotation: -1 }).limit(1);
            
            if (existingOffers.length > 0) {
              offerNumberInQuotation = existingOffers[0].offerNumberInQuotation + 1;
            } else {
              offerNumberInQuotation = 1;
            }
            
            // Keep incrementing until we find a free number
            let checkExists = await QuotationOffer.findOne({ 
              offerNumber: `${quotationNumber}-${offerNumberInQuotation}` 
            });
            
            let incrementAttempts = 0;
            while (checkExists && incrementAttempts < 50) { // Separate counter for increment attempts
              offerNumberInQuotation++;
              checkExists = await QuotationOffer.findOne({ 
                offerNumber: `${quotationNumber}-${offerNumberInQuotation}` 
              });
              incrementAttempts++;
            }
            
            if (checkExists) {
              throw new Error(`Unable to find available offer number after ${incrementAttempts} increments`);
            }
            
            offerNumber = `${quotationNumber}-${offerNumberInQuotation}`;
          } else {
            // For revisions, regenerate using generateOfferNumber with retry
            const retryResult = await generateOfferNumber(
              quotationNumber, 
              formattedData.isRevision, 
              formattedData.parentOfferId,
              retryAttempts // Pass retry count to generateOfferNumber
            );
            offerNumber = retryResult.offerNumber;
            if (retryResult.offerNumberInQuotation) {
              offerNumberInQuotation = retryResult.offerNumberInQuotation;
            }
          }
          
          // Add a small delay to allow database to catch up
          await new Promise(resolve => setTimeout(resolve, 50 * retryAttempts));
          continue;
        } else {
          // If it's not a duplicate key error, throw it
          throw saveError;
        }
      }
    }

    // Track created resources for potential rollback
    const createdResources = {
      offer: offer,
      items: []
    };

    // Create offer items if provided - use Promise.allSettled for atomic-like creation
    if (offerItems.length > 0) {
      console.log('[createQuotationOffer] Creating', offerItems.length, 'offer items atomically');
      
      // Create all items in parallel using Promise.allSettled
      const itemPromises = offerItems.map((itemData, index) => {
        return (async () => {
          console.log('[createQuotationOffer] Processing offer item', index + 1, 'of', offerItems.length);
          const formattedItemData = formatDataForStorage(itemData);
          
          // Remove _id and other fields that shouldn't be copied for new items
          delete formattedItemData._id;
          delete formattedItemData.createdAt;
          delete formattedItemData.updatedAt;
          delete formattedItemData.__v;
          delete formattedItemData.quotationOfferId; // Will be set to new offer ID
          
          const offerItem = new OfferItem({
            ...formattedItemData,
            quotationOfferId: offer._id,
            itemNumber: index + 1
          });
          
          const savedItem = await offerItem.save();
          console.log('[createQuotationOffer] Offer item', index + 1, 'saved successfully');
          return savedItem;
        })();
      });

      // Wait for all items to be created (or fail)
      const results = await Promise.allSettled(itemPromises);
      
      // Check for failures
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.error('[createQuotationOffer] Failed to create', failures.length, 'items out of', offerItems.length);
        failures.forEach((failure, index) => {
          console.error('[createQuotationOffer] Item failure', index + 1, ':', failure.reason);
        });
        
        // Collect successfully created items for cleanup
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            createdResources.items.push(result.value);
          }
        });
        
        throw new Error(`Failed to create ${failures.length} out of ${offerItems.length} offer items`);
      }
      
      // All items created successfully - collect them
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          createdResources.items.push(result.value);
        }
      });
      
      console.log('[createQuotationOffer] All', offerItems.length, 'items created successfully');
      
      // Validate completeness
      await validateOfferCompleteness(offer._id, offerItems.length);
      
      // Update offer totals
      await offer.save();
      console.log('[createQuotationOffer] Offer totals updated');
    } else {
      console.log('[createQuotationOffer] No offer items to create');
    }

    // Return offer with createdResources for caller to track
    return { offer, createdResources };
  } catch (error) {
    console.error('Error creating quotation offer:', error);
    throw error;
  }
};

// Cleanup quotation resources (header, offers, items) - used for rollback
const cleanupQuotationResources = async (createdResources) => {
  if (!createdResources) {
    return;
  }

  console.log('[cleanupQuotationResources] Starting cleanup...', {
    hasOffer: !!createdResources.offer,
    itemsCount: createdResources.items?.length || 0,
    hasHeader: !!createdResources.header
  });

  try {
    // Delete items first (in reverse order)
    if (createdResources.items && createdResources.items.length > 0) {
      const itemIds = createdResources.items.map(item => item._id || item);
      console.log('[cleanupQuotationResources] Deleting', itemIds.length, 'items');
      await OfferItem.deleteMany({ _id: { $in: itemIds } });
      console.log('[cleanupQuotationResources] Deleted items');
    }

    // Delete offer
    if (createdResources.offer) {
      const offerId = createdResources.offer._id || createdResources.offer;
      console.log('[cleanupQuotationResources] Deleting offer:', offerId);
      await QuotationOffer.findByIdAndDelete(offerId);
      console.log('[cleanupQuotationResources] Deleted offer');
    }

    // Delete header (last, as it's the parent)
    if (createdResources.header) {
      const headerId = createdResources.header._id || createdResources.header;
      console.log('[cleanupQuotationResources] Deleting header:', headerId);
      await QuotationHeader.findByIdAndDelete(headerId);
      console.log('[cleanupQuotationResources] Deleted header');
    }

    console.log('[cleanupQuotationResources] Cleanup completed successfully');
  } catch (cleanupError) {
    // Log but don't throw - we want cleanup to be best-effort
    console.error('[cleanupQuotationResources] Error during cleanup:', cleanupError);
    console.error('[cleanupQuotationResources] Partial cleanup may have occurred');
  }
};

// Validate that all offer items were created successfully
const validateOfferCompleteness = async (offerId, expectedItemCount) => {
  if (expectedItemCount === 0) {
    return; // No items expected, skip validation
  }

  console.log('[validateOfferCompleteness] Validating offer completeness...', {
    offerId,
    expectedItemCount
  });

  const actualItemCount = await OfferItem.countDocuments({ quotationOfferId: offerId });
  
  if (actualItemCount !== expectedItemCount) {
    console.error('[validateOfferCompleteness] Validation failed!', {
      offerId,
      expectedItemCount,
      actualItemCount
    });
    throw new Error(`Offer completeness validation failed: expected ${expectedItemCount} items, found ${actualItemCount}`);
  }

  console.log('[validateOfferCompleteness] Validation passed:', {
    offerId,
    itemCount: actualItemCount
  });
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
    .populate('requesterId', 'fullName email phoneNumbers')
    .populate('approverId', 'fullName email phoneNumbers')
    .populate('creatorId', 'fullName email phoneNumbers')
    .populate({
      path: 'downloads.userId',
      select: 'fullName email'
    })
    .populate({
      path: 'rfqId',
      populate: [
        { path: 'requesterId', select: 'fullName email' },
        { path: 'approverId', select: 'fullName email' },
        { path: 'quotationCreatorId', select: 'fullName email' },
        { path: 'timeline.user', select: 'fullName email' },
        { path: 'documents', populate: { path: 'uploadedBy', select: 'fullName email' } },
        { path: 'items', populate: [{ path: 'drawingSpecification' }, { path: 'templateSourceId' }] }
      ]
    });
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
      model: 'DrawingSpecification',
      populate: [
        {
          path: 'bodyTypeId',
          select: 'name shortName'
        },
        {
          path: 'chassisTypeId',
          select: 'name shortName'
        },
        {
          path: 'sizeTypeId',
          select: 'name shortName'
        },
        {
          path: 'features.featureId',
          select: 'name shortName'
        }
      ]
    })
    .populate('bodyTypeId', 'name shortName')
    .populate('chassisTypeId', 'name shortName')
    .populate('sizeTypeId', 'name shortName')
    .populate('templateSourceId') // Populate dynamic template source (BodyType or DrawingSpecification)
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


  const headerObj = header.toObject();
  const rfqSnapshot = headerObj.rfqId || null;
  delete headerObj.rfqId;

  if (rfqSnapshot) {
    headerObj.customerName = rfqSnapshot.customerName;
    headerObj.contactPerson = rfqSnapshot.contactPerson;
    headerObj.customerContacts = rfqSnapshot.customerContacts;
    headerObj.deliveryTerms = rfqSnapshot.deliveryTerms;
    headerObj.deliveryNotes = rfqSnapshot.deliveryNotes;
    headerObj.targetCloseDate = rfqSnapshot.targetCloseDate;
    headerObj.paymentTerms = rfqSnapshot.paymentTerms;
    headerObj.inclusionNotes = rfqSnapshot.inclusionNotes;
    headerObj.exclusionNotes = rfqSnapshot.exclusionNotes;
    headerObj.isTaxIncluded = rfqSnapshot.isTaxIncluded;
    headerObj.includePPN = rfqSnapshot.includePPN;
    headerObj.lineOfBusiness = rfqSnapshot.lineOfBusiness;
    headerObj.rfqId = rfqSnapshot._id;
  }

  return { 
    header: {
      ...headerObj,
      followUpStatus: getFollowUpStatus(header.lastFollowUpDate)
    },
    rfq: rfqSnapshot,
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
const getQuotations = async (filters = {}, pagination = { page: 1, limit: 10 }, options = {}) => {
  const { page, limit } = pagination;
  const { lightweight = false } = options;
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
  if (filters.marketing) {
    headerQuery.marketingName = new RegExp(filters.marketing, 'i');
  }
  if (filters.status) {
    // Handle both string and object (for $in queries)
    if (typeof filters.status === 'object' && filters.status.$in) {
      headerQuery['status.type'] = filters.status;
    } else {
      headerQuery['status.type'] = filters.status;
    }
  }
  if (filters['lineOfBusiness.type']) {
    // Handle both string and object (for $in queries)
    if (typeof filters['lineOfBusiness.type'] === 'object' && filters['lineOfBusiness.type'].$in) {
      headerQuery['lineOfBusiness.type'] = filters['lineOfBusiness.type'];
    } else {
      headerQuery['lineOfBusiness.type'] = filters['lineOfBusiness.type'];
    }
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

  // Get headers with pagination
  // Skip population in lightweight mode for instant loading
  let headers;
  if (lightweight) {
    // Ultra-lightweight: no population, minimal fields only
    headers = await QuotationHeader.find(headerQuery)
      .select('_id quotationNumber createdAt updatedAt requesterId approverId creatorId status lastFollowUpDate')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean() for faster queries without Mongoose document overhead
  } else {
    // Full mode: populate user data
    headers = await QuotationHeader.find(headerQuery)
      .populate('requesterId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('creatorId', 'fullName email')
      .populate({
        path: 'rfqId',
        populate: [
          { path: 'requesterId', select: 'fullName email' },
          { path: 'approverId', select: 'fullName email' },
          { path: 'quotationCreatorId', select: 'fullName email' }
        ]
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  }

  // Get total count
  const total = await QuotationHeader.countDocuments(headerQuery);

  // For each header, get its offers with grouping (skip in lightweight mode)
  const quotations = [];
  for (const header of headers) {
    try {
      // Skip fetching offers in lightweight mode for faster initial load
      if (lightweight) {
        // In lightweight mode, header is already a plain object from lean()
        // Only include minimal fields
        const headerObj = header.toObject ? header.toObject() : header;
        quotations.push({
          header: {
            _id: headerObj._id,
            quotationNumber: headerObj.quotationNumber,
            createdAt: headerObj.createdAt,
            updatedAt: headerObj.updatedAt,
            requesterId: headerObj.requesterId, // Just the ID, no population
            approverId: headerObj.approverId, // Just the ID, no population
            creatorId: headerObj.creatorId, // Just the ID, no population
            status: headerObj.status,
            lastFollowUpDate: headerObj.lastFollowUpDate,
            // Skip followUpStatus calculation to avoid aggregation overhead
            // Skip other fields like customerName, marketingName, etc. to keep it minimal
          },
          offers: []
        });
        continue;
      }
      
      // Use the grouped structure from getQuotationOffers
      const { header: mappedHeader, rfq, offers: offersGrouped } = await getQuotationOffers(header.quotationNumber);
      let groupedOffers = offersGrouped;

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

    if (filters.customer && rfq) {
        const matchesCustomer = new RegExp(filters.customer, 'i').test(rfq.customerName || '');
        if (!matchesCustomer) {
          continue;
        }
      }

    quotations.push({
        header: mappedHeader,
        rfq,
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
        rfq: header.rfqId || null,
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

    // Get RFQ statistics
    const rfqs = await RFQ.find({
      ...dateFilter
    });
    
    const rfqStats = {
      total: rfqs.length,
      approved: rfqs.filter(r => r.status === 'approved').length,
      rejected: rfqs.filter(r => r.status === 'rejected').length,
      pending: rfqs.filter(r => r.status === 'pending').length
    };


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
      notFollowedUp: { count: 0, quotations: [] },
      mediumWarning: { count: 0, quotations: [] },
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
          followUpStatus.notFollowedUp.quotations.push({
            quotationId: q._id.toString(),
            quotationNumber: q.quotationNumber,
            customerName: q.customerName || 'N/A',
            daysSinceFollowUp: null
          });
        } else {
          const followUpDate = new Date(lastFollowUp);
          const daysSinceFollowUp = Math.floor((now - followUpDate) / (24 * 60 * 60 * 1000));
          
          if (daysSinceFollowUp > 7) {
            // More than 7 days since last follow-up (danger)
            followUpStatus.notFollowedUp.count += 1;
            followUpStatus.notFollowedUp.quotations.push({
              quotationId: q._id.toString(),
              quotationNumber: q.quotationNumber,
              customerName: q.customerName || 'N/A',
              daysSinceFollowUp
            });
          } else if (daysSinceFollowUp > 3) {
            // 3-7 days since last follow-up (medium warning)
            followUpStatus.mediumWarning.count += 1;
            followUpStatus.mediumWarning.quotations.push({
              quotationId: q._id.toString(),
              quotationNumber: q.quotationNumber,
              customerName: q.customerName || 'N/A',
              daysSinceFollowUp
            });
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

    // Body type frequency - aggregate from RFQs and Quotations
    const bodyTypeFrequencyMap = {};
    
    try {
      // Count body types from RFQs
      const rfqsWithBodyType = await RFQ.find({
        ...dateFilter,
        bodyTypeId: { $exists: true, $ne: null }
      }).populate({
        path: 'bodyTypeId',
        select: 'name shortName',
        model: 'BodyType'
      });
      
      rfqsWithBodyType.forEach(rfq => {
        // Handle populated bodyTypeId
        if (rfq.bodyTypeId) {
          let bodyTypeName = 'Unknown';
          // Check if it's a populated object with name property
          if (rfq.bodyTypeId && typeof rfq.bodyTypeId === 'object' && rfq.bodyTypeId.name) {
            bodyTypeName = rfq.bodyTypeId.name;
          } else if (rfq.bodyTypeId && typeof rfq.bodyTypeId.toString === 'function') {
            // If it's an ObjectId that wasn't populated, skip it
            return;
          }
          
          if (!bodyTypeFrequencyMap[bodyTypeName]) {
            bodyTypeFrequencyMap[bodyTypeName] = {
              name: bodyTypeName,
              rfq: 0,
              quotation: 0,
              total: 0
            };
          }
          bodyTypeFrequencyMap[bodyTypeName].rfq += 1;
          bodyTypeFrequencyMap[bodyTypeName].total += 1;
        }
      });
    } catch (error) {
      console.error('Error counting body types from RFQs:', error);
    }
    
    try {
      // Count body types from Quotations (via rfqId)
      const quotationsWithRfq = await QuotationHeader.find({
        ...dateFilter,
        rfqId: { $exists: true, $ne: null }
      }).populate({
        path: 'rfqId',
        select: 'bodyTypeId',
        populate: {
          path: 'bodyTypeId',
          select: 'name shortName',
          model: 'BodyType'
        }
      });
      
      quotationsWithRfq.forEach(quotation => {
        if (quotation.rfqId && quotation.rfqId.bodyTypeId) {
          let bodyTypeName = 'Unknown';
          // Check if it's a populated object with name property
          if (quotation.rfqId.bodyTypeId && typeof quotation.rfqId.bodyTypeId === 'object' && quotation.rfqId.bodyTypeId.name) {
            bodyTypeName = quotation.rfqId.bodyTypeId.name;
          } else {
            // If it's an ObjectId that wasn't populated, skip it
            return;
          }
          
          if (!bodyTypeFrequencyMap[bodyTypeName]) {
            bodyTypeFrequencyMap[bodyTypeName] = {
              name: bodyTypeName,
              rfq: 0,
              quotation: 0,
              total: 0
            };
          }
          bodyTypeFrequencyMap[bodyTypeName].quotation += 1;
          bodyTypeFrequencyMap[bodyTypeName].total += 1;
        }
      });
    } catch (error) {
      console.error('Error counting body types from Quotations:', error);
    }
    
    const bodyTypeFrequency = Object.values(bodyTypeFrequencyMap)
      .sort((a, b) => b.total - a.total);

    // Quarterly status breakdown
    const quarterlyStatusMap = {};
    const yearsWithData = new Set();
    
    // Determine the year range to process
    let startYear, endYear;
    if (startDate && endDate) {
      startYear = new Date(startDate).getFullYear();
      endYear = new Date(endDate).getFullYear();
    } else {
      // Default to current year if no date filter
      const currentYear = new Date().getFullYear();
      startYear = currentYear;
      endYear = currentYear;
    }
    
    // First pass: collect data and track which years have data
    quotations.forEach(q => {
      const date = new Date(q.createdAt);
      const year = date.getFullYear();
      const month = date.getMonth();
      let quarter;
      
      if (month >= 0 && month <= 2) quarter = 1; // Q1: Jan-Mar
      else if (month >= 3 && month <= 5) quarter = 2; // Q2: Apr-Jun
      else if (month >= 6 && month <= 8) quarter = 3; // Q3: Jul-Sep
      else quarter = 4; // Q4: Oct-Dec
      
      yearsWithData.add(year);
      
      const key = `Q${quarter} ${year}`;
      if (!quarterlyStatusMap[key]) {
        quarterlyStatusMap[key] = {
          label: key,
          win: 0,
          loss: 0,
          cancel: 0,
          open: 0
        };
      }
      
      const status = q.status?.type || 'open';
      if (status === 'close') {
        quarterlyStatusMap[key].cancel += 1;
      } else if (quarterlyStatusMap[key].hasOwnProperty(status)) {
        quarterlyStatusMap[key][status] += 1;
      }
    });
    
    // Second pass: ensure all quarters exist for all years in the range
    // This ensures Q1-Q4 are always shown even if some have no data
    for (let year = startYear; year <= endYear; year++) {
      for (let quarter = 1; quarter <= 4; quarter++) {
        const key = `Q${quarter} ${year}`;
        if (!quarterlyStatusMap[key]) {
          quarterlyStatusMap[key] = {
            label: key,
            win: 0,
            loss: 0,
            cancel: 0,
            open: 0
          };
        }
      }
    }
    
    // Convert to array and sort by year and quarter
    const quarterlyStatus = Object.values(quarterlyStatusMap)
      .sort((a, b) => {
        // Extract year and quarter from label (e.g., "Q1 2024")
        const aMatch = a.label.match(/Q(\d+)\s+(\d+)/);
        const bMatch = b.label.match(/Q(\d+)\s+(\d+)/);
        if (!aMatch || !bMatch) return 0;
        const aYear = parseInt(aMatch[2]);
        const bYear = parseInt(bMatch[2]);
        const aQuarter = parseInt(aMatch[1]);
        const bQuarter = parseInt(bMatch[1]);
        
        if (aYear !== bYear) return aYear - bYear;
        return aQuarter - bQuarter;
      });

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
      followUpStatus,
      rfqStats,
      bodyTypeFrequency,
      quarterlyStatus
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
  getQuotationAnalysis,
  cleanupQuotationResources,
  validateOfferCompleteness
};