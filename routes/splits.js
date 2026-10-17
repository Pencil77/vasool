const express = require('express');
const crypto = require('crypto');
const { connectToDatabase } = require('../lib/mongodb');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { requireAuth } = require('./auth');

const router = express.Router();

/**
 * Greedy Minimum-Cash-Flow Debt Simplification Algorithm
 * Takes net balances { email: { name, email, net } } and produces the minimal
 * set of directed transfers [{ fromEmail, fromName, toEmail, toName, amount }].
 */
function simplifyDebts(balanceMap) {
  const debtors = [];
  const creditors = [];

  Object.values(balanceMap).forEach((entry) => {
    const rounded = Math.round(entry.net * 100) / 100;
    if (rounded < -0.01) {
      debtors.push({ ...entry, amount: Math.abs(rounded) });
    } else if (rounded > 0.01) {
      creditors.push({ ...entry, amount: rounded });
    }
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settledAmount = Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100;

    if (settledAmount > 0) {
      transactions.push({
        fromEmail: debtor.email,
        fromName: debtor.name,
        toEmail: creditor.email,
        toName: creditor.name,
        amount: settledAmount
      });
    }

    debtor.amount = Math.round((debtor.amount - settledAmount) * 100) / 100;
    creditor.amount = Math.round((creditor.amount - settledAmount) * 100) / 100;

    if (debtor.amount <= 0.01) i++;
    if (creditor.amount <= 0.01) j++;
  }

  return transactions;
}

// GET /api/groups - List groups where user is a member
router.get('/groups', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const groups = await Group.find({ 'members.email': req.user.email }).sort({ updatedAt: -1 });
    return res.status(200).json({ groups });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups - Create a new group
router.post('/groups', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { name, description, category, currency, members = [] } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    const normalizedCreator = {
      name: req.user.name,
      email: req.user.email.toLowerCase(),
      role: 'owner'
    };

    const seenEmails = new Set([normalizedCreator.email]);
    const finalMembers = [normalizedCreator];

    members.forEach((m) => {
      if (m && m.email && m.name) {
        const cleanEmail = String(m.email).toLowerCase().trim();
        if (!seenEmails.has(cleanEmail)) {
          seenEmails.add(cleanEmail);
          finalMembers.push({
            name: String(m.name).trim(),
            email: cleanEmail,
            role: 'member'
          });
        }
      }
    });

    const inviteCode = 'SPL-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const group = await Group.create({
      name: String(name).trim(),
      description: description ? String(description).trim() : '',
      category: category || 'Trip',
      currency: currency || 'INR',
      inviteCode,
      createdByEmail: normalizedCreator.email,
      members: finalMembers
    });

    return res.status(201).json({ group });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/members - Add a member to a group
router.post('/groups/:id/members', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Member name and email are required.' });
    }
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    if (group.members.some((m) => m.email === cleanEmail)) {
      return res.status(409).json({ error: 'Member is already in this group.' });
    }

    group.members.push({ name: String(name).trim(), email: cleanEmail, role: 'member' });
    await group.save();
    return res.status(200).json({ group });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses - List expenses (optionally filtered by groupId)
router.get('/expenses', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const filter = {};
    if (req.query.groupId) {
      filter.groupId = req.query.groupId;
    } else {
      const userGroups = await Group.find({ 'members.email': req.user.email }, { _id: 1 });
      filter.groupId = { $in: userGroups.map((g) => g._id) };
    }
    const expenses = await Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 });
    return res.status(200).json({ expenses });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses - Create an expense with equal/exact/percentage/shares split
router.post('/expenses', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const {
      groupId,
      description,
      amount,
      currency,
      category,
      paidByEmail,
      paidByName,
      splitType = 'equal',
      splits = [],
      notes = ''
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
      category: category || 'Food & Dining',
      paidByEmail: String(paidByEmail || req.user.email).toLowerCase().trim(),
      paidByName: String(paidByName || req.user.name).trim(),
      splitType,
      splits,
      notes
    });

    return res.status(201).json({ expense });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id
router.delete('/expenses/:id', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    await Expense.findByIdAndDelete(req.params.id);
    return res.status(200).json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
      const payer = ensureMember(exp.paidByEmail, exp.paidByName);
      payer.paid += exp.amount;
      payer.net += exp.amount;

      exp.splits.forEach((s) => {
        const participant = ensureMember(s.memberEmail, s.memberName);
        participant.owed += s.amount;
        participant.net -= s.amount;
      });
    });

    settlements.forEach((st) => {
      const payer = ensureMember(st.fromEmail, st.fromName);
      const receiver = ensureMember(st.toEmail, st.toName);
      payer.net += st.amount;
      receiver.net -= st.amount;
    });

    const simplifiedTransactions = simplifyDebts(balanceMap);

    return res.status(200).json({
      balances: Object.values(balanceMap),
      simplifiedTransactions,
      settlements
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

    const settlement = await Settlement.create({
      groupId,
      fromEmail: String(fromEmail).toLowerCase().trim(),
      fromName: String(fromName || fromEmail).trim(),
      toEmail: String(toEmail).toLowerCase().trim(),
      toName: String(toName || toEmail).trim(),
      amount: Math.round(Number(amount) * 100) / 100,
      currency: currency || 'INR',
      method: method || 'UPI',
      referenceNote: referenceNote || ''
    });

    return res.status(201).json({ settlement });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { splitsRouter: router };
