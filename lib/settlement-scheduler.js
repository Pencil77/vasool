const Settlement = require('../models/Settlement');
const Group = require('../models/Group');
const User = require('../models/User');
const Notification = require('../models/Notification');
const logger = require('./logger');
const otel = require('./otel');
const { appendGroupAuditLog } = require('./debt-engine');
const {
  sendPaymentConfirmationRequestEmail,
  sendDisputeAlertToSenderEmail,
  sendDisputeAlertToAdminEmail,
  sendPaymentAutoConfirmedEmail,
  formatDateTimeIST
} = require('./mailer');

const NOTIFICATION_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000; // 48 hours
const PROCESSING_LOCK_MS = 2 * 60 * 1000; // 2-minute atomic lock lease
const MAX_EMAIL_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

let lastCatchupRunAt = 0;

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function getGroupAdminRecipients(group) {
  if (!group) return [];
  const adminMap = new Map();
  const addAdmin = (email, name) => {
    const clean = normalizeEmail(email);
    if (!clean) return;
    if (!adminMap.has(clean)) {
      adminMap.set(clean, { email: clean, name: String(name || clean).trim() });
    }
  };

  if (Array.isArray(group.members)) {
    group.members.forEach((m) => {
      if (m && (m.role === 'admin' || m.role === 'owner')) {
        addAdmin(m.email, m.name);
      }
    });
  }
  if (group.adminEmail) {
    const matched = (group.members || []).find((m) => normalizeEmail(m.email) === normalizeEmail(group.adminEmail));
    addAdmin(group.adminEmail, matched?.name);
  }
  if (adminMap.size === 0 && group.createdByEmail) {
    const matched = (group.members || []).find((m) => normalizeEmail(m.email) === normalizeEmail(group.createdByEmail));
    addAdmin(group.createdByEmail, matched?.name);
  }
  if (adminMap.size === 0 && Array.isArray(group.members) && group.members[0]) {
    addAdmin(group.members[0].email, group.members[0].name);
  }
  return Array.from(adminMap.values());
}

/**
 * Strictly idempotent in-app notification creation keyed on `eventKey`.
 */
async function createNotificationIdempotent(payload) {
  const cleanRecipient = normalizeEmail(payload.recipientEmail);
  if (!cleanRecipient) return null;

  const doc = {
    recipientEmail: cleanRecipient,
    type: payload.type,
    title: String(payload.title || '').trim(),
    message: String(payload.message || '').trim(),
    groupId: payload.groupId || null,
    groupName: String(payload.groupName || '').trim(),
    settlementId: payload.settlementId || null,
    amount: payload.amount !== undefined && payload.amount !== null ? Number(payload.amount) : null,
    currency: payload.currency || 'INR',
    senderEmail: normalizeEmail(payload.senderEmail),
    senderName: String(payload.senderName || '').trim(),
    receiverEmail: normalizeEmail(payload.receiverEmail),
    receiverName: String(payload.receiverName || '').trim(),
    targetTab: payload.targetTab || 'settle',
    metadata: payload.metadata || {},
    isRead: false
  };

  if (payload.eventKey) {
    try {
      const res = await Notification.updateOne(
        { eventKey: payload.eventKey },
        { $setOnInsert: { ...doc, eventKey: payload.eventKey } },
        { upsert: true }
      );
      return res;
    } catch (err) {
      if (err && err.code === 11000) return null; // Already created concurrently
      throw err;
    }
  }
  return Notification.create(doc);
}

/**
 * Resolves the receiver's registered UPI ID from their User profile (or group member cache).
 */
async function resolveReceiverUpiSnapshot(toEmail, group) {
  const cleanTo = normalizeEmail(toEmail);
  if (!cleanTo) return '';
  const userDoc = await User.findOne({ email: cleanTo }, 'upiId').lean();
  if (userDoc && userDoc.upiId && String(userDoc.upiId).trim()) {
    return String(userDoc.upiId).trim();
  }
  if (group && Array.isArray(group.members)) {
    const member = group.members.find((m) => normalizeEmail(m.email) === cleanTo);
    if (member && member.upiId && String(member.upiId).trim()) {
      return String(member.upiId).trim();
    }
  }
  return '';
}

/**
 * Processes settlements whose 10-minute notification delay has elapsed,
 * as well as failed verification email deliveries due for retry.
 */
