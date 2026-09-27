// FILE: backend/src/utils/mailer.js
const nodemailer = require("nodemailer");

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  return transporter;
};

/**
 * Send a single email
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transport = getTransporter();
    const fromName = process.env.EMAIL_FROM_NAME || "CareerFlow";
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER;

    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to,
      subject,
      html,
      text: text || subject,
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send bulk emails (batched to avoid rate limits)
 * @param {Array} recipients - Array of { email, name }
 * @param {string} subject
 * @param {string} htmlTemplate - Use {{name}} and {{email}} as placeholders
 * @param {number} batchSize - Emails per batch (default: 10)
 * @param {number} delayMs - Delay between batches in ms (default: 2000)
 */
const sendBulkEmail = async (
  recipients,
  subject,
  htmlTemplate,
  batchSize = 10,
  delayMs = 2000
) => {
  const results = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    errors: [],
  };

  // Split into batches
  const batches = [];
  for (let i = 0; i < recipients.length; i += batchSize) {
    batches.push(recipients.slice(i, i + batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    const promises = batch.map(async (recipient) => {
      // Replace placeholders in template
      let personalizedHtml = htmlTemplate
        .replace(/\{\{name\}\}/g, recipient.name || "User")
        .replace(/\{\{email\}\}/g, recipient.email || "")
        .replace(/\{\{phone\}\}/g, recipient.phone || "")
        .replace(/\{\{city\}\}/g, recipient.city || "")
        .replace(/\{\{unsubscribeLink\}\}/g, `${process.env.FRONTEND_URL || "https://careerflow.app"}/unsubscribe?email=${encodeURIComponent(recipient.email)}`);

      const result = await sendEmail({
        to: recipient.email,
        subject,
        html: personalizedHtml,
      });

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ email: recipient.email, error: result.error });
      }
    });

    await Promise.all(promises);

    // Delay between batches to avoid rate limits
    if (batchIndex < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log(
      `📧 Batch ${batchIndex + 1}/${batches.length} complete — Sent: ${results.sent}, Failed: ${results.failed}`
    );
  }

  return results;
};

/**
 * Verify SMTP connection
 */
const verifyConnection = async () => {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log("✅ SMTP connection verified");
    return { success: true };
  } catch (error) {
    console.error("❌ SMTP connection failed:", error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendEmail, sendBulkEmail, verifyConnection, getTransporter };