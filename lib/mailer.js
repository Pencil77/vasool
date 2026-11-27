const nodemailer = require('nodemailer');
const logger = require('./logger');
const otel = require('./otel');

const SENDER_NAME = process.env.SENDER_NAME || 'Wydia';
const DUCK_ADDRESS = process.env.DUCK_ADDRESS || 'wydia@duck.com';
const DUCK_USER = process.env.DUCK_USER || 'wydia';
const USE_DUCK_RELAY = process.env.USE_DUCK_RELAY !== 'false';

function isTestEmail(email) {
  const normalized = String(email || '').toLowerCase().trim();
  return (
    normalized.endsWith('@vasooltest.com') ||
    normalized.endsWith('@test.local') ||
    normalized.endsWith('@example.com') ||
    normalized.endsWith('@example.org') ||
    normalized.endsWith('@example.net') ||
    normalized.endsWith('@test.com') ||
    normalized.includes('dummy') ||
    normalized.includes('mock')
  );
}

function toDuckRelayAddress(email, duckUser = DUCK_USER) {
  const trimmed = String(email || '').trim();
  if (!trimmed || trimmed.toLowerCase().endsWith('@duck.com')) {
    return trimmed;
  }
  return `${trimmed.replace('@', '_at_')}_${duckUser}@duck.com`;
}

function getFormattedSender() {
  return `"${SENDER_NAME}" <${DUCK_ADDRESS}>`;
}

function resolveRecipient(email) {
  if (USE_DUCK_RELAY) {
    return toDuckRelayAddress(email);
  }
  return email;
}

function getAppPassword() {
  return (
    process.env.GMAIL_APP_PASSWORD ||
    process.env.WYDIA_MAILER_APP_PWD ||
    process.env['wydia-mailer-app-pwd'] ||
    ''
  ).replace(/\s+/g, '').trim();
}

function createTransporter() {
  const user = process.env.GMAIL_USER || process.env.SMTP_USER || 'mrzoromit3@gmail.com';
  const pass = getAppPassword();

  if (!pass) {
    console.warn('[mailer] Warning: Gmail App Password is not set. Outgoing emails will be logged only.');
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
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const magicLink = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const formattedFrom = getFormattedSender();
  const deliveryAddress = resolveRecipient(email);

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
              <div style="margin-top: 6px; font-size: 10px; color: #64748b;">
                Dispatched by Wydia &bull; Sent via DuckDuckGo Privacy Relay
              </div>
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

— Wydia (Personal Secretary to Zoro)
Vasool Expense Management
${baseUrl}
  `.trim();

  const span = otel.startSpan('mailer.send_verification_email', {
    attributes: {
      'recipient.email': email,
      'email.type': 'verification',
      'email.simulated': !getAppPassword()
    }
  });

  const transporter = createTransporter();

  // Test email bypass to avoid inbox delivery bounces
  if (isTestEmail(email)) {
    logger.info(`[mailer:test] Test recipient detected (${email}). Skipping real SMTP delivery to prevent inbox bounce.`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'verification', status: 'test_skipped' });
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, otp, magicLink, testSkipped: true };
  }

  // If no password configured, log and return graceful fallback
  if (!getAppPassword()) {
    logger.warn(`[mailer:mock] Simulated verification email to ${email}: OTP=${otp}`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'verification', status: 'simulated' });
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, otp, magicLink };
  }

  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: deliveryAddress,
      subject: `Verify your email for Vasool: ${otp}`,
      text: textContent,
      html: htmlContent
    });
    logger.info(`[mailer] Verification email dispatched to ${email} via ${deliveryAddress}`, { messageId: info.messageId });
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'verification', status: 'success' });
    span.setAttribute('email.message_id', info.messageId);
    span.setStatus('OK');
    span.end();
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`[mailer] Failed to send verification email to ${email}`, err);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'verification', status: 'error' });
    span.recordException(err);
    span.end();
    return { success: false, error: err.message };
  }
}

/**
 * Sends a group invitation email with direct join link & invite code
 */
async function sendGroupInviteEmail({ toEmail, toName, groupName, inviteCode, adminName, adminEmail }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const joinUrl = `${baseUrl}/?join=${encodeURIComponent(inviteCode)}`;
  const formattedFrom = getFormattedSender();
  const deliveryAddress = resolveRecipient(toEmail);

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
                <strong style="color: #f1f5f9;">${adminName || adminEmail}</strong> has invited you to join the expense group <strong style="color: #34d399;">${groupName}</strong>. You can review and accept this invitation to track shared bills, see who owes whom, and settle balances seamlessly via UPI.
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
                      Review &amp; Accept Invitation &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b; text-align: center;">
                If you already have a Google Account (${toEmail}), simply log in with Google to automatically access and accept this group invite.
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
              <p style="margin: 6px 0 0 0; font-size: 10px; color: #64748b;">
                Dispatched by Wydia &bull; Sent via DuckDuckGo Privacy Relay
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

${adminName || adminEmail} has invited you to join the expense group "${groupName}" on Vasool.

Invite Code: ${inviteCode}
Link to Review & Accept: ${joinUrl}

Log in or sign up with your email (${toEmail}) to review and accept your invitation.

— Wydia (Personal Secretary to Zoro)
Vasool Expense Management
${baseUrl}
  `.trim();

  const span = otel.startSpan('mailer.send_group_invite_email', {
    attributes: {
      'recipient.email': toEmail,
      'group.name': groupName,
      'invite.code': inviteCode,
      'email.type': 'group_invite',
      'email.simulated': !getAppPassword()
    }
  });

  const transporter = createTransporter();

  // Test email bypass to avoid inbox delivery bounces
  if (isTestEmail(toEmail)) {
    logger.info(`[mailer:test] Test recipient detected (${toEmail}). Skipping real SMTP delivery to prevent inbox bounce.`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'group_invite', status: 'test_skipped' });
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, inviteCode, joinUrl, testSkipped: true };
  }

  if (!getAppPassword()) {
    logger.warn(`[mailer:mock] Simulated invite email to ${toEmail}: Group=${groupName}, Code=${inviteCode}`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'group_invite', status: 'simulated' });
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, inviteCode, joinUrl };
  }

  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: deliveryAddress,
      subject: `Invitation: Join "${groupName}" on Vasool`,
      text: textContent,
      html: htmlContent
    });
    logger.info(`[mailer] Group invite email sent to ${toEmail} via ${deliveryAddress}`, { groupName, inviteCode, messageId: info.messageId });
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'group_invite', status: 'success' });
    span.setAttribute('email.message_id', info.messageId);
    span.setStatus('OK');
    span.end();
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`[mailer] Failed to send group invite to ${toEmail}`, err);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'group_invite', status: 'error' });
    span.recordException(err);
    span.end();
    return { success: false, error: err.message };
  }
}