async function processDueDelayedNotifications({ now = new Date(), limit = 25, mailSenders = null } = {}) {
  const sendConfirmMail = mailSenders?.sendPaymentConfirmationRequestEmail || sendPaymentConfirmationRequestEmail;
  const nowDate = now instanceof Date ? now : new Date(now);
  const lockExpiry = new Date(nowDate.getTime() + PROCESSING_LOCK_MS);

  const candidates = await Settlement.find({
    workflowVersion: 2,
    status: { $in: ['pending_confirmation', 'pending_admin_approval'] },
    $and: [
      {
        $or: [
          { notificationProcessingLockUntil: null },
          { notificationProcessingLockUntil: { $lt: nowDate } }
        ]
      },
      {
        $or: [
          {
            verificationStage: 'notification_pending',
            notifyAfterAt: { $lte: nowDate }
          },
          {
            verificationStage: 'awaiting_verification',
            emailDeliveryStatus: 'failed',
            notificationAttempts: { $lt: MAX_EMAIL_ATTEMPTS },
            $or: [
              { notificationNextRetryAt: null },
              { notificationNextRetryAt: { $lte: nowDate } }
            ]
          }
        ]
      }
    ]
  })
    .sort({ notifyAfterAt: 1 })
    .limit(limit)
    .lean();

  let notifiedCount = 0;
  let emailRetrySuccessCount = 0;
  let emailFailedCount = 0;

  for (const cand of candidates) {
    // Atomically acquire lock lease on this candidate
    const claimed = await Settlement.findOneAndUpdate(
      {
        _id: cand._id,
        status: { $in: ['pending_confirmation', 'pending_admin_approval'] },
        verificationStage: cand.verificationStage,
        $or: [
          { notificationProcessingLockUntil: null },
          { notificationProcessingLockUntil: { $lt: nowDate } }
        ]
      },
      {
        $set: { notificationProcessingLockUntil: lockExpiry }
      },
      { new: true }
    );

    if (!claimed) continue;

    try {
      const group = await Group.findById(claimed.groupId).lean();
      const groupName = group ? group.name : 'Shared Group';
      const upiId = await resolveReceiverUpiSnapshot(claimed.toEmail, group);

      let graceStart = claimed.gracePeriodStartedAt;
      let graceEnd = claimed.gracePeriodEndsAt;
      const isInitialDispatch = claimed.verificationStage === 'notification_pending';

      if (isInitialDispatch) {
        graceStart = nowDate;
        graceEnd = new Date(nowDate.getTime() + GRACE_PERIOD_MS);

        // Transition settlement to awaiting_verification + anchor exact server 48h grace deadline
        await Settlement.updateOne(
          { _id: claimed._id, verificationStage: 'notification_pending' },
          {
            $set: {
              verificationStage: 'awaiting_verification',
              receiverUpiIdSnapshot: upiId,
              gracePeriodStartedAt: graceStart,
              gracePeriodEndsAt: graceEnd,
              emailDeliveryStatus: 'pending'
            }
          }
        );

        claimed.verificationStage = 'awaiting_verification';
        claimed.receiverUpiIdSnapshot = upiId;
        claimed.gracePeriodStartedAt = graceStart;
        claimed.gracePeriodEndsAt = graceEnd;

        const paidTimeStr = formatDateTimeIST(claimed.acknowledgedAt || claimed.settledAt || claimed.createdAt);
        const upiHint = upiId ? ` Please verify in UPI ID: ${upiId}.` : '';

        await createNotificationIdempotent({
          eventKey: `payment_acknowledged:${claimed._id}:${normalizeEmail(claimed.toEmail)}`,
          recipientEmail: claimed.toEmail,
          type: 'payment_acknowledged',
          title: `₹${Number(claimed.amount).toFixed(2)} marked sent by ${claimed.fromName}`,
          message: `${claimed.fromName} marked ₹${Number(claimed.amount).toFixed(2)} as paid in "${groupName}" on ${paidTimeStr}.${upiHint} Report within 48h if not received.`,
          groupId: claimed.groupId,
          groupName,
          settlementId: claimed._id,
          amount: claimed.amount,
          currency: claimed.currency || 'INR',
          senderEmail: claimed.fromEmail,
          senderName: claimed.fromName,
          receiverEmail: claimed.toEmail,
          receiverName: claimed.toName,
          targetTab: 'settle',
          metadata: {
            receiverUpiId: upiId,
            acknowledgedAt: claimed.acknowledgedAt || claimed.createdAt,
            gracePeriodEndsAt: graceEnd
          }
        });
        notifiedCount++;
      }

      // Send or retry confirmation email to receiver
      const mailRes = await sendConfirmMail({
        settlement: claimed,
        group,
        confirmToken: claimed.confirmationToken,
        disputeToken: claimed.disputeToken,
        receiverUpiId: upiId,
        gracePeriodEndsAt: graceEnd
      });

      if (mailRes && mailRes.success) {
        await Settlement.updateOne(
          { _id: claimed._id },
          {
            $set: {
              emailDeliveryStatus: 'sent',
              receiverNotifiedAt: claimed.receiverNotifiedAt || nowDate,
              notificationNextRetryAt: null,
              notificationLastError: '',
              notificationProcessingLockUntil: null
            },
            $inc: { notificationAttempts: 1 }
          }
        );
        if (!isInitialDispatch) emailRetrySuccessCount++;
      } else {
        const nextAttempt = (claimed.notificationAttempts || 0) + 1;
        const backoff = RETRY_BACKOFF_MS[Math.min(nextAttempt - 1, RETRY_BACKOFF_MS.length - 1)];
        await Settlement.updateOne(
          { _id: claimed._id },
          {
            $set: {
              emailDeliveryStatus: 'failed',
              notificationLastError: String(mailRes?.error || 'Email transport failure').slice(0, 500),
              notificationNextRetryAt: nextAttempt < MAX_EMAIL_ATTEMPTS ? new Date(nowDate.getTime() + backoff) : null,
              notificationProcessingLockUntil: null
            },
            $inc: { notificationAttempts: 1 }
          }
        );
        emailFailedCount++;
      }
    } catch (err) {
      logger.error(`[scheduler] Error processing delayed notification for settlement ${claimed._id}:`, err);
      const nextAttempt = (claimed.notificationAttempts || 0) + 1;
      const backoff = RETRY_BACKOFF_MS[Math.min(nextAttempt - 1, RETRY_BACKOFF_MS.length - 1)];
      await Settlement.updateOne(
        { _id: claimed._id },
        {
          $set: {
            emailDeliveryStatus: 'failed',
            notificationLastError: String(err.message || err).slice(0, 500),
            notificationNextRetryAt: nextAttempt < MAX_EMAIL_ATTEMPTS ? new Date(nowDate.getTime() + backoff) : null,
            notificationProcessingLockUntil: null
          },
          $inc: { notificationAttempts: 1 }
        }
      ).catch(() => {});
      emailFailedCount++;
    }
  }

  return { notifiedCount, emailRetrySuccessCount, emailFailedCount };
}

