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

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CATALOGUE_URL,
      'http://localhost:5173',
      'https://uat-stm-portal.stm-asb.co.id',
      'https://stm-portal.stm-asb.co.id',
      'http://stm-portal.stm-asb.co.id',
      'http://72.61.208.60:3501',
      'https://be-uat-stm-portal.stm-asb.co.id', // Backend domain (if needed)
    ].filter(Boolean); // Remove undefined/null values
    
    // In development/preprod, allow all origins
    if (process.env.NODE_ENV_BUILD !== 'production') {
      // console.log(`✅ CORS: Allowing origin ${origin} (non-production mode)`);
      return callback(null, true);
    }
    
    // In production, check against allowed list
    if (allowedOrigins.includes(origin)) {
      // console.log(`✅ CORS: Allowing origin ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ CORS: Blocking origin ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Disposition'],
  credentials: true,
  optionsSuccessStatus: 200, // Some browsers expect 200 instead of 204
  preflightContinue: false
};

// Apply CORS middleware BEFORE any routes
app.use(cors(corsOptions));

// Explicitly handle OPTIONS requests BEFORE the catch-all 404 handler
app.options('*', cors(corsOptions));

// Add a manual OPTIONS handler as backup
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    return res.status(200).end();
  }
  next();
});

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
  // Don't interfere with OPTIONS requests
  if (req.method === 'OPTIONS') {
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