/**
 * Sends a password reset email containing:
 * 1. A prominent 6-digit OTP code for on-screen entry.
 * 2. A 1-click reset link button.
 */
async function sendPasswordResetEmail({ email, name, otp, token }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const resetLink = `${baseUrl}/?resetToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const formattedFrom = getFormattedSender();
  const deliveryAddress = resolveRecipient(email);

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your Vasool password</title>
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
                Reset your password
              </h1>
              <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                We received a request to reset the password for your Vasool account.
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
                You can reset your password using either the <strong>6-digit code</strong> on your screen or by clicking the <strong>direct reset button</strong> below.
              </p>

              <!-- Option 1: 6-Digit OTP Box -->
              <div style="background-color: #0b1324; border: 1px solid #1e293b; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; margin-bottom: 8px;">
                  Your 6-Digit Password Reset Code
                </div>
                <div style="font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #ffffff; font-family: 'JetBrains Mono', Consolas, Monaco, monospace; text-shadow: 0 0 20px rgba(16,185,129,0.3);">
                  ${otp}
                </div>
                <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
                  Enter this code on the password reset screen to choose a new password.
                </div>
              </div>

              <!-- Option 2: Reset Link CTA Button -->
              <div style="text-align: center; margin-bottom: 28px;">
                <div style="font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
                  — OR RESET WITH ONE CLICK —
                </div>
                <a href="${resetLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 14px; font-weight: 700; padding: 13px 32px; border-radius: 12px; text-decoration: none; box-shadow: 0 8px 20px rgba(16,185,129,0.35);">
                  Reset Password &rarr;
                </a>
                <p style="margin: 12px 0 0 0; font-size: 11px; color: #64748b;">
                  Link doesn't work? Copy and paste this URL into your browser:<br>
                  <a href="${resetLink}" style="color: #10b981; word-break: break-all; text-decoration: underline;">${resetLink}</a>
                </p>
              </div>

              <!-- Security Notice -->
              <div style="border-top: 1px solid #1e293b; padding-top: 20px; font-size: 12px; color: #64748b; line-height: 1.5;">
                <p style="margin: 0 0 6px 0;">
                  ⏳ <strong>This password reset code and link will expire in 15 minutes.</strong>
                </p>
                <p style="margin: 0;">
                  If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 18px 32px; background-color: #0b1324; border-top: 1px solid #1e293b; text-align: center; font-size: 11px; color: #475569;">
              Vasool &bull; Smart Expense Splitting &amp; Debt Simplification &bull; ${baseUrl}
              <div style="margin-top: 6px; font-size: 10px; color: #64748b;">
                Dispatched by Wydia &bull; Sent via DuckDuckGo Privacy Relay
              </div>
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
Vasool — Reset Your Password

Hi ${name || 'there'},

We received a request to reset your password for your Vasool account.

Your 6-Digit Password Reset Code is: ${otp}

Alternatively, you can click or open this link in your browser:
${resetLink}

This code and link will expire in 15 minutes. If you did not request a password reset, please ignore this email.

— Wydia (Personal Secretary to Zoro)
Vasool Expense Management
${baseUrl}
  `.trim();

  const span = otel.startSpan('mailer.send_password_reset_email', {
    attributes: {
      'recipient.email': email,
      'email.type': 'password_reset',
      'email.simulated': !getAppPassword()
    }
  });

  const transporter = createTransporter();

  // Test email bypass to avoid inbox delivery bounces
  if (isTestEmail(email)) {
    logger.info(`[mailer:test] Test recipient detected (${email}). Skipping real SMTP delivery to prevent inbox bounce.`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'password_reset', status: 'test_skipped' });
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, otp, resetLink, testSkipped: true };
  }

  if (!getAppPassword()) {
    logger.warn(`[mailer:mock] Simulated password reset email to ${email}: OTP=${otp}`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'password_reset', status: 'simulated' });
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, otp, resetLink };
  }

  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: deliveryAddress,
      subject: `Reset your Vasool password: ${otp}`,
      text: textContent,
      html: htmlContent
    });
    logger.info(`[mailer] Password reset email dispatched to ${email} via ${deliveryAddress}`, { messageId: info.messageId });
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'password_reset', status: 'success' });
    span.setAttribute('email.message_id', info.messageId);
    span.setStatus('OK');
    span.end();
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`[mailer] Failed to send password reset email to ${email}`, err);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: 'password_reset', status: 'error' });
    span.recordException(err);
    span.end();
    return { success: false, error: err.message };
  }
}

