const mongoose = require('mongoose');

const SUPER_ADMIN_EMAIL = 'mdzubair7592@gmail.com';

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
    role: { type: String, enum: ['user', 'super_admin'], default: 'user', index: true },
    isSuperAdmin: { type: Boolean, default: false, index: true },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationOtp: { type: String, default: null },
    emailVerificationToken: { type: String, default: null, index: true },
    emailVerificationExpires: { type: Date, default: null },
    passwordResetOtp: { type: String, default: null },
    passwordResetToken: { type: String, default: null, index: true },
    passwordResetExpires: { type: Date, default: null },
    lastLoginAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Hardcoded single Super Admin assignment for Zoro (mdzubair7592@gmail.com)
UserSchema.pre('save', function (next) {
  if (this.email && this.email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    this.role = 'super_admin';
    this.isSuperAdmin = true;
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
