const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const ImageModule = require('docxtemplater-image-module-free');
const fs = require('fs');
const path = require('path');
const { drawingSpecificationGridFS, notesImagesGridFS } = require('../utils/gridfsHelper');
const mongoose = require('mongoose');
const signatureService = require('./signatureService');
const QRCode = require('qrcode');

// XML escaping helper
const escapeXml = (unsafe) => {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

/**
 * Sanitize paragraph attributes by removing Word-generated volatile unique IDs
 * These IDs can cause corruption when documents are regenerated or tables are inserted
 * 
 * @param {string} attrs - Raw paragraph attributes string
 * @returns {string} - Sanitized attributes without Word unique IDs
 */
const sanitizePAttrs = (attrs = "") => {
  return attrs
    .replace(/\s(?:w14:paraId|w14:textId|w:paraId|w:rsidR|w:rsidRDefault|w:rsidP|w:rsidRPr)="[^"]*"/g, "")
    .replace(/\smc:Ignorable="[^"]*"/g, "")
    .trim();
};

const DEFAULT_DOC_FONT = 'Century Gothic';
const FONT_FAMILY_TAG = `<w:rFonts w:ascii="${DEFAULT_DOC_FONT}" w:hAnsi="${DEFAULT_DOC_FONT}" w:cs="${DEFAULT_DOC_FONT}" w:eastAsia="${DEFAULT_DOC_FONT}"/>`;
// Font size 9 (18 half-points) for regular text
const FONT_SIZE_TAG = `<w:sz w:val="18"/><w:szCs w:val="18"/>`;
// Font size tag with family for regular text
const FONT_TAG_WITH_SIZE = `${FONT_FAMILY_TAG}${FONT_SIZE_TAG}`;

// Post-process document to insert table XML into Word document
const insertTablesIntoDocument = (zip, tableMap) => {
  if (!tableMap || Object.keys(tableMap).length === 0) {
    return zip;
  }

  try {
    if (!zip.files['word/document.xml']) {
      console.error('word/document.xml not found in ZIP');
      return zip;
    }
    
    let docXml = zip.files['word/document.xml'].asText();
    let tablesInserted = 0;
    
    Object.keys(tableMap).forEach((placeholder, idx) => {
      const tableXML = tableMap[placeholder];
      
      const markerPos = docXml.indexOf(placeholder);
      
      if (markerPos === -1) {
        const markerWithoutBrackets = placeholder.replace(/[\[\]]/g, '');
        const markerPos2 = docXml.indexOf(markerWithoutBrackets);
        if (markerPos2 !== -1) {
          const paraStart = docXml.lastIndexOf('<w:p', markerPos2);
          const paraEnd = docXml.indexOf('</w:p>', markerPos2);
          if (paraStart !== -1 && paraEnd !== -1 && paraEnd > paraStart) {
            const paraContent = docXml.substring(paraStart, paraEnd + 6);
            const textContent = paraContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (textContent === markerWithoutBrackets || textContent === placeholder.replace(/[\[\]]/g, '')) {
              const beforePara = docXml.substring(0, paraStart);
              const afterPara = docXml.substring(paraEnd + 6);
              docXml = beforePara + tableXML + afterPara;
              tablesInserted++;
              return;
            }
          }
        }
        console.warn(`Placeholder ${placeholder} not found in XML`);
        return;
      }
      
      const paraStart = docXml.lastIndexOf('<w:p', markerPos);
      const paraEnd = docXml.indexOf('</w:p>', markerPos);
      
      if (paraStart === -1 || paraEnd === -1 || paraEnd <= paraStart) {
        console.warn(`Could not find paragraph boundaries for ${placeholder}`);
        return;
      }
      
      const paraContent = docXml.substring(paraStart, paraEnd + 6);
      const textContent = paraContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      
      if (textContent === placeholder || textContent.replace(/[\[\]]/g, '') === placeholder.replace(/[\[\]]/g, '')) {
        const beforePara = docXml.substring(0, paraStart);
        const afterPara = docXml.substring(paraEnd + 6);
        docXml = beforePara + tableXML + afterPara;
        tablesInserted++;
        return;
      }
      
      const placeholderPos2 = docXml.indexOf(placeholder, markerPos + 1);
      if (placeholderPos2 === -1) {
        return;
      }
      
      let placeholderPos = placeholderPos2;
      let actualMarker = placeholder;
      
      if (placeholderPos === -1) {
        const markerWithoutBrackets = placeholder.replace(/[\[\]]/g, '');
        placeholderPos = docXml.indexOf(markerWithoutBrackets);
        if (placeholderPos !== -1) {
          actualMarker = markerWithoutBrackets;
        }
      }
      
      if (placeholderPos !== -1) {
        const paraStart = docXml.lastIndexOf('<w:p', placeholderPos);
        const paraEnd = docXml.indexOf('</w:p>', placeholderPos);
        
        if (paraStart !== -1 && paraEnd !== -1) {
          const originalParagraph = docXml.substring(paraStart, paraEnd + 6);
          
          const beforePlaceholderInPara = docXml.substring(paraStart, placeholderPos);
          const afterPlaceholderInPara = docXml.substring(placeholderPos + actualMarker.length, paraEnd);
          
          let beforeContent = beforePlaceholderInPara;
          const beforeParaOpenTag = beforeContent.indexOf('>');
          if (beforeParaOpenTag !== -1) {
            beforeContent = beforeContent.substring(beforeParaOpenTag + 1);
          }
          beforeContent = beforeContent.replace(/\[SPEC_TABLE_MARKER[^\]]*\]/g, '').trim();
          
          let afterContent = afterPlaceholderInPara;
          afterContent = afterContent.replace(/\[SPEC_TABLE_MARKER[^\]]*\]/g, '').trim();
          
          const textBefore = beforeContent.replace(/<[^>]+>/g, '').trim();
          const textAfter = afterContent.replace(/<[^>]+>/g, '').trim();
          const isMarkerInOwnParagraph = !textBefore && !textAfter;
          
          let finalReplacement;
          
          if (isMarkerInOwnParagraph) {
            finalReplacement = tableXML;
          } else if (textBefore && textAfter) {
            const paraPropsMatch = originalParagraph.match(/<w:p([^>]*)>/);
            const rawAttrs = paraPropsMatch ? paraPropsMatch[1] : "";
            const paraAttrs = sanitizePAttrs(rawAttrs);
            const openP = paraAttrs ? `<w:p${paraAttrs}>` : "<w:p>";
            const closeP = "</w:p>";
            
            const beforeXml = beforeContent.includes('<w:r>') 
              ? beforeContent 
              : `<w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t xml:space="preserve">${escapeXml(beforeContent)}</w:t></w:r>`;
            const afterXml = afterContent.includes('<w:r>')
              ? afterContent
              : `<w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t xml:space="preserve">${escapeXml(afterContent)}</w:t></w:r>`;
            
            finalReplacement = `${openP}${beforeXml}${closeP}${tableXML}${openP}${afterXml}${closeP}`;
          } else if (textBefore) {
            const paraPropsMatch = originalParagraph.match(/<w:p([^>]*)>/);
            const rawAttrs = paraPropsMatch ? paraPropsMatch[1] : "";
            const paraAttrs = sanitizePAttrs(rawAttrs);
            const openP = paraAttrs ? `<w:p${paraAttrs}>` : "<w:p>";
            const closeP = "</w:p>";
            
            const beforeXml = beforeContent.includes('<w:r>')
              ? beforeContent
              : `<w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t xml:space="preserve">${escapeXml(beforeContent)}</w:t></w:r>`;
            
            finalReplacement = `${openP}${beforeXml}${closeP}${tableXML}`;
          } else if (textAfter) {
            const paraPropsMatch = originalParagraph.match(/<w:p([^>]*)>/);
            const rawAttrs = paraPropsMatch ? paraPropsMatch[1] : "";
            const paraAttrs = sanitizePAttrs(rawAttrs);
            const openP = paraAttrs ? `<w:p${paraAttrs}>` : "<w:p>";
            const closeP = "</w:p>";
            
            const afterXml = afterContent.includes('<w:r>')
              ? afterContent
              : `<w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t xml:space="preserve">${escapeXml(afterContent)}</w:t></w:r>`;
            
            finalReplacement = `${tableXML}${openP}${afterXml}${closeP}`;
          } else {
            finalReplacement = tableXML;
          }
          
          const beforePara = docXml.substring(0, paraStart);
          const afterPara = docXml.substring(paraEnd + 6);
          
          const openPCount = (finalReplacement.match(/<w:p[^>]*>/g) || []).length;
          const closePCount = (finalReplacement.match(/<\/w:p>/g) || []).length;
          if (openPCount !== closePCount) {
            console.error(`ERROR: Unbalanced paragraph tags in replacement for ${placeholder}`);
            throw new Error(`Invalid XML structure: Unbalanced paragraph tags (${openPCount} open, ${closePCount} close)`);
          }
          
          const originalOpenPCount = (originalParagraph.match(/<w:p[^>]*>/g) || []).length;
          const originalClosePCount = (originalParagraph.match(/<\/w:p>/g) || []).length;
          
          if (originalOpenPCount !== originalClosePCount) {
            console.warn(`WARNING: Original paragraph has unbalanced tags (${originalOpenPCount} open, ${originalClosePCount} close)`);
          }
          
          const beforeLength = docXml.length;
          docXml = beforePara + finalReplacement + afterPara;
          const afterLength = docXml.length;
          tablesInserted++;
          
          const docOpenPCount = (docXml.match(/<w:p[^>]*>/g) || []).length;
          const docClosePCount = (docXml.match(/<\/w:p>/g) || []).length;
          
          if (docOpenPCount !== docClosePCount) {
            console.error(`ERROR: Document paragraph tags unbalanced after replacement!`);
            const missingCloses = docOpenPCount - docClosePCount;
            if (missingCloses > 0) {
              console.warn(`Attempting to fix by adding ${missingCloses} closing paragraph tags`);
              const bodyEnd = docXml.lastIndexOf('</w:body>');
              if (bodyEnd !== -1) {
                const missingTags = '</w:p>'.repeat(missingCloses);
                docXml = docXml.substring(0, bodyEnd) + missingTags + docXml.substring(bodyEnd);
              }
            }
          }
        } else {
          console.warn(`WARNING: Could not find paragraph boundaries for ${placeholder}, using fallback`);
          if (docXml.includes(placeholder)) {
            docXml = docXml.replace(placeholder, tableXML);
            tablesInserted++;
          } else if (docXml.includes(actualMarker)) {
            docXml = docXml.replace(actualMarker, tableXML);
            tablesInserted++;
          } else {
            console.error(`ERROR: Could not find placeholder ${placeholder} or marker ${actualMarker} in XML`);
          }
        }
      } else {
        console.warn(`Placeholder ${placeholder} not found in XML`);
      }
    });
    
    const remainingMarkers = Object.keys(tableMap).filter(p => docXml.includes(p));
    if (remainingMarkers.length > 0) {
      console.error('ERROR: Some placeholders were NOT replaced:', remainingMarkers);
      
      remainingMarkers.forEach(marker => {
        const safeMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const markerPos = docXml.indexOf(marker);
        if (markerPos !== -1) {
          docXml = docXml.replace(marker, tableMap[marker]);
          tablesInserted++;
        } else {
          const markerNoBrackets = marker.replace(/[\[\]]/g, '');
          const markerPos2 = docXml.indexOf(markerNoBrackets);
          if (markerPos2 !== -1) {
            docXml = docXml.replace(markerNoBrackets, tableMap[marker]);
            tablesInserted++;
          }
        }
      });
    }
    
    if (tablesInserted === 0) {
      console.error('ERROR: No tables were inserted! Document will show markers instead of tables.');
    }
    
    if (!docXml.includes('<w:document') || !docXml.includes('</w:document>')) {
      console.error('Error: Modified XML appears to be malformed.');
      return zip;
    }
    
    if (!docXml.includes('<w:document') || !docXml.includes('</w:document>')) {
      console.error('Document XML structure is broken - missing document tags');
      throw new Error('Invalid document XML structure');
    }
    
    const tableOpenCount = (docXml.match(/<w:tbl>/g) || []).length;
    const tableCloseCount = (docXml.match(/<\/w:tbl>/g) || []).length;
    if (tableOpenCount !== tableCloseCount) {
      console.error(`Table tag mismatch: Open: ${tableOpenCount}, Close: ${tableCloseCount}`);
      throw new Error('Invalid table XML structure: Unmatched table tags');
    }
    
    const remainingPlaceholders = Object.keys(tableMap).filter(p => docXml.includes(p));
    if (remainingPlaceholders.length > 0) {
      console.error('ERROR: Placeholders still in document after replacement:', remainingPlaceholders);
      throw new Error('Placeholders not replaced: ' + remainingPlaceholders.join(', '));
    }
    
    const paraOpenCount = (docXml.match(/<w:p[^>]*>/g) || []).length;
    const paraCloseCount = (docXml.match(/<\/w:p>/g) || []).length;
    if (Math.abs(paraOpenCount - paraCloseCount) > 2) {
      console.warn(`Paragraph tag imbalance: Open: ${paraOpenCount}, Close: ${paraCloseCount}`);
    }
    
    docXml = docXml.replace(/<\/w:p>\s{0,10}<\/w:p>/g, '</w:p>');
    
    try {
      zip.file('word/document.xml', docXml);
    } catch (updateError) {
      console.error('Error updating document XML:', updateError);
      throw updateError;
    }
    
    return zip;
  } catch (error) {
    console.error('Error inserting tables into document:', error);
    return zip;
  }
};

/**
 * Quotation Document Service
 * Handles all DOCX generation for quotations on the backend
 */

// Format dates for Indonesian locale
const formatDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

// Format contact gender
const formatContactGender = (gender) => {
  if (!gender) return "";
  switch (gender.toLowerCase()) {
    case "male":
      return "Bapak";
    case "female":
      return "Ibu";
    default:
      return gender;
  }
};

// Format price with Indonesian currency
const formatPrice = (price) => {
  if (!price || price === 0) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
};

// Normalize number inputs
const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

