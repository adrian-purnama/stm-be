# ASB Backend Server

This is the backend server for the ASB (Automotive Service Business) system, built with Node.js, Express.js, and MongoDB.

## Project Structure

```
backend/
├── middleware/           # Authentication and authorization middleware
│   └── auth.js          # JWT authentication and permission checking
├── models/              # Mongoose data models
│   ├── user.model.js           # User account model
│   ├── permission.model.js     # Permission model
│   ├── permissionCategory.model.js # Permission category model
│   ├── quotationHeader.model.js    # Quotation header model
│   ├── quotationOffer.model.js     # Quotation offer model
│   ├── offerItem.model.js          # Offer item model
│   ├── rfq.model.js               # Request for Quotation model
│   ├── truckType.model.js         # Truck type model
│   ├── drawingSpecification.model.js # Drawing specification model
│   ├── notesImage.model.js        # Notes and images model
│   └── notification.model.js      # Notification model
├── routes/              # API route handlers
│   ├── auth.js                    # Authentication & user management
│   ├── quotation.js              # Quotation management
│   ├── quotationAnalysis.js      # Quotation analytics
│   ├── rfq.js                    # Request for Quotation
│   ├── drawingSpecifications.js  # Drawing specifications
│   ├── truckTypes.js             # Truck type management
│   ├── permissions.js            # Permission management
│   ├── permissionCategories.js  # Permission category management
│   ├── notifications.js         # Notification system
│   ├── assets.js                # Asset management
│   └── notesImages.js           # Notes and images
├── utils/               # Utility functions
│   ├── auth.js                  # Authentication utilities
│   ├── jwtHelper.js            # JWT token management
│   ├── errorHandler.js         # Error handling utilities
│   ├── userHelper.js           # User management utilities
│   ├── quotationHelper.js      # Quotation management utilities
│   ├── rfqHelper.js            # RFQ management utilities
│   ├── permissionHelper.js     # Permission management utilities
│   ├── notificationHelper.js   # Notification utilities
│   ├── gridfsHelper.js         # GridFS file storage utilities
│   ├── contentTypeHelper.js    # Content type utilities
│   └── notesImageCleanup.js    # Notes image cleanup utilities
├── websocket/           # WebSocket server for real-time notifications
│   └── notificationWebsocket.js
├── scripts/             # Utility scripts
│   ├── addRFQPermission.js     # Add RFQ permissions script
│   └── sendTestNotification.js # Test notification script
├── server.js            # Main server entry point
├── package.json         # Dependencies and scripts
└── README.md           # This file
```

## Key Features

### 1. Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Permission-based authorization
- User management with role assignment

### 2. Quotation Management
- Create, read, update, delete quotations
- Multiple offers per quotation
- Offer items with specifications
- Status tracking and workflow management
- Role-based filtering (requester, creator, approver, admin)

### 3. Request for Quotation (RFQ)
- RFQ creation and management
- Approval/rejection workflow
- Role-based access (requester, approver, creator)
- Notification system integration

### 4. Drawing Specifications
- Drawing specification management
- File upload support (PDF, DWG, DXF, images)
- GridFS storage for large files
- Truck type associations

### 5. Truck Type Management
- Truck type CRUD operations
- Category-based organization
- Drawing specification associations

### 6. Permission System
- Granular permission management
- Permission categories
- Role-based permission assignment
- Dynamic permission checking

### 7. Notification System
- Real-time WebSocket notifications
- Email notifications
- Notification management
- User-specific notifications

### 8. File Management
- GridFS for large file storage
- Multiple file format support
- File cleanup utilities
- Asset serving

## API Endpoints

### Authentication (`/api/auth`)
- `POST /login` - User login
- `POST /register` - User registration (first user only)
- `GET /profile` - Get user profile
- `PUT /profile` - Update user profile
- `POST /reset-password` - Reset password
- `GET /users` - List users (admin)
- `POST /users` - Create user (admin)
- `PUT /users/:id` - Update user (admin)
- `DELETE /users/:id` - Delete user (admin)

### Quotations (`/api/quotations`)
- `GET /` - List quotations (role-based filtering)
- `GET /all` - List all quotations (special permission)
- `POST /` - Create quotation
- `GET /:quotationNumber` - Get quotation
- `PUT /:quotationNumber` - Update quotation
- `DELETE /:quotationNumber` - Delete quotation
- `PATCH /:quotationNumber/status` - Update status

### RFQ (`/api/rfq`)
- `GET /` - List RFQs (role-based filtering)
- `POST /` - Create RFQ
- `PATCH /:id/approve` - Approve RFQ
- `PATCH /:id/reject` - Reject RFQ
- `GET /:id/items` - Get RFQ items

### Drawing Specifications (`/api/drawing-specifications`)
- `GET /` - List drawing specifications
- `POST /` - Create drawing specification
- `GET /:id` - Get drawing specification
- `PUT /:id` - Update drawing specification
- `DELETE /:id` - Delete drawing specification

### Truck Types (`/api/truck-types`)
- `GET /` - List truck types
- `POST /` - Create truck type
- `GET /:id` - Get truck type
- `PUT /:id` - Update truck type
- `DELETE /:id` - Delete truck type

## Environment Variables

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/asb
JWT_SECRET=your_jwt_secret
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the server:
```bash
npm start
# or for development
npm run dev
```

## Database Setup

The system automatically seeds the database with:
- Permission categories
- Individual permissions
- Default roles
- Admin user (if no users exist)

## Security Features

- JWT token authentication
- Password hashing with bcrypt
- CORS configuration
- Input validation
- SQL injection prevention
- File upload security

## Development

- ES6+ JavaScript
- Express.js framework
- MongoDB with Mongoose ODM
- JWT for authentication
- WebSocket for real-time features
- GridFS for file storage

## API Documentation

See `PERMISSIONS_DOCUMENTATION.md` for detailed permission requirements for each endpoint.

## Health Check

- `GET /api/health` - Server and database status