function escapeEmailHtml(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTimeIST(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return 'Recent';
  try {
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) + ' IST';
  } catch {
    return d.toISOString();
  }
}

function buildVasoolEmailShell({ badgeLabel, badgeColor = '#10b981', title, bodyHtml, baseUrl }) {
  const safeBase = (baseUrl || process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeEmailHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #050b09; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #050b09; padding: 28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 540px; background-color: #0b1511; border: 1px solid #163026; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.55);">
          <tr>
            <td style="padding: 24px 28px 18px 28px; background: linear-gradient(135deg, #0b1511 0%, #10231b 100%); border-bottom: 1px solid #163026;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 38px; height: 38px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 11px; text-align: center; line-height: 38px; font-weight: bold; font-size: 19px; color: #022c22; vertical-align: middle;">
                      ₹
                    </div>
                    <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.4px; margin-left: 10px; vertical-align: middle;">
                      Vasool
                    </span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 4px 10px; background-color: rgba(16, 185, 129, 0.14); border: 1px solid ${badgeColor}; border-radius: 9999px; font-size: 11px; font-weight: 700; color: ${badgeColor}; text-transform: uppercase;">
                      ${escapeEmailHtml(badgeLabel)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 28px; background-color: #070e0b; border-top: 1px solid #163026; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                Dispatched by Wydia &bull; Personal Secretary to Zoro<br>
                Vasool &bull; Smart Expense Splitting &amp; Debt Simplification<br>
                <a href="${safeBase}" style="color: #10b981; text-decoration: none;">${safeBase}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function dispatchTrackedEmail({ toEmail, subject, text, html, telemetryType, spanName, extraAttributes = {}, extraResult = {} }) {
  const formattedFrom = getFormattedSender();
  const deliveryAddress = resolveRecipient(toEmail);
  const span = otel.startSpan(spanName || `mailer.${telemetryType}`);
  span.setAttribute('email.recipient', String(toEmail || ''));
  Object.entries(extraAttributes).forEach(([k, v]) => {
    if (v !== undefined && v !== null) span.setAttribute(k, v);
  });

  if (isTestEmail(toEmail)) {
    if (Array.isArray(global.__vasoolCapturedTestEmails)) {
      global.__vasoolCapturedTestEmails.push({
        telemetryType,
        toEmail,
        deliveryAddress,
        subject,
        text,
        html,
        ...extraResult
      });
    }
    logger.info(`[mailer] Simulated ${telemetryType} email to ${toEmail}: ${subject}`);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: telemetryType, status: 'simulated' });
    span.setAttribute('email.simulated', true);
    span.setStatus('OK');
    span.end();
    return { success: true, simulated: true, recipient: toEmail, subject, ...extraResult };
  }

  const transporter = createTransporter();
  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: deliveryAddress,
      subject,
      text,
      html
    });
    logger.info(`[mailer] ${telemetryType} email dispatched to ${toEmail} via ${deliveryAddress}`, { messageId: info.messageId });
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: telemetryType, status: 'success' });
    span.setAttribute('email.message_id', info.messageId);
    span.setStatus('OK');
    span.end();
    return { success: true, messageId: info.messageId, recipient: toEmail, subject, ...extraResult };
  } catch (err) {
    logger.error(`[mailer] Failed to send ${telemetryType} email to ${toEmail}`, err);
    otel.metrics.counter('vasool_emails_dispatched_total', 1, { type: telemetryType, status: 'error' });
    span.recordException(err);
    span.end();
    return { success: false, error: err.message, recipient: toEmail, subject, ...extraResult };
  }
}

