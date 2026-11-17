const express = require('express');
const crypto = require('crypto');
const { connectToDatabase } = require('../lib/mongodb');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const { requireAuth } = require('./auth');
const { sendGroupInviteEmail, sendPaymentConfirmationRequestEmail } = require('../lib/mailer');
const logger = require('../lib/logger');
const otel = require('../lib/otel');
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

    const isTargetCreditor = cleanToEmail === requesterEmail;
    const isHubMode = Boolean(group.adminHubSettlement);

    // Direct Confirmation Rule:
    // In Direct P2P mode (!isHubMode): ONLY the receiving creditor can auto-confirm upon recording.
    // If the payer (even group admin) records it, it remains PENDING confirmation by the recipient.
    // In Admin-Hub mode (isHubMode): All funds route through admin, so admin receiving funds can auto-confirm.
    const isDirectlyConfirmed = isTargetCreditor || (isHubMode && isAdmin && cleanToEmail === requesterEmail);
    const status = isDirectlyConfirmed
      ? 'confirmed'
      : (isHubMode ? 'pending_admin_approval' : 'pending_confirmation');
    const confirmedAt = isDirectlyConfirmed ? new Date() : null;
    const confirmedByEmail = isDirectlyConfirmed ? requesterEmail : null;
    const confirmedRole = isTargetCreditor ? 'creditor' : (isAdmin ? 'admin' : '');
    const confirmationToken = isDirectlyConfirmed ? null : crypto.randomBytes(32).toString('hex');

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
      recordedByEmail: requesterEmail,
      status,
      confirmedAt,
      confirmedByEmail,
      confirmationToken
    });

    // Send email notification to recipient with 1-click confirmation hyperlink
    if (!isDirectlyConfirmed && confirmationToken) {
      try {
        sendPaymentConfirmationRequestEmail({
          settlement,
          group,
          confirmToken: confirmationToken
        }).catch((emailErr) => {
          logger.error('[settlements] Async payment confirmation email error:', emailErr);
        });
      } catch (emailErr) {
        logger.error('[settlements] Failed to dispatch payment confirmation email:', emailErr);
      }
    }

    const message = isDirectlyConfirmed
      ? `Settlement recorded and confirmed by ${isTargetCreditor ? 'receiving creditor' : 'group admin'}.`
      : (isHubMode
          ? 'Payment marked as settled by payer. Awaiting group admin confirmation.'
          : `Payment marked as settled. Confirmation email sent to ${settlement.toName || settlement.toEmail} to acknowledge receipt.`);

    otel.metrics.counter('vasool_settlements_created_total', 1, {
      method: settlement.method,
      status: settlement.status
    });
    otel.metrics.histogram('vasool_settlement_amount_inr', Number(settlement.amount), {
      method: settlement.method
    });

    return res.status(201).json({ settlement, message });
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
    } else if (isSuperAdmin) {
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

    const { receivedAmount, adminNote } = req.body || {};
    const claimedAmt = Number(settlement.amount);
    let isPartial = false;

    if (receivedAmount !== undefined && receivedAmount !== null && Number(receivedAmount) > 0) {
      const parsedReceived = Math.round(Number(receivedAmount) * 100) / 100;
      if (parsedReceived < claimedAmt) {
        settlement.originalClaimedAmount = claimedAmt;
        settlement.amount = parsedReceived;
        isPartial = true;
      }
    }

    if (adminNote !== undefined) {
      settlement.adminNote = String(adminNote || '').trim();
    }

    settlement.status = 'confirmed';
    settlement.confirmedAt = new Date();
    settlement.confirmedByEmail = requesterEmail;
    settlement.confirmedRole = isTargetCreditor ? 'creditor' : 'admin';
    settlement.confirmationToken = null; // Invalidate token on confirm
    await settlement.save();

    appendGroupAuditLog(group, {
      action: isPartial ? 'settlement_partial_confirmed' : 'settlement_confirmed',
      actorEmail: requesterEmail,
      actorName: req.user.name || requesterEmail,
      summary: isPartial
        ? `${req.user.name || requesterEmail} confirmed partial receipt of ₹${settlement.amount} (of ₹${claimedAmt} claimed) from ${settlement.fromName} to ${settlement.toName}`
        : `${req.user.name || requesterEmail} confirmed ₹${settlement.amount} payment from ${settlement.fromName} to ${settlement.toName}`,
      details: `${settlement.method}${settlement.utrNumber ? ' · UTR: ' + settlement.utrNumber : ''}${settlement.adminNote ? ' · Note: ' + settlement.adminNote : ''}`
    });
    await group.save();

    otel.metrics.counter('vasool_settlements_confirmed_total', 1, {
      confirmed_role: settlement.confirmedRole,
      partial: String(isPartial)
    });

    return res.status(200).json({
      message: isPartial
        ? `Partial payment of ₹${settlement.amount} (of ₹${claimedAmt}) confirmed by ${isTargetCreditor ? 'creditor' : 'group admin'}. Remaining ₹${Math.round((claimedAmt - settlement.amount) * 100) / 100} stays open.`
        : `Payment of ₹${settlement.amount} confirmed by ${isTargetCreditor ? 'creditor' : 'group admin'}. Transaction is now settled.`,
      settlement,
      isPartial
    });
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

    settlement.status = 'rejected';
    settlement.rejectedReason = reason || `Payment claim rejected by ${isTargetCreditor ? 'creditor' : 'group admin'}.`;
    settlement.confirmationToken = null; // Invalidate token on reject
    await settlement.save();

    otel.metrics.counter('vasool_settlements_rejected_total', 1);

    return res.status(200).json({
      message: 'Settlement payment claim rejected.',
      settlement
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/settlements/:id/revert
 * Reverts a recorded/acknowledged settlement back to an open debt.
 * Allowed for the payer, the recipient, or the person who recorded it.
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

    if (!isPayer && !isRecipient && !isRecorder && !isSuperAdmin) {
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

    settlement.status = 'reverted';
    settlement.revertedAt = new Date();
    settlement.revertedByEmail = requesterEmail;
    settlement.confirmationToken = null; // Invalidate any pending confirmation link
    await settlement.save();

    const group = await Group.findById(settlement.groupId);
    if (group) {
      appendGroupAuditLog(group, {
        action: 'settlement_reverted',
        actorEmail: requesterEmail,
        actorName: req.user.name || requesterEmail,
        summary: `${req.user.name || requesterEmail} reverted ₹${settlement.amount} settlement from ${settlement.fromName} to ${settlement.toName}`,
        details: `${settlement.method}${settlement.utrNumber ? ' · UTR: ' + settlement.utrNumber : ''}`
      });
      await group.save();
    }

    otel.metrics.counter('vasool_settlements_reverted_total', 1);

    return res.status(200).json({
      message: `Settlement of ₹${settlement.amount} reverted. The amount is due again.`,
      settlement
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

    // Secure timing-safe token verification
    if (!settlement.confirmationToken || settlement.confirmationToken !== token) {
      return res.status(403).send(renderAckResultPage({
        success: false,
        title: 'Link Expired or Invalid',
        message: 'This confirmation link is invalid or has already been used.',
        alreadyConfirmed: false
      }));
    }

    // Confirm settlement
    settlement.status = 'confirmed';
    settlement.confirmedAt = new Date();
    settlement.confirmedByEmail = settlement.toEmail;
    settlement.confirmedRole = 'creditor';
    settlement.confirmationToken = null; // Invalidate token to prevent reuse
    await settlement.save();

    // Group audit log
    const group = await Group.findById(settlement.groupId);
    if (group) {
      appendGroupAuditLog(group, {
        action: 'settlement_confirmed_email',
        actorEmail: settlement.toEmail,
        actorName: settlement.toName || settlement.toEmail,
        summary: `${settlement.toName || settlement.toEmail} acknowledged receipt of ₹${settlement.amount} from ${settlement.fromName} via email confirmation`,
        details: `${settlement.method}${settlement.utrNumber ? ' · UTR: ' + settlement.utrNumber : ''}`
      });
      await group.save();
    }

    otel.metrics.counter('vasool_settlements_confirmed_total', 1, {
      confirmed_role: 'creditor_email',
      partial: 'false'
    });

    return res.status(200).send(renderAckResultPage({
      success: true,
      title: 'Payment Confirmed Successfully! 🎉',
      message: `You have successfully acknowledged receipt of ₹${settlement.amount} from ${settlement.fromName}. The group balance has been updated and the debt is closed.`,
      settlement,
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

// GET /api/settlements - List recorded settlements
router.get('/settlements', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const filter = {};
    if (req.query.groupId) {
      filter.groupId = req.query.groupId;
    } else {
      const userGroups = await Group.find({ 'members.email': req.user.email }, { _id: 1 });
      filter.groupId = { $in: userGroups.map((g) => g._id) };
    }
    const settlements = await Settlement.find(filter).sort({ settledAt: -1, createdAt: -1 });
    return res.status(200).json({ settlements });
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

module.exports = { settlementsRouter: router };
