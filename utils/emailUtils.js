const { sendEmail } = require('./emailConfig');

// Email templates and utility functions

/**
 * Send test email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject (optional)
 * @param {string} message - Email message (optional)
 */
const sendTestEmail = async (to, subject = 'Test Email', message = 'This is a test email from ASB system.') => {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Test Email</h2>
        <p>${message}</p>
        <p style="color: #666; font-size: 12px;">Sent from ASB System at ${new Date().toLocaleString()}</p>
      </div>
    `
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send welcome email to new user
 * @param {string} to - User email
 * @param {string} userName - User's name
 * @param {string} tempPassword - Temporary password (optional)
 */
const sendWelcomeEmail = async (to, userName, tempPassword = null) => {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: 'Welcome to ASB System',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Welcome to ASB System!</h2>
        <p>Hello ${userName},</p>
        <p>Your account has been created successfully. You can now access the ASB system.</p>
        ${tempPassword ? `<p><strong>Temporary Password:</strong> ${tempPassword}</p><p style="color: #dc2626;">Please change your password after first login.</p>` : ''}
        <p>Best regards,<br>ASB Team</p>
        <p style="color: #666; font-size: 12px;">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send password reset email
 * @param {string} to - User email
 * @param {string} userName - User's name
 * @param {string} resetToken - Password reset token
 * @param {string} resetUrl - Password reset URL
 */
const sendPasswordResetEmail = async (to, userName, resetToken, resetUrl) => {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: 'Password Reset Request - ASB System',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Password Reset Request</h2>
        <p>Hello ${userName},</p>
        <p>You have requested to reset your password. Click the link below to reset your password:</p>
        <div style="text-align: center; margin: 20px 0;">
          <a href="${resetUrl}?token=${resetToken}" 
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <p>Best regards,<br>ASB Team</p>
        <p style="color: #666; font-size: 12px;">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send quotation notification email
 * @param {string} to - Recipient email
 * @param {string} quotationNumber - Quotation number
 * @param {string} status - Quotation status
 * @param {string} recipientName - Recipient name
 */
const sendQuotationNotificationEmail = async (to, quotationNumber, status, recipientName) => {
  const statusColors = {
    'pending': '#f59e0b',
    'approved': '#10b981',
    'rejected': '#ef4444',
    'completed': '#8b5cf6'
  };
  
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: `Quotation ${quotationNumber} - ${status.toUpperCase()}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Quotation Update</h2>
        <p>Hello ${recipientName},</p>
        <p>Your quotation <strong>${quotationNumber}</strong> status has been updated to:</p>
        <div style="background-color: ${statusColors[status] || '#6b7280'}; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block; font-weight: bold;">
          ${status.toUpperCase()}
        </div>
        <p>Please log in to the ASB system to view details.</p>
        <p>Best regards,<br>ASB Team</p>
        <p style="color: #666; font-size: 12px;">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send RFQ notification email
 * @param {string} to - Recipient email
 * @param {string} rfqNumber - RFQ number
 * @param {string} message - Notification message
 * @param {string} recipientName - Recipient name
 */
const sendRFQNotificationEmail = async (to, rfqNumber, message, recipientName) => {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: `RFQ ${rfqNumber} - New Request`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">New RFQ Request</h2>
        <p>Hello ${recipientName},</p>
        <p>${message}</p>
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin: 16px 0;">
          <strong>RFQ Number:</strong> ${rfqNumber}
        </div>
        <p>Please log in to the ASB system to respond to this request.</p>
        <p>Best regards,<br>ASB Team</p>
        <p style="color: #666; font-size: 12px;">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send system notification email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} message - Notification message
 * @param {string} recipientName - Recipient name
 * @param {string} priority - Priority level (low, medium, high)
 */
const sendSystemNotificationEmail = async (to, subject, message, recipientName, priority = 'medium') => {
  const priorityColors = {
    'low': '#10b981',
    'medium': '#f59e0b',
    'high': '#ef4444'
  };
  
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: `[${priority.toUpperCase()}] ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">System Notification</h2>
        <p>Hello ${recipientName},</p>
        <div style="background-color: ${priorityColors[priority]}; color: white; padding: 4px 8px; border-radius: 4px; display: inline-block; font-size: 12px; font-weight: bold; margin-bottom: 16px;">
          ${priority.toUpperCase()} PRIORITY
        </div>
        <div style="background-color: #f9fafb; padding: 16px; border-radius: 6px; border-left: 4px solid ${priorityColors[priority]};">
          <p style="margin: 0;">${message}</p>
        </div>
        <p>Best regards,<br>ASB Team</p>
        <p style="color: #666; font-size: 12px;">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send custom email with HTML content
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML content
 * @param {string} fromName - Sender name (optional)
 */
const sendCustomEmail = async (to, subject, htmlContent, fromName = 'ASB System') => {
  const mailOptions = {
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to: to,
    subject: subject,
    html: htmlContent
  };
  
  return await sendEmail(mailOptions);
};

module.exports = {
  sendTestEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendQuotationNotificationEmail,
  sendRFQNotificationEmail,
  sendSystemNotificationEmail,
  sendCustomEmail
};