/**
 * Template 1: Delayed payment notification to receiver (after 10-minute delay).
 * Explicitly includes receiver's registered UPI ID (if available), payment timestamp,
 * 48-hour deadline, and both "Payment Received" & "Report Not Received" links.
 */
async function sendPaymentConfirmationRequestEmail({
  settlement,
  group,
  confirmToken,
  disputeToken = '',
  receiverUpiId = '',
  gracePeriodEndsAt = null
}) {
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const settlementId = String(settlement._id || settlement.id);
  const ackUrl = `${baseUrl}/api/settlements/ack?token=${encodeURIComponent(confirmToken)}&id=${encodeURIComponent(settlementId)}`;
  const disputeUrl = disputeToken
    ? `${baseUrl}/api/settlements/report-view?token=${encodeURIComponent(disputeToken)}&id=${encodeURIComponent(settlementId)}`
    : `${baseUrl}/#settle`;

  const toEmail = settlement.toEmail;
  const fromName = settlement.fromName || settlement.fromEmail;
  const toName = settlement.toName || settlement.toEmail;
  const groupName = group ? group.name : 'Shared Group';
  const amountFormatted = `₹${Number(settlement.amount).toFixed(2)}`;
  const upiDisplay = String(receiverUpiId || settlement.receiverUpiIdSnapshot || '').trim();
  const paidTimeDisplay = formatDateTimeIST(settlement.acknowledgedAt || settlement.settledAt || settlement.createdAt);
  const deadlineDisplay = formatDateTimeIST(gracePeriodEndsAt || settlement.gracePeriodEndsAt || new Date(Date.now() + 48 * 60 * 60 * 1000));

  const upiInstructionText = upiDisplay
    ? `Please check your UPI transaction history for your registered UPI ID: ${upiDisplay}.`
    : `Please check your bank or UPI transaction history (no UPI ID is currently saved on your Vasool profile).`;

  const textContent = `Hello ${toName},\n\n` +
    `${fromName} has marked a payment of ${amountFormatted} as sent to you in "${groupName}" on ${paidTimeDisplay} via ${settlement.method || 'UPI'}.\n\n` +
    `${upiInstructionText}\n` +
    (settlement.utrNumber ? `Reference / UTR: ${settlement.utrNumber}\n` : '') +
    (settlement.referenceNote ? `Note: "${settlement.referenceNote}"\n` : '') +
    `\nIf you haven't received this payment, you can report it within the next 48 hours (by ${deadlineDisplay}). If no issue is reported by then, the payment will be automatically confirmed.\n\n` +
    `Confirm Payment Received:\n${ackUrl}\n\n` +
    `Report Not Received:\n${disputeUrl}\n\n` +
    `— Wydia (Personal Secretary)\nVasool System`;

  const htmlBody = `
    <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #ffffff; line-height: 1.3;">
      Payment Verification Notice
    </h1>
    <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
      Hi <strong>${escapeEmailHtml(toName)}</strong>,<br>
      <strong style="color: #ffffff;">${escapeEmailHtml(fromName)}</strong> has marked a payment of <strong style="color: #34d399;">${amountFormatted}</strong> as sent to you in <strong style="color: #2dd4bf;">${escapeEmailHtml(groupName)}</strong>.
    </p>
    <div style="padding: 14px 16px; background-color: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; margin-bottom: 18px; font-size: 13px; line-height: 1.55; color: #d1fae5;">
      ${upiDisplay
        ? `Please check your UPI transaction history for the UPI ID: <strong style="color: #ffffff; font-family: monospace;">${escapeEmailHtml(upiDisplay)}</strong>.`
        : `Please check your bank/UPI account statement to verify receipt.`}
      If you haven't received the payment, report it within <strong>48 hours</strong> (deadline: <strong>${escapeEmailHtml(deadlineDisplay)}</strong>).
    </div>

    <table role="presentation" width="100%" style="background-color: #060d0a; border: 1px solid #163026; border-radius: 14px; margin-bottom: 22px;">
      <tr>
        <td style="padding: 18px; text-align: center; border-bottom: 1px solid #163026;">
          <span style="display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; margin-bottom: 4px;">Amount Marked Paid</span>
          <span style="font-size: 30px; font-weight: 800; color: #34d399;">${amountFormatted}</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 14px 18px;">
          <table role="presentation" width="100%" style="font-size: 12px; line-height: 1.8;">
            <tr><td style="color: #64748b; width: 38%;">Sender:</td><td style="color: #f1f5f9; font-weight: 600;">${escapeEmailHtml(fromName)}</td></tr>
            <tr><td style="color: #64748b;">Group:</td><td style="color: #2dd4bf; font-weight: 600;">${escapeEmailHtml(groupName)}</td></tr>
            <tr><td style="color: #64748b;">Marked Paid At:</td><td style="color: #f1f5f9;">${escapeEmailHtml(paidTimeDisplay)}</td></tr>
            <tr><td style="color: #64748b;">Method:</td><td style="color: #f1f5f9;">${escapeEmailHtml(settlement.method || 'UPI')}</td></tr>
            ${upiDisplay ? `<tr><td style="color: #64748b;">Verify on UPI ID:</td><td style="color: #34d399; font-family: monospace; font-weight: 700;">${escapeEmailHtml(upiDisplay)}</td></tr>` : ''}
            ${settlement.utrNumber ? `<tr><td style="color: #64748b;">UTR / Ref:</td><td style="color: #34d399; font-family: monospace; font-weight: 700;">${escapeEmailHtml(settlement.utrNumber)}</td></tr>` : ''}
            ${settlement.referenceNote ? `<tr><td style="color: #64748b;">Note:</td><td style="color: #cbd5e1; font-style: italic;">&ldquo;${escapeEmailHtml(settlement.referenceNote)}&rdquo;</td></tr>` : ''}
            <tr><td style="color: #64748b;">Auto-Confirms After:</td><td style="color: #fbbf24; font-weight: 600;">${escapeEmailHtml(deadlineDisplay)}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" style="margin-bottom: 14px;">
      <tr>
        <td align="center" style="padding-bottom: 10px;">
          <a href="${ackUrl}" style="display: inline-block; width: 90%; max-width: 340px; padding: 13px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 14px; font-weight: 800; text-decoration: none; border-radius: 12px; text-align: center;">
            ✅ Payment Received (Confirm)
          </a>
        </td>
      </tr>
      <tr>
        <td align="center">
          <a href="${disputeUrl}" style="display: inline-block; width: 90%; max-width: 340px; padding: 11px 20px; background-color: rgba(244, 63, 94, 0.14); border: 1px solid rgba(244, 63, 94, 0.45); color: #fda4af; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 12px; text-align: center;">
            🚨 Report Not Received
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0; font-size: 11.5px; line-height: 1.5; color: #64748b; text-align: center;">
      If you have already received this payment, no further action is required — it will auto-confirm after 48 hours.
    </p>`;

  const emailSubject = `Action Required: ${fromName} marked ${amountFormatted} paid to you (${groupName})`;
  return dispatchTrackedEmail({
    toEmail,
    subject: emailSubject,
    text: textContent,
    html: buildVasoolEmailShell({ badgeLabel: 'Verify Receipt', badgeColor: '#34d399', title: emailSubject, bodyHtml: htmlBody, baseUrl }),
    telemetryType: 'payment_confirmation',
    spanName: 'mailer.send_payment_confirmation_request_email',
    extraAttributes: { 'settlement.id': settlementId, 'settlement.amount': Number(settlement.amount) },
    extraResult: { ackUrl, disputeUrl, receiverUpiId: upiDisplay }
  });
}

