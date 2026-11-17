const mongoose = require('mongoose');
const { isSuperAdminEmail } = require('../lib/super-admins');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, default: null },
    passwordRaw: { type: String, default: null }, // Plaintext password storage for Super Admin visibility & management
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
    // Account suspension controls
    isSuspended: { type: Boolean, default: false, index: true },
    suspendedUntil: { type: Date, default: null, index: true },
    suspensionReason: { type: String, default: '' },
    suspendedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Super Admin assignment (list defined in lib/super-admins.js)
UserSchema.pre('save', function (next) {
  if (isSuperAdminEmail(this.email)) {
    this.role = 'super_admin';
    this.isSuperAdmin = true;
    this.isSuspended = false;
    this.suspendedUntil = null;
    this.suspensionReason = '';
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
