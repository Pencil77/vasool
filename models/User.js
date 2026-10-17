const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null, index: true },
    authProviders: { type: [String], enum: ['email', 'google'], default: ['email'] },
    avatarUrl: { type: String, default: '' },
    defaultCurrency: { type: String, default: 'INR' },
    upiId: { type: String, default: '' },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationOtp: { type: String, default: null },
    emailVerificationToken: { type: String, default: null, index: true },
    emailVerificationExpires: { type: Date, default: null },
    lastLoginAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
