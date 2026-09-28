// FILE: backend/src/utils/mailer.js
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const nodemailer = require("nodemailer");

const FROM_NAME = process.env.EMAIL_FROM_NAME || "Smile Jobs";
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_FROM_ADDRESS || "info.smilejobs@gmail.com";
const REPLY_TO = process.env.EMAIL_REPLY_TO || FROM_EMAIL;
const APP_NAME = process.env.APP_NAME || "Smile Jobs";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Brevo API Key (starts with xkeysib- or fallback to SMTP_PASS)
const BREVO_API_KEY = process.env.BREVO_API_KEY || process.env.SMTP_PASS;

/**
 * Validates real email addresses and excludes internal mock handles
 */
const isValidDeliverableEmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (
    clean.endsWith("@phone.verihire.local") ||
    clean.includes("phone.local") ||
    clean.includes("test.local")
  ) {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(clean);
};

/**
 * Send email via Brevo HTTPS REST API (Port 443 - Never blocked on Render/Cloud)
 */
const sendViaBrevoApi = async ({ to, subject, html, text, recipientName = "User" }) => {
  const payload = {
    sender: {
      name: FROM_NAME,
      email: FROM_EMAIL,
    },
    to: [
      {
        email: to.trim(),
        name: recipientName,
      },
    ],
    replyTo: {
      email: REPLY_TO,
      name: FROM_NAME,
    },
    subject: subject.trim(),
    htmlContent: html,
    textContent: text || html.replace(/<[^>]*>/g, ""),
  };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Brevo API Error (${response.status})`);
  }

  return { success: true, messageId: data.messageId };
};

/**
 * Fallback to Nodemailer SMTP if API key is not present
 */
let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp-relay.brevo.com";
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || "587", 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
  });
  return transporter;
};

/**
 * Send a single email (uses Brevo HTTPS API first, SMTP fallback)
 */
const sendEmail = async ({ to, subject, html, text, recipientName }) => {
  try {
    if (!to || !subject || !html) {
      throw new Error("Missing required email fields (to, subject, html)");
    }

    if (!isValidDeliverableEmail(to)) {
      console.log(`⏩ Skipped undeliverable/mock address: [${to}]`);
      return { success: false, error: "Skipped: Not a deliverable address" };
    }

    // Use Brevo HTTPS API if key is configured (Preferred for Render)
    if (BREVO_API_KEY) {
      const result = await sendViaBrevoApi({ to, subject, html, text, recipientName });
      console.log(`📧 [Brevo HTTPS] Dispatch successful: ${to} | ID: ${result.messageId}`);
      return result;
    }

    // SMTP Fallback
    const transport = getTransporter();
    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: to.trim(),
      replyTo: REPLY_TO,
      subject: subject.trim(),
      html,
      text: text || html.replace(/<[^>]*>/g, ""),
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`📧 [SMTP] Dispatch successful: ${to} | ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Dispatch failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send bulk emails in batches
 */
const sendBulkEmail = async (
  recipients,
  subject,
  htmlTemplate,
  batchSize = 10,
  delayMs = 500
) => {
  const results = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const validRecipients = [];
  for (const r of recipients) {
    const email = typeof r === "string" ? r : r?.email;
    if (isValidDeliverableEmail(email)) {
      validRecipients.push(r);
    } else {
      results.skipped++;
    }
  }

  const batches = [];
  for (let i = 0; i < validRecipients.length; i += batchSize) {
    batches.push(validRecipients.slice(i, i + batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    const promises = batch.map(async (recipient) => {
      const email = typeof recipient === "string" ? recipient : recipient.email;
      const name = typeof recipient === "object" ? recipient.name || "User" : "User";
      const phone = typeof recipient === "object" ? recipient.phone || "" : "";
      const city = typeof recipient === "object" ? recipient.city || "" : "";

      const personalizedHtml = htmlTemplate
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{email\}\}/g, email)
        .replace(/\{\{phone\}\}/g, phone)
        .replace(/\{\{city\}\}/g, city)
        .replace(
          /\{\{unsubscribeLink\}\}/g,
          `${FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(email)}`
        );

      const result = await sendEmail({
        to: email,
        subject,
        html: personalizedHtml,
        recipientName: name,
      });

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ email, error: result.error });
      }
    });

    await Promise.all(promises);

    if (batchIndex < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log(
      `📧 Batch Progress: ${batchIndex + 1}/${batches.length} | Sent: ${results.sent} | Failed: ${results.failed} | Skipped: ${results.skipped}`
    );
  }

  return results;
};

/**
 * Verify Connection
 */
const verifyConnection = async () => {
  if (BREVO_API_KEY) {
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": BREVO_API_KEY },
      });
      if (res.ok) {
        const acc = await res.json();
        console.log(`✅ Brevo HTTPS API Connected for account: ${acc.email}`);
        return { success: true };
      }
      const errData = await res.json();
      return { success: false, error: errData.message };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  try {
    const transport = getTransporter();
    await transport.verify();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Startup verification
(async () => {
  const res = await verifyConnection();
  if (res.success) {
    console.log(`✅ Email Delivery Ready (Smile Jobs) — ${FROM_EMAIL}`);
  } else {
    console.warn(`⚠️ Mailer startup notice: ${res.error}`);
  }
})();

/**
 * Branded HTML layout wrapper
 */
const wrapEmailTemplate = (content, options = {}) => {
  const { heading = APP_NAME, footerNote = "", buttonText, buttonUrl } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);padding:32px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${APP_NAME}</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${heading}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;color:#333333;font-size:15px;line-height:1.6;">
              ${content}
              ${
                buttonText && buttonUrl
                  ? `
                <div style="text-align:center;margin:28px 0 8px;">
                  <a href="${buttonUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">
                    ${buttonText}
                  </a>
                </div>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="background-color:#fafafa;padding:20px 24px;text-align:center;border-top:1px solid #eeeeee;">
              ${footerNote ? `<p style="margin:0 0 8px;font-size:12px;color:#666;">${footerNote}</p>` : ""}
              <p style="margin:0;font-size:11px;color:#999;">
                © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.<br>
                Contact: <a href="mailto:${REPLY_TO}" style="color:#4F46E5;text-decoration:none;">${REPLY_TO}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

module.exports = {
  getTransporter,
  sendEmail,
  sendBulkEmail,
  verifyConnection,
  wrapEmailTemplate,
  isValidDeliverableEmail,
};