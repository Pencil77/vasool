const express = require('express');
const crypto = require('crypto');
const { connectToDatabase } = require('../lib/mongodb');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { requireAuth } = require('./auth');

const router = express.Router();

/**
 * Greedy Minimum-Cash-Flow Fallback
 */
function simplifyDebtsGreedy(balanceMap) {
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

/**
 * Admin-Hub Debt Calibration Algorithm:
 * All group members pay to the group Admin, and the Admin settles back to all creditors.
 * The Admin is also a normal member of the group who shares splits and may owe or be owed.
 * 
 * For every non-admin member M != Admin:
 * - If M's net balance < -0.01 (M owes): M pays Admin |M.net|
 * - If M's net balance > 0.01 (M is owed): Admin pays M M.net
 */
function simplifyDebtsAdminHub(balanceMap, adminMember) {
  if (!adminMember || !adminMember.email) {
    return simplifyDebtsGreedy(balanceMap);
  }

  const adminEmail = String(adminMember.email).toLowerCase().trim();
  const adminName = adminMember.name || 'Admin';
  const transactions = [];

  Object.values(balanceMap).forEach((entry) => {
    const memberEmail = String(entry.email).toLowerCase().trim();
    if (memberEmail === adminEmail) return;

    const rounded = Math.round(entry.net * 100) / 100;
    if (rounded < -0.01) {
      // Non-admin debtor pays the group Admin
      transactions.push({
        fromEmail: entry.email,
        fromName: entry.name,
        toEmail: adminEmail,
        toName: adminName,
        amount: Math.round(Math.abs(rounded) * 100) / 100,
        isAdminTransfer: true,
        type: 'pay_to_admin'
      });
    } else if (rounded > 0.01) {
      // Group Admin pays the non-admin creditor
      transactions.push({
        fromEmail: adminEmail,
        fromName: adminName,
        toEmail: entry.email,
        toName: entry.name,
        amount: Math.round(rounded * 100) / 100,
        isAdminTransfer: true,
        type: 'admin_payout'
      });
    }
  });

  // Sort: payments to admin first, payouts by admin second, then descending by amount
  transactions.sort((a, b) => {
    if (a.toEmail === adminEmail && b.toEmail !== adminEmail) return -1;
    if (a.toEmail !== adminEmail && b.toEmail === adminEmail) return 1;
    return b.amount - a.amount;
  });

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

// POST /api/groups - Create a new group (creator is default Admin)
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
      role: 'admin'
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
      adminEmail: normalizedCreator.email,
      members: finalMembers
    });

    return res.status(201).json({ group });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/transfer-admin - Transfer group adminship to another member
router.post('/groups/:id/transfer-admin', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { newAdminEmail } = req.body;
    if (!newAdminEmail) {
      return res.status(400).json({ error: 'newAdminEmail is required.' });
    }

    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const cleanNewAdminEmail = String(newAdminEmail).toLowerCase().trim();
    const requesterEmail = req.user.email.toLowerCase().trim();

    // Verify requester is current admin (strictly one admin in group)
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members.find((m) => m.role === 'owner') ||
      group.members[0];

    const isCurrentAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail;

    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the current group admin can transfer admin privileges.' });
    }

    // Verify target member is in group
    const targetMember = group.members.find((m) => m.email === cleanNewAdminEmail);
    if (!targetMember) {
      return res.status(400).json({ error: 'Target user is not a member of this group.' });
    }

    // Enforce strictly ONLY ONE admin in group
    group.members.forEach((m) => {
      if (m.email === cleanNewAdminEmail) {
        m.role = 'admin';
      } else {
        m.role = 'member';
      }
    });
    group.adminEmail = cleanNewAdminEmail;

    await group.save();

    return res.status(200).json({
      message: `Admin privileges successfully transferred to ${targetMember.name} (${cleanNewAdminEmail}).`,
      group
    });
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

