const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectToDatabase } = require('../lib/mongodb');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');
const otel = require('../lib/otel');
const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-fallback-secret-override-in-infisical';
const SUPER_ADMIN_EMAIL = 'mdzubair7592@gmail.com';

// In-memory cache for dynamically configurable session duration
let cachedSessionConfig = {
  value: 7,
  unit: 'days',
  string: '7d',
  lastFetchedAt: 0
};

async function refreshSessionDurationCache(force = false) {
  const now = Date.now();
  if (!force && now - cachedSessionConfig.lastFetchedAt < 60000) {
    return cachedSessionConfig.string || '7d';
  }
  try {
    const config = await SystemConfig.findOne({ key: 'auth_session' }).lean();
    if (config && config.sessionDurationString) {
      cachedSessionConfig = {
        value: Number(config.sessionDurationValue) || 7,
        unit: config.sessionDurationUnit || 'days',
        string: config.sessionDurationString,
        lastFetchedAt: now
      };
    } else {
      cachedSessionConfig.lastFetchedAt = now;
    }
  } catch (err) {
    // Keep cached config on error
  }
  return cachedSessionConfig.string || '7d';
}

function updateCachedSessionDuration(value, unit, string) {
  cachedSessionConfig = {
    value: Number(value),
    unit: String(unit),
    string: String(string),
    lastFetchedAt: Date.now()
  };
}

function getCachedSessionDuration() {
  return cachedSessionConfig.string || '7d';
}

function isSuperAdminEmail(email) {
  if (!email) return false;
  return String(email).trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Password encryption/hashing toggle. Disabled by default as requested to keep raw words in DB.
// Can be toggled on anytime in the future via environment variable ENABLE_PASSWORD_HASHING=true
const ENABLE_PASSWORD_HASHING = process.env.ENABLE_PASSWORD_HASHING === 'true';

async function storePassword(rawPassword) {
  if (ENABLE_PASSWORD_HASHING) {
    return await bcrypt.hash(rawPassword, 12);
  }
  return String(rawPassword); // Stored as raw word in the database
}

async function verifyPassword(inputPassword, storedPassword) {
  if (!storedPassword || !inputPassword) return false;
  // 1. Direct raw plaintext match (when hashing is turned off)
  if (inputPassword === storedPassword) {
    return true;
  }
  // 2. Bcrypt hash check (fallback support when hashing was used or is turned on)
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
    try {
      return await bcrypt.compare(inputPassword, storedPassword);
    } catch {
      return false;
    }
  }
  return false;
}

function signAuthToken(user) {
  const isSuper = Boolean(user.isSuperAdmin) || isSuperAdminEmail(user.email);
  const expiresIn = cachedSessionConfig.string || '7d';
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      name: user.name,
      role: isSuper ? 'super_admin' : (user.role || 'user'),
      isSuperAdmin: isSuper,
      authProviders: user.authProviders
    },
    JWT_SECRET,
    { expiresIn }
  );
}

function verifyAuthToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function sanitizeUser(user) {
  const isSuper = Boolean(user.isSuperAdmin) || isSuperAdminEmail(user.email);
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    authProviders: user.authProviders,
    defaultCurrency: user.defaultCurrency,
    upiId: user.upiId,
    role: isSuper ? 'super_admin' : (user.role || 'user'),
    isSuperAdmin: isSuper,
    isEmailVerified: Boolean(user.isEmailVerified),
    isSuspended: Boolean(user.isSuspended),
    suspendedUntil: user.suspendedUntil || null,
    suspensionReason: user.suspensionReason || ''
  };
}

