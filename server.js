const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const http = require('http');
const { setupNotificationWebsocket } = require('./websocket/notificationWebsocket');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration - allow specific origins
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    "https://stm-uat.onrender.com",
    "http://localhost:5173"
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/quotations', require('./routes/quotation'));
app.use('/api/quotations/analysis', require('./routes/quotationAnalysis'));
app.use('/api/drawing-specifications', require('./routes/drawingSpecifications'));
app.use('/api/truck-types', require('./routes/truckTypes'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/notes-images', require('./routes/notesImages').router);
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/permission-categories', require("./routes/permissionCategories"));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/rfq', require('./routes/rfq'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Error handling middleware
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
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Create HTTP server to attach WebSocket server
const server = http.createServer(app);

// WebSocket server for notifications
const wss = setupNotificationWebsocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔔 Notification WS: ws://localhost:${PORT}/notification`);
});
