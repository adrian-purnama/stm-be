# RFQ (Request for Quotation) System

## Overview

The RFQ system allows users to create quotation requests and have them approved by designated approvers. It includes real-time notifications and WebSocket updates for live synchronization.

## Features

- **Two User Roles**: Requesters and Approvers
- **Real-time Updates**: WebSocket integration for live updates
- **Notifications**: Automatic notifications for RFQ submission, approval, and rejection
- **Permission-based Access**: Role-based access control using permissions
- **Modern UI**: Clean, responsive interface with tabbed navigation

## Database Schema

### RFQ Model (`backend/models/rfq.model.js`)

```javascript
{
  title: String (required),
  approverId: ObjectId (required, ref: 'User'),
  userId: ObjectId (required, ref: 'User'),
  isApproved: Boolean (default: false),
  status: String (enum: ['pending', 'approved', 'rejected'], default: 'pending'),
  description: String (optional),
  approvedAt: Date (optional),
  rejectedAt: Date (optional),
  createdAt: Date,
  updatedAt: Date
}
```

## API Endpoints

### GET `/api/rfq`
- **Description**: Get RFQs based on user role
- **Query Parameters**: 
  - `status` (optional): Filter by status
  - `page` (optional): Page number for pagination
  - `limit` (optional): Items per page
- **Response**: Returns RFQs for the current user (as requester or approver)

### GET `/api/rfq/approvers`
- **Description**: Get users with `approve_rfq` permission
- **Response**: List of users who can approve RFQs

### POST `/api/rfq`
- **Description**: Create a new RFQ
- **Body**:
  ```json
  {
    "title": "string (required)",
    "approverId": "string (required)",
    "description": "string (optional)"
  }
  ```
- **Response**: Created RFQ with populated user data

### PATCH `/api/rfq/:id/approve`
- **Description**: Approve an RFQ
- **Response**: Updated RFQ with approval status

### PATCH `/api/rfq/:id/reject`
- **Description**: Reject an RFQ
- **Response**: Updated RFQ with rejection status

### GET `/api/rfq/pending-count`
- **Description**: Get count of pending RFQs for approver
- **Response**: Number of pending RFQs

## Permissions

### Required Permissions

1. **`approve_rfq`**: Allows users to approve/reject RFQs
2. **`create_rfq`**: Allows users to create RFQ requests

### Setting Up Permissions

Run the setup script to create the required permissions:

```bash
cd backend
npm run setup:rfq
```

This will create:
- RFQ Management permission category
- `approve_rfq` permission
- `create_rfq` permission

## Frontend Components

### RFQPage (`frontend/src/pages/RFQPage.jsx`)
- Main page with two tabs: Request and Approve
- Real-time WebSocket connection status indicator
- Dynamic content based on user role

### RequestRFQModal (`frontend/src/components/RequestRFQModal.jsx`)
- Modal for creating new RFQ requests
- Form validation and error handling
- Custom dropdown for approver selection

## Real-time Features

### WebSocket Integration
- **Connection Status**: Green/red indicator showing WebSocket connection
- **Auto-reconnection**: Automatic reconnection attempts on disconnect
- **Live Updates**: Real-time updates when RFQs are created, approved, or rejected

### Notifications
- **RFQ Submission**: Notifies approver when new RFQ is submitted
- **RFQ Approval**: Notifies requester when RFQ is approved
- **RFQ Rejection**: Notifies requester when RFQ is rejected

## Usage Guide

### Permission-Based Tab Visibility

The system automatically shows tabs based on user permissions:

- **Create Quotation Tab**: Always visible to all users
- **Request Quotation Tab**: Only visible if user has `quotation_create` permission
- **Approve Quotation Tab**: Only visible if user has `approve_rfq` permission

### For Requesters (users with `quotation_create` permission)

1. Navigate to `/quotations` page
2. Click on "Request Quotation" tab (only visible if you have `quotation_create` permission)
3. Click "Request Quotation" button
4. Fill in the form:
   - **Title**: Required field for RFQ title
   - **Approver**: Select from dropdown of users with `approve_rfq` permission
   - **Description**: Optional additional details
5. Submit the RFQ
6. Monitor status in the Request tab (shows only RFQs created by you)

### For Approvers (users with `approve_rfq` permission)

1. Navigate to `/quotations` page
2. Click on "Approve Quotation" tab (only visible if you have `approve_rfq` permission)
3. View pending RFQs with red dot indicator showing count
4. For each pending RFQ:
   - Review the details
   - Click "Approve" or "Reject"
5. Approved/rejected RFQs will show updated status (shows only RFQs assigned to you for approval)

## WebSocket Events

The system uses the existing notification WebSocket for real-time updates:

- **RFQ Created**: Broadcasts to approver
- **RFQ Approved/Rejected**: Broadcasts to requester
- **Connection Status**: Shows real-time connection status

## File Structure

```
backend/
├── models/rfq.model.js          # RFQ database model
├── routes/rfq.js               # RFQ API routes
├── scripts/addRFQPermission.js # Permission setup script
└── README_RFQ.md              # This documentation

frontend/src/
├── pages/quotation/QuotationPage.jsx # Main quotations page with RFQ tabs
├── components/quotations/RequestQuotationTab.jsx # Request RFQ tab component
├── components/quotations/ApproveQuotationTab.jsx # Approve RFQ tab component
├── components/RequestRFQModal.jsx # RFQ creation modal
└── App.jsx                    # Updated with quotations route
```

## Testing

### Manual Testing

1. **Setup Permissions**:
   ```bash
   cd backend
   npm run setup:rfq
   ```

2. **Assign Permissions**:
   - Go to User Management
   - Assign `approve_rfq` permission to test approver
   - Assign `create_rfq` permission to test requester

3. **Test Workflow**:
   - Login as requester
   - Create an RFQ
   - Login as approver
   - Approve/reject the RFQ
   - Check notifications

### WebSocket Testing

- Check connection status indicator (green/red dot)
- Test real-time updates by opening multiple browser tabs
- Verify notifications appear in real-time

## Future Enhancements

- **Comments System**: Add comments to RFQs
- **File Attachments**: Support for document uploads
- **Email Notifications**: Email alerts in addition to in-app notifications
- **RFQ Templates**: Predefined templates for common requests
- **Bulk Operations**: Approve/reject multiple RFQs at once
- **Advanced Filtering**: Filter by date range, status, approver, etc.
- **RFQ History**: Detailed audit trail of all actions