// Calculate financial breakdown for a single offer item
const calculateItemFinancials = (item = {}) => {
  const quantity = safeNumber(item.quantity, 1) > 0 ? safeNumber(item.quantity, 1) : 1;
  const basePrice = safeNumber(item.price, 0);
  const discountValue = safeNumber(item.discountValue, 0);
  let discountPerUnit = 0;

  if (item.discountType === 'percentage') {
    discountPerUnit = Math.round((basePrice * discountValue) / 100);
  } else {
    discountPerUnit = discountValue;
  }

  const commissionPerUnit = safeNumber(item.commission, 0);
  const clientNetPerUnit = Math.max(basePrice - discountPerUnit, 0);
  const internalNetPerUnit = Math.max(clientNetPerUnit - commissionPerUnit, 0);

  const baseTotal = basePrice * quantity;
  const discountTotal = discountPerUnit * quantity;
  const commissionTotal = commissionPerUnit * quantity;
  const clientNetTotal = clientNetPerUnit * quantity;
  const internalNetTotal = internalNetPerUnit * quantity;

  return {
    quantity,
    basePrice,
    discountPerUnit,
    commissionPerUnit,
    clientNetPerUnit,
    internalNetPerUnit,
    nettoPerUnit: internalNetPerUnit,
    baseTotal,
    discountTotal,
    commissionTotal,
    clientNetTotal,
    nettoTotal: internalNetTotal
  };
};

// Aggregate financials for an offer
const aggregateOfferFinancials = (items = []) => {
  return items.reduce(
    (acc, item) => {
      const breakdown = calculateItemFinancials(item);
      acc.quantity += breakdown.quantity;
      acc.baseTotal += breakdown.baseTotal;
      acc.discountTotal += breakdown.discountTotal;
      acc.commissionTotal += breakdown.commissionTotal;
      acc.clientNetTotal += breakdown.clientNetTotal;
      acc.internalNetTotal += breakdown.nettoTotal;
      acc.clientNetPerUnitTotal += breakdown.clientNetPerUnit;
      acc.details.push({ item, breakdown });
      return acc;
    },
    {
      quantity: 0,
      baseTotal: 0,
      discountTotal: 0,
      commissionTotal: 0,
      clientNetTotal: 0,
      internalNetTotal: 0,
      clientNetPerUnitTotal: 0,
      details: []
    }
  );
};

// Format phone numbers
const formatPhoneNumbers = (phoneNumbers) => {
  if (
    !phoneNumbers ||
    !Array.isArray(phoneNumbers) ||
    phoneNumbers.length === 0
  ) {
    return "";
  }

  return phoneNumbers
    .filter((phone) => phone.label && phone.value)
    .map((phone) => `${phone.label} : ${phone.value}`)
    .join("\n");
};

// Format notes based on selected notes indices
const formatNotes = (selectedNotes, excludePPN, paymentTerms) => {
  const notes = [];

  if (excludePPN) {
    notes.push("Harga tersebut diatas Belum Termasuk PPN 11%");
    notes.push(
      "Nilai PPN menyesuaikan ketentuan pemerintah saat terbit faktur pajak"
    );
  } else {
    notes.push("Harga tersebut diatas Sudah Termasuk PPN 11%");
  }

  // Predefined notes
  const predefinedNotes = [
    { text: paymentTerms || 'Payment DP 50% sisa cash before delivery', selected: true },
    { text: 'Loco Pabrik Cikande', selected: true },
    { text: 'Harga tidak mengikat bisa berubah sewaktu-waktu tanpa pemberitahuan terlebih dahulu.', selected: true },
    { text: 'DIMENSI KAROSERI diluar SKRB tidak diperuntukan untuk dijalan raya (OFF ROAD)', selected: true },
    { text: 'Uji Type yang terbit hanya untuk karoseri dengan ukuran standard Dishub. Ukuran Oversize STM tidak bertanggung jawab jika uji type tidak dapat terbit dari Dishub', selected: true },
    { text: 'Tanpa acc keur', selected: true }
  ];

  // Add selected notes based on indices
  if (Array.isArray(selectedNotes)) {
    selectedNotes.forEach((index) => {
      if (predefinedNotes[index] && predefinedNotes[index].selected) {
        notes.push(predefinedNotes[index].text);
      }
    });
  }

  // Format notes with proper spacing
  // Simple, clean notes format - one note per line with bullet
  const formattedNotes = notes
    .map((note) => {
      const cleanNote = note.trim();
      if (!cleanNote) return '';
      return cleanNote;
    })
    .filter(note => note.length > 0);
  
  return formattedNotes.join("\n");
};

// Generate specification table XML for Word document
const generateSpecificationTableXML = (specifications, drawingInfo = null, priceInfo = null, leftIndentTwips = 0) => {
  if (!specifications || specifications.length === 0) {
    return '';
  }

  // Count total rows
  let totalRows = 0;
  const tableData = [];
  
  specifications.forEach((spec) => {
    const categoryName = escapeXml(spec.category || "");
    const specItems = spec.items || [];
    
    if (specItems.length > 0) {
      specItems.forEach((specItem, itemIndex) => {
        tableData.push({
          category: categoryName,
          categoryRowSpan: itemIndex === 0 ? specItems.length : 0,
          name: escapeXml(specItem.name || ""),
          specification: escapeXml(specItem.specification || ""),
          isSpanningRow: false
        });
        totalRows++;
      });
    }
  });

  // Add drawing specification row if provided
  if (drawingInfo && drawingInfo.drawingNumber) {
    tableData.push({
      category: '',
      categoryRowSpan: 0,
      name: '',
      specification: `Spesifikasi lain sesuai gambar ${escapeXml(drawingInfo.drawingNumber)}`,
      isSpanningRow: true
    });
    totalRows++;
  }

  // Add price row if provided
  if (priceInfo) {
    const priceText = `Harga: ${escapeXml(priceInfo.formattedClientNetPerUnit)}`;
    
    tableData.push({
      category: '',
      categoryRowSpan: 0,
      name: '',
      specification: priceText,
      isSpanningRow: true
    });
    totalRows++;
  }

  if (totalRows === 0) {
    return '';
  }

  // Generate Word table XML - using clean, formatted structure
  // Based on Word 2007+ format requirements
  let tableXML = '<w:tbl>';
  
  // Table properties - styled for better appearance
  tableXML += '<w:tblPr>';
  tableXML += '<w:tblStyle w:val="TableGrid"/>';
  tableXML += '<w:tblW w:w="0" w:type="auto"/>';
  // Add left indentation to align with chassis
  if (leftIndentTwips > 0) {
    tableXML += `<w:tblInd w:w="${leftIndentTwips}" w:type="dxa"/>`;
  }
  tableXML += '<w:tblBorders>';
  tableXML += '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '</w:tblBorders>';
  tableXML += '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';
  tableXML += '</w:tblPr>';
  
  // Table grid (column widths) - optimized for readability
  tableXML += '<w:tblGrid>';
  tableXML += '<w:gridCol w:w="1500"/>';  // Kategori - slightly wider
  tableXML += '<w:gridCol w:w="2500"/>';  // Nama - wider for better readability
  tableXML += '<w:gridCol w:w="5000"/>';   // Spesifikasi - wider for longer text
  tableXML += '</w:tblGrid>';
  
  // Table header row - with bold formatting and padding
  const cellPadding = 100; // Padding for table cells (increased for neatness)
  tableXML += '<w:tr>';
  // Header cell 1: Kategori
  tableXML += '<w:tc>';
  tableXML += `<w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
  tableXML += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>Kategori</w:t></w:r></w:p>`;
  tableXML += '</w:tc>';
  // Header cell 2: Nama
  tableXML += '<w:tc>';
  tableXML += `<w:tcPr><w:tcW w:w="2500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
  tableXML += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>Nama</w:t></w:r></w:p>`;
  tableXML += '</w:tc>';
  // Header cell 3: Spesifikasi
  tableXML += '<w:tc>';
  tableXML += `<w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
  tableXML += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>Spesifikasi</w:t></w:r></w:p>`;
  tableXML += '</w:tc>';
  tableXML += '</w:tr>';
  
  // Table data rows - formatted with proper alignment and styling
  tableData.forEach((row, rowIndex) => {
    tableXML += '<w:tr>';
    
    // Category cell - show in every row for simplicity
    // CRITICAL: All text must be XML escaped and cannot contain XML tags
    let categoryText = row.category || '';
    let nameText = row.name || '';
    let specText = row.specification || '';
    
    if (categoryText.includes('<') || categoryText.includes('>')) {
      categoryText = categoryText.replace(/<[^>]+>/g, '');
    }
    if (nameText.includes('<') || nameText.includes('>')) {
      nameText = nameText.replace(/<[^>]+>/g, '');
    }
    if (specText.includes('<') || specText.includes('>')) {
      specText = specText.replace(/<[^>]+>/g, '');
    }
    
    // Alternate row background for better readability (light gray every other row)
    const rowFill = rowIndex % 2 === 0 ? 'FFFFFF' : 'F9F9F9';
    
    // Build cells with proper structure and styling - normal spacing with padding
    const cellPadding = 100; // Padding for table cells (increased for neatness)
    
    // If this is a spanning row (drawing spec or price), merge all three columns
    if (row.isSpanningRow) {
      // First cell: spans all three columns
      tableXML += '<w:tc>';
      tableXML += `<w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:gridSpan w:val="3"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
      // Bold for drawing row (second to last if price exists, or last if no price)
      const isLastRow = rowIndex === tableData.length - 1;
      const isSecondLastRow = rowIndex === tableData.length - 2;
      const isDrawingRow = drawingInfo && isSecondLastRow && priceInfo;
      const isPriceRow = isLastRow && priceInfo;
      const alignTag = isPriceRow ? '<w:jc w:val="right"/>' : '';
      
      // Special handling for price row: make everything bold and bigger font
      if (isPriceRow && specText.startsWith('Harga:')) {
        // Font size 10 (20 half-points) for price - slightly bigger than regular text
        const PRICE_FONT_SIZE_TAG = `<w:sz w:val="20"/><w:szCs w:val="20"/>`;
        const PRICE_FONT_TAG = `${FONT_FAMILY_TAG}${PRICE_FONT_SIZE_TAG}`;
        // Make entire price text bold with bigger font
        tableXML += `<w:p><w:pPr>${alignTag}<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>`;
        tableXML += `<w:r><w:rPr>${PRICE_FONT_TAG}<w:b/></w:rPr><w:t>${escapeXml(specText)}</w:t></w:r>`;
        tableXML += `</w:p>`;
      } else {
        // For drawing row or other spanning rows, use original logic
        const boldTag = (isDrawingRow || (isLastRow && !priceInfo)) ? '<w:b/>' : '';
        tableXML += `<w:p><w:pPr>${alignTag}<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}${boldTag}</w:rPr><w:t>${escapeXml(specText)}</w:t></w:r></w:p>`;
      }
      tableXML += '</w:tc>';
      // Skip adding the other two cells since they're merged into the first one
    } else {
      // Category cell - merged vertically when categoryRowSpan > 0
      tableXML += '<w:tc>';
      if (row.categoryRowSpan > 0) {
        // First row of category - show text and start merge
        tableXML += `<w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:vMerge w:val="restart"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
        tableXML += `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>${escapeXml(categoryText)}</w:t></w:r></w:p>`;
      } else {
        // Continuation of merged cell - empty with continue merge
        tableXML += `<w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:vMerge/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
        tableXML += '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>';
      }
      tableXML += '</w:tc>';
      
      // Name cell - left aligned
      tableXML += '<w:tc>';
      tableXML += `<w:tcPr><w:tcW w:w="2500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="top"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
      tableXML += `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${escapeXml(nameText)}</w:t></w:r></w:p>`;
      tableXML += '</w:tc>';
      
      // Specification cell - left aligned, wider for longer text
      tableXML += '<w:tc>';
      tableXML += `<w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="top"/><w:tcMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tcMar></w:tcPr>`;
      tableXML += `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${escapeXml(specText)}</w:t></w:r></w:p>`;
      tableXML += '</w:tc>';
    }
    
    tableXML += '</w:tr>';
  });
  
  tableXML += '</w:tbl>';
  
  console.log('Table XML generated:', {
    totalLength: tableXML.length,
    rowCount: (tableXML.match(/<w:tr>/g) || []).length,
    cellCount: (tableXML.match(/<w:tc>/g) || []).length
  });
  
  // CRITICAL: Validate table XML structure before returning
  // Check that all required tags are present and properly closed
  const openTags = {
    'w:tbl': (tableXML.match(/<w:tbl>/g) || []).length,
    'w:tblPr': (tableXML.match(/<w:tblPr>/g) || []).length,
    'w:tblGrid': (tableXML.match(/<w:tblGrid>/g) || []).length,
    'w:tr': (tableXML.match(/<w:tr>/g) || []).length,
    'w:tc': (tableXML.match(/<w:tc>/g) || []).length,
  };
  
  const closeTags = {
    'w:tbl': (tableXML.match(/<\/w:tbl>/g) || []).length,
    'w:tblPr': (tableXML.match(/<\/w:tblPr>/g) || []).length,
    'w:tblGrid': (tableXML.match(/<\/w:tblGrid>/g) || []).length,
    'w:tr': (tableXML.match(/<\/w:tr>/g) || []).length,
    'w:tc': (tableXML.match(/<\/w:tc>/g) || []).length,
  };
  
  // Validate tag counts match
  for (const tag in openTags) {
    if (openTags[tag] !== closeTags[tag]) {
      console.error(`Table XML validation failed: ${tag} - Open: ${openTags[tag]}, Close: ${closeTags[tag]}`);
      throw new Error(`Invalid table XML structure: Unmatched ${tag} tags`);
    }
  }
  
  // Ensure minimum structure: 1 header row + data rows
  if (openTags['w:tr'] < 2) {
    console.warn('Table XML has fewer than 2 rows (header + at least 1 data row)');
  }
  
  // Validate cell count - account for spanning rows (they have only 1 cell instead of 3)
  const spanningRows = tableData.filter(row => row.isSpanningRow).length;
  const normalRows = openTags['w:tr'] - spanningRows - 1; // -1 for header row
  const expectedCells = (openTags['w:tr'] - 1) * 3 - (spanningRows * 2); // Header row has 3 cells, spanning rows have 1 cell each (saves 2 cells per spanning row)
  // Actually, let's be more lenient - just check that we have at least the minimum required cells
  const minExpectedCells = openTags['w:tr'] * 1; // At least 1 cell per row
  if (openTags['w:tc'] < minExpectedCells) {
    console.error(`Table XML validation failed: Expected at least ${minExpectedCells} cells, found ${openTags['w:tc']}`);
    throw new Error(`Invalid table XML structure: Insufficient cells`);
  }
  
  console.log(`Table XML validated: ${openTags['w:tr']} rows, ${openTags['w:tc']} cells`);
  
  return tableXML;
};