function isUserSuspended(user) {
  if (!user || !user.isSuspended) return false;
  if (user.suspendedUntil && new Date() > new Date(user.suspendedUntil)) {
    return false;
  }
  return true;
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Super Admin is never blocked by suspension
    if (decoded.role === 'super_admin' || decoded.isSuperAdmin || isSuperAdminEmail(decoded.email)) {
      return next();
    }

    // Check suspension state in database
    await connectToDatabase();
    const userDoc = await User.findById(decoded.sub);
    if (!userDoc) {
      return res.status(401).json({ error: 'Account not found or deleted.' });
    }

    if (userDoc.isSuspended) {
      if (userDoc.suspendedUntil && new Date() > new Date(userDoc.suspendedUntil)) {
        userDoc.isSuspended = false;
        userDoc.suspendedUntil = null;
        userDoc.suspensionReason = '';
        await userDoc.save();
      } else {
        const untilStr = userDoc.suspendedUntil
          ? `until ${new Date(userDoc.suspendedUntil).toLocaleString()}`
          : 'indefinitely';
        return res.status(403).json({
          error: 'account_suspended',
          message: `Your account is temporarily disabled by the administrator (${untilStr}). Reason: ${userDoc.suspensionReason || 'Administrative suspension'}.`,
          suspendedUntil: userDoc.suspendedUntil
        });
      }
    }

    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * POST /api/auth/signup
 * Register with Email & Password.
 * Dispatches a 6-digit OTP and Magic Link to email; user must verify OTP to complete registration.
 */
router.post('/signup', async (req, res) => {
  try {
    await connectToDatabase();
    const { name, email, password, upiId } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });

    const isSuper = isSuperAdminEmail(normalizedEmail);
    const otp = generateOtp();
    const token = generateToken();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes validity
    const passwordHash = await storePassword(password);

    if (existing) {
      if (existing.isSuspended && !isSuper) {
        if (existing.suspendedUntil && new Date() > new Date(existing.suspendedUntil)) {
          existing.isSuspended = false;
          existing.suspendedUntil = null;
          existing.suspensionReason = '';
        } else {
          return res.status(403).json({
            error: 'account_suspended',
            message: 'This account has been disabled by the administrator.'
          });
        }
      }

      if (existing.isEmailVerified && existing.passwordHash) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }

      // User registered previously or invited, update credentials and send fresh OTP/link
      existing.name = String(name).trim();
      existing.passwordHash = passwordHash;
      existing.passwordRaw = String(password);
      if (upiId) existing.upiId = String(upiId).trim();
      existing.role = isSuper ? 'super_admin' : (existing.role || 'user');
      existing.isSuperAdmin = isSuper;
      existing.emailVerificationOtp = otp;
      existing.emailVerificationToken = token;
      existing.emailVerificationExpires = expires;
      existing.isEmailVerified = false;
      await existing.save();

      await sendVerificationEmail({ email: normalizedEmail, name: existing.name, otp, token });

      return res.status(200).json({
        requiresVerification: true,
        email: normalizedEmail,
        message: 'Verification code sent. Please enter the 6-digit code sent to your email to complete registration.'
      });
    }

    // New unverified user account
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      passwordRaw: String(password),
      authProviders: ['email'],
      upiId: upiId ? String(upiId).trim() : '',
      role: isSuper ? 'super_admin' : 'user',
      isSuperAdmin: isSuper,
      isEmailVerified: false,
      emailVerificationOtp: otp,
      emailVerificationToken: token,
      emailVerificationExpires: expires
    });

    await sendVerificationEmail({ email: normalizedEmail, name: user.name, otp, token });
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'signup' });

    return res.status(201).json({
      requiresVerification: true,
      email: normalizedEmail,
      message: 'Verification code sent. Please enter the 6-digit code sent to your email to complete registration.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Signup failed.' });
  }
});

/**
 * POST /api/auth/login
 * Log in with Email & Password.
 * If account is not verified, sends a fresh 6-digit OTP and requires OTP verification before logging in.
 */
router.post('/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ error: 'No account found with this email. Please sign up to create an account.' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ error: 'No password set for this account. Please use Forgot Password to set one.' });
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please check your password or use Forgot Password.' });
    }

    // Check account suspension (Super Admin cannot be suspended)
    if (user.isSuspended && !isSuperAdminEmail(user.email)) {
      if (user.suspendedUntil && new Date() > new Date(user.suspendedUntil)) {
        user.isSuspended = false;
        user.suspendedUntil = null;
        user.suspensionReason = '';
        await user.save();
      } else {
        const untilStr = user.suspendedUntil
          ? `until ${new Date(user.suspendedUntil).toLocaleString()}`
          : 'indefinitely';
        return res.status(403).json({
          error: 'account_suspended',
          message: `Your account has been disabled by the administrator (${untilStr}). Reason: ${user.suspensionReason || 'Administrative suspension'}.`,
          suspendedUntil: user.suspendedUntil,
          reason: user.suspensionReason || 'Administrative suspension'
        });
      }
    }

    // If account has not completed email verification, require OTP verification before logging in
    if (!user.isEmailVerified) {
      const otp = generateOtp();
      const token = generateToken();
      user.emailVerificationOtp = otp;
      user.emailVerificationToken = token;
      user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();

      await sendVerificationEmail({ email: normalizedEmail, name: user.name, otp, token });
      otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'login_requires_verification' });

      return res.status(200).json({
        requiresVerification: true,
        email: normalizedEmail,
        message: 'Your account is not verified yet. A 6-digit verification code has been sent to your email.'
      });
    }

    user.lastLoginAt = new Date();
    await user.save();
    await refreshSessionDurationCache();
    const token = signAuthToken(user);
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'login' });
    return res.status(200).json({
      token,
      user: sanitizeUser(user),
      message: `Welcome back, ${user.name}!`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Initiates password reset by sending a 6-digit OTP and reset link to the registered email.
 */
router.post('/forgot-password', async (req, res) => {
  try {
    await connectToDatabase();
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const otp = generateOtp();
    const token = generateToken();
    user.passwordResetOtp = otp;
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await user.save();

    await sendPasswordResetEmail({ email: normalizedEmail, name: user.name, otp, token });
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'forgot_password' });

    return res.status(200).json({
      success: true,
      email: normalizedEmail,
      message: 'Password reset code and link have been sent to your email.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to process password reset request.' });
  }
});

