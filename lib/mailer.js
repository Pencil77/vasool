const nodemailer = require('nodemailer');

function createTransporter() {
  const user = process.env.GMAIL_USER || 'mrzoromit3@gmail.com';
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();

  if (!pass) {
    console.warn('[mailer] Warning: GMAIL_APP_PASSWORD is not set. Outgoing emails will be logged only.');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for 587 (STARTTLS)
    auth: {
      user: user,
      pass: pass
    },
    tls: {
      rejectUnauthorized: true
    }
  });
}

/**
 * Sends a hybrid email verification message containing both:
 * 1. A prominent 6-digit OTP code for on-screen entry.
 * 2. A 1-click magic link button for instant browser verification.
 */
async function sendVerificationEmail({ email, name, otp, token }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool-ecru.vercel.app').replace(/\/+$/, '');
  const magicLink = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const senderEmail = process.env.GMAIL_USER || 'mrzoromit3@gmail.com';
  const formattedFrom = `"Vasool" <${senderEmail}>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your Vasool account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #060b16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #060b16; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 540px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          <!-- Header Banner -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; background: linear-gradient(135deg, #0f172a 0%, #13213c 100%); border-bottom: 1px solid #1e293b;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 40px; height: 40px; background: linear-gradient(135deg, #10b981 0%, #0d9488 100%); border-radius: 12px; text-align: center; line-height: 40px; font-weight: bold; font-size: 20px; color: #022c22; vertical-align: middle;">
                      ₹
                    </div>
                    <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; margin-left: 12px; vertical-align: middle;">
                      Vasool
                    </span>
                  </td>
                </tr>
              </table>
              <h1 style="margin: 20px 0 6px 0; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                Verify your email address
              </h1>
              <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                One quick step to activate your account and start managing shared expenses.
              </p>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 28px 32px 32px 32px;">
              <p style="margin: 0 0 20px 0; font-size: 14px; color: #cbd5e1; line-height: 1.6;">
                Hi <strong>${name || 'there'}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                Thanks for joining Vasool! You can verify your email using either the <strong>6-digit code</strong> on your screen or by clicking the <strong>direct verification button</strong> below.
              </p>

              <!-- Option 1: 6-Digit OTP Box -->
              <div style="background-color: #0b1324; border: 1px solid #1e293b; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; margin-bottom: 8px;">
                  Your 6-Digit Verification Code
                </div>
                <div style="font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #ffffff; font-family: 'JetBrains Mono', Consolas, Monaco, monospace; text-shadow: 0 0 20px rgba(16,185,129,0.3);">
                  ${otp}
                </div>
                <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
                  Enter this code on the verification screen to activate your account.
                </div>
              </div>

              <!-- Option 2: Magic Link CTA Button -->
              <div style="text-align: center; margin-bottom: 28px;">
                <div style="font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
                  — OR VERIFY WITH ONE CLICK —
                </div>
                <a href="${magicLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 14px; font-weight: 700; padding: 13px 32px; border-radius: 12px; text-decoration: none; box-shadow: 0 8px 20px rgba(16,185,129,0.35);">
                  Verify Email Address &rarr;
                </a>
                <p style="margin: 12px 0 0 0; font-size: 11px; color: #64748b;">
                  Link doesn't work? Copy and paste this URL into your browser:<br>
                  <a href="${magicLink}" style="color: #10b981; word-break: break-all; text-decoration: underline;">${magicLink}</a>
                </p>
              </div>

              <!-- Security Notice -->
              <div style="border-top: 1px solid #1e293b; padding-top: 20px; font-size: 12px; color: #64748b; line-height: 1.5;">
                <p style="margin: 0 0 6px 0;">
                  ⏳ <strong>This verification code and link will expire in 15 minutes.</strong>
                </p>
                <p style="margin: 0;">
                  If you didn't create an account with Vasool, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 18px 32px; background-color: #0b1324; border-top: 1px solid #1e293b; text-align: center; font-size: 11px; color: #475569;">
              Vasool &bull; Smart Expense Splitting &amp; Debt Simplification &bull; ${baseUrl}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textContent = `
Vasool — Verify Your Email Address

Hi ${name || 'there'},

Welcome to Vasool! Please verify your email address to complete your registration.

Your 6-Digit Verification Code is: ${otp}

Alternatively, you can click or open this link in your browser:
${magicLink}

This code and link will expire in 15 minutes. If you did not create an account with Vasool, please ignore this email.

— Team Vasool
${baseUrl}
  `.trim();

  const transporter = createTransporter();

const logger = require('./logger');

// If no password configured, log and return graceful fallback
  if (!process.env.GMAIL_APP_PASSWORD) {
    logger.warn(`[mailer:mock] Simulated verification email to ${email}: OTP=${otp}`);
    return { success: true, simulated: true, otp, magicLink };
  }

  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: email,
      subject: `Verify your email for Vasool: ${otp}`,
      text: textContent,
      html: htmlContent
    });
    logger.info(`[mailer] Verification email dispatched to ${email}`, { messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`[mailer] Failed to send verification email to ${email}`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Sends a group invitation email with direct join link & invite code
 */
async function sendGroupInviteEmail({ toEmail, toName, groupName, inviteCode, adminName, adminEmail }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool-ecru.vercel.app').replace(/\/+$/, '');
  const joinUrl = `${baseUrl}/?join=${encodeURIComponent(inviteCode)}`;
  const senderEmail = process.env.GMAIL_USER || 'mrzoromit3@gmail.com';
  const formattedFrom = `"Vasool" <${senderEmail}>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Group Invitation: ${groupName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #060b16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #060b16; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 540px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          <!-- Header Banner -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; background: linear-gradient(135deg, #0f172a 0%, #13213c 100%); border-bottom: 1px solid #1e293b;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 40px; height: 40px; background: linear-gradient(135deg, #10b981 0%, #0d9488 100%); border-radius: 12px; text-align: center; line-height: 40px; font-weight: bold; font-size: 20px; color: #022c22; vertical-align: middle;">
                      ₹
                    </div>
                    <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; margin-left: 12px; vertical-align: middle;">
                      Vasool
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px;">
              <div style="display: inline-block; padding: 4px 10px; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 9999px; font-size: 11px; font-weight: 700; color: #6ee7b7; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;">
                Group Invitation
              </div>

              <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                Join &ldquo;${groupName}&rdquo; on Vasool
              </h1>

              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Hi <strong>${toName || 'there'}</strong>,<br>
                <strong style="color: #f1f5f9;">${adminName || adminEmail}</strong> has added you to the expense group <strong style="color: #34d399;">${groupName}</strong>. You can now track shared bills, see who owes whom, and settle balances with 1 tap via UPI.
              </p>

              <!-- Invite Box -->
              <table role="presentation" width="100%" style="background-color: #090e1a; border: 1px solid #1e293b; border-radius: 14px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <span style="display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 6px;">
                      Group Invite Code
                    </span>
                    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 24px; font-weight: 800; letter-spacing: 3px; color: #34d399;">
                      ${inviteCode}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${joinUrl}" style="display: inline-block; width: 85%; max-width: 320px; padding: 14px 24px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 12px; text-align: center; box-shadow: 0 10px 20px rgba(16, 185, 129, 0.25);">
                      Open Group &amp; View Bills &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b; text-align: center;">
                If you already have a Google Account (${toEmail}), simply log in with Google to automatically access this group.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #0b1120; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #475569;">
                Vasool &bull; Smart Expense Splitting &amp; Debt Simplification<br>
                <a href="${baseUrl}" style="color: #10b981; text-decoration: none;">${baseUrl}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textContent = `
Join "${groupName}" on Vasool

Hi ${toName || 'there'},

${adminName || adminEmail} has invited you to the group "${groupName}" on Vasool.

Invite Code: ${inviteCode}
Link to Join: ${joinUrl}

Log in with your email (${toEmail}) or Google to view and split bills immediately.

— Team Vasool
${baseUrl}
  `.trim();

  const transporter = createTransporter();

  if (!process.env.GMAIL_APP_PASSWORD) {
    logger.warn(`[mailer:mock] Simulated invite email to ${toEmail}: Group=${groupName}, Code=${inviteCode}`);
    return { success: true, simulated: true, inviteCode, joinUrl };
  }

  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: toEmail,
      subject: `Invitation: Join "${groupName}" on Vasool`,
      text: textContent,
      html: htmlContent
    });
    logger.info(`[mailer] Group invite email sent to ${toEmail}`, { groupName, inviteCode, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`[mailer] Failed to send group invite to ${toEmail}`, err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendVerificationEmail,
  sendGroupInviteEmail
};
