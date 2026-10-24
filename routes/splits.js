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

/**
 * Direct Pair-Wise Debts (When minimizeDebts is disabled):
 * Calculates exact debts directly between each debtor and the member who paid.
 */
function calculateDirectDebts(expenses, settlements) {
  const netPairMap = {};

  expenses.forEach((exp) => {
    const payerEmail = exp.paidByEmail.toLowerCase().trim();
    const payerName = exp.paidByName;
    const isIncome = exp.type === 'income';

    exp.splits.forEach((s) => {
      const participantEmail = s.memberEmail.toLowerCase().trim();
      const participantName = s.memberName;
      if (participantEmail === payerEmail) return;

      if (!isIncome) {
        // Participant owes Payer
        const key = `${participantEmail}->${payerEmail}`;
        if (!netPairMap[key]) {
          netPairMap[key] = { fromEmail: participantEmail, fromName: participantName, toEmail: payerEmail, toName: payerName, amount: 0, type: 'direct_pairwise' };
        }
        netPairMap[key].amount += s.amount;
      } else {
        // Income: Payer received group funds, so Payer owes Participant
        const key = `${payerEmail}->${participantEmail}`;
        if (!netPairMap[key]) {
          netPairMap[key] = { fromEmail: payerEmail, fromName: payerName, toEmail: participantEmail, toName: participantName, amount: 0, type: 'direct_pairwise' };
        }
        netPairMap[key].amount += s.amount;
      }
    });
  });

  // Subtract confirmed settlements
  settlements.forEach((st) => {
    if (st.status === 'confirmed') {
      const from = st.fromEmail.toLowerCase().trim();
      const to = st.toEmail.toLowerCase().trim();
      const key = `${from}->${to}`;
      if (!netPairMap[key]) {
        netPairMap[key] = { fromEmail: from, fromName: st.fromName, toEmail: to, toName: st.toName, amount: 0, type: 'direct_pairwise' };
      }
      netPairMap[key].amount -= st.amount;
    }
  });

  // Consolidate bilateral debts (A->B and B->A)
  const transactions = [];
  const processed = new Set();

  Object.keys(netPairMap).forEach((key) => {
    if (processed.has(key)) return;
    const [from, to] = key.split('->');
    const revKey = `${to}->${from}`;
    const directAmt = netPairMap[key]?.amount || 0;
    const revAmt = netPairMap[revKey]?.amount || 0;
    const net = Math.round((directAmt - revAmt) * 100) / 100;

    processed.add(key);
    processed.add(revKey);

    if (net > 0.01) {
      transactions.push({
        fromEmail: from,
        fromName: netPairMap[key]?.fromName || from,
        toEmail: to,
        toName: netPairMap[key]?.toName || to,
        amount: net,
        isAdminTransfer: false,
        type: 'direct_pairwise'
      });
    } else if (net < -0.01) {
      transactions.push({
        fromEmail: to,
        fromName: netPairMap[revKey]?.fromName || to,
        toEmail: from,
        toName: netPairMap[key]?.toName || from,
        amount: Math.abs(net),
        isAdminTransfer: false,
        type: 'direct_pairwise'
      });
    }
  });

  transactions.sort((a, b) => b.amount - a.amount);
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
    const { name, description, category, currency, members = [], splitsVisibility = 'personal_only' } = req.body;
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
      splitsVisibility: splitsVisibility || 'personal_only',
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

// PATCH /api/groups/:id/visibility - Update group splits visibility setting (Admin only)
router.patch('/groups/:id/visibility', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { splitsVisibility } = req.body;
    if (!['personal_only', 'show_all'].includes(splitsVisibility)) {
      return res.status(400).json({ error: "splitsVisibility must be 'personal_only' or 'show_all'." });
    }

    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = req.user.email.toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail;
    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the group admin can change group splits visibility.' });
    }

    group.splitsVisibility = splitsVisibility;
    await group.save();

    return res.status(200).json({
      message: `Group splits visibility updated to ${splitsVisibility}.`,
      group
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/groups/:id/minimize-debts - Toggle debt minimization mode (Admin only)
router.patch('/groups/:id/minimize-debts', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const requesterEmail = req.user.email.toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail;
    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the group admin can change debt minimization mode.' });
    }

    group.minimizeDebts = req.body.minimizeDebts !== undefined ? Boolean(req.body.minimizeDebts) : !group.minimizeDebts;
    await group.save();

    return res.status(200).json({
      message: `Debt minimization set to ${group.minimizeDebts ? 'Minimized (Fewest Transfers)' : 'Direct Pair-Wise'}.`,
      group
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/groups/:id/archive - Archive or unarchive group (Admin only)
router.patch('/groups/:id/archive', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const requesterEmail = req.user.email.toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail;
    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the group admin can archive this group.' });
    }

    group.isArchived = req.body.isArchived !== undefined ? Boolean(req.body.isArchived) : !group.isArchived;
    await group.save();

    return res.status(200).json({
      message: `Group ${group.isArchived ? 'archived' : 'unarchived'} successfully.`,
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

      const isAdmin = adminMember && adminMember.email.toLowerCase().trim() === requesterEmail;
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
      type: type === 'income' ? 'income' : 'expense',
      category: category || (type === 'income' ? '💵 Income & Refunds' : '🍔 Food & Dining'),
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
      } else {
        const adminMember = g.members.find((m) => m.role === 'admin') ||
          (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
          g.members[0];
        simplifiedTransactions = simplifyDebtsAdminHub(balanceMap, adminMember);
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

          const adminMember = g.members.find((m) => m.role === 'admin') ||
            (g.adminEmail ? g.members.find((m) => m.email.toLowerCase() === g.adminEmail.toLowerCase()) : null) ||
            g.members[0];
          simplifiedTransactions.push(...simplifyDebtsAdminHub(groupBalanceMap, adminMember));
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

    const isAdmin = adminMember && adminMember.email.toLowerCase().trim() === requesterEmail;

    // Handshake: payee marks as settled -> pending_admin_approval
    // If admin is creating or confirming directly -> confirmed
    const status = isAdmin ? 'confirmed' : 'pending_admin_approval';
    const confirmedAt = isAdmin ? new Date() : null;
    const confirmedByEmail = isAdmin ? requesterEmail : null;

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
      status,
      confirmedAt,
      confirmedByEmail
    });

    const message = isAdmin
      ? 'Settlement recorded and confirmed by admin.'
      : 'Payment marked as settled by payee. Awaiting admin confirmation.';

    return res.status(201).json({ settlement, message });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/confirm - Admin confirms receipt of payment
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

    const isAdmin = adminMember && adminMember.email.toLowerCase().trim() === requesterEmail;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only the group admin can confirm payment receipt.' });
    }

    settlement.status = 'confirmed';
    settlement.confirmedAt = new Date();
    settlement.confirmedByEmail = requesterEmail;
    await settlement.save();

    return res.status(200).json({
      message: `Payment of ₹${settlement.amount} confirmed by admin. Transaction is now settled.`,
      settlement
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settlements/:id/reject - Admin rejects an unconfirmed settlement claim
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

    const isAdmin = adminMember && adminMember.email.toLowerCase().trim() === requesterEmail;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only the group admin can reject payment claims.' });
    }

    settlement.status = 'rejected';
    settlement.rejectedReason = reason || 'Payment not verified by admin.';
    await settlement.save();

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

module.exports = { splitsRouter: router };