/**
 * Atomically auto-confirms settlements whose 48-hour verification grace period has expired
 * without being confirmed, reverted, rejected, or disputed.
 */
async function processDueAutoConfirmations({ now = new Date(), limit = 25, mailSenders = null } = {}) {
  const sendAutoMail = mailSenders?.sendPaymentAutoConfirmedEmail || sendPaymentAutoConfirmedEmail;
  const nowDate = now instanceof Date ? now : new Date(now);

  const candidates = await Settlement.find({
    workflowVersion: 2,
    verificationStage: 'awaiting_verification',
    status: { $in: ['pending_confirmation', 'pending_admin_approval'] },
    gracePeriodEndsAt: { $lte: nowDate },
    disputedAt: null
  })
    .sort({ gracePeriodEndsAt: 1 })
    .limit(limit)
    .lean();

  let autoConfirmedCount = 0;

  for (const cand of candidates) {
    // Atomic conditional transition: prevents race against concurrent Confirm / Dispute / Revert
    const updated = await Settlement.findOneAndUpdate(
      {
        _id: cand._id,
        status: { $in: ['pending_confirmation', 'pending_admin_approval'] },
        verificationStage: 'awaiting_verification',
        gracePeriodEndsAt: { $lte: nowDate },
        disputedAt: null
      },
      {
        $set: {
          status: 'confirmed',
          verificationStage: 'auto_confirmed_48h',
          confirmedAt: nowDate,
          autoConfirmedAt: nowDate,
          confirmedByEmail: 'system@vasool.auto',
          confirmedRole: 'auto_48h',
          confirmationSource: 'auto_48h',
          confirmationToken: null,
          disputeToken: null,
          notificationProcessingLockUntil: null
        }
      },
      { new: true }
    );

    if (!updated) continue; // Lost race to concurrent receiver action — safe no-op!

    autoConfirmedCount++;
    const group = await Group.findById(updated.groupId);
    const groupName = group ? group.name : 'Shared Group';

    if (group) {
      appendGroupAuditLog(group, {
        action: 'settlement_auto_confirmed',
        actorEmail: 'system@vasool.auto',
        actorName: 'Vasool Auto-Verification',
        summary: `₹${updated.amount} payment from ${updated.fromName} to ${updated.toName} auto-confirmed after 48-hour verification grace period`,
        details: `${updated.method}${updated.utrNumber ? ' · UTR: ' + updated.utrNumber : ''}`
      });
      await group.save();
    }

    otel.metrics.counter('vasool_settlements_confirmed_total', 1, {
      confirmed_role: 'auto_48h',
      partial: 'false'
    });

    // Idempotent In-App Notifications for Sender & Receiver
    const recipients = [
      { email: updated.fromEmail, name: updated.fromName, isSender: true },
      { email: updated.toEmail, name: updated.toName, isSender: false }
    ];

    for (const r of recipients) {
      await createNotificationIdempotent({
        eventKey: `payment_auto_confirmed:${updated._id}:${normalizeEmail(r.email)}`,
        recipientEmail: r.email,
        type: 'payment_auto_confirmed',
        title: `₹${Number(updated.amount).toFixed(2)} auto-confirmed (48h elapsed)`,
        message: r.isSender
          ? `Your ₹${Number(updated.amount).toFixed(2)} payment to ${updated.toName} in "${groupName}" was automatically confirmed after the 48-hour grace period.`
          : `₹${Number(updated.amount).toFixed(2)} from ${updated.fromName} in "${groupName}" was automatically confirmed after the 48-hour grace period ended without dispute.`,
        groupId: updated.groupId,
        groupName,
        settlementId: updated._id,
        amount: updated.amount,
        currency: updated.currency || 'INR',
        senderEmail: updated.fromEmail,
        senderName: updated.fromName,
        receiverEmail: updated.toEmail,
        receiverName: updated.toName,
        targetTab: 'settle',
        metadata: { autoConfirmedAt: nowDate }
      });
    }

    // Dispatch Email #4 to Sender & Receiver
    const mailResults = await Promise.allSettled(
      recipients.map((r) =>
        sendAutoMail({
          settlement: updated,
          group,
          recipientEmail: r.email,
          recipientName: r.name,
          isSender: r.isSender
        })
      )
    );
    if (mailResults.every((m) => m.status === 'fulfilled' && m.value?.success)) {
      await Settlement.updateOne({ _id: updated._id }, { $set: { autoConfirmEmailSentAt: nowDate } });
    }
  }

  return { autoConfirmedCount };
}

