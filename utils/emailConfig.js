const SibApiV3Sdk = require('sib-api-v3-sdk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Brevo API client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// Get TransactionalEmailsApi instance
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const mask = (value = '') => {
  if (!value) return '[empty]';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
};

// Parse sender string (e.g., "Name <email@example.com>") or use default
const parseSender = (fromString) => {
  if (!fromString) {
    return {
      name: 'ASB-Portal',
      email: process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'
    };
  }
  
  // Check if it's in format "Name <email@example.com>"
  const match = fromString.match(/^"?([^"<]+)"?\s*<(.+)>$/);
  if (match) {
    return {
      name: match[1].trim(),
      email: match[2].trim()
    };
  }
  
  // If it's just an email
  if (fromString.includes('@')) {
    return {
      name: 'ASB-Portal',
      email: fromString.trim()
    };
  }
  
  return {
    name: fromString,
    email: process.env.BREVO_SENDER_EMAIL || 'noreply@asb.com'
  };
};

// Test email configuration
const testEmailConfig = async () => {
  try {
    console.log('[EmailConfig] Testing Brevo email configuration…');
    if (!process.env.BREVO_API_KEY) {
      console.warn('[EmailConfig] ⚠️ Missing BREVO_API_KEY env variable.');
      return false;
    }

    console.log('[EmailConfig] Using Brevo API key:', mask(process.env.BREVO_API_KEY));
    
    // Test by getting account info
    const accountApi = new SibApiV3Sdk.AccountApi();
    const accountInfo = await accountApi.getAccount();
    console.log('[EmailConfig] ✅ Brevo API connection succeeded');
    console.log('[EmailConfig] Account email:', accountInfo.email);
    return true;
  } catch (error) {
    console.error('[EmailConfig] ❌ Brevo API configuration error:', error.message);
    return false;
  }
};

// Send email function using Brevo Transactional API
const sendEmail = async (mailOptions) => {
  console.log('[EmailConfig] Preparing to send email via Brevo…');
  try {
    if (!process.env.BREVO_API_KEY) {
      console.warn('[EmailConfig] ⚠️ Email credentials not configured (BREVO_API_KEY). Skipping email send.');
      return { success: false, error: 'Email credentials not configured' };
    }

    // Parse sender information
    const sender = parseSender(mailOptions?.from);
    
    // Parse recipient(s) - can be string or array
    const recipients = Array.isArray(mailOptions?.to) 
      ? mailOptions.to 
      : [mailOptions?.to].filter(Boolean);

    if (recipients.length === 0) {
      console.warn('[EmailConfig] ⚠️ No recipients specified');
      return { success: false, error: 'No recipients specified' };
    }

    console.log('[EmailConfig] Mail options snapshot:', {
      from: `${sender.name} <${sender.email}>`,
      to: recipients,
      subject: mailOptions?.subject
    });

    // Create sendSmtpEmail object for Brevo
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    
    sendSmtpEmail.sender = {
      name: sender.name,
      email: sender.email
    };
    
    sendSmtpEmail.to = recipients.map(email => ({ email }));
    
    sendSmtpEmail.subject = mailOptions?.subject || 'No Subject';
    sendSmtpEmail.htmlContent = mailOptions?.html || mailOptions?.text || '';
    
    // Add text content if provided (for plain text fallback)
    if (mailOptions?.text && !mailOptions?.html) {
      sendSmtpEmail.textContent = mailOptions.text;
    }

    // Add reply-to if specified
    if (mailOptions?.replyTo) {
      sendSmtpEmail.replyTo = parseSender(mailOptions.replyTo);
    }

    // Add CC if specified
    if (mailOptions?.cc) {
      const ccRecipients = Array.isArray(mailOptions.cc) 
        ? mailOptions.cc 
        : [mailOptions.cc];
      sendSmtpEmail.cc = ccRecipients.map(email => ({ email }));
    }

    // Add BCC if specified
    if (mailOptions?.bcc) {
      const bccRecipients = Array.isArray(mailOptions.bcc) 
        ? mailOptions.bcc 
        : [mailOptions.bcc];
      sendSmtpEmail.bcc = bccRecipients.map(email => ({ email }));
    }

    console.log('[EmailConfig] Sending email via Brevo API…');
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('[EmailConfig] 📧 Email sent successfully. Message ID:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('[EmailConfig] ❌ Failed to send email:', error);
    return { 
      success: false, 
      error: error.message || error.response?.body?.message || 'Unknown error' 
    };
  }
};

module.exports = {
  testEmailConfig,
  sendEmail
};


