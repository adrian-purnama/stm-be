const { sendEmail } = require('./emailConfig');
const User = require('../models/user.model');

const COMPANY_NAME = 'ASB';
const COMPANY_LOGO_URL = 'https://i.imgur.com/83wJQlA.png';
const BRAND_COLOR = '#b91c1c';
const BRAND_ACCENT = '#fee2e2';
const BASE_BG = '#f8fafc';

/**
 * Check if email should be sent to user
 * @param {string|Object} userOrEmail - User email string or User object/ID
 * @returns {Promise<boolean>} True if email should be sent, false otherwise
 */
const shouldSendEmail = async (userOrEmail) => {
  try {
    let user;
    
    if (typeof userOrEmail === 'string') {
      // If it's an email string, find user by email
      user = await User.findOne({ email: userOrEmail }).select('sendToEmail');
    } else if (userOrEmail && userOrEmail._id) {
      // If it's a user object with _id, use it directly
      user = userOrEmail.sendToEmail !== undefined ? userOrEmail : await User.findById(userOrEmail._id).select('sendToEmail');
    } else if (userOrEmail && typeof userOrEmail.toString === 'function') {
      // If it's an ObjectId, find user by ID
      user = await User.findById(userOrEmail).select('sendToEmail');
    }
    
    // Default to true if user not found or sendToEmail not set
    return user ? (user.sendToEmail !== false) : true;
  } catch (error) {
    console.error('Error checking sendToEmail preference:', error);
    // Default to true on error
    return true;
  }
};

const buildEmailTemplate = (title, bodyHtml) => `
  <div style="background-color:${BASE_BG};padding:24px;font-family:'Segoe UI',Arial,sans-serif;">
    <table style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND_ACCENT};box-shadow:0 12px 30px rgba(185,28,28,0.12);">
      <thead>
        <tr>
          <td style="background:${BRAND_COLOR};padding:24px;text-align:center;">
            <img src="${COMPANY_LOGO_URL}" alt="${COMPANY_NAME} Logo" style="height:56px;display:block;margin:0 auto 8px;" />
            ${title ? `<h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:600;">${title}</h1>` : ''}
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:24px;color:#1f2937;font-size:15px;line-height:1.7;">
            ${bodyHtml}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td style="padding:16px 24px;background:#fff5f5;color:${BRAND_COLOR};font-size:12px;text-align:center;border-top:1px solid ${BRAND_ACCENT};">
            This is an automated message from ${COMPANY_NAME}. Please do not reply to this email.
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
`;

const badge = (label) => `
  <span style="display:inline-block;margin-top:16px;padding:8px 14px;background:${BRAND_ACCENT};color:${BRAND_COLOR};border-radius:999px;font-weight:600;letter-spacing:0.5px;">
    ${label}
  </span>
