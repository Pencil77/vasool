const mongoose = require('mongoose');

const SettlementSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    fromEmail: { type: String, required: true, lowercase: true, trim: true },
    fromName: { type: String, required: true, trim: true },
    toEmail: { type: String, required: true, lowercase: true, trim: true },
    toName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    originalClaimedAmount: { type: Number, default: null },
    currency: { type: String, default: 'INR' },
    method: { type: String, enum: ['UPI', 'Amazon Pay', 'Bank Transfer', 'Cash'], default: 'UPI' },
    referenceNote: { type: String, default: '' },
    utrNumber: { type: String, default: '' },
    adminNote: { type: String, default: '' },
    confirmedRole: { type: String, default: '' },
    recordedByEmail: { type: String, lowercase: true, trim: true, default: null },
    status: {
      type: String,
      enum: ['pending_admin_approval', 'pending_confirmation', 'confirmed', 'rejected', 'reverted'],
      default: 'pending_admin_approval'
    },
    confirmedAt: { type: Date, default: null },
    confirmedByEmail: { type: String, lowercase: true, default: null },
    confirmationToken: { type: String, default: null, index: true },
    rejectedReason: { type: String, default: '' },
    revertedAt: { type: Date, default: null },
    revertedByEmail: { type: String, lowercase: true, default: null },
    settledAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Settlement || mongoose.model('Settlement', SettlementSchema);