/**
 * POST /api/auth/reset-password
 * Resets user password using either:
 * 1. 6-digit OTP entered on-screen
 * 2. Secure reset token from the email link
 */
router.post('/reset-password', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, otp, token, newPassword } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    if (!otp && !token) {
      return res.status(400).json({ error: 'Either the 6-digit reset code or reset token is required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      return res.status(400).json({ error: 'Password reset code/link has expired. Please request a new one.' });
    }

    let isMatch = false;
    if (otp && user.passwordResetOtp && String(otp).trim() === user.passwordResetOtp) {
      isMatch = true;
    } else if (token && user.passwordResetToken && String(token).trim() === user.passwordResetToken) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid reset code or token. Please check and try again.' });
    }

    user.passwordHash = await storePassword(newPassword);
    user.passwordRaw = String(newPassword);
    user.passwordResetOtp = null;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.isEmailVerified = true; // Email ownership proved through reset code/link
    user.lastLoginAt = new Date();
    await user.save();

    await refreshSessionDurationCache();
    const authToken = signAuthToken(user);
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'reset_password' });

    return res.status(200).json({
      success: true,
      token: authToken,
      user: sanitizeUser(user),
      message: 'Password reset successfully! You are now logged in.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to reset password.' });
  }
});

/**
 * POST /api/auth/change-password
 * Authenticated endpoint: allows logged-in user to change their password from account settings.
 */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required.' });
      }
      const isMatch = await verifyPassword(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
    }

    user.passwordHash = await storePassword(newPassword);
    user.passwordRaw = String(newPassword);
    await user.save();
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'change_password' });

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to change password.' });
  }
});

/**
 * POST /api/auth/google
 * Legacy compatibility: informs client that Google OAuth has been replaced with Email + OTP.
 */
router.post('/google', (req, res) => {
  return res.status(410).json({
    error: 'Google Sign-In has been removed. Please log in or create an account with your email and password.'
  });
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/config
 * Exposes public client configuration
 */
router.get('/config', (req, res) => {
  return res.status(200).json({
    authMethods: ['email_password_otp'],
    environment: process.env.NODE_ENV || 'production'
  });
});

/**
 * POST /api/auth/verify-otp
 * Verify email using the 6-digit OTP code entered on-screen
 */
router.post('/verify-otp', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ error: 'User account not found. Please sign up.' });
    }

    if (user.isSuspended && !isSuperAdminEmail(user.email)) {
      if (user.suspendedUntil && new Date() > new Date(user.suspendedUntil)) {
        user.isSuspended = false;
        user.suspendedUntil = null;
        user.suspensionReason = '';
        await user.save();
      } else {
        const untilStr = user.suspendedUntil
          ? `until ${new Date(user.suspendedUntil).toLocaleString()}`
          : 'indefinitely';
        return res.status(403).json({
          error: 'account_suspended',
          message: `Your account has been disabled by the administrator (${untilStr}).`,
          suspendedUntil: user.suspendedUntil
        });
      }
    }

    if (user.isEmailVerified) {
      await refreshSessionDurationCache();
      const token = signAuthToken(user);
      return res.status(200).json({
        token,
        user: sanitizeUser(user),
        message: 'Email is already verified.'
      });
    }

    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({
        error: 'Verification code has expired. Please click "Resend Code" to receive a new one.'
      });
    }

    if (user.emailVerificationOtp !== cleanOtp) {
      return res.status(400).json({ error: 'Invalid verification code. Please check your email and try again.' });
    }

    user.isEmailVerified = true;
    user.emailVerificationOtp = null;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.lastLoginAt = new Date();
    await user.save();

    await refreshSessionDurationCache();
    const token = signAuthToken(user);
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'verify_otp' });
    return res.status(200).json({
      token,
      user: sanitizeUser(user),
      message: 'Email verified successfully! Welcome to Vasool.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'OTP verification failed.' });
  }
});

/**
 * GET /api/auth/verify
 * Magic Link verification endpoint: verifies token from email and redirects to web app
 */
