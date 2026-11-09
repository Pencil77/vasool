const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { connectToDatabase } = require('../lib/mongodb');
const { sendVerificationEmail } = require('../lib/mailer');
const otel = require('../lib/otel');
const User = require('../models/User');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-fallback-secret-override-in-infisical';
const GOOGLE_CLIENT_ID = process.env.VASOOL_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      name: user.name,
      authProviders: user.authProviders
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    authProviders: user.authProviders,
    defaultCurrency: user.defaultCurrency,
    upiId: user.upiId,
    isEmailVerified: Boolean(user.isEmailVerified)
  };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * POST /api/auth/signup
 * Register with Email & Password (initiates 6-digit OTP + Magic Link email verification)
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

    const otp = generateOtp();
    const token = generateToken();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes validity
    const passwordHash = await storePassword(password);

    if (existing) {
      if (existing.isEmailVerified && existing.passwordHash) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }

      // If user was created via Google Sign-In previously (pre-verified), link password directly
      if (existing.authProviders.includes('google') && existing.isEmailVerified) {
        existing.passwordHash = passwordHash;
        if (!existing.authProviders.includes('email')) {
          existing.authProviders.push('email');
        }
        existing.lastLoginAt = new Date();
        await existing.save();
        const authToken = signAuthToken(existing);
        return res.status(200).json({
          token: authToken,
          user: sanitizeUser(existing),
          linkedProvider: true,
          message: 'Password successfully linked to your existing Google account.'
        });
      }

      // User registered previously with email/password but never verified: update credentials and send fresh OTP/link
      existing.name = String(name).trim();
      existing.passwordHash = passwordHash;
      if (upiId) existing.upiId = String(upiId).trim();
      existing.emailVerificationOtp = otp;
      existing.emailVerificationToken = token;
      existing.emailVerificationExpires = expires;
      existing.isEmailVerified = false;
      await existing.save();

      await sendVerificationEmail({ email: normalizedEmail, name: existing.name, otp, token });

      return res.status(200).json({
        requiresVerification: true,
        email: normalizedEmail,
        message: 'Verification email sent. Please enter the 6-digit code or click the verification link in your email.'
      });
    }

    // New unverified user account
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      authProviders: ['email'],
      upiId: upiId ? String(upiId).trim() : '',
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
      message: 'Verification email sent. Please enter the 6-digit code or click the verification link in your email.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Signup failed.' });
  }
});

/**
 * POST /api/auth/login
 * Unified Auth: Log in with Email & Password.
 * If user does not exist, automatically record their name and details and create the account.
 */
router.post('/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, password, name, upiId } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      // Seamless Unified Auth: User signing in without signing up beforehand.
      // Automatically record their name and details and create their account.
      const userName = (name && String(name).trim()) ? String(name).trim() : normalizedEmail.split('@')[0];
      const passwordHash = await storePassword(password);
      user = await User.create({
        name: userName,
        email: normalizedEmail,
        passwordHash,
        upiId: upiId ? String(upiId).trim() : '',
        authProviders: ['email'],
        isEmailVerified: true,
        lastLoginAt: new Date()
      });
      const token = signAuthToken(user);
      otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'unified_auto_signup' });
      return res.status(200).json({
        token,
        user: sanitizeUser(user),
        isNewUser: true,
        message: `Welcome to Vasool, ${user.name}! Your account has been created.`
      });
    }

    if (!user.passwordHash) {
      // User registered with Google or invite placeholder previously, set their password now
      user.passwordHash = await storePassword(password);
      if (!user.authProviders.includes('email')) {
        user.authProviders.push('email');
      }
      if (name && (!user.name || user.name === normalizedEmail.split('@')[0])) {
        user.name = String(name).trim();
      }
      if (upiId && !user.upiId) {
        user.upiId = String(upiId).trim();
      }
      user.isEmailVerified = true;
      user.lastLoginAt = new Date();
      await user.save();
      const token = signAuthToken(user);
      otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'link_password' });
      return res.status(200).json({ token, user: sanitizeUser(user), linkedProvider: true });
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password for this email. Please check your password or sign in with Google.' });
    }

    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
    }
    if (name && (!user.name || user.name === normalizedEmail.split('@')[0])) {
      user.name = String(name).trim();
    }
    if (upiId && !user.upiId) {
      user.upiId = String(upiId).trim();
    }
    user.lastLoginAt = new Date();
    await user.save();
    const token = signAuthToken(user);
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'email', action: 'login' });
    return res.status(200).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

/**
 * POST /api/auth/google
 * Google OAuth 2.0 Sign-Up / Sign-In (verifies Google ID token from Google Identity Services)
 */
router.post('/google', async (req, res) => {
  try {
    await connectToDatabase();
    const { credential, profileFallback } = req.body;

    let googlePayload = null;
    if (credential && GOOGLE_CLIENT_ID) {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      googlePayload = ticket.getPayload();
    } else if (profileFallback && profileFallback.email) {
      // Development fallback when testing locally before setting GOOGLE_CLIENT_ID
      googlePayload = {
        sub: profileFallback.sub || 'google_' + Date.now(),
        email: profileFallback.email,
        name: profileFallback.name || profileFallback.email.split('@')[0],
        picture: profileFallback.picture || ''
      };
    } else {
      return res.status(400).json({ error: 'Missing Google ID token credential.' });
    }

    const normalizedEmail = String(googlePayload.email).toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({
        name: googlePayload.name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        googleId: googlePayload.sub,
        avatarUrl: googlePayload.picture || '',
        authProviders: ['google'],
        isEmailVerified: true,
        lastLoginAt: new Date()
      });
    } else {
      user.googleId = googlePayload.sub || user.googleId;
      user.isEmailVerified = true;
      user.emailVerificationOtp = null;
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
      if (googlePayload.picture && !user.avatarUrl) {
        user.avatarUrl = googlePayload.picture;
      }
      if (!user.authProviders.includes('google')) {
        user.authProviders.push('google');
      }
      user.lastLoginAt = new Date();
      await user.save();
    }

    const token = signAuthToken(user);
    otel.metrics.counter('vasool_auth_operations_total', 1, { provider: 'google', action: 'oauth' });
    return res.status(200).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    const isAuthError = err.message && (
      err.message.toLowerCase().includes('token') ||
      err.message.toLowerCase().includes('signature') ||
      err.message.toLowerCase().includes('audience') ||
      err.message.toLowerCase().includes('recipient') ||
      err.message.toLowerCase().includes('jwt') ||
      err.message.toLowerCase().includes('wrong number of segments')
    );
    return res.status(isAuthError ? 401 : 500).json({ error: err.message || 'Google authentication failed.' });
  }
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
 * Exposes public client configuration (e.g. Google OAuth 2.0 Web Client ID)
 */
router.get('/config', (req, res) => {
  return res.status(200).json({
    googleClientId: GOOGLE_CLIENT_ID || null,
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

    if (user.isEmailVerified) {
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

module.exports = { authRouter: router, requireAuth };
