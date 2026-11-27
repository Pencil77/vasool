const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    recipientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    type: {
      type: String,
      enum: [
        'payment_acknowledged',
        'payment_confirmed',
        'payment_auto_confirmed',
        'payment_disputed',
        'dispute_resolved',
        'payment_reverted',
        'group_invite',
        'settlement_update'
      ],
      required: true
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    groupName: { type: String, default: '', trim: true },
    settlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Settlement', default: null },
    amount: { type: Number, default: null },
    currency: { type: String, default: 'INR' },
    senderEmail: { type: String, default: '', lowercase: true, trim: true },
    senderName: { type: String, default: '', trim: true },
    receiverEmail: { type: String, default: '', lowercase: true, trim: true },
    receiverName: { type: String, default: '', trim: true },
    targetTab: { type: String, default: 'settle' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    isDismissed: { type: Boolean, default: false, index: true },
    dismissedAt: { type: Date, default: null },
    // Unique idempotency key per event & recipient so background workers/retries never duplicate
    eventKey: { type: String, unique: true, sparse: true }
  },
  { timestamps: true }
);

NotificationSchema.index({ recipientEmail: 1, isDismissed: 1, createdAt: -1 });
NotificationSchema.index({ recipientEmail: 1, createdAt: -1 });
NotificationSchema.index({ recipientEmail: 1, isRead: 1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