/**
 * Runs both delayed notification dispatch and 48-hour auto-confirm sweeps.
 */
async function processDueSettlementJobs({ now = new Date(), mailSenders = null } = {}) {
  const delayed = await processDueDelayedNotifications({ now, mailSenders });
  const autoConf = await processDueAutoConfirmations({ now, mailSenders });
  return { ...delayed, ...autoConf };
}

/**
 * Throttled catch-up hook invoked safely during API requests (bootstrap, notifications, settlements)
 * so transitions occur promptly even without external cron traffic, without adding DB overhead on rapid requests.
 */
async function maybeRunScheduledSettlementCatchup({ force = false, minIntervalMs = 30000 } = {}) {
  const nowMs = Date.now();
  if (!force && nowMs - lastCatchupRunAt < minIntervalMs) {
    return null;
  }
  lastCatchupRunAt = nowMs;
  try {
    return await processDueSettlementJobs({ now: new Date(nowMs) });
  } catch (err) {
    logger.warn('[scheduler] Catchup sweep warning:', err.message);
    return null;
  }
}

/**
 * Immediately sends In-App + Email dispute alerts to Original Sender and Group Admin(s).
 */
async function notifyDisputeParties({ settlement, group, reporterName, disputeReason, mailSenders = null }) {
  const sendSenderMail = mailSenders?.sendDisputeAlertToSenderEmail || sendDisputeAlertToSenderEmail;
  const sendAdminMail = mailSenders?.sendDisputeAlertToAdminEmail || sendDisputeAlertToAdminEmail;

  const groupName = group ? group.name : 'Shared Group';
  const ackTimeStr = formatDateTimeIST(settlement.acknowledgedAt || settlement.settledAt || settlement.createdAt);
  const amountStr = `₹${Number(settlement.amount).toFixed(2)}`;
  const senderEmail = normalizeEmail(settlement.fromEmail);
  const reporterDisplay = reporterName || settlement.toName || settlement.toEmail;
  const reasonDisplay = disputeReason || settlement.disputeReason || 'Payment not received in bank/UPI account';

  // 1. In-app notification + Email to original sender (and recorder if distinct)
  const senderRecipients = new Map();
  if (senderEmail) senderRecipients.set(senderEmail, settlement.fromName || senderEmail);
  if (settlement.recordedByEmail && normalizeEmail(settlement.recordedByEmail) !== senderEmail && normalizeEmail(settlement.recordedByEmail) !== normalizeEmail(settlement.toEmail)) {
    senderRecipients.set(normalizeEmail(settlement.recordedByEmail), settlement.recordedByEmail);
  }

  const emailPromises = [];
  for (const [em, nm] of senderRecipients.entries()) {
    await createNotificationIdempotent({
      eventKey: `payment_disputed_sender:${settlement._id}:${em}`,
      recipientEmail: em,
      type: 'payment_disputed',
      title: `Payment Disputed: ${reporterDisplay} reported ${amountStr} not received`,
      message: `${reporterDisplay} reported your ${amountStr} settlement in "${groupName}" (marked paid on ${ackTimeStr}) as not received. Issue: "${reasonDisplay}".`,
      groupId: settlement.groupId,
      groupName,
      settlementId: settlement._id,
      amount: settlement.amount,
      currency: settlement.currency || 'INR',
      senderEmail: settlement.fromEmail,
      senderName: settlement.fromName,
      receiverEmail: settlement.toEmail,
      receiverName: reporterDisplay,
      targetTab: 'settle',
      metadata: { disputeReason: reasonDisplay, disputedAt: settlement.disputedAt, acknowledgedAt: settlement.acknowledgedAt }
    });
    emailPromises.push(
      sendSenderMail({
        settlement: { ...settlement.toObject ? settlement.toObject() : settlement, fromEmail: em, fromName: nm },
        group,
        reporterName: reporterDisplay,
        disputeReason: reasonDisplay
      })
    );
  }

  // 2. In-app notification + Email to all Group Administrator(s)
  const admins = getGroupAdminRecipients(group);
  for (const adm of admins) {
    // Avoid sending duplicate notification/email if the reporter themselves or sender already received the sender alert
    if (adm.email === normalizeEmail(settlement.toEmail)) continue;
    await createNotificationIdempotent({
      eventKey: `payment_disputed_admin:${settlement._id}:${adm.email}`,
      recipientEmail: adm.email,
      type: 'payment_disputed',
      title: `Admin Alert: ${reporterDisplay} disputed ${amountStr} in "${groupName}"`,
      message: `${reporterDisplay} reported ${settlement.fromName}'s ${amountStr} payment (marked paid ${ackTimeStr}) as not received. Issue: "${reasonDisplay}".`,
      groupId: settlement.groupId,
      groupName,
      settlementId: settlement._id,
      amount: settlement.amount,
      currency: settlement.currency || 'INR',
      senderEmail: settlement.fromEmail,
      senderName: settlement.fromName,
      receiverEmail: settlement.toEmail,
      receiverName: reporterDisplay,
      targetTab: 'settle',
      metadata: { disputeReason: reasonDisplay, disputedAt: settlement.disputedAt, acknowledgedAt: settlement.acknowledgedAt, isAdminAlert: true }
    });
    // Still dispatch admin alert email even if admin was the sender, or skip duplicate email?
    // Requirements explicitly say: immediately notify "The original sender" and "The group administrator(s)".
    if (!senderRecipients.has(adm.email)) {
      emailPromises.push(
        sendAdminMail({
          settlement,
          group,
          adminEmail: adm.email,
          adminName: adm.name,
          reporterName: reporterDisplay,
          disputeReason: reasonDisplay
        })
      );
    }
  }

  const results = await Promise.allSettled(emailPromises);
  if (results.length > 0 && results.every((r) => r.status === 'fulfilled' && r.value?.success)) {
    await Settlement.updateOne({ _id: settlement._id }, { $set: { disputeEmailSentAt: new Date() } }).catch(() => {});
  }
  return results;
}

module.exports = {
  NOTIFICATION_DELAY_MS,
  GRACE_PERIOD_MS,
  MAX_EMAIL_ATTEMPTS,
  RETRY_BACKOFF_MS,
  getGroupAdminRecipients,
  createNotificationIdempotent,
  resolveReceiverUpiSnapshot,
  processDueDelayedNotifications,
  processDueAutoConfirmations,
  processDueSettlementJobs,
  maybeRunScheduledSettlementCatchup,
  notifyDisputeParties
};
