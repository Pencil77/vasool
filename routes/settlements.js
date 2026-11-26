const express = require('express');
const crypto = require('crypto');
const { connectToDatabase } = require('../lib/mongodb');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const { requireAuth, verifyAuthToken } = require('./auth');
const logger = require('../lib/logger');
const otel = require('../lib/otel');
const {
  NOTIFICATION_DELAY_MS,
  GRACE_PERIOD_MS,
  createNotificationIdempotent,
  resolveReceiverUpiSnapshot,
  processDueSettlementJobs,
  maybeRunScheduledSettlementCatchup,
  notifyDisputeParties
} = require('../lib/settlement-scheduler');
const {
  SUPER_ADMIN_EMAIL,
  isSuperAdminUser,
  appendGroupAuditLog,
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
  getExpensePayerAllocations,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
} = require('../lib/debt-engine');

const router = express.Router();

// GET /api/balances - Calculate net balances and simplified minimum-cash-flow settlements
router.get('/balances', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    await maybeRunScheduledSettlementCatchup();
    const groupFilter = req.query.groupId
      ? { _id: req.query.groupId }
      : { 'members.email': req.user.email };

    const groups = await Group.find(groupFilter);
    const groupIds = groups.map((g) => g._id);

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId: { $in: groupIds } }),
      Settlement.find({ groupId: { $in: groupIds } }).sort({ settledAt: -1 })
    ]);

    let simplifiedTransactions = [];
    const balanceMap = {};

    groups.forEach((g) => {
      const grpExpenses = expenses.filter((e) => String(e.groupId) === String(g._id));
      const grpSettlements = settlements.filter((s) => String(s.groupId) === String(g._id));

      const grpBalanceMap = computeGroupBalanceMap(g, grpExpenses, grpSettlements);
      const grpSimplified = computeGroupSimplifiedDebts(g, grpBalanceMap, grpExpenses, grpSettlements);
      simplifiedTransactions.push(...grpSimplified);

      Object.values(grpBalanceMap).forEach((b) => {
        if (!balanceMap[b.email]) {
          balanceMap[b.email] = { ...b };
        } else {
          balanceMap[b.email].paid = Math.round((balanceMap[b.email].paid + b.paid) * 100) / 100;
          balanceMap[b.email].owed = Math.round((balanceMap[b.email].owed + b.owed) * 100) / 100;
          balanceMap[b.email].net = Math.round((balanceMap[b.email].net + b.net) * 100) / 100;
          balanceMap[b.email].paidExpenses = Math.round(((balanceMap[b.email].paidExpenses || 0) + (b.paidExpenses || 0)) * 100) / 100;
          balanceMap[b.email].owedSplits = Math.round(((balanceMap[b.email].owedSplits || 0) + (b.owedSplits || 0)) * 100) / 100;
          balanceMap[b.email].settledPaid = Math.round(((balanceMap[b.email].settledPaid || 0) + (b.settledPaid || 0)) * 100) / 100;
          balanceMap[b.email].settledReceived = Math.round(((balanceMap[b.email].settledReceived || 0) + (b.settledReceived || 0)) * 100) / 100;
          balanceMap[b.email].pendingPaid = Math.round(((balanceMap[b.email].pendingPaid || 0) + (b.pendingPaid || 0)) * 100) / 100;
          balanceMap[b.email].pendingReceived = Math.round(((balanceMap[b.email].pendingReceived || 0) + (b.pendingReceived || 0)) * 100) / 100;
          balanceMap[b.email].unconfirmedNet = Math.round((balanceMap[b.email].net + (balanceMap[b.email].pendingPaid || 0) - (balanceMap[b.email].pendingReceived || 0)) * 100) / 100;
        }
      });
    });

    const pendingSettlements = settlements.filter(
      (s) => s.status === 'pending_admin_approval' || s.status === 'pending_confirmation' || s.status === 'pending'
    );

    const requesterEmail = req.user.email.toLowerCase().trim();
    let balances = Object.values(balanceMap);

    // Privacy rule: Settlement plan and simplified split list only expose the
    // requester's own transactions. Other members' amounts are visible on
    // bills/events (subject to group Split Visibility), never in this plan.
    const isRequesterAdmin = isSuperAdminUser(req.user) || groups.some((g) => {
      const isGrpAdmin = (g.adminEmail && g.adminEmail.toLowerCase() === requesterEmail) ||
        (g.createdByEmail && g.createdByEmail.toLowerCase() === requesterEmail) ||
        (Array.isArray(g.members) && g.members.some((m) => m.email.toLowerCase().trim() === requesterEmail && (m.role === 'admin' || m.role === 'owner'))) ||
        ((g.members?.[0]?.email || '').toLowerCase().trim() === requesterEmail);
      return Boolean(isGrpAdmin);
    });

    // Closure status is derived from the full group picture, before the
    // privacy filter below removes other members' transfers from the response.
    const isFullyClosed = simplifiedTransactions.length === 0 && pendingSettlements.length === 0;

    if (!isRequesterAdmin) {
      simplifiedTransactions = simplifiedTransactions.filter(
        (t) => t.fromEmail.toLowerCase() === requesterEmail || t.toEmail.toLowerCase() === requesterEmail
      );
      const adminEmails = new Set(
        groups.map((g) => {
          const adm = g.members.find((m) => m.role === 'admin') ||
            (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
            g.members[0];
          return adm ? adm.email.toLowerCase().trim() : '';
        })
      );
      balances = balances.filter(
        (b) => b.email.toLowerCase() === requesterEmail || adminEmails.has(b.email.toLowerCase())
      );
    }

    // Payer recommendation suggestion removed per user preference
    const whoShouldPay = null;

    return res.status(200).json({
      balances,
      simplifiedTransactions,
      settlements,
      pendingSettlements,
      whoShouldPay,
      isFullyClosed
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements - Record a debt settlement
router.post('/settlements', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { groupId, fromEmail, fromName, toEmail, toName, amount, currency, method, referenceNote } = req.body;
    if (!groupId || !fromEmail || !toEmail || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid groupId, payer, recipient, and amount are required.' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const adminMember = group.members.find((m) => m.role === 'admin' || m.role === 'owner') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isGroupAdmin = (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail);
    const isSuperAdmin = isSuperAdminUser(req.user);
    const isAdmin = isSuperAdmin || isGroupAdmin;

    const cleanFromEmail = String(fromEmail).toLowerCase().trim();
    const cleanToEmail = String(toEmail).toLowerCase().trim();
    const roundedAmount = Math.round(Number(amount) * 100) / 100;

    const now = new Date();
    const isTargetCreditor = cleanToEmail === requesterEmail;
    const isHubMode = Boolean(group.adminHubSettlement);

    // Direct Confirmation Rule:
    // In Direct P2P mode (!isHubMode): ONLY the receiving creditor can auto-confirm upon recording.
    // If the payer (even group admin) records it, it enters Workflow v2 (10-minute notification delay -> 48h grace period).
    // In Admin-Hub mode (isHubMode): All funds route through admin, so admin receiving funds can auto-confirm.
    const isDirectlyConfirmed = isTargetCreditor || (isHubMode && isAdmin && cleanToEmail === requesterEmail);
    const status = isDirectlyConfirmed
      ? 'confirmed'
      : (isHubMode ? 'pending_admin_approval' : 'pending_confirmation');
    const confirmedAt = isDirectlyConfirmed ? now : null;
    const confirmedByEmail = isDirectlyConfirmed ? requesterEmail : null;
    const confirmedRole = isHubMode && isAdmin && cleanToEmail === requesterEmail
      ? 'admin'
      : (isTargetCreditor ? 'creditor' : (isAdmin ? 'admin' : ''));
    const confirmationToken = isDirectlyConfirmed ? null : crypto.randomBytes(32).toString('hex');
    const disputeToken = isDirectlyConfirmed ? null : crypto.randomBytes(32).toString('hex');
    const notifyAfterAt = isDirectlyConfirmed ? null : new Date(now.getTime() + NOTIFICATION_DELAY_MS);
    const provisionalGraceEnd = notifyAfterAt ? new Date(notifyAfterAt.getTime() + GRACE_PERIOD_MS) : null;

    // Rapid duplicate submission prevention (10-second window):
    // Guards against rapid multi-clicks, touch unresponsiveness, or network re-transmissions.
    const deduplicationWindow = new Date(Date.now() - 10000);
    const existingRecent = await Settlement.findOne({
      groupId,
      fromEmail: cleanFromEmail,
      toEmail: cleanToEmail,
      amount: roundedAmount,
      createdAt: { $gte: deduplicationWindow }
    }).lean();

    if (existingRecent) {
      return res.status(200).json({
        settlement: existingRecent,
        message: 'Settlement already recorded (rapid duplicate prevented).',
        isDuplicatePrevented: true
      });
    }

    // Check for existing pending settlement awaiting confirmation between the same parties for the same amount
    const existingPending = await Settlement.findOne({
      groupId,
      fromEmail: cleanFromEmail,
      toEmail: cleanToEmail,
      amount: roundedAmount,
      status: { $in: ['pending_admin_approval', 'pending_confirmation'] }
    }).lean();

    if (existingPending && (!req.body.utrNumber || req.body.utrNumber === existingPending.utrNumber)) {
      return res.status(200).json({
        settlement: existingPending,
        message: 'An identical settlement is already pending confirmation.',
        isDuplicatePrevented: true
      });
    }

    const receiverUpiSnapshot = isDirectlyConfirmed ? '' : await resolveReceiverUpiSnapshot(cleanToEmail, group);

    const settlement = await Settlement.create({
      groupId,
      fromEmail: cleanFromEmail,
      fromName: String(fromName || fromEmail).trim(),
      toEmail: cleanToEmail,
      toName: String(toName || toEmail).trim(),
      amount: roundedAmount,
      currency: currency || 'INR',
      method: method || 'UPI',
      referenceNote: referenceNote || '',
      utrNumber: req.body.utrNumber ? String(req.body.utrNumber).trim() : '',
      confirmedRole,
      settlementMode: isHubMode ? 'admin_hub' : 'direct_p2p',
      recordedByEmail: requesterEmail,
      status,
      workflowVersion: 2,
      verificationStage: isDirectlyConfirmed ? 'confirmed_by_receiver' : 'notification_pending',
      confirmationSource: isDirectlyConfirmed ? 'direct_recorder' : '',
      acknowledgedAt: now,
      notifyAfterAt,
      receiverUpiIdSnapshot: receiverUpiSnapshot,
      gracePeriodEndsAt: provisionalGraceEnd,
      emailDeliveryStatus: isDirectlyConfirmed ? 'not_required' : 'pending',
      confirmedAt,
      confirmedByEmail,
      confirmationToken,
      disputeToken
    });

    // Note: Do NOT notify receiver immediately when sender acknowledges payment!
    // Notification (Email + In-App) is scheduled reliably after the 10-minute delay via settlement-scheduler.

    const message = isDirectlyConfirmed
      ? `Settlement recorded and confirmed by ${isTargetCreditor ? 'receiving creditor' : 'group admin'}.`
      : `Payment marked as sent. Receiver will be notified after 10 minutes with a 48-hour verification window; you can revert anytime during this period.`;

    otel.metrics.counter('vasool_settlements_created_total', 1, {
      method: settlement.method,
      status: settlement.status
    });
    otel.metrics.histogram('vasool_settlement_amount_inr', Number(settlement.amount), {
      method: settlement.method
    });

    return res.status(201).json({ settlement, message, serverNow: now.toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/confirm - Creditor or Admin confirms full or partial receipt of payment
router.post('/settlements/:id/confirm', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const settlement = await Settlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }

    const group = await Group.findById(settlement.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const adminMember = group.members.find((m) => m.role === 'admin' || m.role === 'owner') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isGroupAdmin = (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail);
    const isSuperAdmin = isSuperAdminUser(req.user);
    const isTargetCreditor = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;
    const isHub = Boolean(group.adminHubSettlement);

    let canConfirm = false;
    if (isTargetCreditor) {
      canConfirm = true;
    } else if (isHub && (isGroupAdmin || isSuperAdmin)) {
      canConfirm = true;
    }

    if (!canConfirm) {
      if (!isHub) {
        return res.status(403).json({
          error: 'In Direct P2P mode, only the receiving recipient/creditor can confirm receipt of this payment.'
        });
      }
      return res.status(403).json({
        error: 'Only the receiving creditor or group admin can confirm payment receipt.'
      });
    }

    if (settlement.status === 'confirmed') {
      return res.status(200).json({
        settlement,
        message: 'Settlement was already confirmed.',
        alreadyConfirmed: true
      });
    }

    if (settlement.status === 'disputed') {
      return res.status(409).json({
        error: 'This payment was reported as not received and is currently disputed. Please resolve the dispute instead.',
        settlement
      });
    }

    if (settlement.status === 'rejected' || settlement.status === 'reverted') {
      return res.status(409).json({
        error: `Cannot confirm a settlement that has already been ${settlement.status}.`,
        settlement
      });
    }

    const now = new Date();
    const { receivedAmount, adminNote } = req.body || {};
    const claimedAmt = Number(settlement.amount);
    let isPartial = false;
    let finalAmount = claimedAmt;

    if (receivedAmount !== undefined && receivedAmount !== null && Number(receivedAmount) > 0) {
      const parsedReceived = Math.round(Number(receivedAmount) * 100) / 100;
      if (parsedReceived < claimedAmt) {
        finalAmount = parsedReceived;
        isPartial = true;
      }
    }

    const resolvedRole = settlement.settlementMode === 'admin_hub' && isGroupAdmin
      ? 'admin'
      : (isTargetCreditor ? 'creditor' : 'admin');

    const updateSet = {
      status: 'confirmed',
      verificationStage: 'confirmed_by_receiver',
      confirmationSource: isTargetCreditor ? 'receiver_app' : 'admin_hub',
      confirmedAt: now,
      confirmedByEmail: requesterEmail,
      confirmedRole: resolvedRole,
      confirmationToken: null,
      disputeToken: null,
      notificationProcessingLockUntil: null
    };
    if (isPartial) {
      updateSet.originalClaimedAmount = claimedAmt;
      updateSet.amount = finalAmount;
    }
    if (adminNote !== undefined) {
      updateSet.adminNote = String(adminNote || '').trim();
    }

    const updated = await Settlement.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $in: ['pending_admin_approval', 'pending_confirmation'] }
      },
      { $set: updateSet },
      { new: true }
    );

    if (!updated) {
      const latest = await Settlement.findById(req.params.id).lean();
      if (latest && latest.status === 'confirmed') {
        return res.status(200).json({ settlement: latest, message: 'Settlement was already confirmed.', alreadyConfirmed: true });
      }
      return res.status(409).json({ error: 'Settlement state changed concurrently and could not be confirmed.', settlement: latest });
    }

    appendGroupAuditLog(group, {
      action: isPartial ? 'settlement_partial_confirmed' : 'settlement_confirmed',
      actorEmail: requesterEmail,
      actorName: req.user.name || requesterEmail,
      summary: isPartial
        ? `${req.user.name || requesterEmail} confirmed partial receipt of ₹${updated.amount} (of ₹${claimedAmt} claimed) from ${updated.fromName} to ${updated.toName}`
        : `${req.user.name || requesterEmail} confirmed ₹${updated.amount} payment from ${updated.fromName} to ${updated.toName}`,
      details: `${updated.method}${updated.utrNumber ? ' · UTR: ' + updated.utrNumber : ''}${updated.adminNote ? ' · Note: ' + updated.adminNote : ''}`
    });
    await group.save();

    await createNotificationIdempotent({
      eventKey: `payment_confirmed:${updated._id}:${updated.fromEmail}`,
      recipientEmail: updated.fromEmail,
      type: 'payment_confirmed',
      title: `₹${Number(updated.amount).toFixed(2)} confirmed by ${req.user.name || updated.toName}`,
      message: `${req.user.name || updated.toName} confirmed receipt of your ₹${Number(updated.amount).toFixed(2)} settlement in "${group.name}".`,
      groupId: updated.groupId,
      groupName: group.name,
      settlementId: updated._id,
      amount: updated.amount,
      currency: updated.currency || 'INR',
      senderEmail: updated.fromEmail,
      senderName: updated.fromName,
      receiverEmail: updated.toEmail,
      receiverName: updated.toName,
      targetTab: 'settle'
    });

    otel.metrics.counter('vasool_settlements_confirmed_total', 1, {
      confirmed_role: updated.confirmedRole,
      partial: String(isPartial)
    });

    return res.status(200).json({
      message: isPartial
        ? `Partial payment of ₹${updated.amount} (of ₹${claimedAmt}) confirmed by ${isTargetCreditor ? 'creditor' : 'group admin'}. Remaining ₹${Math.round((claimedAmt - updated.amount) * 100) / 100} stays open.`
        : `Payment of ₹${updated.amount} confirmed by ${isTargetCreditor ? 'creditor' : 'group admin'}. Transaction is now settled.`,
      settlement: updated,
      isPartial,
      serverNow: now.toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/report-not-received - Receiver reports non-receipt within the 48-hour grace period
router.post('/settlements/:id/report-not-received', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const now = new Date();
    const settlement = await Settlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }

    const group = await Group.findById(settlement.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const adminMember = group.members.find((m) => m.role === 'admin' || m.role === 'owner') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isGroupAdmin = (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail);
    const isSuperAdmin = isSuperAdminUser(req.user);
    const isTargetCreditor = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;
    const isHub = Boolean(group.adminHubSettlement);

    const canDispute = isTargetCreditor || (isHub && (isGroupAdmin || isSuperAdmin)) || isSuperAdmin;
    if (!canDispute) {
      return res.status(403).json({
        error: isHub
          ? 'Only the receiving creditor or group admin can report non-receipt.'
          : 'In Direct P2P mode, only the receiving recipient can report non-receipt of this payment.'
      });
    }

    if (settlement.status === 'disputed') {
      return res.status(200).json({
        settlement,
        message: 'This payment has already been reported as not received.',
        alreadyDisputed: true,
        serverNow: now.toISOString()
      });
    }

    if (settlement.status === 'confirmed') {
      return res.status(409).json({
        error: 'The verification period has ended and this payment is already confirmed.',
        settlement,
        serverNow: now.toISOString()
      });
    }

    if (settlement.status === 'rejected' || settlement.status === 'reverted') {
      return res.status(409).json({
        error: `Cannot report a settlement that is already ${settlement.status}.`,
        settlement
      });
    }

    // Strict server-side 48-hour grace period check
    if (settlement.workflowVersion === 2 && settlement.gracePeriodEndsAt && now > new Date(settlement.gracePeriodEndsAt)) {
      await maybeRunScheduledSettlementCatchup({ force: true });
      const refreshed = await Settlement.findById(req.params.id).lean();
      return res.status(409).json({
        error: 'The 48-hour verification grace period has expired. This payment has been automatically confirmed.',
        settlement: refreshed,
        graceExpired: true,
        serverNow: now.toISOString()
      });
    }

    const disputeReason = String(req.body?.reason || 'Payment not received in bank/UPI account').trim().slice(0, 500);

    // Atomic conditional transition: prevents concurrent race with 48h auto-confirm or sender revert
    const updated = await Settlement.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $in: ['pending_admin_approval', 'pending_confirmation'] },
        $or: [{ gracePeriodEndsAt: null }, { gracePeriodEndsAt: { $gt: now } }]
      },
      {
        $set: {
          status: 'disputed',
          verificationStage: 'disputed',
          disputedAt: now,
          disputedByEmail: requesterEmail,
          disputeReason,
          confirmationToken: null,
          disputeToken: null,
          notificationProcessingLockUntil: null
        }
      },
      { new: true }
    );

    if (!updated) {
      await maybeRunScheduledSettlementCatchup({ force: true });
      const latest = await Settlement.findById(req.params.id).lean();
      return res.status(409).json({
        error: latest?.status === 'confirmed'
          ? 'The 48-hour verification grace period expired before the report could be recorded.'
          : 'Settlement state changed concurrently. Please refresh and check the latest status.',
        settlement: latest,
        serverNow: now.toISOString()
      });
    }

    appendGroupAuditLog(group, {
      action: 'settlement_disputed',
      actorEmail: requesterEmail,
      actorName: req.user.name || requesterEmail,
      summary: `${req.user.name || requesterEmail} reported ₹${updated.amount} payment from ${updated.fromName} as NOT received`,
      details: disputeReason
    });
    await group.save();

    await notifyDisputeParties({
      settlement: updated,
      group,
      reporterName: req.user.name || updated.toName || requesterEmail,
      disputeReason
    });

    otel.metrics.counter('vasool_settlements_disputed_total', 1);

    return res.status(200).json({
      message: 'Payment reported as not received. The sender and group admin(s) have been notified via email and in-app alerts.',
      settlement: updated,
      serverNow: now.toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/resolve-dispute - Resolve a disputed settlement via confirm or revert
router.post('/settlements/:id/resolve-dispute', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { action, note } = req.body || {};
    if (action !== 'confirm' && action !== 'revert') {
      return res.status(400).json({ error: 'Valid resolution action ("confirm" or "revert") is required.' });
    }

    const settlement = await Settlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }
    if (settlement.status !== 'disputed') {
      return res.status(409).json({ error: 'Only disputed settlements can be resolved via this endpoint.', settlement });
    }

    const group = await Group.findById(settlement.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const adminMember = group.members.find((m) => m.role === 'admin' || m.role === 'owner') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];
    const isGroupAdmin = (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail);
    const isSuperAdmin = isSuperAdminUser(req.user);
    const isPayer = settlement.fromEmail && settlement.fromEmail.toLowerCase().trim() === requesterEmail;
    const isTargetCreditor = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;
    const isRecorder = settlement.recordedByEmail && settlement.recordedByEmail.toLowerCase().trim() === requesterEmail;
    const now = new Date();
    const resolutionNote = String(note || '').trim().slice(0, 500);

    if (action === 'confirm') {
      if (!isTargetCreditor && !isGroupAdmin && !isSuperAdmin) {
        return res.status(403).json({ error: 'Only the receiving creditor or group admin can resolve a dispute by confirming receipt.' });
      }
      const updated = await Settlement.findOneAndUpdate(
        { _id: req.params.id, status: 'disputed' },
        {
          $set: {
            status: 'confirmed',
            verificationStage: 'confirmed_by_receiver',
            confirmationSource: isTargetCreditor ? 'receiver_app' : 'admin_hub',
            confirmedAt: now,
            confirmedByEmail: requesterEmail,
            confirmedRole: isTargetCreditor ? 'creditor' : 'admin',
            disputeResolvedAt: now,
            disputeResolvedByEmail: requesterEmail,
            disputeResolutionNote: resolutionNote || 'Confirmed received during dispute resolution'
          }
        },
        { new: true }
      );
      if (!updated) return res.status(409).json({ error: 'Dispute already resolved concurrently.' });

      appendGroupAuditLog(group, {
        action: 'settlement_dispute_confirmed',
        actorEmail: requesterEmail,
        actorName: req.user.name || requesterEmail,
        summary: `${req.user.name || requesterEmail} resolved dispute on ₹${updated.amount} by confirming receipt`,
        details: resolutionNote || updated.method
      });
      await group.save();

      for (const em of new Set([updated.fromEmail, updated.toEmail].filter((e) => e && e !== requesterEmail))) {
        await createNotificationIdempotent({
          eventKey: `dispute_resolved_confirm:${updated._id}:${em}:${now.getTime()}`,
          recipientEmail: em,
          type: 'dispute_resolved',
          title: `Dispute Resolved: ₹${Number(updated.amount).toFixed(2)} confirmed`,
          message: `${req.user.name || requesterEmail} resolved the dispute in "${group.name}" by confirming receipt of ₹${Number(updated.amount).toFixed(2)}.`,
          groupId: updated.groupId,
          groupName: group.name,
          settlementId: updated._id,
          amount: updated.amount,
          targetTab: 'settle'
        });
      }

      return res.status(200).json({ message: 'Dispute resolved: payment marked as confirmed.', settlement: updated, serverNow: now.toISOString() });
    }

    // action === 'revert'
    if (!isPayer && !isTargetCreditor && !isRecorder && !isGroupAdmin && !isSuperAdmin) {
      return res.status(403).json({ error: 'Unauthorized to cancel/revert this disputed settlement.' });
    }

    const updated = await Settlement.findOneAndUpdate(
      { _id: req.params.id, status: 'disputed' },
      {
        $set: {
          status: 'reverted',
          verificationStage: 'reverted',
          revertedAt: now,
          revertedByEmail: requesterEmail,
          disputeResolvedAt: now,
          disputeResolvedByEmail: requesterEmail,
          disputeResolutionNote: resolutionNote || 'Reverted disputed settlement back to open debt'
        }
      },
      { new: true }
    );
    if (!updated) return res.status(409).json({ error: 'Dispute already resolved concurrently.' });

    appendGroupAuditLog(group, {
      action: 'settlement_dispute_reverted',
      actorEmail: requesterEmail,
      actorName: req.user.name || requesterEmail,
      summary: `${req.user.name || requesterEmail} resolved dispute by reverting ₹${updated.amount} settlement to open debt`,
      details: resolutionNote || updated.method
    });
    await group.save();

    for (const em of new Set([updated.fromEmail, updated.toEmail].filter((e) => e && e !== requesterEmail))) {
      await createNotificationIdempotent({
        eventKey: `dispute_resolved_revert:${updated._id}:${em}:${now.getTime()}`,
        recipientEmail: em,
        type: 'dispute_resolved',
        title: `Dispute Resolved: ₹${Number(updated.amount).toFixed(2)} debt restored`,
        message: `${req.user.name || requesterEmail} reverted the disputed ₹${Number(updated.amount).toFixed(2)} entry in "${group.name}". The balance is open again.`,
        groupId: updated.groupId,
        groupName: group.name,
        settlementId: updated._id,
        amount: updated.amount,
        targetTab: 'settle'
      });
    }

    return res.status(200).json({ message: 'Dispute resolved: settlement reverted and debt reopened.', settlement: updated, serverNow: now.toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/reject - Creditor or Admin rejects an unconfirmed settlement claim
router.post('/settlements/:id/reject', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { reason } = req.body;
    const settlement = await Settlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }

    const group = await Group.findById(settlement.groupId);
    const requesterEmail = req.user.email.toLowerCase().trim();
    const adminMember = group.members.find((m) => m.role === 'admin' || m.role === 'owner') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isGroupAdmin = (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail);
    const isSuperAdmin = isSuperAdminUser(req.user);
    const isTargetCreditor = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;
    const isHub = Boolean(group.adminHubSettlement);

    let canReject = false;
    if (isTargetCreditor) {
      canReject = true;
    } else if (isHub && (isGroupAdmin || isSuperAdmin)) {
      canReject = true;
    } else if (isSuperAdmin) {
      canReject = true;
    }

    if (!canReject) {
      if (!isHub) {
        return res.status(403).json({
          error: 'In Direct P2P mode, only the receiving recipient/creditor can reject payment claims.'
        });
      }
      return res.status(403).json({
        error: 'Only the receiving creditor or group admin can reject payment claims.'
      });
    }

    if (settlement.status === 'rejected') {
      return res.status(200).json({
        settlement,
        message: 'Settlement was already rejected.',
        alreadyRejected: true
      });
    }

    const updated = await Settlement.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['pending_admin_approval', 'pending_confirmation'] } },
      {
        $set: {
          status: 'rejected',
          verificationStage: 'rejected',
          rejectedReason: reason || `Payment claim rejected by ${isTargetCreditor ? 'creditor' : 'group admin'}.`,
          confirmationToken: null,
          disputeToken: null,
          notificationProcessingLockUntil: null
        }
      },
      { new: true }
    );

    if (!updated) {
      const latest = await Settlement.findById(req.params.id).lean();
      return res.status(409).json({ error: 'Settlement state changed concurrently.', settlement: latest });
    }

    otel.metrics.counter('vasool_settlements_rejected_total', 1);

    return res.status(200).json({
      message: 'Settlement payment claim rejected.',
      settlement: updated
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/settlements/:id/revert
 * Reverts a recorded/acknowledged settlement back to an open debt.
 * Allowed for the payer, the recipient, the person who recorded it, or group admin (on disputed).
 * The record is kept for audit purposes with status "reverted" and is
 * excluded from balance and settlement calculations.
 */
router.post('/settlements/:id/revert', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const settlement = await Settlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const isPayer = settlement.fromEmail && settlement.fromEmail.toLowerCase().trim() === requesterEmail;
    const isRecipient = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;
    const isRecorder = settlement.recordedByEmail && settlement.recordedByEmail.toLowerCase().trim() === requesterEmail;
    const isSuperAdmin = isSuperAdminUser(req.user);

    const group = await Group.findById(settlement.groupId);
    const adminMember = group && (group.members.find((m) => m.role === 'admin' || m.role === 'owner') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0]);
    const isGroupAdmin = group && (
      (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail)
    );

    if (!isPayer && !isRecipient && !isRecorder && !isSuperAdmin && !(settlement.status === 'disputed' && isGroupAdmin)) {
      return res.status(403).json({
        error: 'Only the payer, the recipient, or the person who recorded this settlement can revert it.'
      });
    }

    if (settlement.status === 'reverted') {
      return res.status(200).json({
        settlement,
        message: 'Settlement was already reverted.',
        alreadyReverted: true
      });
    }

    if (settlement.status === 'rejected') {
      return res.status(400).json({
        error: 'Rejected settlement claims do not affect balances and cannot be reverted.'
      });
    }

    const now = new Date();
    const updated = await Settlement.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $nin: ['rejected', 'reverted'] }
      },
      {
        $set: {
          status: 'reverted',
          verificationStage: 'reverted',
          revertedAt: now,
          revertedByEmail: requesterEmail,
          confirmationToken: null,
          disputeToken: null,
          notificationProcessingLockUntil: null
        }
      },
      { new: true }
    );

    if (!updated) {
      const latest = await Settlement.findById(req.params.id).lean();
      if (latest && latest.status === 'reverted') {
        return res.status(200).json({ settlement: latest, message: 'Settlement was already reverted.', alreadyReverted: true });
      }
      return res.status(409).json({ error: 'Settlement state changed concurrently.', settlement: latest });
    }

    if (group) {
      appendGroupAuditLog(group, {
        action: 'settlement_reverted',
        actorEmail: requesterEmail,
        actorName: req.user.name || requesterEmail,
        summary: `${req.user.name || requesterEmail} reverted ₹${updated.amount} settlement from ${updated.fromName} to ${updated.toName}`,
        details: `${updated.method}${updated.utrNumber ? ' · UTR: ' + updated.utrNumber : ''}`
      });
      await group.save();

      // If receiver had already been notified, let them know cleanly in-app that the sender reverted it
      if (settlement.receiverNotifiedAt && updated.toEmail && requesterEmail !== updated.toEmail) {
        await createNotificationIdempotent({
          eventKey: `payment_reverted:${updated._id}:${updated.toEmail}`,
          recipientEmail: updated.toEmail,
          type: 'payment_reverted',
          title: `Payment Reverted: ₹${Number(updated.amount).toFixed(2)} reopened`,
          message: `${req.user.name || updated.fromName} reverted their ₹${Number(updated.amount).toFixed(2)} payment claim in "${group.name}". The balance is open again.`,
          groupId: updated.groupId,
          groupName: group.name,
          settlementId: updated._id,
          amount: updated.amount,
          senderEmail: updated.fromEmail,
          senderName: updated.fromName,
          receiverEmail: updated.toEmail,
          receiverName: updated.toName,
          targetTab: 'settle'
        });
      }
    }

    otel.metrics.counter('vasool_settlements_reverted_total', 1);

    return res.status(200).json({
      message: `Settlement of ₹${updated.amount} reverted. The amount is due again.`,
      settlement: updated,
      serverNow: now.toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/settlements/ack
 * 1-Click payment acknowledgment from email hyperlink.
 * Allows the receiving recipient to confirm payment receipt with a single tap.
 */
router.get('/settlements/ack', async (req, res) => {
  try {
    await connectToDatabase();
    const { token, id } = req.query;

    if (!token || !id) {
      return res.status(400).send(renderAckResultPage({
        success: false,
        title: 'Invalid Request',
        message: 'Missing confirmation token or settlement identifier. Please check the link in your email.',
        alreadyConfirmed: false
      }));
    }

    const settlement = await Settlement.findById(id);
    if (!settlement) {
      return res.status(404).send(renderAckResultPage({
        success: false,
        title: 'Settlement Not Found',
        message: 'The requested settlement transaction could not be found.',
        alreadyConfirmed: false
      }));
    }

    if (settlement.status === 'confirmed') {
      return res.status(200).send(renderAckResultPage({
        success: true,
        title: 'Payment Already Confirmed',
        message: `This payment of ₹${settlement.amount} from ${settlement.fromName} was already confirmed on ${new Date(settlement.confirmedAt || settlement.updatedAt).toLocaleDateString('en-IN')}.`,
        settlement,
        alreadyConfirmed: true
      }));
    }

    if (settlement.status === 'disputed') {
      return res.status(409).send(renderAckResultPage({
        success: false,
        title: 'Payment Already Disputed',
        message: 'This payment was previously reported as not received. Please resolve it inside Vasool.',
        settlement,
        alreadyConfirmed: false
      }));
    }

    // Secure atomic token verification + confirmation
    const now = new Date();
    const updated = await Settlement.findOneAndUpdate(
      {
        _id: id,
        confirmationToken: token,
        status: { $in: ['pending_admin_approval', 'pending_confirmation'] }
      },
      {
        $set: {
          status: 'confirmed',
          verificationStage: 'confirmed_by_receiver',
          confirmationSource: 'receiver_email',
          confirmedAt: now,
          confirmedByEmail: settlement.toEmail,
          confirmedRole: 'creditor',
          confirmationToken: null,
          disputeToken: null,
          notificationProcessingLockUntil: null
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(403).send(renderAckResultPage({
        success: false,
        title: 'Link Expired or Invalid',
        message: 'This confirmation link is invalid, expired, or has already been used.',
        alreadyConfirmed: false
      }));
    }

    const group = await Group.findById(updated.groupId);
    if (group) {
      appendGroupAuditLog(group, {
        action: 'settlement_confirmed_email',
        actorEmail: updated.toEmail,
        actorName: updated.toName || updated.toEmail,
        summary: `${updated.toName || updated.toEmail} acknowledged receipt of ₹${updated.amount} from ${updated.fromName} via email confirmation`,
        details: `${updated.method}${updated.utrNumber ? ' · UTR: ' + updated.utrNumber : ''}`
      });
      await group.save();

      await createNotificationIdempotent({
        eventKey: `payment_confirmed:${updated._id}:${updated.fromEmail}`,
        recipientEmail: updated.fromEmail,
        type: 'payment_confirmed',
        title: `₹${Number(updated.amount).toFixed(2)} confirmed by ${updated.toName || updated.toEmail}`,
        message: `${updated.toName || updated.toEmail} confirmed receipt of your ₹${Number(updated.amount).toFixed(2)} settlement in "${group.name}".`,
        groupId: updated.groupId,
        groupName: group.name,
        settlementId: updated._id,
        amount: updated.amount,
        senderEmail: updated.fromEmail,
        senderName: updated.fromName,
        receiverEmail: updated.toEmail,
        receiverName: updated.toName,
        targetTab: 'settle'
      });
    }

    otel.metrics.counter('vasool_settlements_confirmed_total', 1, {
      confirmed_role: 'creditor_email',
      partial: 'false'
    });

    return res.status(200).send(renderAckResultPage({
      success: true,
      title: 'Payment Confirmed Successfully! 🎉',
      message: `You have successfully acknowledged receipt of ₹${updated.amount} from ${updated.fromName}. The group balance has been updated and the debt is closed.`,
      settlement: updated,
      alreadyConfirmed: false
    }));
  } catch (err) {
    logger.error('[settlements/ack] Error acknowledging payment:', err);
    return res.status(500).send(renderAckResultPage({
      success: false,
      title: 'Server Error',
      message: 'An unexpected error occurred while confirming the settlement. Please try again or open the Vasool app.',
      alreadyConfirmed: false
    }));
  }
});

/**
 * GET /api/settlements/report-view & POST /api/settlements/report-email
 * Allows the receiver to report a payment as not received from the email link within the 48h grace period.
 */
router.get('/settlements/report-view', async (req, res) => {
  try {
    await connectToDatabase();
    const now = new Date();
    const { token, id } = req.query;
    if (!token || !id) {
      return res.status(400).send(renderAckResultPage({
        success: false,
        title: 'Invalid Link',
        message: 'Missing report token or settlement identifier.'
      }));
    }

    const settlement = await Settlement.findById(id).lean();
    if (!settlement) {
      return res.status(404).send(renderAckResultPage({
        success: false,
        title: 'Settlement Not Found',
        message: 'The requested payment record could not be found.'
      }));
    }

    if (settlement.status === 'confirmed') {
      return res.status(200).send(renderAckResultPage({
        success: true,
        title: 'Verification Grace Period Closed',
        message: `This ₹${settlement.amount} payment from ${settlement.fromName} is already confirmed and can no longer be reported.`,
        settlement
      }));
    }

    if (settlement.status === 'disputed') {
      return res.status(200).send(renderAckResultPage({
        success: false,
        title: 'Already Reported as Not Received',
        message: `You already reported this ₹${settlement.amount} payment. The sender and group admin have been notified.`,
        settlement
      }));
    }

    if (!settlement.disputeToken || settlement.disputeToken !== token) {
      return res.status(403).send(renderAckResultPage({
        success: false,
        title: 'Link Expired or Invalid',
        message: 'This report link is invalid or no longer active.'
      }));
    }

    if (settlement.gracePeriodEndsAt && now > new Date(settlement.gracePeriodEndsAt)) {
      await maybeRunScheduledSettlementCatchup({ force: true });
      return res.status(409).send(renderAckResultPage({
        success: true,
        title: '48-Hour Grace Period Expired',
        message: `The 48-hour reporting window ended on ${new Date(settlement.gracePeriodEndsAt).toLocaleString('en-IN')}. The payment is automatically confirmed.`,
        settlement
      }));
    }

    return res.status(200).send(renderReportViewPage({ settlement, token }));
  } catch (err) {
    return res.status(500).send(renderAckResultPage({
      success: false,
      title: 'Server Error',
      message: 'Could not load the report form. Please log into Vasool directly.'
    }));
  }
});

router.post('/settlements/report-email', async (req, res) => {
  try {
    await connectToDatabase();
    const now = new Date();
    const { id, token, reason } = req.body || {};
    if (!id || !token) {
      return res.status(400).json({ error: 'Settlement ID and dispute token are required.' });
    }

    const settlement = await Settlement.findById(id);
    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }
    if (settlement.status === 'confirmed') {
      return res.status(409).json({ error: 'Payment is already confirmed; grace period has closed.' });
    }
    if (settlement.status === 'disputed') {
      return res.status(200).json({ settlement, alreadyDisputed: true, message: 'Already reported as not received.' });
    }
    if (!settlement.disputeToken || settlement.disputeToken !== token) {
      return res.status(403).json({ error: 'Invalid or expired report link token.' });
    }
    if (settlement.gracePeriodEndsAt && now > new Date(settlement.gracePeriodEndsAt)) {
      await maybeRunScheduledSettlementCatchup({ force: true });
      return res.status(409).json({ error: 'The 48-hour verification grace period has expired.' });
    }

    const disputeReason = String(reason || 'Payment not received in bank/UPI account').trim().slice(0, 500);
    const updated = await Settlement.findOneAndUpdate(
      {
        _id: id,
        disputeToken: token,
        status: { $in: ['pending_admin_approval', 'pending_confirmation'] },
        $or: [{ gracePeriodEndsAt: null }, { gracePeriodEndsAt: { $gt: now } }]
      },
      {
        $set: {
          status: 'disputed',
          verificationStage: 'disputed',
          disputedAt: now,
          disputedByEmail: settlement.toEmail,
          disputeReason,
          confirmationToken: null,
          disputeToken: null,
          notificationProcessingLockUntil: null
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ error: 'Unable to record dispute because the payment state changed concurrently.' });
    }

    const group = await Group.findById(updated.groupId);
    if (group) {
      appendGroupAuditLog(group, {
        action: 'settlement_disputed_email',
        actorEmail: updated.toEmail,
        actorName: updated.toName || updated.toEmail,
        summary: `${updated.toName || updated.toEmail} reported ₹${updated.amount} payment from ${updated.fromName} as NOT received via email link`,
        details: disputeReason
      });
      await group.save();
    }

    await notifyDisputeParties({
      settlement: updated,
      group,
      reporterName: updated.toName || updated.toEmail,
      disputeReason
    });

    otel.metrics.counter('vasool_settlements_disputed_total', 1);

    return res.status(200).json({
      success: true,
      message: 'Non-receipt report submitted. Sender and group administrator(s) have been notified.',
      settlement: updated
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Background Scheduler Cron Endpoint (supports cron-job.org, Vercel Cron, or Admin manual trigger)
async function handleProcessSettlementsCron(req, res) {
  try {
    const cronSecret = process.env.CRON_SECRET || '';
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerSecret = req.headers['x-cron-secret'] || req.query.secret || '';

    let authorized = false;
    if (cronSecret && (bearer === cronSecret || headerSecret === cronSecret)) {
      authorized = true;
    } else if (bearer) {
      const decoded = verifyAuthToken(bearer);
      if (decoded && isSuperAdminUser(decoded)) {
        authorized = true;
      }
    } else if (!cronSecret && process.env.NODE_ENV === 'test') {
      authorized = true;
    }

    if (!authorized) {
      return res.status(401).json({ error: 'Unauthorized cron trigger.' });
    }

    await connectToDatabase();
    const summary = await processDueSettlementJobs({ now: new Date() });
    return res.status(200).json({
      ok: true,
      serverNow: new Date().toISOString(),
      ...summary
    });
  } catch (err) {
    logger.error('[cron/process-settlements] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

router.get('/cron/process-settlements', handleProcessSettlementsCron);
router.post('/cron/process-settlements', handleProcessSettlementsCron);

// GET /api/settlements - List recorded settlements
router.get('/settlements', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    await maybeRunScheduledSettlementCatchup();
    const filter = {};
    if (req.query.groupId) {
      filter.groupId = req.query.groupId;
    } else {
      const userGroups = await Group.find({ 'members.email': req.user.email }, { _id: 1 }).lean();
      filter.groupId = { $in: userGroups.map((g) => g._id) };
    }
    const settlements = await Settlement.find(filter).sort({ settledAt: -1, createdAt: -1 }).lean();
    return res.status(200).json({ settlements, serverNow: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/users/search - Search registered users by email or name for autocomplete
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

// GET /api/users/check-email - Checks whether an email is already linked to a registered account
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

/**
 * POST /api/feedback
 * Submit user feedback (authenticated or anonymous).
 */
router.post('/feedback', async (req, res) => {
  await connectToDatabase();
  const { type, rating, message, page } = req.body;
  if (!message || String(message).trim().length < 3) {
    return res.status(400).json({ error: 'Feedback message must be at least 3 characters.' });
  }
  if (String(message).trim().length > 2000) {
    return res.status(400).json({ error: 'Feedback message too long (max 2000 characters).' });
  }
  const allowedTypes = ['bug', 'feature', 'general', 'ux'];
  const feedbackType = allowedTypes.includes(type) ? type : 'general';
  const ratingNum = rating ? parseInt(rating, 10) : null;
  if (ratingNum !== null && (ratingNum < 1 || ratingNum > 5)) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  }

  // Identify user if logged in (optional — feedback works anonymously too)
  let userId = null;
  let userEmail = null;
  let userName = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const { verifyAuthToken } = require('./auth');
      const decoded = verifyAuthToken(authHeader.slice(7));
      if (decoded && decoded.sub) {
        userId = decoded.sub;
        userEmail = decoded.email;
        userName = decoded.name;
      }
    }
  } catch (_) { /* Anonymous fallback */ }

  const feedback = await Feedback.create({
    userId,
    userEmail,
    userName,
    type: feedbackType,
    rating: ratingNum,
    message: String(message).trim(),
    page: page ? String(page).trim().slice(0, 100) : null
  });

  logger.info(`[feedback] New feedback submitted (type=${feedbackType}, user=${userEmail || 'anonymous'})`);
  return res.status(201).json({ success: true, feedbackId: feedback._id });
});

function renderAckResultPage({ success, title, message, settlement, alreadyConfirmed }) {
  const isOk = success;
  const icon = isOk ? '✅' : '⚠️';
  const safeTitle = String(title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeMessage = String(message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fromName = settlement ? String(settlement.fromName || settlement.fromEmail || '').replace(/</g, '&lt;') : '';
  const toName = settlement ? String(settlement.toName || settlement.toEmail || '').replace(/</g, '&lt;') : '';
  const amount = settlement ? Number(settlement.amount).toLocaleString('en-IN') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} · Vasool</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #030712;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #0f172a;
      border: 1px solid ${isOk ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'};
      border-radius: 1.5rem;
      max-width: 460px;
      width: 100%;
      padding: 2.25rem 2rem;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .icon-bubble {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${isOk ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)'};
      border: 2px solid ${isOk ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'};
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 2.25rem;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 0.75rem;
      letter-spacing: -0.025em;
    }
    p {
      color: #94a3b8;
      font-size: 0.925rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .details-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 1rem;
      padding: 1.25rem;
      margin-bottom: 1.75rem;
      text-align: left;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.4rem 0;
      font-size: 0.85rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #64748b; }
    .detail-val { color: #f1f5f9; font-weight: 600; }
    .amount-val { color: #10b981; font-size: 1.15rem; font-weight: 800; }
    .btn-app {
      display: inline-block;
      width: 100%;
      padding: 0.875rem 1.25rem;
      border-radius: 0.875rem;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #030712;
      font-weight: 700;
      font-size: 0.95rem;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
    }
    .btn-app:hover {
      background: linear-gradient(135deg, #34d399, #10b981);
      transform: translateY(-1px);
    }
    .countdown-note {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-bubble">${icon}</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${settlement ? `
      <div class="details-box">
        <div class="detail-row">
          <span class="detail-label">Amount Paid</span>
          <span class="detail-val amount-val">₹${amount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Paid By</span>
          <span class="detail-val">${fromName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Recipient</span>
          <span class="detail-val">${toName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Method</span>
          <span class="detail-val">${settlement.method || 'UPI'}</span>
        </div>
        ${settlement.utrNumber ? `
        <div class="detail-row">
          <span class="detail-label">UTR Ref</span>
          <span class="detail-val" style="font-family: monospace;">${settlement.utrNumber}</span>
        </div>` : ''}
      </div>
    ` : ''}
    <a href="/" class="btn-app" id="btnGoApp">Open Vasool Dashboard</a>
    <div class="countdown-note" id="redirectMsg">Redirecting to dashboard in <span id="timer">5</span> seconds...</div>
  </div>
  <script>
    var seconds = 5;
    var timerEl = document.getElementById('timer');
    var interval = setInterval(function() {
      seconds--;
      if (timerEl) timerEl.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(interval);
        window.location.href = '/';
      }
    }, 1000);
  </script>
</body>
</html>`;
}

function renderReportViewPage({ settlement, token }) {
  const fromName = String(settlement.fromName || settlement.fromEmail || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const toName = String(settlement.toName || settlement.toEmail || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const amount = Number(settlement.amount).toLocaleString('en-IN');
  const deadline = settlement.gracePeriodEndsAt ? new Date(settlement.gracePeriodEndsAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Within 48 hours';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Report Payment Not Received · Vasool</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #050b09; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
    .card { background: #0b1511; border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 1.5rem; max-width: 460px; width: 100%; padding: 2rem; box-shadow: 0 25px 50px rgba(0,0,0,0.7); }
    h1 { font-size: 1.3rem; font-weight: 800; color: #fda4af; margin-bottom: 0.5rem; }
    p { font-size: 0.9rem; color: #94a3b8; line-height: 1.5; margin-bottom: 1.25rem; }
    .box { background: #060d0a; border: 1px solid #163026; border-radius: 1rem; padding: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem; }
    .row { display: flex; justify-content: space-between; padding: 0.35rem 0; }
    .lbl { color: #64748b; } .val { color: #f1f5f9; font-weight: 600; }
    label { display: block; font-size: 0.8rem; color: #cbd5e1; margin-bottom: 0.4rem; font-weight: 600; }
    input { width: 100%; padding: 0.75rem 0.9rem; border-radius: 0.75rem; background: #050b09; border: 1px solid #334155; color: #fff; font-size: 0.875rem; margin-bottom: 1rem; }
    button { width: 100%; padding: 0.85rem; border-radius: 0.875rem; background: #e11d48; color: #fff; border: none; font-weight: 700; font-size: 0.95rem; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .msg { margin-top: 1rem; font-size: 0.85rem; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚨 Report Payment Not Received</h1>
    <p>Confirm if you have checked your account and did not receive ₹${amount} from ${fromName}. Deadline: ${deadline}.</p>
    <div class="box">
      <div class="row"><span class="lbl">Sender</span><span class="val">${fromName}</span></div>
      <div class="row"><span class="lbl">Receiver</span><span class="val">${toName}</span></div>
      <div class="row"><span class="lbl">Amount</span><span class="val" style="color:#fda4af;">₹${amount}</span></div>
      <div class="row"><span class="lbl">Method</span><span class="val">${settlement.method || 'UPI'}</span></div>
    </div>
    <form id="disputeForm">
      <label for="reason">Issue Details</label>
      <input id="reason" name="reason" type="text" required value="Payment not received in bank/UPI account" />
      <button type="submit" id="submitBtn">Submit Report Not Received</button>
    </form>
    <div class="msg" id="statusMsg"></div>
  </div>
  <script>
    document.getElementById('disputeForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = document.getElementById('submitBtn');
      var msg = document.getElementById('statusMsg');
      btn.disabled = true;
      btn.textContent = 'Submitting report...';
      try {
        var res = await fetch('/api/settlements/report-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: ${JSON.stringify(String(settlement._id || settlement.id))},
            token: ${JSON.stringify(String(token))},
            reason: document.getElementById('reason').value
          })
        });
        var data = await res.json();
        if (res.ok) {
          msg.style.color = '#34d399';
          msg.textContent = 'Report submitted! The sender and group admin(s) have been notified. Redirecting...';
          setTimeout(function () { window.location.href = '/#settle'; }, 1800);
        } else {
          msg.style.color = '#fb7185';
          msg.textContent = data.error || 'Could not submit report.';
          btn.disabled = false;
          btn.textContent = 'Submit Report Not Received';
        }
      } catch (err) {
        msg.style.color = '#fb7185';
        msg.textContent = 'Network error. Please open Vasool to report.';
        btn.disabled = false;
        btn.textContent = 'Submit Report Not Received';
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { settlementsRouter: router };
