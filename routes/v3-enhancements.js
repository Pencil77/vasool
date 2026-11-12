const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { requireAuth } = require('./auth');
const logger = require('../lib/logger');
const otel = require('../lib/otel');

const router = express.Router();
const SUPER_ADMIN_EMAIL = 'mdzubair7592@gmail.com';

function isSuperAdminUser(user) {
  if (!user) return false;
  return (
    user.role === 'super_admin' ||
    user.isSuperAdmin === true ||
    (user.email && user.email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase())
  );
}

function appendGroupAuditLog(group, { action, actorEmail = '', actorName = '', summary = '', details = '' }) {
  if (!group) return;
  if (!Array.isArray(group.auditLog)) {
    group.auditLog = [];
  }
  group.auditLog.unshift({
    action: String(action || 'event').trim(),
    actorEmail: String(actorEmail || '').toLowerCase().trim(),
    actorName: String(actorName || actorEmail || 'System').trim(),
    summary: String(summary || action).trim(),
    details: String(details || '').trim(),
    createdAt: new Date()
  });
  if (group.auditLog.length > 100) {
    group.auditLog = group.auditLog.slice(0, 100);
  }
}

// GET /api/groups/:id/activity - Retrieve chronological group audit trail
router.get('/groups/:id/activity', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    const requesterEmail = (req.user.email || '').toLowerCase().trim();
    const isMember = group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail);
    if (!isMember && !isSuperAdminUser(req.user)) {
      return res.status(403).json({ error: 'Access denied to this group activity log.' });
    }
    return res.status(200).json({
      groupId: group._id.toString(),
      groupName: group.name,
      auditLog: group.auditLog || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses - Create expense with 7-currency FX, linked refund & audit log
router.post('/expenses', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const {
      groupId,
      description,
      amount,
      currency,
      originalAmount,
      originalCurrency,
      exchangeRate,
      category,
      parentExpenseId = null,
      parentExpenseDesc = '',
      paidByEmail,
      paidByName,
      splitType = 'equal',
      splits = [],
      roundingRemainder = 0,
      remainderAbsorbedBy = '',
      notes = '',
      type = 'expense'
    } = req.body;

    const totalAmount = Number(amount);
    if (!groupId || !description || !totalAmount || totalAmount <= 0 || !splits.length) {
      return res.status(400).json({ error: 'Group, description, positive amount, and participants are required.' });
    }

    const expense = await Expense.create({
      groupId,
      description: String(description).trim(),
      amount: Math.round(totalAmount * 100) / 100,
      currency: currency || 'INR',
      originalAmount: originalAmount ? Math.round(Number(originalAmount) * 100) / 100 : Math.round(totalAmount * 100) / 100,
      originalCurrency: originalCurrency || currency || 'INR',
      exchangeRate: Number(exchangeRate) > 0 ? Number(exchangeRate) : 1,
      type: type === 'income' ? 'income' : 'expense',
      category: category || (type === 'income' ? '💵 Income & Refunds' : '🍔 Food & Dining'),
      parentExpenseId: parentExpenseId ? String(parentExpenseId) : null,
      parentExpenseDesc: parentExpenseDesc ? String(parentExpenseDesc).trim() : '',
      paidByEmail: String(paidByEmail || req.user.email).toLowerCase().trim(),
      paidByName: String(paidByName || req.user.name).trim(),
      splitType,
      splits,
      roundingRemainder: Number(roundingRemainder) || 0,
      remainderAbsorbedBy: String(remainderAbsorbedBy || '').trim(),
      notes
    });

    try {
      const grp = await Group.findById(groupId);
      if (grp) {
        const fxTag =
          expense.originalCurrency && expense.originalCurrency !== 'INR' && expense.exchangeRate !== 1
            ? ` (${expense.originalAmount} ${expense.originalCurrency} @ ${expense.exchangeRate})`
            : '';
        appendGroupAuditLog(grp, {
          action: expense.type === 'income' ? 'refund_recorded' : 'expense_created',
          actorEmail: req.user.email,
          actorName: req.user.name || req.user.email,
          summary: `${req.user.name || req.user.email} added ${expense.type === 'income' ? 'refund' : 'bill'} "${expense.description}" for ₹${expense.amount}${fxTag}`,
          details: `Paid by ${expense.paidByName} · ${expense.splitType.toUpperCase()} split${expense.parentExpenseDesc ? ' · Linked to: ' + expense.parentExpenseDesc : ''}`
        });
        await grp.save();
      }
    } catch (auditErr) {
      logger.warn('[splits:audit] Non-blocking audit log warning:', auditErr.message);
    }

    otel.metrics.counter('vasool_expenses_created_total', 1, {
      split_type: splitType,
      category: expense.category,
      type: expense.type
    });

    return res.status(201).json({ expense });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/expenses/:id - Edit an existing expense & log audit entry
router.put('/expenses/:id', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const existing = await Expense.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found.' });
    }

    const group = await Group.findById(existing.groupId);
    const requesterEmail = (req.user.email || '').toLowerCase().trim();
    if (group) {
      const isMember = group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail);
      if (!isMember && !isSuperAdminUser(req.user)) {
        return res.status(403).json({ error: 'Only group members can edit expenses in this group.' });
      }
    }

    const prevAmount = existing.amount;
    const fields = [
      'description', 'currency', 'originalCurrency', 'category',
      'parentExpenseId', 'parentExpenseDesc', 'paidByEmail', 'paidByName',
      'splitType', 'remainderAbsorbedBy', 'notes', 'type'
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) existing[f] = req.body[f];
    });
    if (req.body.amount !== undefined && Number(req.body.amount) > 0) {
      existing.amount = Math.round(Number(req.body.amount) * 100) / 100;
    }
    if (req.body.originalAmount !== undefined) {
      existing.originalAmount = Math.round(Number(req.body.originalAmount) * 100) / 100;
    }
    if (req.body.exchangeRate !== undefined && Number(req.body.exchangeRate) > 0) {
      existing.exchangeRate = Number(req.body.exchangeRate);
    }
    if (Array.isArray(req.body.splits) && req.body.splits.length > 0) {
      existing.splits = req.body.splits;
    }
    if (req.body.roundingRemainder !== undefined) {
      existing.roundingRemainder = Number(req.body.roundingRemainder) || 0;
    }

    await existing.save();

    if (group) {
      appendGroupAuditLog(group, {
        action: 'expense_updated',
        actorEmail: requesterEmail,
        actorName: req.user.name || requesterEmail,
        summary: `${req.user.name || requesterEmail} edited "${existing.description}" (₹${prevAmount} → ₹${existing.amount})`,
        details: `Paid by ${existing.paidByName} · ${existing.splitType.toUpperCase()} split`
      });
      await group.save();
    }

    return res.status(200).json({ expense: existing, message: 'Expense updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id - Authorized deletion returning deletedExpense snapshot for 1-Click Undo
router.delete('/expenses/:id', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const existing = await Expense.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found.' });
    }
    const group = await Group.findById(existing.groupId);
    const requesterEmail = (req.user.email || '').toLowerCase().trim();
    if (group) {
      const isMember = group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail);
      if (!isMember && !isSuperAdminUser(req.user)) {
        return res.status(403).json({ error: 'Access denied. Only group members can delete bills.' });
      }
    }
    const deletedSnapshot = existing.toObject ? existing.toObject() : { ...existing };
    await Expense.findByIdAndDelete(req.params.id);

    if (group) {
      appendGroupAuditLog(group, {
        action: 'expense_deleted',
        actorEmail: requesterEmail,
        actorName: req.user.name || requesterEmail,
        summary: `${req.user.name || requesterEmail} deleted bill "${deletedSnapshot.description}" (₹${deletedSnapshot.amount})`,
        details: `Originally paid by ${deletedSnapshot.paidByName}`
      });
      await group.save();
    }

    return res.status(200).json({ deleted: true, deletedExpense: deletedSnapshot });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/confirm - Full or Partial Settlement Confirmation
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
    const adminMember =
      group.members.find((m) => m.role === 'admin') ||
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
        ? `${req.user.name || requesterEmail} confirmed partial receipt of ₹${settlement.amount} (of ₹${claimedAmt} claimed) from ${settlement.fromName}`
        : `${req.user.name || requesterEmail} confirmed ₹${settlement.amount} payment from ${settlement.fromName} to ${settlement.toName}`,
      details: `${settlement.method}${settlement.utrNumber ? ' · UTR: ' + settlement.utrNumber : ''}${settlement.adminNote ? ' · Note: ' + settlement.adminNote : ''}`
    });
    await group.save();

    return res.status(200).json({
      message: isPartial
        ? `Partial payment of ₹${settlement.amount} (of ₹${claimedAmt}) confirmed.`
        : `Payment of ₹${settlement.amount} confirmed.`,
      settlement,
      isPartial
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { v3EnhancementsRouter: router, appendGroupAuditLog };
