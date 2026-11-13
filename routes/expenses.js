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

// GET /api/expenses - List expenses (optionally filtered by groupId)
router.get('/expenses', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const filter = {};
    const userGroups = await Group.find({ 'members.email': req.user.email });
    const userGroupIds = userGroups.map((g) => g._id.toString());

    if (req.query.groupId) {
      if (!userGroupIds.includes(String(req.query.groupId))) {
        return res.status(403).json({ error: 'Access denied to this group expenses.' });
      }
      filter.groupId = req.query.groupId;
    } else {
      filter.groupId = { $in: userGroups.map((g) => g._id) };
    }

    const expenses = await Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 });

    const groupMap = {};
    userGroups.forEach((g) => {
      groupMap[g._id.toString()] = g;
    });

    const requesterEmail = req.user.email.toLowerCase().trim();

    // Privacy filter: if group has splitsVisibility === 'personal_only' and user is not admin,
    // normal users can only see their own part of the share, not others
    const sanitizedExpenses = expenses.map((exp) => {
      const g = groupMap[exp.groupId.toString()];
      if (!g) return exp;

      const adminMember = g.members.find((m) => m.role === 'admin') ||
        (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
        g.members[0];

      const isAdmin = isSuperAdminUser(req.user) || (adminMember && adminMember.email.toLowerCase().trim() === requesterEmail);
      const isPersonalOnly = (g.splitsVisibility || 'personal_only') === 'personal_only';

      if (isPersonalOnly && !isAdmin) {
        // Redact other members' split shares, only show requester's share
        const mySplit = exp.splits.find((s) => s.memberEmail.toLowerCase() === requesterEmail);
        const otherSum = exp.splits
          .filter((s) => s.memberEmail.toLowerCase() !== requesterEmail)
          .reduce((acc, s) => acc + s.amount, 0);

        const visibleSplits = [];
        if (mySplit) visibleSplits.push(mySplit);
        if (otherSum > 0) {
          visibleSplits.push({
            memberEmail: 'private@group',
            memberName: 'Other Members (Hidden by Admin)',
            amount: Math.round(otherSum * 100) / 100,
            isPrivate: true
          });
        }

        const expObj = exp.toObject ? exp.toObject() : { ...exp };
        expObj.splits = visibleSplits;
        expObj.isPersonalView = true;
        return expObj;
      }

      return exp;
    });

    return res.status(200).json({ expenses: sanitizedExpenses });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses - Create an expense with equal/exact/percentage/shares split, FX conversion & linked refund support
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
      paidByAllocations = [],
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

    let normalizedPayers = [];
    if (Array.isArray(paidByAllocations) && paidByAllocations.length > 0) {
      normalizedPayers = paidByAllocations
        .map((p) => ({
          memberEmail: String(p.memberEmail || p.email || '').toLowerCase().trim(),
          memberName: String(p.memberName || p.name || p.memberEmail || 'Member').trim(),
          amount: Math.round((Number(p.amount) || 0) * 100) / 100
        }))
        .filter((p) => p.memberEmail && p.amount > 0);
    }
    const resolvedPaidByEmail = normalizedPayers.length > 0
      ? normalizedPayers[0].memberEmail
      : String(paidByEmail || req.user.email).toLowerCase().trim();
    const resolvedPaidByName = normalizedPayers.length > 1
      ? normalizedPayers.map((p) => `${p.memberName.split(' ')[0]} (₹${p.amount})`).join(' + ')
      : normalizedPayers.length === 1
        ? normalizedPayers[0].memberName
        : String(paidByName || req.user.name).trim();
    if (normalizedPayers.length === 0) {
      normalizedPayers = [{
        memberEmail: resolvedPaidByEmail,
        memberName: resolvedPaidByName,
        amount: Math.round(totalAmount * 100) / 100
      }];
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
      paidByEmail: resolvedPaidByEmail,
      paidByName: resolvedPaidByName,
      paidByAllocations: normalizedPayers,
      splitType,
      splits,
      roundingRemainder: Number(roundingRemainder) || 0,
      remainderAbsorbedBy: String(remainderAbsorbedBy || '').trim(),
      notes
    });

    try {
      const grp = await Group.findById(groupId);
      if (grp) {
        const fxTag = (expense.originalCurrency && expense.originalCurrency !== 'INR' && expense.exchangeRate !== 1)
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
    otel.metrics.histogram('vasool_expense_amount_inr', expense.amount, {
      split_type: splitType,
      category: expense.category
    });

    return res.status(201).json({ expense });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/expenses/:id - Edit an existing expense & recalculate group balances
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

    const {
      description,
      amount,
      currency,
      originalAmount,
      originalCurrency,
      exchangeRate,
      category,
      parentExpenseId,
      parentExpenseDesc,
      paidByEmail,
      paidByName,
      paidByAllocations,
      splitType,
      splits,
      roundingRemainder,
      remainderAbsorbedBy,
      notes,
      type
    } = req.body;

    const prevAmount = existing.amount;
    const prevDesc = existing.description;

    if (description !== undefined) existing.description = String(description).trim();
    if (amount !== undefined && Number(amount) > 0) {
      existing.amount = Math.round(Number(amount) * 100) / 100;
    }
    if (currency !== undefined) existing.currency = currency;
    if (originalAmount !== undefined) {
      existing.originalAmount = originalAmount ? Math.round(Number(originalAmount) * 100) / 100 : existing.amount;
    }
    if (originalCurrency !== undefined) existing.originalCurrency = originalCurrency || 'INR';
    if (exchangeRate !== undefined && Number(exchangeRate) > 0) existing.exchangeRate = Number(exchangeRate);
    if (type !== undefined) existing.type = type === 'income' ? 'income' : 'expense';
    if (category !== undefined) existing.category = category;
    if (parentExpenseId !== undefined) existing.parentExpenseId = parentExpenseId ? String(parentExpenseId) : null;
    if (parentExpenseDesc !== undefined) existing.parentExpenseDesc = String(parentExpenseDesc || '').trim();
    if (paidByEmail !== undefined) existing.paidByEmail = String(paidByEmail).toLowerCase().trim();
    if (paidByName !== undefined) existing.paidByName = String(paidByName).trim();
    if (Array.isArray(paidByAllocations) && paidByAllocations.length > 0) {
      const cleanAlloc = paidByAllocations
        .map((p) => ({
          memberEmail: String(p.memberEmail || p.email || '').toLowerCase().trim(),
          memberName: String(p.memberName || p.name || p.memberEmail || 'Member').trim(),
          amount: Math.round((Number(p.amount) || 0) * 100) / 100
        }))
        .filter((p) => p.memberEmail && p.amount > 0);
      if (cleanAlloc.length > 0) {
        existing.paidByAllocations = cleanAlloc;
        existing.paidByEmail = cleanAlloc[0].memberEmail;
        existing.paidByName = cleanAlloc.length > 1
          ? cleanAlloc.map((p) => `${p.memberName.split(' ')[0]} (₹${p.amount})`).join(' + ')
          : cleanAlloc[0].memberName;
      }
    }
    if (splitType !== undefined) existing.splitType = splitType;
    if (Array.isArray(splits) && splits.length > 0) existing.splits = splits;
    if (roundingRemainder !== undefined) existing.roundingRemainder = Number(roundingRemainder) || 0;
    if (remainderAbsorbedBy !== undefined) existing.remainderAbsorbedBy = String(remainderAbsorbedBy || '').trim();
    if (notes !== undefined) existing.notes = String(notes || '');

    await existing.save();

    if (group) {
      appendGroupAuditLog(group, {
        action: 'expense_updated',
        actorEmail: requesterEmail,
        actorName: req.user.name || requesterEmail,
        summary: `${req.user.name || requesterEmail} edited "${existing.description}" (₹${prevAmount} → ₹${existing.amount})`,
        details: prevDesc !== existing.description ? `Renamed from "${prevDesc}" · ${existing.splitType.toUpperCase()} split` : `Paid by ${existing.paidByName} · ${existing.splitType.toUpperCase()} split`
      });
      await group.save();
    }

    otel.metrics.counter('vasool_expenses_updated_total', 1, {
      split_type: existing.splitType,
      category: existing.category
    });

    return res.status(200).json({ expense: existing, message: 'Expense updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id - Authorized expense deletion with undo payload & audit log
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

    otel.metrics.counter('vasool_expenses_deleted_total', 1);
    return res.status(200).json({ deleted: true, deletedExpense: deletedSnapshot });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { expensesRouter: router };
