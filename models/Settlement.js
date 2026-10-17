const mongoose = require('mongoose');

const SettlementSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    fromEmail: { type: String, required: true, lowercase: true, trim: true },
    fromName: { type: String, required: true, trim: true },
    toEmail: { type: String, required: true, lowercase: true, trim: true },
    toName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'INR' },
    method: { type: String, enum: ['UPI', 'Amazon Pay', 'Bank Transfer', 'Cash'], default: 'UPI' },
    referenceNote: { type: String, default: '' },
    settledAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Settlement || mongoose.model('Settlement', SettlementSchema);
