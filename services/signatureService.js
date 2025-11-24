const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Digital Signature Service
 * Provides cryptographic signing and verification for document QR codes
 * Uses ECDSA P-256 (ES256) for efficient signing
 */

// Key storage path
const KEYS_DIR = path.join(__dirname, '../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private_key.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public_key.pem');

/**
 * Ensure keys directory exists
 */
const ensureKeysDirectory = () => {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
};

/**
 * Generate ECDSA P-256 key pair if not exists
 * @returns {Object} { privateKey, publicKey }
 */
const generateKeyPair = () => {
  ensureKeysDirectory();
  
  // Check if keys already exist
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    try {
      const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
      console.log('✓ Loaded existing key pair from:', PRIVATE_KEY_PATH);
      return { privateKey, publicKey };
    } catch (error) {
      console.error('Error reading existing keys, generating new ones:', error);
      // Fall through to generate new keys
    }
  }

  // Generate new key pair
  console.log('Generating new ECDSA P-256 key pair...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // P-256
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Save keys
  try {
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey);
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
    console.log('✓ Generated and saved new ECDSA P-256 key pair');
    console.log('  Private key:', PRIVATE_KEY_PATH);
    console.log('  Public key:', PUBLIC_KEY_PATH);
  } catch (error) {
    console.error('Error saving keys:', error);
    throw new Error('Failed to save key pair: ' + error.message);
  }

  return { privateKey, publicKey };
};

/**
 * Get or generate key pair
 * @returns {Object} { privateKey, publicKey }
 */
const getKeyPair = () => {
  ensureKeysDirectory();
  
  // Use the proper path constants defined at the top
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    try {
      return {
        privateKey: fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'),
        publicKey: fs.readFileSync(PUBLIC_KEY_PATH, 'utf8')
      };
    } catch (error) {
      console.error('Error reading key files:', error);
      // If reading fails, generate new keys
      return generateKeyPair();
    }
  }

  return generateKeyPair();
};

/**
 * Base64URL encode (URL-safe base64)
 * @param {Buffer|string} data - Data to encode
 * @returns {string} Base64URL encoded string
 */
