const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-fallback-secret-override-in-infisical';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
    upiId: user.upiId
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
 * Register with Email & Password
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
    if (existing) {
      if (existing.passwordHash) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }
      // Account was created via Google Sign-In previously; link password
      existing.passwordHash = await bcrypt.hash(password, 12);
      if (!existing.authProviders.includes('email')) {
        existing.authProviders.push('email');
      }
      existing.lastLoginAt = new Date();
      await existing.save();
      const token = signAuthToken(existing);
      return res.status(200).json({ token, user: sanitizeUser(existing), linkedProvider: true });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      authProviders: ['email'],
      upiId: upiId ? String(upiId).trim() : ''
    });

    const token = signAuthToken(user);
    return res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Signup failed.' });
  }
});

/**
 * POST /api/auth/login
 * Log in with Email & Password
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
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!user.passwordHash) {
      return res.status(401).json({
        error: 'This account was registered with Google Sign-In. Please continue with Google or sign up to set a password.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    user.lastLoginAt = new Date();
    await user.save();
    const token = signAuthToken(user);
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
    if (credential && process.env.GOOGLE_CLIENT_ID) {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID
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
        lastLoginAt: new Date()
      });
    } else {
      user.googleId = googlePayload.sub || user.googleId;
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

module.exports = { authRouter: router, requireAuth };