// Generate service specification table XML for Word document
const generatePricingTableXML = (offerItems = [], lineOfBusinessType = 'service') => {
  if (!offerItems || offerItems.length === 0) {
    return '';
  }

  let totalClientNet = 0;

  const rows = offerItems.map((item, index) => {
    const breakdown = calculateItemFinancials(item);
    totalClientNet += safeNumber(breakdown.clientNetTotal, 0);

    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const pricePerQty = formatPrice(safeNumber(breakdown.clientNetPerUnit, 0));
    const totalPrice = formatPrice(safeNumber(breakdown.clientNetTotal, 0));

    const isService = lineOfBusinessType === 'service';
    const name = isService
      ? item.serviceName || `Service ${index + 1}`
      : item.sparepartName || `Sparepart ${index + 1}`;
    const details = isService && Array.isArray(item.serviceDetails)
      ? item.serviceDetails.map((detail) => escapeXml(detail || '')).filter(Boolean)
      : [];

    return {
      no: index + 1,
      name: escapeXml(name),
      details,
      quantity,
      pricePerQty,
      totalPrice
    };
  });

  let tableXML = '<w:tbl>';

  tableXML += '<w:tblPr>';
  tableXML += '<w:tblStyle w:val="TableGrid"/>';
  tableXML += '<w:tblW w:w="0" w:type="auto"/>';
  tableXML += '<w:tblBorders>';
  tableXML += '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  tableXML += '</w:tblBorders>';
  tableXML += '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';
  tableXML += '</w:tblPr>';

  tableXML += '<w:tblGrid>';
  tableXML += '<w:gridCol w:w="800"/>';
  tableXML += '<w:gridCol w:w="4200"/>';
  tableXML += '<w:gridCol w:w="1500"/>';
  tableXML += '<w:gridCol w:w="1200"/>';
  tableXML += '<w:gridCol w:w="2000"/>';
  tableXML += '</w:tblGrid>';

  const headerCells = [
    { text: 'No', width: '800', align: 'center' },
    { text: 'Nama', width: '4200', align: 'center' },
    { text: 'Harga per Qty', width: '1500', align: 'right' },
    { text: 'Qty', width: '1200', align: 'center' },
    { text: 'Total Harga', width: '2000', align: 'right' }
  ];

  tableXML += '<w:tr>';
  headerCells.forEach(({ text, width, align }) => {
    tableXML += '<w:tc>';
    tableXML += `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;
    tableXML += `<w:p><w:pPr><w:jc w:val="${align}"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    tableXML += '</w:tc>';
  });
  tableXML += '</w:tr>';

  rows.forEach((row, rowIndex) => {
    const rowFill = rowIndex % 2 === 0 ? 'FFFFFF' : 'F7F7F7';
    tableXML += '<w:tr>';

    tableXML += '<w:tc>';
    tableXML += `<w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;
    tableXML += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${row.no}</w:t></w:r></w:p>`;
    tableXML += '</w:tc>';

    tableXML += '<w:tc>';
    tableXML += `<w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="top"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;
    tableXML += `<w:p><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>${row.name}</w:t></w:r></w:p>`;
    row.details.forEach((detailText) => {
      const bulletText = detailText ? `• ${detailText}` : '•';
      tableXML += `<w:p><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${bulletText}</w:t></w:r></w:p>`;
    });
    tableXML += '</w:tc>';

    tableXML += '<w:tc>';
    tableXML += `<w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;
    tableXML += `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${row.pricePerQty}</w:t></w:r></w:p>`;
    tableXML += '</w:tc>';

    tableXML += '<w:tc>';
    tableXML += `<w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;
    tableXML += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${row.quantity}</w:t></w:r></w:p>`;
    tableXML += '</w:tc>';

    tableXML += '<w:tc>';
    tableXML += `<w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;
    tableXML += `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t>${row.totalPrice}</w:t></w:r></w:p>`;
    tableXML += '</w:tc>';

    tableXML += '</w:tr>';
  });

  tableXML += '<w:tr>';
  tableXML += '<w:tc>';
  tableXML += '<w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/></w:tcPr>';
  tableXML += `<w:p><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t></w:t></w:r></w:p>`;
  tableXML += '</w:tc>';

  tableXML += '<w:tc>';
  tableXML += '<w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/></w:tcPr>';
  tableXML += `<w:p><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>Total Harga</w:t></w:r></w:p>`;
  tableXML += '</w:tc>';

  tableXML += '<w:tc>';
  tableXML += '<w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/></w:tcPr>';
  tableXML += `<w:p><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t></w:t></w:r></w:p>`;
  tableXML += '</w:tc>';

  tableXML += '<w:tc>';
  tableXML += '<w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/></w:tcPr>';
  tableXML += `<w:p><w:r><w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr><w:t></w:t></w:r></w:p>`;
  tableXML += '</w:tc>';

  tableXML += '<w:tc>';
  tableXML += '<w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/><w:vAlign w:val="center"/></w:tcPr>';
  tableXML += `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr><w:t>${formatPrice(totalClientNet)}</w:t></w:r></w:p>`;
  tableXML += '</w:tc>';
  tableXML += '</w:tr>';

  tableXML += '</w:tbl>';

  return tableXML;
};

// Build item text for template - supports karoseri, service, and sparepart
// Returns both the item text and a map of table placeholders to table XML
const buildItemText = (offerItems, lineOfBusinessType = 'karoseri', drawingNumberMap = {}, offerContext = {}) => {
  if (!offerItems || offerItems.length === 0) {
    return { itemText: "", tableMap: {} };
  }

  let itemText = "";
  const tableMap = {};
  const financialAggregate = aggregateOfferFinancials(offerItems);

  if (lineOfBusinessType === 'service' || lineOfBusinessType === 'sparepart') {
    const pricingTable = generatePricingTableXML(offerItems, lineOfBusinessType);
    if (pricingTable) {
      const placeholder = '[ITEM_PRICING_TABLE]';
      const heading = lineOfBusinessType === 'service' ? 'Daftar Layanan:' : 'Daftar Sparepart:';
      itemText += `${heading}\n`;
      itemText += `${placeholder}\n\n`;
      tableMap[placeholder] = pricingTable;
    }
  }

  offerItems.forEach((item, index) => {
    const itemNumber = index + 1;
    const breakdown = calculateItemFinancials(item);
    const formattedBasePrice = formatPrice(breakdown.basePrice);
    const formattedDiscount = formatPrice(breakdown.discountPerUnit);
    const formattedClientNetPerUnit = formatPrice(breakdown.clientNetPerUnit);

    if (lineOfBusinessType !== 'karoseri') {
      if (lineOfBusinessType === 'service' && item.notes) {
        itemText += `${itemNumber}. ${escapeXml(item.notes)}\n\n`;
      }
      return;
    }

    const karoseri = item.karoseri || "";
    const chassis = item.chassis || "";
    const chassisModel = item.chassisModel ? ` - ${item.chassisModel}` : "";

    // Item number with more space before (10 spaces for more spacing)
    // Calculate padding to align "Chassis" with "Karoseri"
    // Format: "     ${itemNumber}.  Karoseri : ${karoseri}"
    // "Karoseri" starts after: 10 spaces + item number + ".  "
    const itemNumberStr = String(itemNumber);
    const paddingBeforeKaroseri = 10 + itemNumberStr.length + 3; // 10 spaces + item number length + ".  "
    
    itemText += `          ${itemNumber}.  Karoseri     : ${karoseri}\n`;
    // Chassis aligned with Karoseri (same starting position)
    // Add space before colon: "Chassis      :" (with 6 spaces before colon)
    const chassisPadding = ' '.repeat(paddingBeforeKaroseri);
    itemText += `${chassisPadding} Chassis      : ${chassis}${chassisModel}\n`;
    
    // Karoseri specifications - generate table format
    if (item.specifications && item.specifications.length > 0) {
      // Add specification label aligned with chassis
      // Add space before colon: "Spesifikasi  :" (with two spaces before colon, matching Chassis format)
      const spesifikasiPadding = ' '.repeat(paddingBeforeKaroseri);
      itemText += `\n${spesifikasiPadding}Spesifikasi  :\n`;
      
      // Prepare drawing info for table
      let drawingInfo = null;
      if (item.drawingSpecification) {
        // Check if drawingSpecification is populated (object) or just an ObjectId
        let drawingNumber = 'Selected';
        const drawingId = typeof item.drawingSpecification === 'object' && item.drawingSpecification !== null
          ? item.drawingSpecification._id?.toString()
          : item.drawingSpecification?.toString();
        
        // Try to get drawing number from populated object first
        if (typeof item.drawingSpecification === 'object' && item.drawingSpecification !== null) {
          drawingNumber = item.drawingSpecification.drawingNumber || drawingNumber;
        }
        
        // If not found, try looking up from drawingNumberMap
        if (drawingNumber === 'Selected' && drawingId && drawingNumberMap[drawingId]) {
          drawingNumber = drawingNumberMap[drawingId];
        }
        
        drawingInfo = { drawingNumber };
      }
      
      // Prepare price info for table
      const effectiveDiscount = Math.max(breakdown.basePrice - breakdown.nettoPerUnit, 0);
      const hasDiscount = breakdown.discountPerUnit > 0;
      const discountLabel =
        item.discountType === 'percentage' && safeNumber(item.discountValue, 0) > 0
          ? ` (${safeNumber(item.discountValue, 0)}%)`
          : '';
      
      const priceInfo = {
        formattedClientNetPerUnit,
        formattedBasePrice,
        formattedDiscount,
        discountLabel,
        hasDiscount
      };
      
      // Generate table XML with drawing and price info
      // Calculate left indentation to match chassis alignment
      // Convert spaces to twips: approximately 1 space = 100 twips (reduced for better alignment)
      // paddingBeforeKaroseri is in spaces, convert to twips
      const leftIndentTwips = paddingBeforeKaroseri * 60; // 1 space ≈ 100 twips (reduced from 120)
      const tableXML = generateSpecificationTableXML(item.specifications, drawingInfo, priceInfo, leftIndentTwips);
      if (tableXML) {
        // Use a unique marker that docxtemplater won't process (not in {variable} format)
        // Put marker on its own line with blank lines around it
        const placeholder = `[SPEC_TABLE_MARKER_${index}]`;
        itemText += `\n${placeholder}\n`;
        tableMap[placeholder] = tableXML;
        console.log(`Added placeholder ${placeholder} for item ${index + 1}:`, {
          placeholder,
          tableXMLLength: tableXML.length,
          specificationsCount: item.specifications.length,
          hasDrawingInfo: !!drawingInfo,
          hasPriceInfo: !!priceInfo
        });
      }
    } else {
      // If no specifications table, keep the old format for drawing and price
      // Drawing specification
      if (item.drawingSpecification) {
        // Check if drawingSpecification is populated (object) or just an ObjectId
        let drawingNumber = 'Selected';
        const drawingId = typeof item.drawingSpecification === 'object' && item.drawingSpecification !== null
          ? item.drawingSpecification._id?.toString()
          : item.drawingSpecification?.toString();
        
        // Try to get drawing number from populated object first
        if (typeof item.drawingSpecification === 'object' && item.drawingSpecification !== null) {
          drawingNumber = item.drawingSpecification.drawingNumber || drawingNumber;
        }
        
        // If not found, try looking up from drawingNumberMap
        if (drawingNumber === 'Selected' && drawingId && drawingNumberMap[drawingId]) {
          drawingNumber = drawingNumberMap[drawingId];
        }
        
        itemText += `\n   Spesifikasi lain sesuai gambar ${drawingNumber}\n`;
      }
      
      itemText += `\n   Harga: ${formattedClientNetPerUnit}\n`;
    }
    
    // Add item notes if available (for karoseri items)
    if (item.notes && item.notes.trim()) {
      const notesPadding = ' '.repeat(paddingBeforeKaroseri);
      itemText += `\n${notesPadding}Catatan      : ${escapeXml(item.notes.trim())}\n`;
    }
    
    // Add spacing between items
    if (index < offerItems.length - 1) {
      itemText += "\n";
    }
  });

  return { itemText, tableMap };
};

// Rotate image 90 degrees clockwise using sharp library
const rotateImage90Degrees = async (imageBuffer) => {
  try {
    const sharp = require('sharp');
    // Rotate 90 degrees clockwise (positive rotation)
    const rotatedBuffer = await sharp(imageBuffer)
      .rotate(90)
      .toBuffer();
    return rotatedBuffer;
  } catch (error) {
    console.error('Error rotating image:', error);
    // Return original buffer if rotation fails
    return imageBuffer;
  }
};

// Fetch drawing image as base64
const fetchDrawingImageAsBase64 = async (drawingId, fileId, rotate = false) => {
  try {
    const objectId = new mongoose.Types.ObjectId(fileId);
    const fileBuffer = await drawingSpecificationGridFS.getFileBuffer(objectId);
    
    if (rotate) {
      // Rotate if needed (implement with sharp if required)
      const rotatedBuffer = await rotateImage90Degrees(fileBuffer);
      return rotatedBuffer.toString('base64');
    }
    
    return fileBuffer.toString('base64');
  } catch (error) {
    console.error('Error fetching drawing image:', error);
    throw error;
  }
};

// Fetch notes image as base64
const fetchNotesImageAsBase64 = async (imageId, fileId, rotate = false) => {
  try {
    const objectId = new mongoose.Types.ObjectId(fileId);
    const fileBuffer = await notesImagesGridFS.getFileBuffer(objectId);
    
    if (rotate) {
      const rotatedBuffer = await rotateImage90Degrees(fileBuffer);
      return rotatedBuffer.toString('base64');
    }
    
    return fileBuffer.toString('base64');
  } catch (error) {
    console.error('Error fetching notes image:', error);
    throw error;
  }
};

// Create image module for docxtemplater
// CRITICAL: Must return Buffer, not Uint8Array, to prevent Word corruption
const createImageModule = () =>
  new ImageModule({
    centered: true,
    fileType: "docx",
    prefix: "image",
    getImage: (tagValue) => {
      if (!tagValue) return Buffer.alloc(0);
      const base64Data = tagValue.includes(",")
        ? tagValue.split(",")[1]
        : tagValue;
      // Return Buffer directly - ImageModule expects Buffer, not Uint8Array
      return Buffer.from(base64Data, "base64");
    },
          getSize: (img, tagValue, tagName) => {
        // Return size based on image type
        if (tagName && tagName.includes("notes")) {
          return [400, 600]; // Width x Height for notes images
        } else {
          // Drawing images: 5.5 x 7.5 inches (fits within A4 page with margins)
          // 1 inch = 72 points, so 5.5 inches = 396 points, 7.5 inches = 540 points
          return [396, 540]; // Width x Height for drawing images
        }
      },
  });

// Create drawings information text - simplified to show only Drawing Number
const createDrawingsInfo = (itemsWithDrawings, quotationNumber) => {
  try {
    if (!itemsWithDrawings || itemsWithDrawings.length === 0) {
      return "";
    }
    
    let drawingsText = `\n\n\nLAMPIRAN\n`;
    drawingsText += `DRAWING SPECIFICATIONS\n`;
    drawingsText += `Quotation: ${quotationNumber}\n\n`;
    
    itemsWithDrawings.forEach((item, index) => {
      const drawing = item.drawingSpecification;
      
      drawingsText += `Item ${index + 1}: ${item.karoseri} - ${item.chassis}${item.chassisModel ? ` - ${item.chassisModel}` : ''}\n`;
      drawingsText += `Drawing Number: ${drawing.drawingNumber || 'N/A'}\n`;
      drawingsText += `\n`;
    });
    
    return drawingsText;
  } catch (error) {
    console.error("Error creating drawings info:", error);
    return "\n\n\nLAMPIRAN\n[Drawing information could not be generated]\n";
  }
};

// Prepare quotation data for template
const prepareQuotationData = async (header, offer, selectedNotes = [], drawingsInfo = "", imageData = [], notesImagesData = [], drawingNumberMap = {}, rfq = null) => {
  const financialAggregate = aggregateOfferFinancials(offer.offerItems || []);
  const totalBase = financialAggregate.baseTotal;
  const totalClientNet = financialAggregate.clientNetTotal;
  const totalInternalNet = financialAggregate.internalNetTotal;
  const ppnStatusLabel = offer.excludePPN
    ? 'Belum termasuk PPN (harga Nett)'
    : 'Sudah termasuk PPN (harga Gross)';

  const rfqContext = rfq || {};

  // Get line of business type
  const lineOfBusinessType = rfqContext.lineOfBusiness?.type || header.lineOfBusiness?.type || 'karoseri';

  // Build item text and get table map
  const { itemText, tableMap } = buildItemText(
    offer.offerItems,
    lineOfBusinessType,
    drawingNumberMap,
    offer
  );

  // Check if this is a revision
  const isRevision = offer.offerNumber && offer.offerNumber.includes('-Rev');
  
  // Create salutation based on gender
  const contactGender = rfqContext.contactPerson?.gender || header.contactPerson?.gender;
  const contactName = rfqContext.contactPerson?.name || header.contactPerson?.name || "";
  let salutationName = "";
  if (contactName && contactName.trim()) {
    const gender = String(contactGender || "").toLowerCase().trim();
    if (gender === "male" || gender === "m") {
      salutationName = `Bapak ${contactName}`;
    } else if (gender === "female" || gender === "f") {
      salutationName = `Ibu ${contactName}`;
    } else {
      // Default if gender not specified - just use the name
      salutationName = contactName;
    }
  }
  
  // Get signatory user information (prefer requesterId, fallback to creatorId)
  let signatoryUser = null;
  if (header.requesterId) {
    if (typeof header.requesterId === 'object' && header.requesterId !== null) {
      // If requesterId is populated but doesn't have phoneNumbers, fetch it
      if (!header.requesterId.phoneNumbers) {
        try {
          const User = require('../models/user.model');
          signatoryUser = await User.findById(header.requesterId._id || header.requesterId).select('fullName email phoneNumbers');
        } catch (err) {
          console.error('Error fetching requester user:', err);
          signatoryUser = header.requesterId;
        }
      } else {
        signatoryUser = header.requesterId;
      }
    } else {
      try {
        const User = require('../models/user.model');
        signatoryUser = await User.findById(header.requesterId).select('fullName email phoneNumbers');
      } catch (err) {
        console.error('Error fetching requester user:', err);
      }
    }
  }
  
  // Fallback to creatorId if requesterId not available
  if (!signatoryUser && header.creatorId) {
    // If creatorId is populated (object), use it directly
    if (typeof header.creatorId === 'object' && header.creatorId !== null) {
      signatoryUser = header.creatorId;
    } else {
      // If creatorId is just an ID, fetch the user
      try {
        const User = require('../models/user.model');
        signatoryUser = await User.findById(header.creatorId).select('fullName email phoneNumbers');
      } catch (err) {
        console.error('Error fetching creator user:', err);
      }
    }
  }
  
  // Extract user info
  const signatoryName = signatoryUser?.fullName || header.marketingName || "N/A";
  const signatoryEmail = signatoryUser?.email || "";
  const signatoryPhones = signatoryUser?.phoneNumbers || [];
  
  const data = {
    // Header information
    quotation_number: isRevision ? offer.offerNumber : (header.quotationNumber || ""),
    quotation_date: formatDate(new Date()),
    customer_name: rfqContext.customerName || header.customerName || "",
    contact_person: contactName,
    contact_gender: formatContactGender(contactGender),
    salutation_name: salutationName, // Formatted salutation (Bapak/Ibu + name)
    marketing_name: signatoryName, // Use full name from user
    signatory_name: signatoryName,
    signatory_email: signatoryEmail,
    signatory_phones: signatoryPhones,
    
    // Offer information
    offer_number: offer.offerNumber || "",
    offer_notes: offer.notes || "",
    exclude_ppn: offer.excludePPN || false,
    ppn_status: ppnStatusLabel,

    // Item text
    item: itemText,
    total_items: (offer.offerItems || []).length,
    item_financials: financialAggregate.details.map(({ item: offerItem, breakdown }, idx) => ({
      index: idx + 1,
      title:
        offerItem.karoseri ||
        offerItem.serviceName ||
        offerItem.sparepartName ||
        `Item ${idx + 1}`,
      base_price: formatPrice(breakdown.basePrice),
      discount_type: offerItem.discountType || 'percentage',
      discount_rate: safeNumber(offerItem.discountValue, 0),
      discount_per_unit: formatPrice(breakdown.discountPerUnit),
      commission_per_unit: formatPrice(breakdown.commissionPerUnit),
      netto_per_unit: formatPrice(breakdown.clientNetPerUnit),
      client_net_per_unit: formatPrice(breakdown.clientNetPerUnit),
      internal_net_per_unit: formatPrice(breakdown.internalNetPerUnit),
      quantity: breakdown.quantity,
      netto_total: formatPrice(breakdown.clientNetTotal),
      client_net_total: formatPrice(breakdown.clientNetTotal),
      internal_net_total: formatPrice(breakdown.nettoTotal)
    })),
    
    // Table map for post-processing (not sent to template, used in post-processing)
    _tableMap: tableMap,

    // Pricing totals
    total_base_price: formatPrice(totalBase),
    internal_netto_total: formatPrice(totalInternalNet),
    
    // Additional data
    current_date: formatDate(new Date()),
    current_year: new Date().getFullYear(),
    line_of_business_type: lineOfBusinessType,
    
    // Notes
    notes: formatNotes(selectedNotes, offer.excludePPN, rfqContext.paymentTerms || header.paymentTerms),
    
    // Introduction text (paragraph only - "Dengan Hormat," should be hardcoded in template)
    introduction_text: "Bersama ini kami PT. SUKSES TUNGGAL MANDIRI bermaksud untuk mengajukan penawaran harga pembuatan Karoseri dengan data sebagai berikut :",
    
    // Signature section
    signature: "Demikianlah penawaran dari kami, atas perhatian dan kerjasamanya kami ucapkan terimakasih.\n\nHormat Kami,\nPT. Sukses Tunggal Mandiri",
    
    // Signatory information (for signature section)
    name: signatoryName, // Signatory name (uses full name from user)
    jabatan: "", // Position/title (can be added to header model if needed)
    phone_number: signatoryPhones.length > 0 ? formatPhoneNumbers(signatoryPhones) : "", // Phone numbers
    email: signatoryEmail, // Email address
    
    // Drawings information
    drawings_info: drawingsInfo || "",
    has_drawings: drawingsInfo ? true : false,
    
    // Image data
    images: imageData || [],
    has_images: imageData && imageData.length > 0,
    
    // Notes images data
    notes_images: notesImagesData || [],
    has_notes_images: notesImagesData && notesImagesData.length > 0,
  };

  // Add individual image placeholders
  if (imageData && imageData.length > 0) {
    imageData.forEach((img, index) => {
      data[`image_${index + 1}`] = img.imageTag;
    });
  }

  // Add individual notes images placeholders
  if (notesImagesData && notesImagesData.length > 0) {
    notesImagesData.forEach((img, index) => {
      data[`image_notes_${index + 1}`] = img.imageTag;
      data[`image_${(imageData ? imageData.length : 0) + index + 1}`] = img.imageTag;
    });
  }

  // Add service pricing table when applicable
  // Add table map for post-processing (not sent to template, used in post-processing)
  data._tableMap = tableMap;
  
  return data;
};

/**
 * Generate complete Word document XML from scratch (no template)
 * Creates a nicely formatted quotation document
 */
const generateDocumentXMLFromScratch = async (templateData, tableMap = {}, headerRelId = null, footerRelId = null, watermarkRelId = null, watermarkDocPrId = null, watermarkPicId = null, qrCodeRelId = null, qrCodeDocPrId = null, qrCodePicId = null) => {
  // Helper to create a paragraph with text - tight line spacing with small increase
  const createParagraph = (text, isBold = false, alignment = 'left', spacingAfter = 20) => {
    const alignTag = alignment === 'center' ? '<w:jc w:val="center"/>' : 
                     alignment === 'right' ? '<w:jc w:val="right"/>' : '';
    const boldTag = isBold ? '<w:b/>' : '';
    const runProperties = `<w:rPr>${FONT_TAG_WITH_SIZE}${boldTag}</w:rPr>`;
    
    if (!text) {
      return `<w:p>
        <w:pPr>
          ${alignTag}
          <w:spacing w:after="${spacingAfter}" w:line="200" w:lineRule="auto"/>
        </w:pPr>
      </w:p>`;
    }
    
    const escapedText = escapeXml(text);
    
    return `<w:p>
      <w:pPr>
        ${alignTag}
        <w:spacing w:after="${spacingAfter}" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        ${runProperties}
        <w:t xml:space="preserve">${escapedText}</w:t>
      </w:r>
    </w:p>`;
  };
  
  // Helper to create paragraph with "PT. SUKSES TUNGGAL MANDIRI" in bold
  const createIntroductionParagraph = (text, alignment = 'left', spacingAfter = 50) => {
    const alignTag = alignment === 'center' ? '<w:jc w:val="center"/>' : 
                     alignment === 'right' ? '<w:jc w:val="right"/>' : '';
    
    // Match "PT. SUKSES TUNGGAL MANDIRI" in the text
    const introMatch = text.match(/^(.*?)(PT\. SUKSES TUNGGAL MANDIRI)(.*)$/);
    
    if (introMatch) {
      const [, before, companyName, after] = introMatch;
      const escapedBefore = escapeXml(before);
      const escapedCompany = escapeXml(companyName);
      const escapedAfter = escapeXml(after);
      
      return `<w:p>
        <w:pPr>
          ${alignTag}
          <w:spacing w:after="${spacingAfter}" w:line="200" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
          <w:t xml:space="preserve">${escapedBefore}</w:t>
        </w:r>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr>
          <w:t xml:space="preserve">${escapedCompany}</w:t>
        </w:r>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
          <w:t xml:space="preserve">${escapedAfter}</w:t>
        </w:r>
      </w:p>`;
    }
    
    // Fallback to regular paragraph if pattern doesn't match
    return createParagraph(text, false, alignment, spacingAfter);
  };
  
  // Helper to create paragraph with "Chassis :" and chassis value in bold
  const createChassisParagraph = (text, alignment = 'left', spacingAfter = 30) => {
    const alignTag = alignment === 'center' ? '<w:jc w:val="center"/>' : 
                     alignment === 'right' ? '<w:jc w:val="right"/>' : '';
    
    // Match "Chassis :" (with optional leading spaces and text after)
    const chassisMatch = text.match(/^(\s*)(Chassis\s+:\s*)(.*)$/);
    
    if (chassisMatch) {
      const [, leadingSpaces, chassisPart, rest] = chassisMatch;
      const escapedLeading = escapeXml(leadingSpaces);
      const escapedChassis = escapeXml(chassisPart);
      const escapedRest = escapeXml(rest);
      
      return `<w:p>
        <w:pPr>
          ${alignTag}
          <w:spacing w:after="${spacingAfter}" w:line="200" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
          <w:t xml:space="preserve">${escapedLeading}</w:t>
        </w:r>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr>
          <w:t xml:space="preserve">${escapedChassis}</w:t>
        </w:r>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr>
          <w:t xml:space="preserve">${escapedRest}</w:t>
        </w:r>
      </w:p>`;
    }
    
    // Fallback to regular paragraph if pattern doesn't match
    return createParagraph(text, false, alignment, spacingAfter);
  };
  
  // Helper to create paragraph with price text (bold and bigger font)
  const createPriceParagraph = (text, alignment = 'left', spacingAfter = 30) => {
    const alignTag = alignment === 'center' ? '<w:jc w:val="center"/>' : 
                     alignment === 'right' ? '<w:jc w:val="right"/>' : '';
    
    // Font size 10 (20 half-points) for price - slightly bigger than regular text
    const PRICE_FONT_SIZE_TAG = `<w:sz w:val="20"/><w:szCs w:val="20"/>`;
    const PRICE_FONT_TAG = `${FONT_FAMILY_TAG}${PRICE_FONT_SIZE_TAG}`;
    
    const escapedText = escapeXml(text);
    
    return `<w:p>
      <w:pPr>
        ${alignTag}
        <w:spacing w:after="${spacingAfter}" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>${PRICE_FONT_TAG}<w:b/></w:rPr>
        <w:t xml:space="preserve">${escapedText}</w:t>
      </w:r>
    </w:p>`;
  };
  
  // Helper to create a bordered box for customer greeting (compact, grouped format)
  const createCustomerGreetingBox = (salutationName, customerName, contactPerson) => {
    const displaySalutation = salutationName || contactPerson || '';

    // Box dimensions: 180pt wide, 55pt high (reduced for font size 9)
    // With 3pt padding top/bottom (6pt total), content area is ~49pt
    // 4 lines of text with font size 9, adjusted spacing for better readability
    const boxLineSpacing = 220; // Increased line spacing for better readability in the box

    const createText = (text, isBold = false) => {
      if (!text) return '';
      const escaped = escapeXml(text);
      const boldTag = isBold ? '<w:b/>' : '';
      return `<w:p>
        <w:pPr>
          <w:spacing w:after="0" w:line="${boxLineSpacing}" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}${boldTag}</w:rPr>
          <w:t xml:space="preserve">${escaped}</w:t>
        </w:r>
      </w:p>`;
    };

    const content = [
      createText('Kepada Yth.'),
      createText(customerName || '', true),
      createText(displaySalutation),
      createText('Di tempat')
    ].join('');

    return `<w:p>
      <w:r>
        <w:pict>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" arcsize="15%" strokecolor="#1F2937" strokeweight="1pt" fillcolor="#F8FAFC" style="width:180pt;height:55pt">
            <v:textbox inset="3pt,3pt,3pt,3pt">
              <w:txbxContent>
                ${content}
              </w:txbxContent>
            </v:textbox>
          </v:roundrect>
        </w:pict>
      </w:r>
    </w:p>`;
  };
  
  const createCustomerGreetingBoxTable = (salutationName, customerName) => {
    const escapedSalutation = escapeXml(salutationName || '');
    const escapedCustomer = escapeXml(customerName || '');
    
    const tableWidth = 4000;
    const cellPadding = 60; // Padding for table cells (reduced for more compact tables)
    
    return `<w:tbl>
      <w:tblPr>
        <w:tblW w:w="${tableWidth}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
          <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        </w:tblBorders>
        <w:tblLook w:val="04A0" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="${tableWidth}"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${tableWidth}" w:type="dxa"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
            </w:tcBorders>
            <w:tcMar>
              <w:top w:w="${cellPadding}" w:type="dxa"/>
              <w:left w:w="${cellPadding}" w:type="dxa"/>
              <w:bottom w:w="${cellPadding}" w:type="dxa"/>
              <w:right w:w="${cellPadding}" w:type="dxa"/>
            </w:tcMar>
            <w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:spacing w:after="0" w:line="180" w:lineRule="auto"/>
            </w:pPr>
            <w:r>
              <w:t xml:space="preserve">Kepada Yth.</w:t>
            </w:r>
          </w:p>
          ${salutationName ? `<w:p>
            <w:pPr>
              <w:spacing w:after="0" w:line="180" w:lineRule="auto"/>
            </w:pPr>
            <w:r>
              <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
              <w:t xml:space="preserve">${escapedSalutation}</w:t>
            </w:r>
          </w:p>` : ''}
          ${customerName ? `<w:p>
            <w:pPr>
              <w:spacing w:after="0" w:line="180" w:lineRule="auto"/>
              <w:rPr>
                ${FONT_TAG_WITH_SIZE}
                <w:b/>
              </w:rPr>
            </w:pPr>
            <w:r>
              <w:rPr>
                ${FONT_TAG_WITH_SIZE}
                <w:b/>
              </w:rPr>
              <w:t xml:space="preserve">${escapedCustomer}</w:t>
            </w:r>
          </w:p>` : ''}
          <w:p>
            <w:pPr>
              <w:spacing w:after="0" w:line="180" w:lineRule="auto"/>
            </w:pPr>
            <w:r>
              <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
              <w:t xml:space="preserve">Di tempat</w:t>
            </w:r>
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>`;
  };
  
  // Helper to create a header table with quotation number and date (space-between alignment)
  // Uses borderless table for clean professional look
  const createHeaderTable = (quotationNumber, quotationDate) => {
    const escapedQuoNum = escapeXml(quotationNumber || '');
    const escapedDate = escapeXml(quotationDate || '');
    
    // Full page width: 12240 twips (A4 width)
    // With margins: 720 left + 720 right = 1440 twips
    // Usable width: 12240 - 1440 = 10800 twips
    const tableWidth = 10800; // Full usable width
    const leftCellWidth = tableWidth / 2; // Half for left content
    const rightCellWidth = tableWidth / 2; // Half for right content
    
    return `<w:tbl>
      <w:tblPr>
        <w:tblW w:w="${tableWidth}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        <w:jc w:val="left"/>
        <w:tblBorders>
          <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        </w:tblBorders>
        <w:tblLook w:val="04A0" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="${leftCellWidth}"/>
        <w:gridCol w:w="${rightCellWidth}"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${leftCellWidth}" w:type="dxa"/>
            <w:vAlign w:val="top"/>
            <w:tcBorders>
              <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
              <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
              <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
              <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
            </w:tcBorders>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:jc w:val="left"/>
              <w:spacing w:after="40"/>
            </w:pPr>
            <w:r>
              <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
              <w:t xml:space="preserve">No. Quo: ${escapedQuoNum}</w:t>
            </w:r>
          </w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${rightCellWidth}" w:type="dxa"/>
            <w:vAlign w:val="top"/>
            <w:tcBorders>
              <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
              <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
              <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
              <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
            </w:tcBorders>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:jc w:val="right"/>
              <w:spacing w:after="40"/>
            </w:pPr>
            <w:r>
              <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
              <w:t xml:space="preserve">Cikande, ${escapedDate}</w:t>
            </w:r>
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>`;
  };
  
  // Build the document body
  let bodyXML = '';
  
  // Header: PENAWARAN with underline, bold, and larger font
  const escapedPenawaran = escapeXml('PENAWARAN');
  bodyXML += `<w:p>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:after="40" w:line="200" w:lineRule="auto"/>
    </w:pPr>
    <w:r>
      <w:rPr>
        ${FONT_FAMILY_TAG}
        <w:b/>
        <w:sz w:val="36"/>
        <w:u w:val="single"/>
      </w:rPr>
      <w:t xml:space="preserve">${escapedPenawaran}</w:t>
    </w:r>
  </w:p>`;
  
  // Quotation info in table format (space-between alignment)
  bodyXML += createHeaderTable(templateData.quotation_number, templateData.quotation_date);
  bodyXML += '<w:p><w:pPr><w:spacing w:after="40" w:line="200" w:lineRule="auto"/></w:pPr></w:p>';
  
  // Customer info with salutation in bordered box (compact, grouped format)
  bodyXML += createCustomerGreetingBox(templateData.salutation_name, templateData.customer_name, templateData.contact_person);
  
  // Introduction
  bodyXML += createParagraph('Dengan Hormat,', false, 'left', 40);
  bodyXML += createParagraph('', false, 'left', 40); // Add blank line after Dengan Hormat
  if (templateData.introduction_text) {
    bodyXML += createIntroductionParagraph(templateData.introduction_text, 'left', 50);
    bodyXML += createParagraph('', false, 'left', 40); // Add blank line after introduction text
  }
  

  
  // Process items - convert text items to paragraphs and insert tables
  if (templateData.item) {
    const itemLines = templateData.item.split('\n');
    let i = 0;
    while (i < itemLines.length) {
      const originalLine = itemLines[i];
      const trimmedLine = originalLine.trim();
      
      // Check if this line is a table marker (check trimmed version for markers)
      if (tableMap[trimmedLine]) {
        // Insert the table
        bodyXML += tableMap[trimmedLine];
        i++;
        continue;
      }
      
      // Regular text line - preserve leading spaces
      if (trimmedLine) {
        if (trimmedLine.startsWith('Harga:')) {
          // Price line - bold and bigger font
          bodyXML += createPriceParagraph(originalLine, 'left', 30);
        } else if (trimmedLine.startsWith('Spesifikasi  :') || trimmedLine.startsWith('Spesifikasi :') || trimmedLine.startsWith('Spesifikasi:')) {
          // Support multiple formats for backward compatibility (two spaces, one space, or no space)
          bodyXML += createParagraph(originalLine, true, 'left', 30);
        } else if (trimmedLine.match(/^\d+\./)) {
          // Item number line - bold, preserve original spacing
          bodyXML += createParagraph(originalLine, true, 'left', 30);
        } else if (trimmedLine.includes('Chassis')) {
          // Chassis line - make "Chassis :" bold, rest normal
          bodyXML += createChassisParagraph(originalLine, 'left', 30);
        } else {
          // All other lines - preserve original spacing (including leading spaces)
          bodyXML += createParagraph(originalLine, false, 'left', 30);
        }
      } else {
        // Empty line - add spacing
        bodyXML += '<w:p><w:pPr><w:spacing w:after="30" w:line="200" w:lineRule="auto"/></w:pPr></w:p>';
      }
      i++;
    }
  }
  
  // Notes section
  if (templateData.notes) {
    bodyXML += createParagraph('Catatan:', true, 'left', 60);
    const noteLines = templateData.notes.split('\n');
    noteLines.forEach(note => {
      if (note.trim()) {
        // Custom note formatting: 5 spaces indent, dash, 3 spaces gap, then text
        // Using hanging indent to ensure wrapped text aligns with the start of the text
        // 1 space approx 60-70 twips. 5 spaces ~ 360 twips. 3 spaces ~ 220 twips.
        // Left indent (text start) = 360 + 220 = 580 twips
        // Hanging indent = 220 twips (so first line starts at 360)
        const escapedNote = escapeXml(note.trim());
        bodyXML += `<w:p>
          <w:pPr>
            <w:ind w:left="580" w:hanging="220"/>
            <w:spacing w:after="30" w:line="200" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
            <w:t xml:space="preserve">-</w:t>
            <w:tab/>
            <w:t xml:space="preserve">${escapedNote}</w:t>
          </w:r>
        </w:p>`;
      }
    });
    bodyXML += createParagraph('', false, 'left', 40);
  }
  
  // Signature section
  bodyXML += createParagraph('', false, 'left', 60);
  if (templateData.signature) {
    const sigLines = templateData.signature.split('\n');
    sigLines.forEach((line, idx) => {
      if (line.trim()) {
        const isLast = idx === sigLines.length - 1;
        // Add extra spacing after "Hormat Kami," line and make it bold
        const isHormatKami = line.trim() === 'Hormat Kami,' || line.trim() === 'Hormat Kami, ';
        const spacingAfter = isHormatKami ? 60 : (isLast ? 40 : 30);
        bodyXML += createParagraph(line, isHormatKami, 'left', spacingAfter);
      } else {
        // Add empty paragraph for blank lines (to preserve spacing)
        bodyXML += createParagraph('', false, 'left', 30);
      }
    });
  }
  
  // Add QR code between "PT. Sukses Tunggal Mandiri" and marketing name (inline, not absolute)
  if (qrCodeRelId && qrCodeDocPrId && qrCodePicId) {
    // Add spacing after "PT. Sukses Tunggal Mandiri"
    bodyXML += createParagraph('', false, 'left', 40);
    
    // QR code size: 1.2 x 1.2 inches
    const qrWidth = 1.2 * 914400; // 1,097,280 EMU
    const qrHeight = 1.2 * 914400; // 1,097,280 EMU
    
    // Create inline QR code image (not absolutely positioned)
    const qrCodeImageXML = createImageXML(qrCodeRelId, qrWidth, qrHeight, qrCodeDocPrId, qrCodePicId);
    
    // Place QR code left-aligned
    bodyXML += `<w:p>
      <w:pPr>
        <w:jc w:val="left"/>
        <w:spacing w:after="10" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        ${qrCodeImageXML}
      </w:r>
    </w:p>`;
    
    // Add "Signed" text below QR code (left-aligned)
    bodyXML += `<w:p>
      <w:pPr>
        <w:jc w:val="left"/>
        <w:spacing w:after="30" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
        <w:t xml:space="preserve">(Signed Digitally)</w:t>
      </w:r>
    </w:p>`;
  }
  
  // Add signatory name and contact information (vertical layout, no table)
  if (templateData.signatory_name && templateData.signatory_name !== 'N/A') {
    // Add spacing before signatory name
    bodyXML += createParagraph('', false, 'left', 20);
    
    // Add signatory full name (bold)
    const escapedSignatoryName = escapeXml(templateData.signatory_name);
    bodyXML += `<w:p>
      <w:pPr>
        <w:spacing w:after="20" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>${FONT_TAG_WITH_SIZE}<w:b/></w:rPr>
        <w:t xml:space="preserve">${escapedSignatoryName}</w:t>
      </w:r>
    </w:p>`;
    
    // Add phone numbers if available
    if (templateData.signatory_phones && Array.isArray(templateData.signatory_phones) && templateData.signatory_phones.length > 0) {
      const phoneNumbers = templateData.signatory_phones.filter((phone) => phone.label && phone.value);
      if (phoneNumbers.length > 0) {
        const phoneText = phoneNumbers.map((phone) => `${phone.label} : ${phone.value}`).join(', ');
        const escapedPhone = escapeXml(phoneText);
        bodyXML += `<w:p>
          <w:pPr>
            <w:spacing w:after="10" w:line="200" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
            <w:t xml:space="preserve">Phone: ${escapedPhone}</w:t>
          </w:r>
        </w:p>`;
      }
    } else if (templateData.phone_number && templateData.phone_number.trim()) {
      const escapedPhone = escapeXml(templateData.phone_number);
      bodyXML += `<w:p>
        <w:pPr>
          <w:spacing w:after="10" w:line="200" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
          <w:t xml:space="preserve">Phone: ${escapedPhone}</w:t>
        </w:r>
      </w:p>`;
    }
    
    // Add email if available
    const emailToDisplay = templateData.signatory_email || templateData.email || "";
    if (emailToDisplay && emailToDisplay.trim()) {
      const escapedEmail = escapeXml(emailToDisplay);
      bodyXML += `<w:p>
        <w:pPr>
          <w:spacing w:after="0" w:line="200" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>${FONT_TAG_WITH_SIZE}</w:rPr>
          <w:t xml:space="preserve">Email: ${escapedEmail}</w:t>
        </w:r>
      </w:p>`;
    }
  } else if (qrCodeRelId && qrCodeDocPrId && qrCodePicId) {
    // If no signatory info but QR code exists, add QR code alone
    bodyXML += createParagraph('', false, 'left', 40);
    bodyXML += createParagraph('', false, 'left', 40);
    
    bodyXML += createParagraph('Digital Signature Verification:', true, 'left', 20);
    
    const qrWidth = 1.5 * 914400;
    const qrHeight = 1.5 * 914400;
    const qrCodeImageXML = createImageXML(qrCodeRelId, qrWidth, qrHeight, qrCodeDocPrId, qrCodePicId);
    
    bodyXML += `<w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:after="20" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        ${qrCodeImageXML}
      </w:r>
    </w:p>`;
    
    bodyXML += createParagraph('Scan QR code to verify document authenticity', false, 'center', 40);
  }
  
  // Drawings section - moved after marketing name
  if (templateData.has_drawings && templateData.drawings_info) {
    // Add page break before drawings, but skip the text (only show images)
    bodyXML += '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>';
    // Skip adding the drawings_info text - only images will be shown
  }
  
  // Drawing images - placed after drawings info text
  if (templateData.has_images && templateData.images && templateData.images.length > 0) {
    templateData.images.forEach((img, idx) => {
      if (img.imageTag) {
        bodyXML += `<w:p>
          <w:pPr>
            <w:spacing w:after="0" w:line="200" w:lineRule="auto"/>
            <w:jc w:val="center"/>
          </w:pPr>
          <w:r>
            ${img.imageTag}
          </w:r>
        </w:p>`;
      }
    });
  }
  
  // Notes images section - insert after all text and marketing name
  if (templateData.has_notes_images && templateData.notes_images && templateData.notes_images.length > 0) {
    templateData.notes_images.forEach((img, idx) => {
      if (img.imageTag) {
        bodyXML += `<w:p>
          <w:pPr>
            <w:spacing w:after="0" w:line="200" w:lineRule="auto"/>
            <w:jc w:val="center"/>
          </w:pPr>
          <w:r>
            ${img.imageTag}
          </w:r>
        </w:p>`;
      }
    });
  }
  
  // Build section properties with header/footer references
  // Small margins on left and right, slightly increased top margin
  // Header margin adds space between top of page and header content
  // Footer margin increased to prevent footer image from being cropped at the top
  let sectPrContent = `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1800" w:right="1008" w:bottom="1440" w:left="1008" w:header="360" w:footer="720" w:gutter="0"/>`;
  
  if (headerRelId) {
    sectPrContent += `<w:headerReference w:type="default" r:id="rId${headerRelId}"/>`;
  }
  
  // Always add footer reference if footerRelId is provided (it should always be provided)
  if (footerRelId !== null && footerRelId !== undefined) {
    sectPrContent += `<w:footerReference w:type="default" r:id="rId${footerRelId}"/>`;
  }
  
  sectPrContent += `<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>`;
  
  // Build complete document XML
  const documentXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
            xmlns:v="urn:schemas-microsoft-com:vml">
  <w:body>
    ${bodyXML}
    <w:p><w:pPr><w:spacing w:after="0" w:line="200" w:lineRule="auto"/><w:sectPr>${sectPrContent}</w:sectPr></w:pPr></w:p>
  </w:body>
</w:document>`;
  
  return documentXML;
};

/**
 * Convert base64 image to Word XML image format using DrawingML
 * @param {string} relationshipId - Relationship ID (e.g., "rId2")
 * @param {number} width - Image width in EMU (English Metric Units, 1 inch = 914400 EMU)
 * @param {number} height - Image height in EMU
 * @param {number} docPrId - Unique document property ID (must be unique per document)
 * @param {number} picId - Unique picture ID (must be unique per document)
 * @returns {string} Word XML for embedded image
 */
const createImageXML = (relationshipId, width, height, docPrId, picId) => {
  return `<w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${width}" cy="${height}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
      <wp:cNvGraphicFramePr>
        <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
      </wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr>
              <pic:cNvPr id="${picId}" name="Picture"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${relationshipId}"/>
              <a:stretch>
                <a:fillRect/>
              </a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm>
                <a:off x="0" y="0"/>
                <a:ext cx="${width}" cy="${height}"/>
              </a:xfrm>
              <a:prstGeom prst="rect">
                <a:avLst/>
              </a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing>`;
};

/**
 * Create anchored image XML (in front of text) for absolute positioning
 * @param {string} relationshipId - Relationship ID for the image
 * @param {number} width - Image width in EMU
 * @param {number} height - Image height in EMU
 * @param {number} docPrId - Document property ID
 * @param {number} picId - Picture ID
 * @param {number} posX - X position in EMU (0 = left)
 * @param {number} posY - Y position in EMU (0 = top)
 * @returns {string} Anchored image XML
 */
const createAnchoredImageXML = (relationshipId, width, height, docPrId, picId, posX = 0, posY = 0) => {
  // Use provided posX, or default to center if not specified
  const finalPosX = posX || ((8.5 * 914400 - width) / 2);
  
  return `<w:drawing>
    <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page">
        <wp:posOffset>${finalPosX}</wp:posOffset>
      </wp:positionH>
      <wp:positionV relativeFrom="paragraph">
        <wp:posOffset>${posY}</wp:posOffset>
      </wp:positionV>
      <wp:extent cx="${width}" cy="${height}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:wrapNone/>
      <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
      <wp:cNvGraphicFramePr>
        <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
      </wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr>
              <pic:cNvPr id="${picId}" name="Picture"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${relationshipId}"/>
              <a:stretch>
                <a:fillRect/>
              </a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm>
                <a:off x="0" y="0"/>
                <a:ext cx="${width}" cy="${height}"/>
              </a:xfrm>
              <a:prstGeom prst="rect">
                <a:avLst/>
              </a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:anchor>
  </w:drawing>`;
};

/**
 * Create anchored image XML for table cells (positioned relative to column)
 * @param {string} relationshipId - Relationship ID for the image
 * @param {number} width - Image width in EMU
 * @param {number} height - Image height in EMU
 * @param {number} docPrId - Document property ID
 * @param {number} picId - Picture ID
 * @param {number} posX - X position in EMU relative to column (0 = left of column)
 * @param {number} posY - Y position in EMU relative to paragraph (0 = top)
 * @returns {string} Anchored image XML
 */
const createAnchoredImageXMLForCell = (relationshipId, width, height, docPrId, picId, posX = 0, posY = 0) => {
  return `<w:drawing>
    <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="column">
        <wp:posOffset>${posX}</wp:posOffset>
      </wp:positionH>
      <wp:positionV relativeFrom="paragraph">
        <wp:posOffset>${posY}</wp:posOffset>
      </wp:positionV>
      <wp:extent cx="${width}" cy="${height}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:wrapNone/>
      <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
      <wp:cNvGraphicFramePr>
        <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
      </wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr>
              <pic:cNvPr id="${picId}" name="Picture"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${relationshipId}"/>
              <a:stretch>
                <a:fillRect/>
              </a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm>
                <a:off x="0" y="0"/>
                <a:ext cx="${width}" cy="${height}"/>
              </a:xfrm>
              <a:prstGeom prst="rect">
                <a:avLst/>
              </a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:anchor>
  </w:drawing>`;
};

/**
 * Create watermark image XML (behind text, centered on page)
 * @param {string} relationshipId - Relationship ID for the watermark image
 * @param {number} width - Image width in EMU
 * @param {number} height - Image height in EMU
 * @param {number} docPrId - Document property ID
 * @param {number} picId - Picture ID
 * @returns {string} Watermark image XML
 */
const createWatermarkImageXML = (relationshipId, width, height, docPrId, picId) => {
  // Page dimensions: 8.5 x 11 inches
  const pageWidth = 8.5 * 914400; // 7,772,400 EMU
  const pageHeight = 11 * 914400; // 10,058,400 EMU
  
  // Center horizontally and vertically
  const centerX = (pageWidth - width) / 2;
  const centerY = (pageHeight - height) / 2;
  
  // Rotation: 45 degrees = 2700000 (in 60000ths of a degree, so 45 * 60000 = 2700000)
  const rotation = 2700000;
  
  return `<w:drawing>
    <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page">
        <wp:posOffset>${centerX}</wp:posOffset>
      </wp:positionH>
      <wp:positionV relativeFrom="page">
        <wp:posOffset>${centerY}</wp:posOffset>
      </wp:positionV>
      <wp:extent cx="${width}" cy="${height}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:wrapNone/>
      <wp:docPr id="${docPrId}" name="Watermark ${docPrId}"/>
      <wp:cNvGraphicFramePr>
        <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
      </wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr>
              <pic:cNvPr id="${picId}" name="Watermark"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${relationshipId}">
                <a:alphaModFix amount="70000"/>
              </a:blip>
              <a:stretch>
                <a:fillRect/>
              </a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm>
                <a:off x="0" y="0"/>
                <a:ext cx="${width}" cy="${height}"/>
                <a:rot>${rotation}</a:rot>
              </a:xfrm>
              <a:prstGeom prst="rect">
                <a:avLst/>
              </a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:anchor>
  </w:drawing>`;
};

/**
 * Load header/footer images from assets directory
 * @returns {Promise<Object>} Object with image buffers and metadata
 */
const loadHeaderFooterImages = async () => {
  const assetsPath = path.join(__dirname, '../assets/header-footer');
  
  try {
    const logoNamePath = path.join(assetsPath, 'logo-name.png');
    const isoPath = path.join(assetsPath, 'IAS-IAF.png');
    const footerPath = path.join(assetsPath, 'footer.png');
    const watermarkPath = path.join(assetsPath, 'watermark.png');
    
    const logoNameBuffer = fs.existsSync(logoNamePath) ? fs.readFileSync(logoNamePath) : null;
    const isoBuffer = fs.existsSync(isoPath) ? fs.readFileSync(isoPath) : null;
    const footerBuffer = fs.existsSync(footerPath) ? fs.readFileSync(footerPath) : null;
    const watermarkBuffer = fs.existsSync(watermarkPath) ? fs.readFileSync(watermarkPath) : null;
    
    return {
      logoName: logoNameBuffer,
      iso: isoBuffer,
      footer: footerBuffer,
      watermark: watermarkBuffer
    };
  } catch (error) {
    console.error('Error loading header/footer images:', error);
    return {
      logoName: null,
      iso: null,
      footer: null,
      watermark: null
    };
  }
};

/**
 * Create header XML with company branding
 * @param {string} logoNameRelId - Relationship ID for logo-name image
 * @param {string} isoRelId - Relationship ID for ISO image
 * @param {number} logoNameDocPrId - Document property ID for logo-name
 * @param {number} isoDocPrId - Document property ID for ISO
 * @param {number} logoNamePicId - Picture ID for logo-name
 * @param {number} isoPicId - Picture ID for ISO
 * @returns {string} Header XML
 */
const createHeaderXML = (logoNameRelId, isoRelId, logoNameDocPrId, isoDocPrId, logoNamePicId, isoPicId, watermarkRelId = null, watermarkDocPrId = null, watermarkPicId = null) => {
  // Page width: 12240 twips (8.5 inches), margins: 1008 twips each side (0.7 inches)
  // Available width: 12240 - 1008 - 1008 = 10224 twips (7.1 inches)
  // For table widths: 1 inch = 1440 DXA, so 7.1 inches = 10224 DXA
  const availableWidth = 10224; // 7.1 inches in DXA
  
  // ISO image: scale to fit right side (smaller size - approximately 2 inches wide, maintain aspect ratio)
  const isoWidth = 2 * 914400; // 1,828,800 EMU
  const isoHeight = 0.65 * 914400; // 594,360 EMU
  
  // Logo-name image: stretch to fill space from left edge to ISO image
  // Calculate available space: available width minus ISO image width
  // ISO image is ~2 inches = 2880 DXA, so logo gets the rest
  const isoColWidth = 2880; // 2 inches in DXA (2 * 1440)
  const logoColWidth = availableWidth - isoColWidth; // Remaining space for logo (~5.1 inches)
  
  // Logo image width: stretch to fill its column but keep height smaller (approximately 5.1 inches wide, 0.65 inches high)
  const logoNameWidth = 5.1 * 914400; // ~4,663,440 EMU
  const logoNameHeight = 0.65 * 914400; // 594,360 EMU
  
  const logoNameImageXML = logoNameRelId ? createImageXML(logoNameRelId, logoNameWidth, logoNameHeight, logoNameDocPrId, logoNamePicId) : '';
  const isoImageXML = isoRelId ? createImageXML(isoRelId, isoWidth, isoHeight, isoDocPrId, isoPicId) : '';
  
  const sloganText = escapeXml('To Be Leading Transport & Heavy-Duty Manufacture In Indonesia');
  const isoCertText = escapeXml('ISO9001-14001-45001');
  
  // Table column widths: left column for logo (stretched), right column for ISO
  const leftColWidth = logoColWidth; // Stretches to fill space until ISO
  const rightColWidth = isoColWidth; // Fixed width for ISO image
  
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <!-- Logo and ISO images at the very top in a table for side-by-side layout -->
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="${availableWidth}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:tblBorders>
        <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="${leftColWidth}"/>
      <w:gridCol w:w="${rightColWidth}"/>
    </w:tblGrid>
    <w:tr>
      <!-- Logo-name image (left) -->
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="${leftColWidth}" w:type="dxa"/>
          <w:vAlign w:val="top"/>
        </w:tcPr>
        <w:p>
          <w:pPr>
            <w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            ${logoNameImageXML}
          </w:r>
        </w:p>
      </w:tc>
      <!-- ISO image (right) -->
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="${rightColWidth}" w:type="dxa"/>
          <w:vAlign w:val="top"/>
        </w:tcPr>
        <w:p>
          <w:pPr>
            <w:jc w:val="right"/>
            <w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            ${isoImageXML}
          </w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
  
  <!-- Slogan and ISO certification numbers on the same line with justify-between spacing -->
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="${availableWidth}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:jc w:val="both"/>
      <w:tblBorders>
        <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="${leftColWidth}"/>
      <w:gridCol w:w="${rightColWidth}"/>
    </w:tblGrid>
    <w:tr>
      <!-- Slogan text (left, bold, italic, Arial, font 18) -->
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="${leftColWidth}" w:type="dxa"/>
          <w:vAlign w:val="center"/>
        </w:tcPr>
        <w:p>
          <w:pPr>
            <w:spacing w:after="10" w:line="200" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            <w:rPr>
              <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>
              <w:sz w:val="23"/>
              <w:szCs w:val="23"/>
              <w:b/>
              <w:i/>
            </w:rPr>
            <w:t xml:space="preserve">${sloganText}</w:t>
          </w:r>
        </w:p>
      </w:tc>
      <!-- ISO certification numbers (right, big, bold) -->
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="${rightColWidth}" w:type="dxa"/>
          <w:vAlign w:val="center"/>
        </w:tcPr>
        <w:p>
          <w:pPr>
            <w:jc w:val="right"/>
            <w:spacing w:after="40" w:line="200" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            <w:rPr>
              ${FONT_FAMILY_TAG}
              <w:sz w:val="24"/>
              <w:b/>
            </w:rPr>
            <w:t xml:space="preserve">${isoCertText}</w:t>
          </w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
  
  <!-- Horizontal line at the bottom: thicker line -->
  <!-- Top line (thicker) -->
  <w:p>
    <w:pPr>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="24" w:space="1" w:color="000000"/>
      </w:pBdr>
      <w:spacing w:before="0" w:after="200" w:line="200" w:lineRule="auto"/>
    </w:pPr>
  </w:p>
  
  <!-- Watermark: centered on page, behind text, rotated 45 degrees, 0.7 opacity -->
  ${watermarkRelId && watermarkDocPrId && watermarkPicId ? (() => {
    const watermarkWidth = 4 * 914400; // 3,657,600 EMU
    const watermarkHeight = 4 * 914400; // 3,657,600 EMU
    const watermarkXML = createWatermarkImageXML(watermarkRelId, watermarkWidth, watermarkHeight, watermarkDocPrId, watermarkPicId);
    return `<w:p>
      <w:pPr>
        <w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        ${watermarkXML}
      </w:r>
    </w:p>`;
  })() : ''}
</w:hdr>`;
};

/**
 * Create footer XML with footer image
 * @param {string} footerRelId - Relationship ID for footer image
 * @param {number} footerDocPrId - Document property ID for footer
 * @param {number} footerPicId - Picture ID for footer
 * @returns {string} Footer XML
 */
const createFooterXML = (footerRelId, footerDocPrId, footerPicId) => {
  // Footer image: fit within page width with margins
  // Page width: 8.5 inches = 12240 twips
  // Left/Right margins: 1008 twips each (from section properties)
  // Available width: 12240 - 1008 - 1008 = 10224 twips
  // Use table for perfect centering - full available width
  const tableWidth = 10224; // Full available width in twips
  const footerWidth = 7.0 * 914400; // 6,400,800 EMU (fits within margins with some padding)
  const footerHeight = 0.6 * 914400; // 548,640 EMU (height to maintain aspect ratio)
  
  // Use inline image for footer (not anchored) so it appears in the footer area
  const footerImageXML = footerRelId ? createImageXML(footerRelId, footerWidth, footerHeight, footerDocPrId, footerPicId) : '';
  
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="${tableWidth}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:jc w:val="center"/>
      <w:tblBorders>
        <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      </w:tblBorders>
      <w:tblLook w:val="04A0" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="${tableWidth}"/>
    </w:tblGrid>
    <w:tr>
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="${tableWidth}" w:type="dxa"/>
          <w:vAlign w:val="center"/>
          <w:tcBorders>
            <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
            <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
            <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
            <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          </w:tcBorders>
        </w:tcPr>
        <w:p>
          <w:pPr>
            <w:jc w:val="center"/>
            <w:spacing w:before="120" w:after="0" w:line="240" w:lineRule="auto"/>
          </w:pPr>
          <w:r>
            ${footerImageXML}
          </w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:ftr>`;
};

/**
 * Create minimal DOCX structure from scratch
 * @param {Object} templateData - Template data for the document
 * @param {Object} tableMap - Map of table placeholders to table XML
 * @param {Array} imageData - Array of image data
 * @param {Object} qrCodeData - QR code data
 * @param {Boolean} includeHeaderFooter - Whether to include header, footer, and watermark (default: true)
 */
const createDOCXFromScratch = async (templateData, tableMap = {}, imageData = [], qrCodeData = null, includeHeaderFooter = true) => {
  const PizZip = require('pizzip');
  const zip = new PizZip();
  
  // Relationship IDs in document.xml.rels:
  // rId1 = styles.xml
  // rId2 = header1.xml (fixed)
  // rId3 = footer1.xml (fixed)
  // rId4+ = drawing images, notes images, QR code
  let relationshipIdCounter = 4; // Start from 4 (rId1=styles, rId2=header, rId3=footer)
  let docPrIdCounter = 1; // Document property IDs start from 1
  let picIdCounter = 1; // Picture IDs start from 1
  const imageRelationships = [];
  const processedTemplateData = { ...templateData };
  
  // Process drawing images
  if (processedTemplateData.images && processedTemplateData.images.length > 0) {
    processedTemplateData.images = processedTemplateData.images.map((img, idx) => {
      if (img.imageTag) {
        try {
          // Extract base64 data (handle both data URI and pure base64)
          let base64Data = img.imageTag;
          if (base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
          }
          
          // Validate base64
          if (!base64Data || base64Data.trim().length === 0) {
            console.error(`[Drawing Image ${idx + 1}] Empty base64 data for drawing image`);
            return img;
          }
          
          // Remove any whitespace from base64 string
          base64Data = base64Data.trim();
          
          const imageBuffer = Buffer.from(base64Data, 'base64');
          
          // Validate buffer was created successfully
          if (!imageBuffer || imageBuffer.length === 0) {
            console.error(`[Drawing Image ${idx + 1}] Failed to create buffer from base64 data (buffer length: ${imageBuffer?.length || 0})`);
            return img;
          }
          
          // Validate buffer is a reasonable size (at least 100 bytes for a valid image)
          if (imageBuffer.length < 100) {
            console.error(`[Drawing Image ${idx + 1}] Image buffer too small (${imageBuffer.length} bytes), likely invalid`);
            return img;
          }
          
          const imagePath = `word/media/image${relationshipIdCounter}.jpg`;
          const relationshipId = `rId${relationshipIdCounter}`;
          
          zip.file(imagePath, imageBuffer);
          imageRelationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${relationshipIdCounter}.jpg"/>`);
          
          console.log(`[Drawing Image ${idx + 1}] Successfully processed: ${relationshipId}, size: ${imageBuffer.length} bytes, path: ${imagePath}`);
          
          // Drawing images: 5.5 x 7.5 inches (fits within A4 page with margins)
          // 1 inch = 914400 EMU, so 5.5 inches = 5,029,200 EMU, 7.5 inches = 6,858,000 EMU
          const width = 5.5 * 914400; // 5,029,200 EMU
          const height = 7.5 * 914400; // 6,858,000 EMU
          const imageXML = createImageXML(relationshipId, width, height, docPrIdCounter, picIdCounter);
          
          relationshipIdCounter++;
          docPrIdCounter++;
          picIdCounter++;
          return { ...img, imageTag: imageXML };
        } catch (err) {
          console.error(`[Drawing Image ${idx + 1}] Error processing drawing image:`, err.message, err.stack);
          return img;
        }
      }
      return img;
    });
  }
  
  // Process notes images
  if (processedTemplateData.notes_images && processedTemplateData.notes_images.length > 0) {
    processedTemplateData.notes_images = processedTemplateData.notes_images.map((img, idx) => {
      if (img.imageTag) {
        try {
          // Extract base64 data (handle both data URI and pure base64)
          let base64Data = img.imageTag;
          if (base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
          }
          
          // Validate base64
          if (!base64Data || base64Data.trim().length === 0) {
            console.error('Empty base64 data for notes image');
            return img;
          }
          
          const imageBuffer = Buffer.from(base64Data, 'base64');
          
          // Validate buffer was created successfully
          if (!imageBuffer || imageBuffer.length === 0) {
            console.error('Failed to create buffer from base64 data');
            return img;
          }
          
          const imagePath = `word/media/image${relationshipIdCounter}.jpg`;
          const relationshipId = `rId${relationshipIdCounter}`;
          
          zip.file(imagePath, imageBuffer);
          imageRelationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${relationshipIdCounter}.jpg"/>`);
          
          // Notes images: 4 x 6 inches (fits within A4 page with margins)
          // 1 inch = 914400 EMU, so 4 inches = 3,657,600 EMU, 6 inches = 5,486,400 EMU
          const width = 4 * 914400; // 3,657,600 EMU
          const height = 6 * 914400; // 5,486,400 EMU
          const imageXML = createImageXML(relationshipId, width, height, docPrIdCounter, picIdCounter);
          
          relationshipIdCounter++;
          docPrIdCounter++;
          picIdCounter++;
          return { ...img, imageTag: imageXML };
        } catch (err) {
          console.error('Error processing notes image:', err.message);
          return img;
        }
      }
      return img;
    });
  }
  
  // Load header/footer images only if includeHeaderFooter is true
  let headerFooterImages = { logoName: null, iso: null, footer: null, watermark: null };
  if (includeHeaderFooter) {
    headerFooterImages = await loadHeaderFooterImages();
  }
  
  // Process header/footer images and create relationships
  let headerLogoNameRelId = null;
  let headerIsoRelId = null;
  let footerRelId = null;
  let headerLogoNameDocPrId = null;
  let headerIsoDocPrId = null;
  let footerDocPrId = null;
  let headerLogoNamePicId = null;
  let headerIsoPicId = null;
  let footerPicId = null;
  
  // Store image numbers for header/footer (not relationship IDs, just the counter values)
  let headerLogoNameImageNum = null;
  let headerIsoImageNum = null;
  let footerImageNum = null;
  
  if (includeHeaderFooter && headerFooterImages.logoName) {
    headerLogoNameImageNum = relationshipIdCounter;
    const imagePath = `word/media/image${relationshipIdCounter}.png`;
    zip.file(imagePath, headerFooterImages.logoName);
    // Note: Header/footer images are NOT added to document.xml.rels, only to their respective header/footer rels files
    headerLogoNameDocPrId = docPrIdCounter++;
    headerLogoNamePicId = picIdCounter++;
    relationshipIdCounter++;
  }
  
  if (includeHeaderFooter && headerFooterImages.iso) {
    headerIsoImageNum = relationshipIdCounter;
    const imagePath = `word/media/image${relationshipIdCounter}.png`;
    zip.file(imagePath, headerFooterImages.iso);
    // Note: Header/footer images are NOT added to document.xml.rels, only to their respective header/footer rels files
    headerIsoDocPrId = docPrIdCounter++;
    headerIsoPicId = picIdCounter++;
    relationshipIdCounter++;
  }
  
  if (includeHeaderFooter && headerFooterImages.footer) {
    footerImageNum = relationshipIdCounter;
    const imagePath = `word/media/image${relationshipIdCounter}.png`;
    zip.file(imagePath, headerFooterImages.footer);
    // Note: Header/footer images are NOT added to document.xml.rels, only to their respective header/footer rels files
    footerDocPrId = docPrIdCounter++;
    footerPicId = picIdCounter++;
    relationshipIdCounter++;
  }
  
  // Process watermark image (added to header1.xml.rels so it appears on all pages)
  let watermarkRelId = null;
  let watermarkDocPrId = null;
  let watermarkPicId = null;
  let watermarkImageNum = null;
  if (includeHeaderFooter && headerFooterImages.watermark) {
    watermarkImageNum = relationshipIdCounter;
    const imagePath = `word/media/image${relationshipIdCounter}.png`;
    zip.file(imagePath, headerFooterImages.watermark);
    // Note: Watermark is added to header1.xml.rels, not document.xml.rels
    watermarkDocPrId = docPrIdCounter++;
    watermarkPicId = picIdCounter++;
    relationshipIdCounter++;
  }
  
  // Process QR code image if provided
  let qrCodeRelId = null;
  let qrCodeDocPrId = null;
  let qrCodePicId = null;
  let qrCodeImageNum = null;
  let qrCodeReturnData = null;
  
  if (qrCodeData && qrCodeData.qrBuffer) {
    try {
      // QR code buffer is already generated with correct hash
      const qrBuffer = qrCodeData.qrBuffer;
      
      // Add QR code image to zip
      qrCodeImageNum = relationshipIdCounter;
      const qrImagePath = `word/media/image${relationshipIdCounter}.png`;
      zip.file(qrImagePath, qrBuffer);
      
      // Add to document relationships
      qrCodeRelId = `rId${relationshipIdCounter}`;
      imageRelationships.push(`<Relationship Id="${qrCodeRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${relationshipIdCounter}.png"/>`);
      
      qrCodeDocPrId = docPrIdCounter++;
      qrCodePicId = picIdCounter++;
      relationshipIdCounter++;
      
      // Store QR code data for return
      qrCodeReturnData = qrCodeData;
    } catch (qrError) {
      console.error('Error processing QR code:', qrError);
      // Don't fail document generation if QR code fails
    }
  }
  
  // Create header and footer relationship IDs (for document.xml.rels)
  // These must be sequential: rId1 for styles, rId2 for header, rId3 for footer
  // Note: rId1 is already used for styles.xml in document.xml.rels
  const headerRelId = 2; // Fixed ID for header in document.xml.rels
  const footerRelIdForDoc = 3; // Fixed ID for footer in document.xml.rels
  
  // Build header relationships XML first to determine watermark relationship ID
  let headerRelsParts = [];
  let headerRelCounter = 1;
  
  if (headerLogoNameImageNum !== null) {
    headerRelsParts.push(`  <Relationship Id="rId${headerRelCounter++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${headerLogoNameImageNum}.png"/>`);
  }
  
  if (headerIsoImageNum !== null) {
    headerRelsParts.push(`  <Relationship Id="rId${headerRelCounter++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${headerIsoImageNum}.png"/>`);
  }
  
  if (watermarkImageNum !== null) {
    headerRelsParts.push(`  <Relationship Id="rId${headerRelCounter++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${watermarkImageNum}.png"/>`);
    watermarkRelId = `rId${headerRelCounter - 1}`; // Set the actual relationship ID
  }
  
  // Generate document XML with processed images and header/footer references
  const documentXML = await generateDocumentXMLFromScratch(
    processedTemplateData, 
    tableMap, 
    includeHeaderFooter ? headerRelId : null, 
    includeHeaderFooter ? footerRelIdForDoc : null, 
    includeHeaderFooter ? watermarkRelId : null, 
    includeHeaderFooter ? watermarkDocPrId : null, 
    includeHeaderFooter ? watermarkPicId : null, 
    qrCodeRelId, 
    qrCodeDocPrId, 
    qrCodePicId
  );
  
  // Create header XML (using placeholder IDs that will be replaced with rId1, rId2, etc.)
  const headerXML = includeHeaderFooter 
    ? createHeaderXML('rId1', headerIsoImageNum ? 'rId2' : null, headerLogoNameDocPrId, headerIsoDocPrId, headerLogoNamePicId, headerIsoPicId, watermarkRelId, watermarkDocPrId, watermarkPicId)
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:hdr>';
  
  // Create footer XML (using placeholder ID that will be replaced with rId1)
  const footerXML = includeHeaderFooter 
    ? createFooterXML('rId1', footerDocPrId, footerPicId)
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:ftr>';
  
  // Content Types XML - include image content types if images exist
  let contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`;
  
  // Always include PNG for QR code, and JPG/JPEG for other images
  if (imageRelationships.length > 0 || qrCodeRelId) {
    contentTypesXML += `
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png" ContentType="image/png"/>`;
  }
  
  contentTypesXML += `
</Types>`;
  
  // Relationships XML
  const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  
  // Word relationships XML - include image relationships, header, and footer
  let wordRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  
  if (includeHeaderFooter) {
    wordRelsXML += `
  <Relationship Id="rId${headerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId${footerRelIdForDoc}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`;
  }
  
  if (imageRelationships.length > 0) {
    wordRelsXML += `\n${imageRelationships.join('\n')}`;
  }
  
  wordRelsXML += `\n</Relationships>`;
  
  const finalHeaderRelsXML = headerRelsParts.length > 0 ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${headerRelsParts.join('\n')}