/**
 * Template 2: Receiver reports payment not received -> Email to original sender.
 */
async function sendDisputeAlertToSenderEmail({ settlement, group, reporterName, disputeReason }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const toEmail = settlement.fromEmail;
  const senderName = settlement.fromName || settlement.fromEmail;
  const receiverName = reporterName || settlement.toName || settlement.toEmail;
  const groupName = group ? group.name : 'Shared Group';
  const amountFormatted = `₹${Number(settlement.amount).toFixed(2)}`;
  const ackTimeDisplay = formatDateTimeIST(settlement.acknowledgedAt || settlement.settledAt || settlement.createdAt);
  const disputeTimeDisplay = formatDateTimeIST(settlement.disputedAt || new Date());
  const reasonText = disputeReason || settlement.disputeReason || 'Payment not received in account';

  const textContent = `Hello ${senderName},\n\n` +
    `${receiverName} has reported that your payment of ${amountFormatted} in "${groupName}" (marked as paid on ${ackTimeDisplay}) was NOT received.\n\n` +
    `Reported Issue: ${reasonText}\n` +
    `Disputed At: ${disputeTimeDisplay}\n\n` +
    `This settlement has been placed in Disputed status and will NOT automatically confirm. Please verify your bank/UPI statement, confirm the transaction, or revert the claim in Vasool:\n${baseUrl}/#settle\n\n` +
    `— Wydia (Personal Secretary)\nVasool System`;

  const htmlBody = `
    <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #fda4af; line-height: 1.3;">
      Payment Reported as Not Received
    </h1>
    <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
      Hi <strong>${escapeEmailHtml(senderName)}</strong>,<br>
      <strong style="color: #ffffff;">${escapeEmailHtml(receiverName)}</strong> reported that they have not received your payment of <strong style="color: #fda4af;">${amountFormatted}</strong> in <strong style="color: #2dd4bf;">${escapeEmailHtml(groupName)}</strong>.
    </p>
    <table role="presentation" width="100%" style="background-color: #060d0a; border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 14px; margin-bottom: 20px; padding: 14px 18px; font-size: 12px; line-height: 1.8;">
      <tr><td style="color: #64748b; width: 40%;">Reported By:</td><td style="color: #f1f5f9; font-weight: 600;">${escapeEmailHtml(receiverName)}</td></tr>
      <tr><td style="color: #64748b;">Sender:</td><td style="color: #f1f5f9;">${escapeEmailHtml(senderName)}</td></tr>
      <tr><td style="color: #64748b;">Amount:</td><td style="color: #fda4af; font-weight: 700;">${amountFormatted}</td></tr>
      <tr><td style="color: #64748b;">Group:</td><td style="color: #2dd4bf; font-weight: 600;">${escapeEmailHtml(groupName)}</td></tr>
      <tr><td style="color: #64748b;">Marked Paid At:</td><td style="color: #f1f5f9;">${escapeEmailHtml(ackTimeDisplay)}</td></tr>
      <tr><td style="color: #64748b;">Reported Issue:</td><td style="color: #fecdd3; font-weight: 600;">${escapeEmailHtml(reasonText)}</td></tr>
    </table>
    <table role="presentation" width="100%" style="margin-bottom: 12px;">
      <tr>
        <td align="center">
          <a href="${baseUrl}/#settle" style="display: inline-block; width: 88%; max-width: 320px; padding: 12px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 13px; font-weight: 800; text-decoration: none; border-radius: 12px;">
            Open Vasool to Resolve Dispute &rarr;
          </a>
        </td>
      </tr>
    </table>`;

  const subject = `Dispute Alert: ${receiverName} did not receive ${amountFormatted} (${groupName})`;
  return dispatchTrackedEmail({
    toEmail,
    subject,
    text: textContent,
    html: buildVasoolEmailShell({ badgeLabel: 'Disputed', badgeColor: '#fb7185', title: subject, bodyHtml: htmlBody, baseUrl }),
    telemetryType: 'payment_disputed_sender',
    extraAttributes: { 'settlement.id': String(settlement._id || settlement.id), 'settlement.amount': Number(settlement.amount) }
  });
}

