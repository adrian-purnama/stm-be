// =============================================================================
// ASB BACKEND SERVER - MAIN ENTRY POINT
// =============================================================================
// This file sets up the Express server, database connection, middleware,
// routes, and WebSocket server for the ASB (Automotive Service Business) system.

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

// =============================================================================
// CORS CONFIGURATION
// =============================================================================
// Configure Cross-Origin Resource Sharing to allow specific frontend origins
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

// =============================================================================
// MIDDLEWARE SETUP
// =============================================================================
// Configure body parsing middleware for JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// DATABASE CONNECTION
// =============================================================================
// Establish connection to MongoDB database
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

// =============================================================================
// API ROUTES REGISTRATION
// =============================================================================
// Register all API route modules with their respective base paths
app.use('/api/auth', require('./routes/auth'));                    // Authentication & User Management
app.use('/api/quotations', require('./routes/quotation'));        // Quotation Management
app.use('/api/quotations/analysis', require('./routes/quotationAnalysis')); // Quotation Analytics
app.use('/api/drawing-specifications', require('./routes/drawingSpecifications')); // Drawing Specifications
app.use('/api/truck-types', require('./routes/truckTypes'));      // Truck Type Management
app.use('/api/assets', require('./routes/assets'));              // Asset Management
app.use('/api/notes-images', require('./routes/notesImages').router); // Notes & Images
app.use('/api/permissions', require('./routes/permissions'));     // Permission Management
app.use('/api/permission-categories', require("./routes/permissionCategories")); // Permission Categories
app.use('/api/notifications', require('./routes/notifications')); // Notification System
app.use('/api/rfq', require('./routes/rfq'));                     // Request for Quotation

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
// Public endpoint to check server and database status
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================
// Global error handler for unhandled errors
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

// =============================================================================
// 404 HANDLER
// =============================================================================
// Handle requests to non-existent routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// =============================================================================
// WEBSOCKET SERVER SETUP
// =============================================================================
// Create HTTP server to attach WebSocket server for real-time notifications
const server = http.createServer(app);

// WebSocket server for notifications
const wss = setupNotificationWebsocket(server);

// =============================================================================
// SERVER STARTUP
// =============================================================================
// Start the server and log startup information
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔔 Notification WS: ws://localhost:${PORT}/notification`);
});