</Relationships>` : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  
  // Build footer relationships XML
  let footerRelsParts = [];
  
  if (footerImageNum !== null) {
    footerRelsParts.push(`  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${footerImageNum}.png"/>`);
  }
  
  const footerRelsXML = footerRelsParts.length > 0 ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${footerRelsParts.join('\n')}
</Relationships>` : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  
  // Header and footer XML are already using correct relationship IDs (rId1, rId2)
  const finalHeaderXML = headerXML;
  const finalFooterXML = footerXML;
  
  // Styles XML (minimal)
  const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;
  
  // Add files to ZIP
  zip.file('[Content_Types].xml', contentTypesXML);
  zip.file('_rels/.rels', relsXML);
  zip.file('word/document.xml', documentXML);
  zip.file('word/_rels/document.xml.rels', wordRelsXML);
  zip.file('word/styles.xml', stylesXML);
  zip.file('word/header1.xml', finalHeaderXML);
  zip.file('word/_rels/header1.xml.rels', finalHeaderRelsXML);
  zip.file('word/footer1.xml', finalFooterXML);
  zip.file('word/_rels/footer1.xml.rels', footerRelsXML);
  
  // Generate buffer - CRITICAL: Must return Buffer, not Uint8Array
  const buffer = zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  
  // Ensure we return a proper Buffer instance (not Uint8Array)
  // PizZip should return Buffer with type: "nodebuffer", but let's be explicit
  const finalBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  
  // Return both buffer and QR code data
  return {
    buffer: finalBuffer,
    qrCode: qrCodeReturnData
  };
};

/**
 * Generate quotation document
 * @param {Object} quotationData - Full quotation data with header and offers
 * @param {String} offerId - Optional offer ID to generate specific offer
 * @param {Array} selectedNotes - Array of selected note indices
 * @param {Boolean} includeHeaderFooter - Whether to include header, footer, and watermark (default: true)
 * @returns {Promise<Buffer>} Generated DOCX buffer
 */
const generateQuotationDocument = async (quotationData, offerId = null, selectedNotes = [0, 1, 2, 3, 4, 5], includeHeaderFooter = true) => {
  try {
    const { header, rfq, offers } = quotationData;
    
    // Find the active offer
    let activeOffer = null;
    if (offerId) {
      // Find specific offer by ID
      for (const offerGroup of offers) {
        if (offerGroup.original?._id?.toString() === offerId.toString()) {
          activeOffer = offerGroup.original;
          break;
        }
        if (offerGroup.revisions) {
          const revision = offerGroup.revisions.find(
            (rev) => rev._id?.toString() === offerId.toString()
          );
          if (revision) {
            activeOffer = revision;
            break;
          }
        }
      }
    } else if (header.status?.type === "win" && header.selectedOfferId) {
      // Find winning offer
      for (const offerGroup of offers) {
        if (offerGroup.original?._id?.toString() === header.selectedOfferId.toString()) {
          activeOffer = offerGroup.original;
          break;
        }
        if (offerGroup.revisions) {
          const revision = offerGroup.revisions.find(
            (rev) => rev._id?.toString() === header.selectedOfferId.toString()
          );
          if (revision) {
            activeOffer = revision;
            break;
          }
        }
      }
    } else {
      // Use first offer
      if (offers[0]?.original) {
        activeOffer = offers[0].original;
      } else if (offers[0]) {
        activeOffer = offers[0];
      }
    }
    
    if (!activeOffer) {
      throw new Error("No offer found to generate document");
    }
    
    if (!activeOffer.offerItems || activeOffer.offerItems.length === 0) {
      throw new Error("No offer items found in the selected offer");
    }
    
    // Check if there are any drawings to include (use quotationImage for JPG display)
    const itemsWithDrawings = activeOffer.offerItems.filter(item => 
      item.drawingSpecification && 
      item.drawingSpecification.quotationImage && 
      item.drawingSpecification.quotationImage.fileId
    );
    
    // Create drawing number map for all items (including those without images)
    const drawingNumberMap = {};
    activeOffer.offerItems.forEach(item => {
      if (item.drawingSpecification) {
        const drawingId = typeof item.drawingSpecification === 'object' && item.drawingSpecification !== null
          ? item.drawingSpecification._id?.toString()
          : item.drawingSpecification?.toString();
        if (drawingId) {
          const drawing = typeof item.drawingSpecification === 'object' && item.drawingSpecification !== null
            ? item.drawingSpecification
            : null;
          if (drawing && drawing.drawingNumber) {
            drawingNumberMap[drawingId] = drawing.drawingNumber;
          }
        }
      }
    });
    
    // Create drawings information
    const drawingsInfo = itemsWithDrawings.length > 0 
      ? createDrawingsInfo(itemsWithDrawings, header.quotationNumber)
      : "";
    
    // Preload base64 images for drawings (use quotationImage - always JPG)
    const imageData = [];
    for (const item of itemsWithDrawings) {
      const drawing = item.drawingSpecification;
      const quotationImage = drawing.quotationImage;
      
      if (quotationImage && quotationImage.fileId) {
        try {
          const base64String = await fetchDrawingImageAsBase64(drawing._id, quotationImage.fileId, true);
          imageData.push({
            karoseri: item.karoseri,
            chassis: item.chassis,
            imageTag: base64String,
            itemNumber: activeOffer.offerItems.indexOf(item) + 1,
            drawingNumber: drawing.drawingNumber,
            filename: quotationImage.originalName
          });
        } catch (err) {
          console.error(`Failed to load quotation image for drawing ${drawing._id}:`, err.message);
        }
      }
    }

    // Collect notes images data
    const notesImagesData = [];
    if (activeOffer.notesImages && activeOffer.notesImages.length > 0) {
      for (const notesImage of activeOffer.notesImages) {
        try {
          const imageFile = notesImage.imageFile || notesImage;
          const fileId = imageFile.fileId;
          const imageId = notesImage._id || notesImage;
          
          if (fileId) {
            const base64String = await fetchNotesImageAsBase64(imageId, fileId, true);
            notesImagesData.push({
              imageTag: base64String,
              filename: imageFile.originalName || 'Notes Image'
            });
          }
        } catch (err) {
          console.error(`Failed to load notes image ${notesImage._id}:`, err.message);
        }
      }
    }
    
    // Prepare data for template
    const templateData = await prepareQuotationData(
      header,
      activeOffer,
      selectedNotes,
      drawingsInfo,
      imageData,
      notesImagesData,
      drawingNumberMap,
      rfq
    );
    
    // Extract table map for post-processing (remove from template data)
    const tableMap = templateData._tableMap || {};
    delete templateData._tableMap;
    
    // Generate the document buffer first (without QR code) to calculate hash
    // Then we'll add QR code with the correct hash
    let qrCodeData = null;
    
    // Extract approverId as string - handle both ObjectId and populated objects
    // Priority: Use RFQ approver from timeline if RFQ exists and is approved/quotation_created
    let approverIdString = null;
    let approvalTimestamp = null;
    
    // Check if quotation has an RFQ and if it's been approved
    if (rfq && (rfq.status === 'quotation_created' || rfq.status === 'approved')) {
      // Find the approval entry in the timeline
      const approvalEntry = rfq.timeline && Array.isArray(rfq.timeline) 
        ? rfq.timeline.find(entry => entry.action === 'approved')
        : null;
      
      if (approvalEntry && approvalEntry.user) {
        // Use the approver from the RFQ timeline
        const approverUser = approvalEntry.user;
        if (typeof approverUser === 'string') {
          approverIdString = approverUser;
        } else if (approverUser._id) {
          approverIdString = String(approverUser._id);
        } else if (approverUser.toString && typeof approverUser.toString === 'function') {
          approverIdString = approverUser.toString();
        } else {
          approverIdString = String(approverUser);
        }
        
        // Get approval timestamp from timeline
        if (approvalEntry.timestamp) {
          approvalTimestamp = Math.floor(new Date(approvalEntry.timestamp).getTime() / 1000);
        }
      } else if (rfq.approverId) {
        // Fallback to RFQ approverId if timeline entry not found
        const rfqApprover = rfq.approverId;
        if (typeof rfqApprover === 'string') {
          approverIdString = rfqApprover;
        } else if (rfqApprover._id) {
          approverIdString = String(rfqApprover._id);
        } else if (rfqApprover.toString && typeof rfqApprover.toString === 'function') {
          approverIdString = rfqApprover.toString();
        } else {
          approverIdString = String(rfqApprover);
        }
      }
    }
    
    // Fallback to header approverId if RFQ approver not found
    if (!approverIdString && header.approverId) {
      if (typeof header.approverId === 'string') {
        approverIdString = header.approverId;
      } else if (header.approverId._id) {
        // Populated object - extract _id
        approverIdString = String(header.approverId._id);
      } else if (header.approverId.toString && typeof header.approverId.toString === 'function') {
        const idStr = header.approverId.toString();
        // Check if toString() returned "[object Object]" - if so, try _id or id property
        if (idStr === '[object Object]') {
          approverIdString = header.approverId._id ? String(header.approverId._id) : 
                            (header.approverId.id ? String(header.approverId.id) : null);
        } else {
          approverIdString = idStr;
        }
      } else {
        approverIdString = String(header.approverId);
      }
    }
    
    if (approverIdString) {
      try {
        qrCodeData = {
          quotationNumber: header.quotationNumber,
          approverId: approverIdString,
          timestamp: approvalTimestamp || Math.floor(Date.now() / 1000)
        };
      } catch (qrError) {
        console.error('Error preparing QR code:', qrError);
      }
    }
    
    // Generate document without QR code first to get hash
    const tempResult = await createDOCXFromScratch(templateData, tableMap, imageData, null, includeHeaderFooter);
    const tempBuffer = tempResult.buffer;
    
    // Hash the document (without QR code)
    const documentHash = signatureService.hashDocument(tempBuffer);
    
    // Now generate QR code with the correct hash
    let finalQrCodeData = null;
    if (qrCodeData && approverIdString) {
      try {
        // Generate QR code URL with the actual document hash
        const qrUrl = signatureService.generateQRUrl({
          userId: approverIdString,
          quotationNumber: header.quotationNumber,
          documentHash
        });
        
        // Generate QR code as buffer
        const qrBuffer = await QRCode.toBuffer(qrUrl, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 200
        });
        
        finalQrCodeData = {
          ...qrCodeData,
          qrUrl,
          qrBuffer,
          documentHash
        };
      } catch (qrError) {
        console.error('Error generating QR code:', qrError);
      }
    }
    
    // Now generate the final document WITH QR code embedded
    const finalResult = await createDOCXFromScratch(templateData, tableMap, imageData, finalQrCodeData, includeHeaderFooter);
    const finalBuffer = finalResult.buffer;
    
    // Note: The hash in the QR code is of the document WITHOUT the QR code.
    // This is intentional - it verifies the document content, not the QR code itself.
    // When verifying, we should hash the document (excluding QR code) and compare.
    
    return {
      buffer: finalBuffer,
      qrCode: finalQrCodeData
    };
  } catch (error) {
    console.error("DOCX generation failed:", error.message);
    throw error;
  }
};

const generateServiceSpecificationTableXML = (offerItems = []) => {
  return generatePricingTableXML(offerItems, 'service');
};

module.exports = {
  generateQuotationDocument,
  formatPrice,
  formatNotes,
};

