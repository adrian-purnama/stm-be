const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const http = require('http');
const { setupNotificationWebsocket } = require('./websocket/notificationWebsocket');

const app = express();
const PORT = process.env.PORT || 5000;

// app.use(cors({
//   origin: [
//     process.env.FRONTEND_URL,
//     process.env.CATALOGUE_URL,
//     "http://localhost:5173"
//   ],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   exposedHeaders: ['Content-Disposition'], // Expose Content-Disposition for file downloads
//   credentials: true
// }));

// CORS configuration - Allow all origins
const corsOptions = {
  origin: true, // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Disposition'],
  credentials: true,
  optionsSuccessStatus: 200, // Some browsers expect 200 instead of 204
  preflightContinue: false
};

// CRITICAL: Handle OPTIONS requests FIRST, before any other middleware
app.use((req, res, next) => {
  // Set CORS headers for ALL requests (including OPTIONS)
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Content-Disposition');
  
  // Handle OPTIONS preflight requests immediately
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    return res.status(200).end();
  }
  next();
});

// Apply CORS middleware as additional layer
app.use(cors(corsOptions));

// Explicitly handle OPTIONS requests with CORS
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let mongoURI;

if (process.env.NODE_ENV_BUILD === 'production') {
  mongoURI = process.env.MONGODB_PROD_URL;
  console.log('🚀 Using PRODUCTION database');
} else if (process.env.NODE_ENV_BUILD === 'preprod' || process.env.NODE_ENV_BUILD === 'development') {
  mongoURI = process.env.MONGODB_PREPROD_URL;
  console.log('🧪 Using PREPRODUCTION database');
} else {
  mongoURI = process.env.MONGODB_PREPROD_URL;
  console.log('🧰 Using DEVELOPMENT (PREPROD) database');
}

const connectDB = async () => {
  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      dbName: 'app'
    });
    console.log('✅ Connected to MongoDB successfully');
    
    // Fix chassis type indexes on startup
    await fixChassisTypeIndexes();
    
    // Auto-approve all existing offers (migration)
   await autoApproveExistingOffers();
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Fix old shortname index issue for chassis types
const fixChassisTypeIndexes = async () => {
  try {
    const ChassisType = require('./models/chassisType.model');
    const collection = ChassisType.collection;
    
    // Check if old index exists
    const indexes = await collection.indexes();
    const oldIndex = indexes.find(idx => idx.name === 'shortname_1');
    
    if (oldIndex) {
      console.log('🔧 Found old shortname_1 index, fixing...');
      
      // Drop old index
      await collection.dropIndex('shortname_1');
      console.log('✅ Dropped old shortname_1 index');
      
      // Update all records without shortName
      const recordsWithoutShortName = await ChassisType.find({
        $or: [
          { shortName: { $exists: false } },
          { shortName: null },
          { shortName: '' }
        ]
      });
      
      if (recordsWithoutShortName.length > 0) {
        console.log(`🔧 Found ${recordsWithoutShortName.length} chassis types without shortName, updating...`);
        
        for (const record of recordsWithoutShortName) {
          let generatedShortName = '';
          if (record.name) {
            const words = record.name.trim().toUpperCase().split(/\s+/);
            if (words.length === 1) {
              generatedShortName = words[0].substring(0, 4).replace(/[^A-Z0-9]/g, '');
            } else {
              generatedShortName = words.map(w => w.charAt(0)).join('').substring(0, 4);
            }
            if (!generatedShortName) {
              generatedShortName = 'CH' + record._id.toString().substring(0, 2).toUpperCase();
            }
            
            let finalShortName = generatedShortName;
            let counter = 1;
            while (await ChassisType.findOne({ shortName: finalShortName, _id: { $ne: record._id } })) {
              finalShortName = generatedShortName.substring(0, 3) + counter;
              counter++;
            }
            
            record.shortName = finalShortName;
            await record.save();
          }
        }
        console.log(`✅ Updated ${recordsWithoutShortName.length} chassis types with shortNames`);
      }
      
      // Ensure new index exists
      try {
        await collection.createIndex({ shortName: 1 }, { unique: true, name: 'shortName_1' });
        console.log('✅ Created new shortName_1 index');
      } catch (err) {
        if (err.code !== 85) { // 85 = IndexOptionsConflict (index already exists)
          throw err;
        }
      }
    }
  } catch (error) {
    console.error('⚠️  Error fixing chassis type indexes:', error.message);
    // Don't exit - this is not critical for server startup
  }
};

