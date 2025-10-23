# ASB Backend Permissions Documentation

This document provides a comprehensive overview of all permissions used in the ASB backend system.

## Permission Categories

### 1. User Management (`user_*`)
- `user_view` - View user accounts
- `user_create` - Create new user accounts
- `user_edit` - Edit existing user accounts
- `user_delete` - Delete user accounts
- `user_manage` - Manage user permissions and roles

### 2. Role Management (`role_*`)
- `role_view` - View roles and permissions
- `role_create` - Create new roles
- `role_edit` - Edit existing roles
- `role_delete` - Delete roles

### 3. Truck Management (`truck_*`)
- `truck_view` - View truck types
- `truck_create` - Create new truck types
- `truck_edit` - Edit existing truck types
- `truck_delete` - Delete truck types

### 4. Drawing Management (`drawing_*`)
- `drawing_view` - View drawing specifications
- `drawing_create` - Create new drawing specifications
- `drawing_edit` - Edit existing drawing specifications
- `drawing_delete` - Delete drawing specifications

### 5. Quotation Management (`quotation_*`)
- `quotation_view` - View quotations
- `quotation_create` - Create new quotations
- `quotation_edit` - Edit existing quotations
- `quotation_delete` - Delete quotations
- `quotation_admin` - Full quotation administration
- `all_quotation_viewer` - View all quotations regardless of role

### 6. RFQ Management (`rfq_*`)
- `quotation_requester` - Create and manage RFQs
- `approve_rfq` - Approve/reject RFQs

### 7. Notes Management (`notes_*`)
- `notes_view` - View notes and images
- `notes_create` - Create new notes and images
- `notes_edit` - Edit existing notes and images
- `notes_delete` - Delete notes and images

### 8. Analytics (`analytics_*`)
- `analytics_view` - View analytics and reports

### 9. System Administration (`system_*`)
- `admin` - Full system administration
- `manager` - Management level access

## Route Permissions Summary

### Authentication Routes (`/api/auth`)
- `GET /registration-status` - None (Public)
- `POST /register` - None (Public - first user only)
- `POST /login` - None (Public)
- `GET /profile` - Any authenticated user
- `PUT /profile` - Any authenticated user
- `POST /reset-password` - Any authenticated user
- `GET /users` - `user_view`
- `PUT /users/:id` - `user_manage`
- `DELETE /users/:id` - `user_delete`
- `POST /users` - `user_create`
- `POST /users/:id/copy` - `user_create`
- `POST /users/:id/reset-password` - `user_manage`
- `GET /users/:id/permissions` - `user_view`
- `GET /ispermission/:permission` - Any authenticated user

### Quotation Routes (`/api/quotations`)
- `GET /` - `placeholder_test` (should be `quotation_view`)
- `GET /all` - `all_quotation_viewer`
- `POST /` - `quotation_create`
- `GET /by-id/:quotationId` - `placeholder_test` (should be `quotation_view`)
- `GET /:quotationNumber` - `placeholder_test` (should be `quotation_view`)
- `PUT /:quotationNumber` - `placeholder_test` (should be `quotation_edit`)
- `DELETE /:quotationNumber` - `placeholder_test` (should be `quotation_delete`)
- `PATCH /:quotationNumber/status` - `placeholder_test` (should be `quotation_edit`)
- `GET /:quotationNumber/offers` - `placeholder_test` (should be `quotation_view`)
- `POST /:quotationId/offers` - `placeholder_test` (should be `quotation_edit`)
- `PUT /:quotationId/offers/:offerId` - `placeholder_test` (should be `quotation_edit`)
- `DELETE /:quotationId/offers/:offerId` - `placeholder_test` (should be `quotation_delete`)
- `GET /:quotationNumber/offers/:offerId/items` - `placeholder_test` (should be `quotation_view`)
- `POST /:quotationNumber/offers/:offerId/items` - `placeholder_test` (should be `quotation_edit`)
- `PUT /:quotationNumber/offers/:offerId/items/:itemId` - `placeholder_test` (should be `quotation_edit`)
- `DELETE /:quotationNumber/offers/:offerId/items/:itemId` - `placeholder_test` (should be `quotation_delete`)
- `PATCH /:quotationNumber/offers/:offerId/items/:itemId/accept` - `placeholder_test` (should be `quotation_edit`)
- `POST /:quotationNumber/progress` - `placeholder_test` (should be `quotation_edit`)
- `PATCH /:quotationNumber/follow-up` - `placeholder_test` (should be `quotation_edit`)
- `GET /generate/number` - `placeholder_test` (should be `quotation_create`)
- `POST /migrate/offer-numbers` - `admin`

