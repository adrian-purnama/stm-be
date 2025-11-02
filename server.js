const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const http = require('http');
const { setupNotificationWebsocket } = require('./websocket/notificationWebsocket');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [
    process.env.FRONTEND_URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

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
app.use('/api/quotations', require('./routes/quotation'));
app.use('/api/quotations/analysis', require('./routes/quotationAnalysis'));
app.use('/api/drawing-specifications', require('./routes/drawingSpecifications'));
app.use('/api/body-types', require('./routes/bodyTypes'));
app.use('/api/chassis-types', require('./routes/chassisTypes'));
app.use('/api/size-types', require('./routes/sizeTypes'));
app.use('/api/feature-types', require('./routes/featureTypes'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/notes-images', require('./routes/notesImages').router);
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/permission-categories', require("./routes/permissionCategories"));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/rfq', require('./routes/rfq'));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
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