// Auto-approve all existing offers that don't have approval status set
const autoApproveExistingOffers = async () => {
  try {
    const QuotationOffer = require('./models/quotationOffer.model');
    
    // Find all offers where both engineer and management approvals are still pending
    const pendingOffers = await QuotationOffer.find({
      $or: [
        { 'downloadApproval.engineerApproval.status': 'pending' },
        { 'downloadApproval.managementApproval.status': 'pending' },
        { 'downloadApproval': { $exists: false } }
      ]
    });
    
    if (pendingOffers.length === 0) {
      console.log('✅ All offers are already approved or have approval status set');
      return;
    }
    
    console.log(`🔧 Found ${pendingOffers.length} offers with pending approvals, auto-approving...`);
    
    let approvedCount = 0;
    for (const offer of pendingOffers) {
      const updateData = {};
      
      // Set engineer approval to approved if it's pending
      if (!offer.downloadApproval?.engineerApproval || 
          offer.downloadApproval.engineerApproval.status === 'pending') {
        updateData['downloadApproval.engineerApproval.status'] = 'approved';
        updateData['downloadApproval.engineerApproval.approvedAt'] = offer.createdAt || new Date();
        // Keep approvedBy as null for auto-approved offers
      }
      
      // Set management approval to approved if it's pending
      if (!offer.downloadApproval?.managementApproval || 
          offer.downloadApproval.managementApproval.status === 'pending') {
        updateData['downloadApproval.managementApproval.status'] = 'approved';
        updateData['downloadApproval.managementApproval.approvedAt'] = offer.createdAt || new Date();
        // Keep approvedBy as null for auto-approved offers
      }
      
      // Only update if there are changes
      if (Object.keys(updateData).length > 0) {
        await QuotationOffer.findByIdAndUpdate(offer._id, { $set: updateData });
        approvedCount++;
      }
    }
    
    console.log(`✅ Auto-approved ${approvedCount} existing offers`);
  } catch (error) {
    console.error('⚠️  Error auto-approving existing offers:', error.message);
    // Don't exit - this is not critical for server startup
  }
};

connectDB();

app.use('/api/auth', require('./routes/auth'));
// Mount analysis routes BEFORE general quotation routes to ensure they're matched first
app.use('/api/quotations/analysis', require('./routes/quotationAnalysis'));
app.use('/api/quotations', require('./routes/quotation'));
app.use('/api/drawing-specifications', require('./routes/drawingSpecifications'));
app.use('/api/body-types', require('./routes/bodyTypes'));
app.use('/api/chassis-types', require('./routes/chassisTypes'));
app.use('/api/size-types', require('./routes/sizeTypes'));
app.use('/api/feature-types', require('./routes/featureTypes'));
app.use('/api/catalogues', require('./routes/catalogues'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/notes-images', require('./routes/notesImages').router);
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/permission-categories', require("./routes/permissionCategories"));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/rfq', require('./routes/rfqDocuments'));
app.use('/api/rfq', require('./routes/rfq'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/sessions', require('./routes/sessions'));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: `Server is running`,
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.use((err, req, res, next) => {
  // Set CORS headers even on errors
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  console.error('🚨 SERVER ERROR:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV_BUILD === 'development' ? err.message : 'Something went wrong'
  });
});

app.use('*', (req, res) => {
  // Set CORS headers for all requests (including OPTIONS)
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    return res.status(200).end();
  }
  
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const server = http.createServer(app);

const wss = setupNotificationWebsocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔔 Notification WS: ws://localhost:${PORT}/notification`);
});
