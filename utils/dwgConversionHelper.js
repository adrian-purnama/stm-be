/**
 * DWG to DXF Conversion Helper
 * 
 * IMPORTANT: DWG to DXF conversion requires external tools. There is NO pure Node.js 
 * library that can do this conversion without external dependencies.
 * 
 * Why? DWG is a proprietary Autodesk format with complex binary structure. Conversion
 * requires specialized tools that understand the DWG format deeply.
 * 
 * Options:
 * 1. Store DWG as-is (recommended - works without any configuration)
 * 2. Use ODA File Converter (FREE, open source, requires installation)
 * 3. Use paid cloud APIs (Aspose, GroupDocs, etc.)
 * 
 * By default, files are stored in their original format (no conversion required).
 * 
 * Optional conversion: Install ODA File Converter (FREE):
 * https://www.opendesign.com/guestfiles/oda_file_converter
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Enable/disable debug logging
const DEBUG_MODE = true;

/**
 * Debug logging helper
 */
function debugLog(message, data = null) {
  if (DEBUG_MODE) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [DWG→DXF] ${message}`);
    if (data) console.log(`[${timestamp}] [DWG→DXF] Data:`, data);
  }
}

/**
 * Check if file is DWG format
 */
function isDWGFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.dwg';
}

/**
 * Check if file is DXF format
 */
function isDXFFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.dxf';
}

/**
 * Validate file is DWG or DXF
 */
function validateDrawingFile(filename) {
  return isDWGFile(filename) || isDXFFile(filename);
}

/**
 * Convert DWG to DXF using ODA File Converter (FREE, Open Source)
 * 
 * ODA File Converter is a free, open-source tool provided by the Open Design Alliance.
 * 
 * Installation Instructions:
 * 
 * Windows:
 * 1. Download from: https://www.opendesign.com/guestfiles/oda_file_converter
 * 2. Extract the ZIP file to a folder (e.g., C:\ODAFileConverter)
 * 3. Find ODAFileConverter.exe in the extracted folder
 * 4. Set environment variable: ODA_FILE_CONVERTER_PATH=C:\ODAFileConverter\ODAFileConverter.exe
 *    Or add to your .env file: ODA_FILE_CONVERTER_PATH=C:\\ODAFileConverter\\ODAFileConverter.exe
 * 
 * Linux:
 * 1. Download from: https://www.opendesign.com/guestfiles/oda_file_converter
 * 2. Extract and make executable: chmod +x ODAFileConverter
 * 3. Set environment variable: ODA_FILE_CONVERTER_PATH=/path/to/ODAFileConverter
 * 
 * macOS:
 * 1. Download from: https://www.opendesign.com/guestfiles/oda_file_converter
 * 2. Extract and set: ODA_FILE_CONVERTER_PATH=/path/to/ODAFileConverter
 * 
 * @param {Buffer} dwgBuffer - The DWG file buffer
 * @param {string} originalFilename - Original filename
 * @returns {Promise<Buffer>} - DXF file buffer
 */
async function convertDWGToDXF_ODA(dwgBuffer, originalFilename) {
  debugLog('Starting ODA File Converter conversion', {
    filename: originalFilename,
    inputSize: dwgBuffer.length,
    converterPath: process.env.ODA_FILE_CONVERTER_PATH
  });

  const converterPath = process.env.ODA_FILE_CONVERTER_PATH || 'ODAFileConverter';
  const os = require('os');
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  const uniqueId = `${timestamp}_${randomId}`;
  
  const tempInputDir = path.join(tempDir, `dwg_input_${uniqueId}`);
  const tempOutputDir = path.join(tempDir, `dxf_output_${uniqueId}`);
  const tempDWGPath = path.join(tempInputDir, `input_${uniqueId}.dwg`);
  
  try {
    debugLog('Step 1: Creating temporary directories', { tempInputDir, tempOutputDir });
    await fs.mkdir(tempInputDir, { recursive: true });
    await fs.mkdir(tempOutputDir, { recursive: true });
    
    debugLog('Step 2: Writing DWG file to temp location', { tempDWGPath });
    await fs.writeFile(tempDWGPath, dwgBuffer);
    
    const isWindows = os.platform() === 'win32';
    const inputFolder = isWindows ? tempInputDir.replace(/\//g, '\\') : tempInputDir;
    const outputFolder = isWindows ? tempOutputDir.replace(/\//g, '\\') : tempOutputDir;
    
    const command = `"${converterPath}" "${inputFolder}" "${outputFolder}" ACAD2018 DXF 0 0`;
    
    debugLog('Step 3: Running ODA File Converter command', { command });
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });
    
    if (stdout) debugLog('ODA Converter stdout', { stdout });
    if (stderr && !stderr.includes('Warning')) {
      debugLog('ODA Converter stderr (non-warning)', { stderr });
    }
    
    debugLog('Step 4: Waiting for file system sync');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    debugLog('Step 5: Searching for output DXF file');
    const baseName = path.basename(tempDWGPath, '.dwg');
    const possiblePaths = [
      path.join(tempOutputDir, `${baseName}.dxf`),
      path.join(tempOutputDir, `input_${uniqueId}.dxf`),
      path.join(tempOutputDir, 'input.dxf'),
      path.join(tempOutputDir, `${path.basename(originalFilename, '.dwg')}.dxf`)
    ];
    
    let dxfPath = null;
    for (const possiblePath of possiblePaths) {
      try {
        await fs.access(possiblePath);
        dxfPath = possiblePath;
        debugLog('Found DXF file', { path: dxfPath });
        break;
      } catch (err) {
        debugLog('DXF not found at path', { path: possiblePath });
      }
    }
    
    if (!dxfPath) {
      const files = await fs.readdir(tempOutputDir);
      throw new Error(`DXF file not found. Output directory contains: ${files.join(', ')}`);
    }
    
    debugLog('Step 6: Reading converted DXF file', { path: dxfPath });
    const dxfBuffer = await fs.readFile(dxfPath);
    debugLog('Conversion successful', { 
      originalSize: dwgBuffer.length, 
      convertedSize: dxfBuffer.length,
      compressionRatio: (dwgBuffer.length / dxfBuffer.length * 100).toFixed(1) + '%'
    });
    
    debugLog('Step 7: Cleaning up temporary files');
    await fs.unlink(tempDWGPath).catch(() => {});
    await fs.unlink(dxfPath).catch(() => {});
    await fs.rmdir(tempInputDir, { recursive: true }).catch(() => {});
    await fs.rmdir(tempOutputDir, { recursive: true }).catch(() => {});
    
    return dxfBuffer;
  } catch (error) {
    debugLog('Conversion failed, cleaning up', { error: error.message });
    await fs.unlink(tempDWGPath).catch(() => {});
    await fs.rmdir(tempInputDir, { recursive: true }).catch(() => {});
    await fs.rmdir(tempOutputDir, { recursive: true }).catch(() => {});
    throw error;
  }
}


/**
 * Main conversion function
 * Attempts to convert DWG to DXF using available methods
 * If conversion is not available, allows storing DWG as-is
 * 
 * @param {Buffer} fileBuffer - The file buffer (DWG or DXF)
 * @param {string} originalFilename - Original filename
 * @returns {Promise<{buffer: Buffer, format: string, uploadedFormat: string, converted: boolean}>} - File buffer and metadata
 */
async function convertToDXF(fileBuffer, originalFilename) {
  debugLog('=== Starting file processing ===', {
    filename: originalFilename,
    fileSize: fileBuffer.length
  });

  // Validate file type
  if (!validateDrawingFile(originalFilename)) {
    debugLog('Invalid file type');
    throw new Error('Invalid file type. Only DWG and DXF files are allowed.');
  }
  
  // If already DXF, return as-is
  if (isDXFFile(originalFilename)) {
    debugLog('File is already DXF - no conversion needed', { uploadedFormat: 'DXF' });
    return {
      buffer: fileBuffer,
      format: 'DXF',
      uploadedFormat: 'DXF',
      converted: false
    };
  }
  
  // If DWG, try to convert to DXF
  if (isDWGFile(originalFilename)) {
    debugLog('File is DWG - checking for conversion methods');
    
    // Check conversion method availability
    const hasODA = !!process.env.ODA_FILE_CONVERTER_PATH;
    const requireConversion = process.env.REQUIRE_DWG_CONVERSION === 'true';
    
    debugLog('Conversion method check', {
      hasODA,
      requireConversion,
      odaPath: hasODA ? process.env.ODA_FILE_CONVERTER_PATH : 'not set'
    });
    
    // Verify ODA path exists if configured
    if (hasODA) {
      try {
        if (fsSync.existsSync(process.env.ODA_FILE_CONVERTER_PATH)) {
          debugLog('ODA File Converter found');
        } else {
          debugLog('ODA File Converter path does not exist', { path: process.env.ODA_FILE_CONVERTER_PATH });
        }
      } catch (err) {
        debugLog('Could not verify ODA path', { error: err.message });
      }
    }
    
    // Try ODA File Converter first (FREE, Open Source - recommended)
    if (hasODA || process.env.ENABLE_ODA_CONVERTER === 'true') {
      try {
        debugLog('Attempting ODA File Converter conversion...');
        const dxfBuffer = await convertDWGToDXF_ODA(fileBuffer, originalFilename);
        debugLog('✅ Conversion successful via ODA File Converter');
        return {
          buffer: dxfBuffer,
          format: 'DXF',
          uploadedFormat: 'DWG',
          converted: true
        };
      } catch (error) {
        debugLog('ODA Converter failed', { error: error.message });
      }
    }
    
    // If no conversion method available, check if conversion is REQUIRED
    if (requireConversion) {
      debugLog('Conversion is REQUIRED but no converter available', { error: 'Configuration issue' });
      throw new Error('DWG to DXF conversion is required but no converter is available. Set REQUIRE_DWG_CONVERSION=false to allow DWG files, or install ODA File Converter.');
    }
    
    // If conversion is NOT required, allow storing DWG as-is
    debugLog('No conversion configured - storing DWG as-is');
    debugLog('To enable conversion: Download ODA File Converter (FREE) from https://www.opendesign.com/guestfiles/oda_file_converter');
    
    return {
      buffer: fileBuffer,
      format: 'DWG',
      uploadedFormat: 'DWG',
      converted: false
    };
  }
  
  debugLog('Unsupported file format');
  throw new Error('Unsupported file format');
}

module.exports = {
  isDWGFile,
  isDXFFile,
  validateDrawingFile,
  convertToDXF,
  convertDWGToDXF_ODA
};