### RFQ Routes (`/api/rfq`)
- `GET /approvers` - Any authenticated user
- `GET /quotation-creators` - Any authenticated user
- `GET /approved-for-quotation` - `quotation_create`
- `GET /` - Any authenticated user (role-based filtering)
- `POST /` - `quotation_requester`
- `PATCH /:id/approve` - `approve_rfq`
- `PATCH /:id/reject` - `approve_rfq`
- `GET /pending-count` - Any authenticated user
- `GET /approved-for-quotation` - Any authenticated user
- `GET /:id/items` - Any authenticated user
- `POST /:id/items` - `quotation_requester`
- `PUT /items/:itemId` - `quotation_requester`
- `DELETE /items/:itemId` - `quotation_requester`
- `GET /:id` - Any authenticated user

### Drawing Specification Routes (`/api/drawing-specifications`)
- `GET /` - `placeholder_test` (should be `drawing_view`)
- `GET /:id` - `placeholder_test` (should be `drawing_view`)
- `POST /` - `placeholder_test` (should be `drawing_create`)
- `PUT /:id` - `placeholder_test` (should be `drawing_edit`)
- `POST /:id/files` - `placeholder_test` (should be `drawing_edit`)
- `PUT /:id/files/:fileId/replace` - `placeholder_test` (should be `drawing_edit`)
- `DELETE /:id/files/:fileId` - `placeholder_test` (should be `drawing_edit`)
- `DELETE /:id` - `placeholder_test` (should be `drawing_delete`)
- `POST /cleanup-orphaned-chunks` - `placeholder_test` (should be `admin`)

### Truck Type Routes (`/api/truck-types`)
- `GET /` - `truck_view`
- `GET /:id` - `truck_view`
- `POST /` - `truck_create`
- `PUT /:id` - `truck_edit`
- `DELETE /:id` - `truck_delete`

### Permission Routes (`/api/permissions`)
- `GET /` - `permission_view`
- `GET /:id` - `permission_view`
- `POST /` - `permission_create`
- `PUT /:id` - `permission_edit`
- `DELETE /:id` - `permission_delete`

### Permission Category Routes (`/api/permission-categories`)
- `GET /` - `permission_view`
- `GET /:id` - `permission_view`
- `POST /` - `permission_create`
- `PUT /:id` - `permission_edit`
- `DELETE /:id` - `permission_delete`

### Notification Routes (`/api/notifications`)
- `GET /` - Any authenticated user
- `PATCH /:id/read` - Any authenticated user
- `DELETE /:id` - Any authenticated user

### Asset Routes (`/api/assets`)
- `GET /:filename` - Any authenticated user
- `POST /upload` - Any authenticated user

### Notes Image Routes (`/api/notes-images`)
- `GET /` - Any authenticated user
- `POST /` - Any authenticated user
- `DELETE /:id` - Any authenticated user

## Notes

1. **Temporary Permissions**: Many routes currently use `placeholder_test` as a temporary permission. These should be replaced with proper permissions:
   - Quotation routes should use `quotation_view`, `quotation_edit`, `quotation_create`, `quotation_delete`
   - Drawing specification routes should use `drawing_view`, `drawing_edit`, `drawing_create`, `drawing_delete`

2. **Role-Based Filtering**: Some routes implement role-based filtering where the same endpoint returns different data based on user permissions (e.g., quotation listing).

3. **Admin Permissions**: Some routes require `admin` permission for system-level operations.

4. **Public Endpoints**: Only authentication-related endpoints (`/api/auth/registration-status`, `/api/auth/register`, `/api/auth/login`) are public.

5. **Health Check**: The `/api/health` endpoint is public and doesn't require authentication.