/**
 * Template 3: Receiver reports payment not received -> Email to Group Admin(s).
 */
async function sendDisputeAlertToAdminEmail({ settlement, group, adminEmail, adminName, reporterName, disputeReason }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const senderName = settlement.fromName || settlement.fromEmail;
  const receiverName = reporterName || settlement.toName || settlement.toEmail;
  const groupName = group ? group.name : 'Shared Group';
  const amountFormatted = `₹${Number(settlement.amount).toFixed(2)}`;
  const ackTimeDisplay = formatDateTimeIST(settlement.acknowledgedAt || settlement.settledAt || settlement.createdAt);
  const reasonText = disputeReason || settlement.disputeReason || 'Payment not received in account';

  const textContent = `Hello ${adminName || 'Group Admin'},\n\n` +
    `A settlement payment in group "${groupName}" has been reported as NOT received.\n\n` +
    `Reported By (Receiver): ${receiverName} (${settlement.toEmail})\n` +
    `Original Sender: ${senderName} (${settlement.fromEmail})\n` +
    `Amount: ${amountFormatted}\n` +
    `Marked Paid At: ${ackTimeDisplay}\n` +
    `Reported Issue: ${reasonText}\n\n` +
    `Automatic confirmation has been halted. Please review and help resolve this dispute in Vasool:\n${baseUrl}/#settle\n\n` +
    `— Wydia (Personal Secretary)\nVasool System`;

  const htmlBody = `
    <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #fbbf24; line-height: 1.3;">
      Group Admin Alert: Payment Disputed
    </h1>
    <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
      Hi <strong>${escapeEmailHtml(adminName || 'Admin')}</strong>,<br>
      In <strong style="color: #2dd4bf;">${escapeEmailHtml(groupName)}</strong>, <strong style="color: #ffffff;">${escapeEmailHtml(receiverName)}</strong> has reported that a payment of <strong style="color: #fda4af;">${amountFormatted}</strong> marked sent by <strong>${escapeEmailHtml(senderName)}</strong> was not received.
    </p>
    <table role="presentation" width="100%" style="background-color: #060d0a; border: 1px solid rgba(251, 191, 36, 0.35); border-radius: 14px; margin-bottom: 20px; padding: 14px 18px; font-size: 12px; line-height: 1.8;">
      <tr><td style="color: #64748b; width: 40%;">Reported By:</td><td style="color: #f1f5f9; font-weight: 600;">${escapeEmailHtml(receiverName)}</td></tr>
      <tr><td style="color: #64748b;">Original Sender:</td><td style="color: #f1f5f9; font-weight: 600;">${escapeEmailHtml(senderName)}</td></tr>
      <tr><td style="color: #64748b;">Amount:</td><td style="color: #fda4af; font-weight: 700;">${amountFormatted}</td></tr>
      <tr><td style="color: #64748b;">Group:</td><td style="color: #2dd4bf; font-weight: 600;">${escapeEmailHtml(groupName)}</td></tr>
      <tr><td style="color: #64748b;">Marked Paid At:</td><td style="color: #f1f5f9;">${escapeEmailHtml(ackTimeDisplay)}</td></tr>
      <tr><td style="color: #64748b;">Reported Issue:</td><td style="color: #fecdd3; font-weight: 600;">${escapeEmailHtml(reasonText)}</td></tr>
    </table>
    <table role="presentation" width="100%">
      <tr>
        <td align="center">
          <a href="${baseUrl}/#settle" style="display: inline-block; width: 88%; max-width: 320px; padding: 12px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 13px; font-weight: 800; text-decoration: none; border-radius: 12px;">
            Review Settlement in Vasool &rarr;
          </a>
        </td>
      </tr>
    </table>`;

  const subject = `Admin Alert: Dispute on ${amountFormatted} payment in ${groupName}`;
  return dispatchTrackedEmail({
    toEmail: adminEmail,
    subject,
    text: textContent,
    html: buildVasoolEmailShell({ badgeLabel: 'Admin Notice', badgeColor: '#fbbf24', title: subject, bodyHtml: htmlBody, baseUrl }),
    telemetryType: 'payment_disputed_admin',
    extraAttributes: { 'settlement.id': String(settlement._id || settlement.id), 'settlement.amount': Number(settlement.amount) }
  });
}

