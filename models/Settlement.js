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
    settlementMode: { type: String, enum: ['direct_p2p', 'admin_hub'], default: null },
    recordedByEmail: { type: String, lowercase: true, trim: true, default: null },
    status: {
      type: String,
      enum: ['pending_admin_approval', 'pending_confirmation', 'confirmed', 'disputed', 'rejected', 'reverted'],
      default: 'pending_admin_approval'
    },
    // Workflow v2: 10-min delayed verification notification + 48-hour grace period + auto-confirm / dispute
    workflowVersion: { type: Number, default: 1 },
    verificationStage: {
      type: String,
      enum: [
        'legacy',
        'notification_pending',
        'awaiting_verification',
        'confirmed_by_receiver',
        'auto_confirmed_48h',
        'disputed',
        'reverted',
        'rejected'
      ],
      default: 'legacy'
    },
    confirmationSource: {
      type: String,
      enum: ['', 'direct_recorder', 'receiver_app', 'receiver_email', 'admin_hub', 'auto_48h'],
      default: ''
    },
    acknowledgedAt: { type: Date, default: null },
    notifyAfterAt: { type: Date, default: null, index: true },
    receiverNotifiedAt: { type: Date, default: null },
    receiverUpiIdSnapshot: { type: String, default: '' },
    gracePeriodStartedAt: { type: Date, default: null },
    gracePeriodEndsAt: { type: Date, default: null, index: true },
    autoConfirmedAt: { type: Date, default: null },
    disputedAt: { type: Date, default: null },
    disputedByEmail: { type: String, lowercase: true, default: null },
    disputeReason: { type: String, default: '' },
    disputeResolvedAt: { type: Date, default: null },
    disputeResolvedByEmail: { type: String, lowercase: true, default: null },
    disputeResolutionNote: { type: String, default: '' },
    disputeToken: { type: String, default: null, index: true },
    // Delivery tracking & concurrency/retry control
    emailDeliveryStatus: {
      type: String,
      enum: ['not_required', 'pending', 'sent', 'failed'],
      default: 'not_required'
    },
    notificationAttempts: { type: Number, default: 0 },
    notificationLastError: { type: String, default: '' },
    notificationNextRetryAt: { type: Date, default: null, index: true },
    notificationProcessingLockUntil: { type: Date, default: null },
    autoConfirmEmailSentAt: { type: Date, default: null },
    disputeEmailSentAt: { type: Date, default: null },
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

SettlementSchema.index({ workflowVersion: 1, verificationStage: 1, notifyAfterAt: 1 });
SettlementSchema.index({ workflowVersion: 1, verificationStage: 1, gracePeriodEndsAt: 1 });

module.exports = mongoose.models.Settlement || mongoose.model('Settlement', SettlementSchema);