// PATCH /api/groups/:id/visibility - Update group split visibility policy (admin-only)
router.patch('/groups/:id/visibility', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { splitVisibility } = req.body;
    if (!['all', 'self'].includes(splitVisibility)) {
      return res.status(400).json({ error: "splitVisibility must be 'all' or 'self'." });
    }

    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members.find((m) => m.role === 'owner') ||
      group.members[0];

    const isCurrentAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail;
    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the current group admin can control split visibility.' });
    }

    group.splitVisibility = splitVisibility;
    await group.save();

    return res.status(200).json({
      message: `Group split visibility updated to '${splitVisibility}'.`,
      group
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses - List expenses (optionally filtered by groupId, with splitVisibility policy applied)
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

    const requesterEmail = req.user.email.toLowerCase().trim();
    const groups = await Group.find(filter.groupId ? { _id: filter.groupId } : { 'members.email': req.user.email });
    const groupPolicyMap = {};

    groups.forEach((g) => {
      const adminMember = g.members.find((m) => m.role === 'admin') ||
        (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
        g.members?.find((m) => m.role === 'owner') ||
        g.members[0];

      const isAdmin = adminMember && adminMember.email.toLowerCase().trim() === requesterEmail;
      groupPolicyMap[String(g._id)] = {
        splitVisibility: g.splitVisibility || 'all',
        isAdmin
      };
    });

    const expenses = await Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 });

    const sanitizedExpenses = expenses.map((exp) => {
      const policy = groupPolicyMap[String(exp.groupId)];
      if (policy && policy.splitVisibility === 'self' && !policy.isAdmin) {
        // Normal user only sees their own split share
        const obj = exp.toObject ? exp.toObject() : { ...exp };
        const mySplits = (obj.splits || []).filter(
          (s) => s.memberEmail.toLowerCase() === requesterEmail
        );
        obj.splits = mySplits;
        obj.splitsRestricted = true;
        return obj;
      }
      return exp;
    });

    return res.status(200).json({ expenses: sanitizedExpenses });
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

    let simplifiedTransactions = [];
    if (groups.length === 1) {
      const g = groups[0];
      const adminMember = g.members.find((m) => m.role === 'admin' || m.role === 'owner') || g.members[0];
      simplifiedTransactions = simplifyDebtsAdminHub(balanceMap, adminMember);
    } else if (groups.length > 1) {
      // Calculate Admin-Hub transactions for each group
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

        grpExpenses.forEach((exp) => {
          const payer = ensureGroupMember(exp.paidByEmail, exp.paidByName);
          payer.paid += exp.amount;
          payer.net += exp.amount;
          exp.splits.forEach((s) => {
            const p = ensureGroupMember(s.memberEmail, s.memberName);
            p.owed += s.amount;
            p.net -= s.amount;
          });
        });

        grpSettlements.forEach((st) => {
          const payer = ensureGroupMember(st.fromEmail, st.fromName);
          const receiver = ensureGroupMember(st.toEmail, st.toName);
          payer.net += st.amount;
          receiver.net -= st.amount;
        });

        const adminMember = g.members.find((m) => m.role === 'admin' || m.role === 'owner') || g.members[0];
        simplifiedTransactions.push(...simplifyDebtsAdminHub(groupBalanceMap, adminMember));
      });
    } else {
      simplifiedTransactions = simplifyDebtsGreedy(balanceMap);
    }

    const requesterEmail = req.user.email.toLowerCase().trim();

    // Check if single group has splitVisibility === 'self' and requester is not the admin
    if (groups.length === 1 && groups[0].splitVisibility === 'self') {
      const g = groups[0];
      const adminMember = g.members.find((m) => m.role === 'admin') ||
        (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
        g.members?.find((m) => m.role === 'owner') ||
        g.members[0];

      const isAdmin = adminMember && adminMember.email.toLowerCase().trim() === requesterEmail;
      if (!isAdmin) {
        // Non-admin user only sees their own net balance and direct Admin transfer
        const myBalances = Object.values(balanceMap).filter(
          (b) => b.email.toLowerCase() === requesterEmail
        );
        const myTransactions = simplifiedTransactions.filter(
          (t) => t.fromEmail.toLowerCase() === requesterEmail || t.toEmail.toLowerCase() === requesterEmail
        );
        const mySettlements = settlements.filter(
          (s) => s.fromEmail.toLowerCase() === requesterEmail || s.toEmail.toLowerCase() === requesterEmail
        );

        return res.status(200).json({
          balances: myBalances,
          simplifiedTransactions: myTransactions,
          settlements: mySettlements,
          visibilityPolicy: 'self',
          adminInfo: { name: adminMember.name, email: adminMember.email }
        });
      }
    }

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

module.exports = { splitsRouter: router };