`;

/**
 * Send test email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject (optional)
 * @param {string} message - Email message (optional)
 */
const sendTestEmail = async (to, subject = 'Test Email', message = 'This is a test email from ASB system.') => {
  const contentHtml = `
    <p style="margin:0 0 16px 0;">${message}</p>
    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">Sent from ${COMPANY_NAME} System at ${new Date().toLocaleString()}</p>
  `;

  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject,
    html: buildEmailTemplate(subject, contentHtml)
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
  // Check if user wants to receive emails
  const canSend = await shouldSendEmail(to);
  if (!canSend) {
    console.log(`Email sending disabled for user: ${to}`);
    return { skipped: true, message: 'Email sending disabled by user preference' };
  }

  const contentHtml = `
    <p style="margin:0 0 16px 0;">Hello ${userName},</p>
    <p style="margin:0 0 16px 0;">Your account has been created successfully. You can now access the ${COMPANY_NAME} system.</p>
    ${tempPassword ? `<div style="margin:24px 0;padding:16px 20px;background:${BRAND_ACCENT};border-radius:10px;border:1px solid rgba(185,28,28,0.15);"><p style="margin:0;font-size:14px;color:${BRAND_COLOR};"><strong>Temporary Password:</strong> ${tempPassword}</p><p style="margin:8px 0 0 0;font-size:13px;color:#6b7280;">Please change your password after your first login.</p></div>` : ''}
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Best regards,<br />${COMPANY_NAME} Team</p>
  `;

  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject: `Welcome to ${COMPANY_NAME} System`,
    html: buildEmailTemplate('Welcome to ASB System!', contentHtml)
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send password reset email
 * @param {string} to - User email
 * @param {string} userName - User's name
 * @param {string} otp - One-time password code
 * @param {string} frontendUrl - Frontend base URL
 * @param {string} email - Recipient email
 */
const sendPasswordResetEmail = async (to, userName, otp, frontendUrl, email) => {
  const safeFrontendUrl = (frontendUrl || '').replace(/\/$/, '');
  const resetLink = `${safeFrontendUrl}/reset-password?email=${encodeURIComponent(email)}`;
  const contentHtml = `
    <p style="margin:0 0 16px 0;">Hello ${userName},</p>
    <p style="margin:0 0 16px 0;">You requested to reset your password. Use the OTP below (valid for 5 minutes):</p>
    <div style="text-align:center;margin:24px 0;">
      <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND_COLOR};padding:12px 24px;border:2px solid ${BRAND_COLOR};border-radius:12px;background:${BRAND_ACCENT};">
        ${otp}
      </span>
    </div>
    <p style="margin:0 0 16px 0;">Or click the link below to reset directly:</p>
    <div style="text-align:center;margin:16px 0 24px 0;">
      <a href="${resetLink}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;">
        Reset Password
      </a>
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px;">If you didn’t request this, you can ignore this message.</p>
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Best regards,<br />${COMPANY_NAME} Team</p>
  `;
 
  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject: 'Password Reset Request - ASB System',
    html: buildEmailTemplate('Password Reset Request', contentHtml)
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
  // Check if user wants to receive emails
  const canSend = await shouldSendEmail(to);
  if (!canSend) {
    console.log(`Email sending disabled for user: ${to}`);
    return { skipped: true, message: 'Email sending disabled by user preference' };
  }

  const statusLabel = (status || '').toUpperCase();
  const contentHtml = `
    <p style="margin:0 0 16px 0;">Hello ${recipientName},</p>
    <p style="margin:0 0 16px 0;">Quotation <strong>${quotationNumber}</strong> status has been updated to:</p>
    ${badge(statusLabel || 'UPDATED')}
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Please log in to the ${COMPANY_NAME} system to view more details.</p>
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Best regards,<br />${COMPANY_NAME} Team</p>
  `;

  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject: `Quotation ${quotationNumber} - ${statusLabel || 'UPDATE'}`,
    html: buildEmailTemplate('Quotation Update', contentHtml)
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
  // Check if user wants to receive emails
  const canSend = await shouldSendEmail(to);
  if (!canSend) {
    console.log(`Email sending disabled for user: ${to}`);
    return { skipped: true, message: 'Email sending disabled by user preference' };
  }

  const contentHtml = `
    <p style="margin:0 0 16px 0;">Hello ${recipientName},</p>
    <p style="margin:0 0 16px 0;">${message}</p>
    <div style="margin:24px 0;padding:16px 20px;background:${BRAND_ACCENT};border-radius:10px;border:1px solid rgba(185,28,28,0.15);">
      <strong>RFQ Number:</strong> ${rfqNumber}
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px;">Please log in to the ${COMPANY_NAME} system for further action.</p>
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Best regards,<br />${COMPANY_NAME} Team</p>
  `;

  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject: `RFQ ${rfqNumber} - Notification`,
    html: buildEmailTemplate('RFQ Notification', contentHtml)
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
  // Check if user wants to receive emails
  const canSend = await shouldSendEmail(to);
  if (!canSend) {
    console.log(`Email sending disabled for user: ${to}`);
    return { skipped: true, message: 'Email sending disabled by user preference' };
  }

  const contentHtml = `
    <p style="margin:0 0 16px 0;">Hello ${recipientName},</p>
    <p style="margin:0 0 16px 0;">${message}</p>
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Best regards,<br />${COMPANY_NAME} Team</p>
  `;

  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject: `[${priority.toUpperCase()}] ${subject}`,
    html: buildEmailTemplate('System Notification', contentHtml)
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
  // Check if user wants to receive emails
  const canSend = await shouldSendEmail(to);
  if (!canSend) {
    console.log(`Email sending disabled for user: ${to}`);
    return { skipped: true, message: 'Email sending disabled by user preference' };
  }

  const mailOptions = {
    from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
    to,
    subject,
    html: buildEmailTemplate(subject, htmlContent)
  };
  
  return await sendEmail(mailOptions);
};

/**
 * Send broadcast email to multiple users
 * @param {string[]} userIds - Array of user IDs to send email to
 * @param {string} subject - Email subject
 * @param {string} message - Email message
 * @returns {Promise<Object>} Result with sent, skipped, and failed counts
 */
const sendBroadcastEmail = async (userIds, subject, message) => {
  const results = {
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  if (!userIds || userIds.length === 0) {
    console.log('[BroadcastEmail] No user IDs provided');
    return results;
  }

  console.log(`[BroadcastEmail] Starting broadcast to ${userIds.length} users`);

  // Fetch all users
  const users = await User.find({ _id: { $in: userIds } }).select('email fullName sendToEmail');
  
  if (!users || users.length === 0) {
    console.log('[BroadcastEmail] No users found for provided IDs');
    return results;
  }

  console.log(`[BroadcastEmail] Found ${users.length} users to send emails to`);

  // Send emails in parallel and collect results properly
  const emailResults = await Promise.allSettled(
    users.map(async (user) => {
      try {
        // Log user details for debugging
        console.log(`[BroadcastEmail] Processing user: ${user.email || 'no email'}, sendToEmail: ${user.sendToEmail}, fullName: ${user.fullName || 'N/A'}`);

        // Check if user has email address first
        if (!user.email || !user.email.trim()) {
          console.log(`[BroadcastEmail] ⚠️ Skipping user ${user._id} - no email address`);
          return { success: false, skipped: true, email: null, reason: 'No email address' };
        }

        // Check if user wants to receive emails
        // sendToEmail defaults to true, so only skip if explicitly false
        if (user.sendToEmail === false) {
          console.log(`[BroadcastEmail] ⚠️ Skipping ${user.email} - email notifications disabled (sendToEmail: false)`);
          return { success: false, skipped: true, email: user.email, reason: 'Email notifications disabled' };
        }

        const contentHtml = `
          <p style="margin:0 0 16px 0;">Hello ${user.fullName || user.email},</p>
          <p style="margin:0 0 16px 0;">${message}</p>
          <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Best regards,<br />${COMPANY_NAME} Team</p>
        `;

        const mailOptions = {
          from: `"ASB-Portal" <${process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'}>`,
          to: user.email,
          subject,
          html: buildEmailTemplate(subject, contentHtml)
        };

        console.log(`[BroadcastEmail] Sending email to ${user.email}...`);
        const emailResult = await sendEmail(mailOptions);
        
        if (emailResult && emailResult.success) {
          console.log(`[BroadcastEmail] ✅ Email sent successfully to ${user.email}`);
          return { success: true, email: user.email };
        } else {
          const errorMsg = emailResult?.error || 'Unknown error';
          console.error(`[BroadcastEmail] ❌ Failed to send to ${user.email}:`, errorMsg);
          return { success: false, error: errorMsg, email: user.email };
        }
      } catch (error) {
        console.error(`[BroadcastEmail] ❌ Exception sending to ${user.email}:`, error);
        return { 
          success: false, 
          error: error.message || 'Unknown error', 
          email: user.email 
        };
      }
    })
  );

  // Process results
  emailResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const emailResult = result.value;
      if (emailResult.skipped) {
        results.skipped++;
        console.log(`[BroadcastEmail] ⚠️ Skipped: ${emailResult.email || 'no email'} - ${emailResult.reason || 'unknown reason'}`);
      } else if (emailResult.success) {
        results.sent++;
      } else {
        results.failed++;
        if (emailResult.email) {
          results.errors.push({ 
            email: emailResult.email, 
            error: emailResult.error || 'Unknown error' 
          });
        }
      }
    } else {
      // Promise was rejected
      results.failed++;
      const user = users[index];
      const errorMsg = result.reason?.message || 'Promise rejected';
      console.error(`[BroadcastEmail] ❌ Promise rejected for ${user?.email || 'unknown'}:`, errorMsg);
      results.errors.push({ 
        email: user?.email || 'Unknown', 
        error: errorMsg
      });
    }
  });

  console.log(`[BroadcastEmail] 📊 Final Summary: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`);
  if (results.errors.length > 0) {
    console.log(`[BroadcastEmail] ❌ Errors:`, results.errors);
  }
  return results;
};

module.exports = {
  sendTestEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendQuotationNotificationEmail,
  sendRFQNotificationEmail,
  sendSystemNotificationEmail,
  sendCustomEmail,
  sendBroadcastEmail
};
