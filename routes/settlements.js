const express = require('express');
const crypto = require('crypto');
const { connectToDatabase } = require('../lib/mongodb');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const { requireAuth } = require('./auth');
const { sendGroupInviteEmail } = require('../lib/mailer');
const logger = require('../lib/logger');
const otel = require('../lib/otel');
const {
  SUPER_ADMIN_EMAIL,
  isSuperAdminUser,
  appendGroupAuditLog,
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
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

    const balanceMap = {};
    const ensureMember = (email, name) => {
      const key = String(email).toLowerCase().trim();
      if (!balanceMap[key]) {
        balanceMap[key] = { email: key, name: name || key, paid: 0, owed: 0, net: 0 };
      }
      return balanceMap[key];
    };

    groups.forEach((g) => {
      g.members.forEach((m) => ensureMember(m.email, m.name));
    });

    expenses.forEach((exp) => {
      const isIncome = exp.type === 'income';
      const payer = ensureMember(exp.paidByEmail, exp.paidByName);

      if (isIncome) {
        // Income/Refund: Payer received the money (e.g. deposit returned), so Payer owes participants their split back!
        payer.paid -= exp.amount;
        payer.net -= exp.amount;

        exp.splits.forEach((s) => {
          const participant = ensureMember(s.memberEmail, s.memberName);
          participant.owed -= s.amount;
          participant.net += s.amount;
        });
      } else {
        payer.paid += exp.amount;
        payer.net += exp.amount;

        exp.splits.forEach((s) => {
          const participant = ensureMember(s.memberEmail, s.memberName);
          participant.owed += s.amount;
          participant.net -= s.amount;
        });
      }
    });

    settlements.forEach((st) => {
      // Handshake rule: Only CONFIRMED settlements reduce net debt balances!
      if (st.status === 'confirmed') {
        const payer = ensureMember(st.fromEmail, st.fromName);
        const receiver = ensureMember(st.toEmail, st.toName);
        payer.net += st.amount;
        receiver.net -= st.amount;
      }
    });

    let simplifiedTransactions = [];
    if (groups.length === 1) {
      const g = groups[0];
      const isMinimized = g.minimizeDebts !== false;
      if (!isMinimized) {
        simplifiedTransactions = calculateDirectDebts(expenses, settlements);
      } else if (g.adminHubSettlement === true) {
        const adminMember = g.members.find((m) => m.role === 'admin') ||
          (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
          g.members[0];
        simplifiedTransactions = simplifyDebtsAdminHub(balanceMap, adminMember);
      } else {
        simplifiedTransactions = simplifyDebtsGreedy(balanceMap);
      }
    } else if (groups.length > 1) {
      // Calculate transactions for each group
      groups.forEach((g) => {
        const groupBalanceMap = {};
        const ensureGroupMember = (email, name) => {
          const key = String(email).toLowerCase().trim();
          if (!groupBalanceMap[key]) {
            groupBalanceMap[key] = { email: key, name: name || key, paid: 0, owed: 0, net: 0 };
          }
          return groupBalanceMap[key];
        };

        g.members.forEach((m) => ensureGroupMember(m.email, m.name));

        const grpExpenses = expenses.filter((e) => String(e.groupId) === String(g._id));
        const grpSettlements = settlements.filter((s) => String(s.groupId) === String(g._id));

        const isMinimized = g.minimizeDebts !== false;
        if (!isMinimized) {
          simplifiedTransactions.push(...calculateDirectDebts(grpExpenses, grpSettlements));
        } else {
          grpExpenses.forEach((exp) => {
            const isIncome = exp.type === 'income';
            const payer = ensureGroupMember(exp.paidByEmail, exp.paidByName);
            if (isIncome) {
              payer.paid -= exp.amount;
              payer.net -= exp.amount;
              exp.splits.forEach((s) => {
                const p = ensureGroupMember(s.memberEmail, s.memberName);
                p.owed -= s.amount;
                p.net += s.amount;
              });
            } else {
              payer.paid += exp.amount;
              payer.net += exp.amount;
              exp.splits.forEach((s) => {
                const p = ensureGroupMember(s.memberEmail, s.memberName);
                p.owed += s.amount;
                p.net -= s.amount;
              });
            }
          });

          grpSettlements.forEach((st) => {
            if (st.status === 'confirmed') {
              const payer = ensureGroupMember(st.fromEmail, st.fromName);
              const receiver = ensureGroupMember(st.toEmail, st.toName);
              payer.net += st.amount;
              receiver.net -= st.amount;
            }
          });

          if (g.adminHubSettlement === true) {
            const adminMember = g.members.find((m) => m.role === 'admin') ||
              (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
              g.members[0];
            simplifiedTransactions.push(...simplifyDebtsAdminHub(groupBalanceMap, adminMember));
          } else {
            simplifiedTransactions.push(...simplifyDebtsGreedy(groupBalanceMap));
          }
        }
      });
    } else {
      simplifiedTransactions = simplifyDebtsGreedy(balanceMap);
    }

    // Attach pending approval amounts to transactions
    const pendingSettlements = settlements.filter((s) => s.status === 'pending_admin_approval');
    const pendingMap = {};
    pendingSettlements.forEach((s) => {
      const key = `${s.fromEmail}->${s.toEmail}`;
      pendingMap[key] = (pendingMap[key] || 0) + s.amount;
    });

    simplifiedTransactions.forEach((t) => {
      const key = `${t.fromEmail}->${t.toEmail}`;
      t.pendingApprovalAmount = Math.round((pendingMap[key] || 0) * 100) / 100;
      t.isPendingApproval = t.pendingApprovalAmount > 0;
      t.remainingDue = Math.max(0, Math.round((t.amount - t.pendingApprovalAmount) * 100) / 100);
    });

    const requesterEmail = req.user.email.toLowerCase().trim();
    let balances = Object.values(balanceMap);

    // Privacy rule: If group is personal_only and user is not admin,
    // they only see their own part of the share, not others
    const hasPersonalOnly = groups.some((g) => (g.splitsVisibility || 'personal_only') === 'personal_only');
    const isRequesterAdmin = groups.some((g) => {
      const adm = g.members.find((m) => m.role === 'admin') ||
        (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
        g.members[0];
      return adm && adm.email.toLowerCase().trim() === requesterEmail;
    });

    if (hasPersonalOnly && !isRequesterAdmin) {
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

    const isFullyClosed = simplifiedTransactions.length === 0 && pendingSettlements.length === 0;

    // Settle Up "Who Should Pay Next?" Algorithm:
    // Identify member with lowest (most negative) net balance across the group
    let whoShouldPay = null;
    const allBalances = Object.values(balanceMap);
    if (allBalances.length > 0) {
      const minNet = Math.min(...allBalances.map((b) => b.net));
      if (minNet < -0.01) {
        const candidate = allBalances.find((b) => Math.abs(b.net - minNet) < 0.001);
        if (candidate) {
          whoShouldPay = {
            email: candidate.email,
            name: candidate.name,
            netDebt: Math.round(Math.abs(minNet) * 100) / 100
          };
        }
      }
    }

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
    const adminMember = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isAdmin = isSuperAdminUser(req.user) || (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail);
    const isTargetCreditor = String(toEmail).toLowerCase().trim() === requesterEmail;

    // Dual Confirmation Handshake:
    // If admin OR the receiving creditor is recording the transaction -> directly confirmed
    // Otherwise -> pending_admin_approval (confirmable by either admin or creditor)
    const isDirectlyConfirmed = isAdmin || isTargetCreditor;
    const status = isDirectlyConfirmed ? 'confirmed' : 'pending_admin_approval';
    const confirmedAt = isDirectlyConfirmed ? new Date() : null;
    const confirmedByEmail = isDirectlyConfirmed ? requesterEmail : null;
    const confirmedRole = isTargetCreditor ? 'creditor' : (isAdmin ? 'admin' : '');

    const settlement = await Settlement.create({
      groupId,
      fromEmail: String(fromEmail).toLowerCase().trim(),
      fromName: String(fromName || fromEmail).trim(),
      toEmail: String(toEmail).toLowerCase().trim(),
      toName: String(toName || toEmail).trim(),
      amount: Math.round(Number(amount) * 100) / 100,
      currency: currency || 'INR',
      method: method || 'UPI',
      referenceNote: referenceNote || '',
      utrNumber: req.body.utrNumber ? String(req.body.utrNumber).trim() : '',
      confirmedRole,
      status,
      confirmedAt,
      confirmedByEmail
    });

    const message = isDirectlyConfirmed
      ? `Settlement recorded and confirmed by ${isTargetCreditor ? 'receiving creditor' : 'group admin'}.`
      : 'Payment marked as settled by payer. Awaiting creditor or admin confirmation.';

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
    const adminMember = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isAdmin = isSuperAdminUser(req.user) || (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail);
    const isTargetCreditor = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;

    if (!isAdmin && !isTargetCreditor) {
      return res.status(403).json({ error: 'Only the receiving creditor or group admin can confirm payment receipt.' });
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
    const adminMember = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isAdmin = isSuperAdminUser(req.user) || (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail);
    const isTargetCreditor = settlement.toEmail && settlement.toEmail.toLowerCase().trim() === requesterEmail;

    if (!isAdmin && !isTargetCreditor) {
      return res.status(403).json({ error: 'Only the receiving creditor or group admin can reject payment claims.' });
    }

    settlement.status = 'rejected';
    settlement.rejectedReason = reason || `Payment claim rejected by ${isTargetCreditor ? 'creditor' : 'group admin'}.`;
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

module.exports = { settlementsRouter: router };