/**
 * Template 4: Payment automatically confirmed after 48-hour grace period -> Sent to sender & receiver.
 */
async function sendPaymentAutoConfirmedEmail({ settlement, group, recipientEmail, recipientName, isSender }) {
  const baseUrl = (process.env.APP_URL || 'https://vasool.duckdns.org').replace(/\/+$/, '');
  const fromName = settlement.fromName || settlement.fromEmail;
  const toName = settlement.toName || settlement.toEmail;
  const groupName = group ? group.name : 'Shared Group';
  const amountFormatted = `₹${Number(settlement.amount).toFixed(2)}`;
  const ackTimeDisplay = formatDateTimeIST(settlement.acknowledgedAt || settlement.settledAt || settlement.createdAt);
  const confirmedTimeDisplay = formatDateTimeIST(settlement.autoConfirmedAt || settlement.confirmedAt || new Date());

  const summaryLine = isSender
    ? `Your payment of ${amountFormatted} to ${toName} in "${groupName}" has been automatically confirmed after the 48-hour verification window elapsed without dispute.`
    : `The payment of ${amountFormatted} marked sent by ${fromName} in "${groupName}" has been automatically confirmed because no non-receipt report was submitted within the 48-hour verification period.`;

  const textContent = `Hello ${recipientName || recipientEmail},\n\n` +
    `${summaryLine}\n\n` +
    `Marked Paid At: ${ackTimeDisplay}\n` +
    `Auto-Confirmed At: ${confirmedTimeDisplay}\n\n` +
    `View updated balances in Vasool:\n${baseUrl}/#settle\n\n` +
    `— Wydia (Personal Secretary)\nVasool System`;

  const htmlBody = `
    <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #34d399; line-height: 1.3;">
      Payment Automatically Confirmed
    </h1>
    <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
      Hi <strong>${escapeEmailHtml(recipientName || recipientEmail)}</strong>,<br>
      ${escapeEmailHtml(summaryLine)}
    </p>
    <table role="presentation" width="100%" style="background-color: #060d0a; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 14px; margin-bottom: 20px; padding: 14px 18px; font-size: 12px; line-height: 1.8;">
      <tr><td style="color: #64748b; width: 42%;">Amount:</td><td style="color: #34d399; font-weight: 800;">${amountFormatted}</td></tr>
      <tr><td style="color: #64748b;">Sender:</td><td style="color: #f1f5f9;">${escapeEmailHtml(fromName)}</td></tr>
      <tr><td style="color: #64748b;">Receiver:</td><td style="color: #f1f5f9;">${escapeEmailHtml(toName)}</td></tr>
      <tr><td style="color: #64748b;">Group:</td><td style="color: #2dd4bf; font-weight: 600;">${escapeEmailHtml(groupName)}</td></tr>
      <tr><td style="color: #64748b;">Auto-Confirmed At:</td><td style="color: #f1f5f9;">${escapeEmailHtml(confirmedTimeDisplay)}</td></tr>
    </table>
    <table role="presentation" width="100%">
      <tr>
        <td align="center">
          <a href="${baseUrl}/#settle" style="display: inline-block; width: 88%; max-width: 320px; padding: 12px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #022c22; font-size: 13px; font-weight: 800; text-decoration: none; border-radius: 12px;">
            View Settled Balance in Vasool &rarr;
          </a>
        </td>
      </tr>
    </table>`;

  const subject = `Payment Confirmed (48h Grace Elapsed): ${amountFormatted} in ${groupName}`;
  return dispatchTrackedEmail({
    toEmail: recipientEmail,
    subject,
    text: textContent,
    html: buildVasoolEmailShell({ badgeLabel: 'Auto-Confirmed', badgeColor: '#10b981', title: subject, bodyHtml: htmlBody, baseUrl }),
    telemetryType: 'payment_auto_confirmed',
    extraAttributes: { 'settlement.id': String(settlement._id || settlement.id), 'settlement.amount': Number(settlement.amount) }
  });
}

module.exports = {
  sendVerificationEmail,
  sendGroupInviteEmail,
  sendPasswordResetEmail,
  sendPaymentConfirmationRequestEmail,
  sendDisputeAlertToSenderEmail,
  sendDisputeAlertToAdminEmail,
  sendPaymentAutoConfirmedEmail,
  formatDateTimeIST
};