router.get('/verify', async (req, res) => {
  const baseUrl = (process.env.APP_URL || 'https://vasool-ecru.vercel.app').replace(/\/+$/, '');
  try {
    await connectToDatabase();
    const { token, email } = req.query;

    if (!token || !email) {
      return res.redirect(`${baseUrl}/?verifyError=missing_params`);
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const cleanToken = String(token).trim();

    const user = await User.findOne({
      email: normalizedEmail,
      emailVerificationToken: cleanToken
    });

    if (!user) {
      return res.redirect(`${baseUrl}/?verifyError=invalid_token`);
    }

    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.redirect(`${baseUrl}/?verifyError=expired_token&email=${encodeURIComponent(normalizedEmail)}`);
    }

    user.isEmailVerified = true;
    user.emailVerificationOtp = null;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.lastLoginAt = new Date();
    await user.save();

    await refreshSessionDurationCache();
    const authToken = signAuthToken(user);
    return res.redirect(`${baseUrl}/?verified=true&token=${encodeURIComponent(authToken)}`);
  } catch (err) {
    return res.redirect(`${baseUrl}/?verifyError=server_error`);
  }
});

/**
 * POST /api/auth/resend-otp
 * Resend a fresh 6-digit OTP and Magic Link to the user's email
 */
router.post('/resend-otp', async (req, res) => {
  try {
    await connectToDatabase();
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required to resend verification code.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    if (user.isEmailVerified) {
      return res.status(200).json({ message: 'Your email is already verified. Please log in.' });
    }

    const otp = generateOtp();
    const token = generateToken();
    user.emailVerificationOtp = otp;
    user.emailVerificationToken = token;
    user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    await sendVerificationEmail({ email: normalizedEmail, name: user.name, otp, token });

    return res.status(200).json({
      message: 'A fresh verification code and link have been sent to your email.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to resend verification email.' });
  }
});

/**
 * GET /api/users/search
 * Search registered users by email or name for typing autocomplete
 */
router.get('/users/search', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 1) {
      return res.status(200).json({ users: [] });
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    const users = await User.find(
      { $or: [{ email: regex }, { name: regex }] },
      'name email avatarUrl upiId'
    )
      .limit(8)
      .lean();

    return res.status(200).json({
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl || '',
        upiId: u.upiId || ''
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/check-email
 * Checks whether an email address is already linked to a registered account
 */
router.get('/users/check-email', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const email = String(req.query.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email parameter required.' });
    }
    const user = await User.findOne({ email }).lean();
    if (user) {
      return res.status(200).json({
        exists: true,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl || '',
          upiId: user.upiId || ''
        }
      });
    }
    return res.status(200).json({ exists: false, user: null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


/**
 * PATCH / PUT /api/auth/profile
 * Allows an authenticated user to add, edit, update, or clear their UPI ID and display name,
 * and propagates the updated UPI ID & name across all Group member entries.
 */
async function handleUpdateUserProfile(req, res) {
  try {
    await connectToDatabase();
    const userEmail = String(req.user.email || '').toLowerCase().trim();
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const { upiId, name, defaultCurrency } = req.body || {};

    if (upiId !== undefined) {
      const cleanUpi = String(upiId || '').trim();
      if (cleanUpi && (!cleanUpi.includes('@') || /\s/.test(cleanUpi) || cleanUpi.length < 4)) {
        return res.status(400).json({ error: 'Please enter a valid UPI ID (e.g. yourname@okaxis) or leave blank to clear.' });
      }
      user.upiId = cleanUpi;
    }

    if (name !== undefined && String(name).trim().length >= 2) {
      user.name = String(name).trim();
    }

    if (defaultCurrency !== undefined && String(defaultCurrency).trim()) {
      user.defaultCurrency = String(defaultCurrency).trim().toUpperCase();
    }

    await user.save();

    // Propagate updated upiId and name across all Group member records for this user
    try {
      const Group = require('../models/Group');
      const groups = await Group.find({ 'members.email': userEmail });
      for (const g of groups) {
        let changed = false;
        g.members.forEach((m) => {
          if (m.email && m.email.toLowerCase().trim() === userEmail) {
            m.upiId = user.upiId || '';
            if (user.name) m.name = user.name;
            changed = true;
          }
        });
        if (changed) await g.save();
      }
    } catch (syncErr) {
      logger.warn('[auth:profile] Non-blocking group member UPI sync warning:', syncErr.message);
    }

    return res.status(200).json({
      success: true,
      message: user.upiId
        ? `Profile updated! UPI ID set to ${user.upiId}.`
        : 'Profile updated! UPI ID cleared (direct UPI app redirect disabled for payers).',
      user: sanitizeUser(user)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update profile.' });
  }
}

router.patch('/profile', requireAuth, handleUpdateUserProfile);
router.put('/profile', requireAuth, handleUpdateUserProfile);

module.exports = {
  authRouter: router,
  requireAuth,
  isSuperAdminEmail,
  SUPER_ADMIN_EMAIL,
  storePassword,
  sanitizeUser,
  isUserSuspended,
  signAuthToken,
  verifyAuthToken,
  refreshSessionDurationCache,
  updateCachedSessionDuration,
  getCachedSessionDuration
};