const base64UrlEncode = (data) => {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

/**
 * Base64URL decode
 * @param {string} str - Base64URL encoded string
 * @returns {Buffer} Decoded buffer
 */
const base64UrlDecode = (str) => {
  // Add padding if needed
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
};

/**
 * Calculate SHA256 hash of document data
 * @param {string|Buffer} data - Document data or critical info
 * @returns {string} Hexadecimal hash
 */
const hashDocument = (data) => {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

/**
 * Create signature payload
 * @param {Object} data - Payload data
 * @param {string} data.userId - User ID who signed
 * @param {string} data.quotationNumber - Quotation number
 * @param {string} data.documentHash - SHA256 hash of document
 * @param {number} data.timestamp - Unix timestamp
 * @returns {string} Base64URL encoded JSON payload
 */
const createPayload = ({ userId, quotationNumber, documentHash, timestamp }) => {
  // CRITICAL: Ensure userId is always a proper string, not "[object Object]"
  let userIdString = '';
  if (userId) {
    if (typeof userId === 'string') {
      userIdString = userId;
    } else if (userId && typeof userId === 'object') {
      // Handle ObjectId or populated objects
      if (userId._id) {
        userIdString = String(userId._id);
      } else if (userId.id) {
        userIdString = String(userId.id);
      } else if (userId.toString && typeof userId.toString === 'function') {
        const str = userId.toString();
        // If toString() returns "[object Object]", try to extract actual ID
        if (str === '[object Object]') {
          // Try to get the actual ID value from common properties
          userIdString = userId._id ? String(userId._id) : 
                        (userId.id ? String(userId.id) : 
                        (userId.valueOf ? String(userId.valueOf()) : String(userId)));
        } else {
          userIdString = str;
        }
      } else {
        userIdString = String(userId);
      }
    } else {
      userIdString = String(userId);
    }
  }
  
  // Validate it's a proper string and not "[object Object]"
  if (!userIdString || userIdString === '[object Object]' || userIdString.trim() === '') {
    console.error('Invalid userId in createPayload:', userId, 'Type:', typeof userId);
    throw new Error('Invalid userId: cannot convert to string properly');
  }
  
  const payload = {
    uid: userIdString, // Always use properly converted string
    qtn: quotationNumber,
    hash: documentHash,
    ts: timestamp || Math.floor(Date.now() / 1000)
  };

  // Compact JSON (no whitespace)
  const jsonString = JSON.stringify(payload);
  return base64UrlEncode(jsonString);
};

/**
 * Parse payload from Base64URL
 * @param {string} encodedPayload - Base64URL encoded payload
 * @returns {Object} Parsed payload object
 */
const parsePayload = (encodedPayload) => {
  try {
    const decoded = base64UrlDecode(encodedPayload);
    const jsonString = decoded.toString('utf8');
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error('Invalid payload format');
  }
};

/**
 * Sign payload with private key
 * @param {string} payload - Base64URL encoded payload
 * @returns {string} Base64URL encoded signature
 */
const signPayload = (payload) => {
  try {
    const { privateKey } = getKeyPair();
    
    if (!privateKey) {
      throw new Error('Private key not found');
    }
    
    // Sign the Base64URL encoded payload string (not the decoded version)
    // The payload is already Base64URL encoded, so we sign the string as-is
    const sign = crypto.createSign('SHA256');
    sign.update(payload); // Don't specify encoding - treat as binary/string
    sign.end();
    
    // Get signature as Buffer (DER format for ECDSA)
    const signatureBuffer = sign.sign(privateKey);
    
    // Convert to Base64, then Base64URL encode for URL safety
    const signatureBase64 = signatureBuffer.toString('base64');
    const encodedSignature = base64UrlEncode(signatureBase64);
    
    return encodedSignature;
  } catch (error) {
    console.error('Error signing payload:', error);
    console.error('Payload:', payload);
    throw error;
  }
};

/**
 * Verify signature
 * @param {string} payload - Base64URL encoded payload
 * @param {string} signature - Base64URL encoded signature
 * @returns {boolean} True if signature is valid
 */
const verifySignature = (payload, signature) => {
  try {
    const { publicKey } = getKeyPair();
    
    if (!publicKey) {
      console.error('Public key not found');
      return false;
    }
    
    // Decode Base64URL signature back to Base64, then to Buffer
    const signatureBase64 = base64UrlDecode(signature).toString('utf8');
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    
    // Verify using the same Base64URL encoded payload string that was signed
    const verify = crypto.createVerify('SHA256');
    verify.update(payload); // Don't specify encoding - must match signing
    verify.end();
    
    const isValid = verify.verify(publicKey, signatureBuffer);
    
    if (!isValid) {
      console.error('Signature verification failed');
      console.error('Payload:', payload.substring(0, 50) + '...');
      console.error('Payload length:', payload.length);
      console.error('Signature length:', signature.length);
      console.error('Signature base64 length:', signatureBase64.length);
    }
    
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    console.error('Error stack:', error.stack);
    return false;
  }
};

/**
 * Generate QR code URL
 * @param {Object} data - Signature data
 * @param {string} data.userId - User ID
 * @param {string} data.quotationNumber - Quotation number
 * @param {string} data.documentHash - Document hash
 * @param {string} baseUrl - Base URL for verification (e.g., https://mydomain.com)
 * @returns {string} QR code URL
 */
const generateQRUrl = (data, baseUrl = process.env.BACKEND_URL || 'https://mydomain.com') => {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = createPayload({
    userId: data.userId,
    quotationNumber: data.quotationNumber,
    documentHash: data.documentHash,
    timestamp
  });
  
  const signature = signPayload(payload);
  
  return `${baseUrl}/api/auth/verify?p=${payload}&s=${signature}`;
};

/**
 * Verify QR code data
 * @param {string} encodedPayload - Base64URL encoded payload
 * @param {string} encodedSignature - Base64URL encoded signature
 * @returns {Object} Verification result
 */
const verifyQRData = (encodedPayload, encodedSignature) => {
  try {
    // Verify signature
    const isValidSignature = verifySignature(encodedPayload, encodedSignature);
    
    if (!isValidSignature) {
      return {
        valid: false,
        error: 'Invalid signature',
        message: 'The signature does not match the payload. The document may have been tampered with.'
      };
    }

    // Parse payload
    const payload = parsePayload(encodedPayload);
    
    // Validate payload structure
    if (!payload.uid || !payload.qtn || !payload.hash || !payload.ts) {
      return {
        valid: false,
        error: 'Invalid payload',
        message: 'The payload is missing required fields.'
      };
    }

    // Check timestamp (optional: reject if too old, e.g., > 10 years)
    const timestamp = payload.ts;
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 10 * 365 * 24 * 60 * 60; // 10 years
    
    if (timestamp < now - maxAge) {
      return {
        valid: false,
        error: 'Expired signature',
        message: 'The signature is too old and may no longer be valid.'
      };
    }

    // Ensure userId is always a string
    let userIdString = payload.uid;
    if (userIdString && typeof userIdString !== 'string') {
      userIdString = userIdString.toString ? userIdString.toString() : String(userIdString);
    }
    
    return {
      valid: true,
      payload: {
        userId: userIdString,
        quotationNumber: payload.qtn,
        documentHash: payload.hash,
        timestamp: payload.ts,
        signedAt: new Date(payload.ts * 1000).toISOString()
      },
      message: 'Valid document signature'
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Verification error',
      message: error.message || 'An error occurred during verification.'
    };
  }
};

module.exports = {
  generateKeyPair,
  getKeyPair,
  hashDocument,
  createPayload,
  parsePayload,
  signPayload,
  verifySignature,
  generateQRUrl,
  verifyQRData,
  base64UrlEncode,
  base64UrlDecode
};

