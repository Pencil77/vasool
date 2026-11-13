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

/**
 * Hydrates group members with live upiId from User documents so payers know whether a member has configured a real UPI ID
 */
async function hydrateGroupMembersUpi(groupsList) {
  const arr = Array.isArray(groupsList) ? groupsList : [groupsList];
  const emailSet = new Set();
  arr.forEach((g) => {
    if (g && Array.isArray(g.members)) {
      g.members.forEach((m) => {
        if (m && m.email) emailSet.add(String(m.email).toLowerCase().trim());
      });
    }
  });
  if (emailSet.size === 0) return;
  const users = await User.find({ email: { $in: Array.from(emailSet) } }, 'email upiId name').lean();
  const upiMap = {};
  users.forEach((u) => {
    if (u && u.email) {
      upiMap[u.email.toLowerCase().trim()] = u.upiId || '';
    }
  });
  arr.forEach((g) => {
    if (g && Array.isArray(g.members)) {
      g.members.forEach((m) => {
        const em = String(m.email || '').toLowerCase().trim();
        if (em in upiMap) {
          m.upiId = upiMap[em];
        } else {
          m.upiId = m.upiId || '';
        }
      });
    }
  });
}


// GET /api/groups - List groups where user is a member
router.get('/groups', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const userEmail = (req.user.email || '').toLowerCase().trim();
    const groups = await Group.find({
      'members.email': { $regex: new RegExp('^' + userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    }).sort({ updatedAt: -1 });
    await hydrateGroupMembersUpi(groups);

    const activeGroups = [];
    const pendingInvites = [];
    groups.forEach((g) => {
      const myMember = g.members.find((m) => m.email && m.email.toLowerCase().trim() === userEmail);
      if (myMember && myMember.status === 'pending_acceptance') {
        pendingInvites.push(g);
      } else {
        activeGroups.push(g);
      }
    });

    return res.status(200).json({ groups, activeGroups, pendingInvites });
  } catch (err) {
    logger.error('[splits:groups] Error fetching user groups:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups - Create a new group (creator is default Admin)
router.post('/groups', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { name, description, category, currency, members = [], splitsVisibility = 'personal_only', allowMembersToAddOthers = false, adminHubSettlement = false, minimizeDebts = true } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    const normalizedCreator = {
      userId: req.user.sub || null,
      name: req.user.name,
      email: req.user.email.toLowerCase().trim(),
      role: 'admin',
      status: 'active',
      acceptedAt: new Date(),
      defaultWeight: 1
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
            role: 'member',
            status: 'pending_acceptance',
            invitedAt: new Date(),
            defaultWeight: Number(m.defaultWeight) || 1
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
      allowMembersToAddOthers: Boolean(allowMembersToAddOthers),
      adminHubSettlement: Boolean(adminHubSettlement),
      minimizeDebts: minimizeDebts !== false,
      members: finalMembers
    });

    // Asynchronously dispatch group invitation emails to all added members
    const creatorName = req.user.name || normalizedCreator.name || normalizedCreator.email.split('@')[0];
    finalMembers.forEach((m) => {
      if (m.email !== normalizedCreator.email) {
        sendGroupInviteEmail({
          toEmail: m.email,
          toName: m.name,
          groupName: group.name,
          inviteCode: group.inviteCode,
          adminName: creatorName,
          adminEmail: normalizedCreator.email
        }).catch((err) => {
          logger.error(`[splits:invite] Background invite dispatch failed for ${m.email}:`, err);
        });
      }
    });

    logger.info(`[splits:groups] Created group "${group.name}" with code ${inviteCode} by ${normalizedCreator.email}`);
    otel.metrics.counter('vasool_groups_created_total', 1, { category: group.category || 'Trip', currency: group.currency || 'INR' });
    return res.status(201).json({ group });
  } catch (err) {
    logger.error('[splits:groups] Error creating group:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/join - Join a group using an invite code
router.post('/groups/join', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { inviteCode } = req.body;
    if (!inviteCode) {
      return res.status(400).json({ error: 'Invite code is required.' });
    }

    const cleanCode = String(inviteCode).trim().toUpperCase();
    const group = await Group.findOne({ inviteCode: cleanCode });
    if (!group) {
      return res.status(404).json({ error: `No group found with invite code "${cleanCode}".` });
    }

    const userEmail = (req.user.email || '').toLowerCase().trim();
    const userName = req.user.name || userEmail.split('@')[0];

    const existingMember = group.members.find(
      (m) => m.email.toLowerCase().trim() === userEmail
    );

    if (!existingMember) {
      group.members.push({
        userId: req.user.sub || null,
        name: userName,
        email: userEmail,
        role: 'member',
        status: 'active',
        acceptedAt: new Date(),
        defaultWeight: 1
      });
      await group.save();
      logger.info(`[splits:join] User ${userEmail} (${userName}) joined group "${group.name}" via code ${cleanCode}`);
      otel.metrics.counter('vasool_groups_joined_total', 1, { status: 'new_member', category: group.category || 'Trip' });
    } else {
      if (existingMember.status !== 'active') {
        existingMember.status = 'active';
        existingMember.acceptedAt = new Date();
        existingMember.userId = req.user.sub || existingMember.userId;
        if (req.user.name && (!existingMember.name || existingMember.name === userEmail.split('@')[0])) {
          existingMember.name = req.user.name;
        }
        await group.save();
        logger.info(`[splits:join] User ${userEmail} activated membership in "${group.name}" via code ${cleanCode}`);
      } else {
        logger.info(`[splits:join] User ${userEmail} is already active member of "${group.name}"`);
      }
      otel.metrics.counter('vasool_groups_joined_total', 1, { status: 'already_member', category: group.category || 'Trip' });
    }

    return res.status(200).json({
      message: `Successfully joined group "${group.name}".`,
      group
    });
  } catch (err) {
    logger.error('[splits:join] Error joining group:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id - Get single group details with members, expenses, balances, and simplified debts
router.get('/groups/:id', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = (req.user.email || '').toLowerCase().trim();
    const isMember = group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail);
    const isSuperAdmin = isSuperAdminUser(req.user);

    if (!isMember && !isSuperAdmin) {
      return res.status(403).json({ error: 'Access denied. You are not a member of this group.' });
    }

    await hydrateGroupMembersUpi(group);

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId: group._id }).sort({ expenseDate: -1, createdAt: -1 }),
      Settlement.find({ groupId: group._id }).sort({ settledAt: -1, createdAt: -1 })
    ]);

    const balanceMap = computeGroupBalanceMap(group, expenses, settlements);
    const simplifiedTransactions = computeGroupSimplifiedDebts(group, balanceMap, expenses, settlements);

    const membersWithBalances = group.members.map((m) => {
      const mEmail = m.email.toLowerCase().trim();
      const b = balanceMap[mEmail] || { paid: 0, owed: 0, net: 0 };
      return {
        ...(m.toObject ? m.toObject() : m),
        paid: b.paid,
        owed: b.owed,
        net: b.net
      };
    });

    const totalSpend = Math.round(expenses.reduce((sum, e) => sum + (e.type === 'income' ? 0 : e.amount), 0) * 100) / 100;
    const myBalance = balanceMap[requesterEmail] || { paid: 0, owed: 0, net: 0 };

    return res.status(200).json({
      group,
      members: membersWithBalances,
      expenses,
      settlements,
      simplifiedTransactions,
      totalSpend,
      myBalance,
      auditLog: group.auditLog || []
    });
  } catch (err) {
    logger.error('[splits:group-details] Error fetching group details:', err);
    return res.status(500).json({ error: err.message });
  }
});


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

// POST /api/groups/:id/leave - Exit / Leave a group
router.post('/groups/:id/leave', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const userEmail = (req.user.email || '').toLowerCase().trim();
    const memberIndex = group.members.findIndex((m) => m.email.toLowerCase().trim() === userEmail);
    if (memberIndex === -1) {
      return res.status(400).json({ error: 'You are not a member of this group.' });
    }

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId: group._id }),
      Settlement.find({ groupId: group._id })
    ]);

    const balanceMap = computeGroupBalanceMap(group, expenses, settlements);
    const myBalance = balanceMap[userEmail] || { paid: 0, owed: 0, net: 0 };
    const netAmount = Math.round(myBalance.net * 100) / 100;

    // Financial Safety Check:
    // If user is in debt (owes money to others): CANNOT LEAVE
    if (netAmount < -0.01) {
      return res.status(400).json({
        error: `Cannot exit group: You have an unsettled debt of -₹${Math.abs(netAmount).toFixed(2)} in this group. You must settle all your debts before exiting.`,
        netBalance: netAmount,
        canLeave: false
      });
    }

    // If user is owed money by others: Can only leave if they explicitly confirm forfeiture
    if (netAmount > 0.01 && !req.body.confirmForfeit) {
      return res.status(400).json({
        error: `Cannot exit group: You are owed ₹${netAmount.toFixed(2)} in this group. Settle up first, or confirm forfeiture of this balance to exit.`,
        netBalance: netAmount,
        canForfeit: true,
        canLeave: false
      });
    }

    // Admin Succession Check
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === userEmail;
    const remainingMembers = group.members.filter((m) => m.email.toLowerCase().trim() !== userEmail);

    if (isCurrentAdmin) {
      if (remainingMembers.length === 0) {
        // User was the sole member -> Archive group
        group.isArchived = true;
        group.members = [];
        await group.save();
        logger.info(`[splits:leave] Sole admin ${userEmail} left group "${group.name}". Group archived.`);
        otel.metrics.counter('vasool_group_leaves_total', 1, { group: group.name, status: 'archived_empty' });
        return res.status(200).json({
          success: true,
          message: `You have left and closed "${group.name}" because there are no other members.`,
          isArchived: true
        });
      } else {
        // Designate new admin
        let successorEmail = req.body.successorEmail ? String(req.body.successorEmail).toLowerCase().trim() : null;
        let successor = successorEmail ? remainingMembers.find((m) => m.email.toLowerCase().trim() === successorEmail) : null;
        if (!successor) {
          // Auto-promote next active member or first remaining member
          successor = remainingMembers.find((m) => m.status === 'active') || remainingMembers[0];
        }

        remainingMembers.forEach((m) => {
          if (m.email.toLowerCase().trim() === successor.email.toLowerCase().trim()) {
            m.role = 'admin';
          }
        });
        group.adminEmail = successor.email.toLowerCase().trim();
        logger.info(`[splits:leave] Admin ${userEmail} left group "${group.name}". Admin transferred to ${successor.name} (${successor.email}).`);
      }
    }

    group.members = remainingMembers;
    await group.save();

    logger.info(`[splits:leave] User ${userEmail} successfully exited group "${group.name}".`);
    otel.metrics.counter('vasool_group_leaves_total', 1, { group: group.name, status: 'success' });

    return res.status(200).json({
      success: true,
      message: `You have successfully left the group "${group.name}".`,
      group
    });
  } catch (err) {
    logger.error('[splits:leave] Error exiting group:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/remove-member - Admin removes a member from the group
router.post('/groups/:id/remove-member', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { targetEmail, force } = req.body;
    if (!targetEmail) {
      return res.status(400).json({ error: 'targetEmail is required.' });
    }

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const requesterEmail = (req.user.email || '').toLowerCase().trim();
    const cleanTargetEmail = String(targetEmail).toLowerCase().trim();

    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin =
      isSuperAdminUser(req.user) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail) ||
      (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail) ||
      group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail && (m.role === 'admin' || m.role === 'owner'));

    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the group admin can remove members.' });
    }

    if (cleanTargetEmail === requesterEmail) {
      return res.status(400).json({ error: 'Cannot remove yourself as admin. Use "Exit Group" or transfer adminship first.' });
    }

    if (group.adminEmail && cleanTargetEmail === group.adminEmail.toLowerCase().trim()) {
      return res.status(400).json({ error: 'Cannot remove the primary group admin. Transfer adminship first.' });
    }

    const targetMember = group.members.find((m) => m.email.toLowerCase().trim() === cleanTargetEmail);
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found in this group.' });
    }

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId: group._id }),
      Settlement.find({ groupId: group._id })
    ]);

    const balanceMap = computeGroupBalanceMap(group, expenses, settlements);
    const targetBalance = balanceMap[cleanTargetEmail] || { net: 0 };
    const netAmount = Math.round(targetBalance.net * 100) / 100;

    if (Math.abs(netAmount) > 0.01 && !force) {
      return res.status(400).json({
        error: `Cannot remove member: ${targetMember.name} has an unsettled balance of ₹${netAmount.toFixed(2)}. Settle all balances first, or confirm force removal.`,
        netBalance: netAmount,
        canForce: true
      });
    }

    group.members = group.members.filter((m) => m.email.toLowerCase().trim() !== cleanTargetEmail);
    await group.save();

    logger.info(`[splits:remove-member] Admin ${requesterEmail} removed member ${cleanTargetEmail} (${targetMember.name}) from "${group.name}". (force: ${Boolean(force)})`);
    otel.metrics.counter('vasool_group_member_removals_total', 1, { group: group.name, status: 'success' });

    return res.status(200).json({
      success: true,
      message: `Member ${targetMember.name} (${cleanTargetEmail}) has been removed from "${group.name}".`,
      group
    });
  } catch (err) {
    logger.error('[splits:remove-member] Error removing member:', err);
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

    const isCurrentAdmin = isSuperAdminUser(req.user) || (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail);

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

    const isCurrentAdmin = isSuperAdminUser(req.user) || (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail);
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

    const isCurrentAdmin = isSuperAdminUser(req.user) || (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail);
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

// PATCH /api/groups/:id/admin-hub-settlement - Toggle Admin-Hub settlement routing vs Direct Peer-to-Peer (Admin only)
router.patch('/groups/:id/admin-hub-settlement', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const requesterEmail = req.user.email.toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin = isSuperAdminUser(req.user) || (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail);
    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the group admin can change settlement routing.' });
    }

    group.adminHubSettlement = req.body.adminHubSettlement !== undefined ? Boolean(req.body.adminHubSettlement) : !group.adminHubSettlement;
    await group.save();

    return res.status(200).json({
      message: `Settlement routing set to ${group.adminHubSettlement ? 'Centralized Admin-Hub' : 'Direct Peer-to-Peer (Standard)'}.`,
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

    const isCurrentAdmin = isSuperAdminUser(req.user) || (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail);
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

// POST /api/groups/:id/members - Add one or multiple comma-separated members to a group
router.post('/groups/:id/members', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const { name, email, emails, members: batchMembers, defaultWeight = 1 } = req.body;
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const requesterEmail = (req.user.email || '').toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin =
      isSuperAdminUser(req.user) ||
      (group.adminEmail && group.adminEmail.toLowerCase().trim() === requesterEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase().trim() === requesterEmail) ||
      (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail) ||
      group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail && (m.role === 'admin' || m.role === 'owner'));

    if (!isCurrentAdmin && !group.allowMembersToAddOthers) {
      return res.status(403).json({
        error: 'Only the group admin can add members to this group. Non-admin member invitations are disabled by default in group settings.'
      });
    }

    // Parse candidate list from either batchMembers array or comma-separated email/name string
    const candidates = [];
    if (Array.isArray(batchMembers) && batchMembers.length > 0) {
      batchMembers.forEach((bm) => {
        if (bm && bm.email) {
          const em = String(bm.email).toLowerCase().trim();
          const nm = String(bm.name || em.split('@')[0]).trim();
          candidates.push({ name: nm, email: em, defaultWeight: Number(bm.defaultWeight || defaultWeight) || 1 });
        }
      });
    } else {
      const rawInput = String(emails || email || '').trim();
      if (!rawInput) {
        return res.status(400).json({ error: 'At least one member email is required.' });
      }
      const tokens = rawInput.split(',').map((t) => t.trim()).filter(Boolean);
      tokens.forEach((token, idx) => {
        const angleMatch = token.match(/^([^<]+)<([^>]+)>$/);
        let mEmail = '';
        let mName = '';
        if (angleMatch) {
          mName = angleMatch[1].trim();
          mEmail = angleMatch[2].trim().toLowerCase();
        } else if (token.includes('@')) {
          mEmail = token.toLowerCase().trim();
          if (tokens.length === 1 && name && String(name).trim()) {
            mName = String(name).trim();
          } else {
            const prefix = mEmail.split('@')[0].replace(/[._-]+/g, ' ');
            mName = prefix.replace(/\b\w/g, (c) => c.toUpperCase());
          }
        } else {
          mName = token.trim();
          mEmail = mName.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@gmail.com';
        }
        if (mEmail) {
          candidates.push({ name: mName || mEmail.split('@')[0], email: mEmail, defaultWeight: Number(defaultWeight) || 1 });
        }
      });
    }

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Valid member email is required.' });
    }

    // Lookup registered users to enrich names and upiIds
    const candidateEmails = candidates.map((c) => c.email);
    const registeredUsers = await User.find({ email: { $in: candidateEmails } }, 'name email upiId _id').lean();
    const regMap = {};
    registeredUsers.forEach((u) => {
      regMap[u.email.toLowerCase().trim()] = u;
    });

    const existingEmails = new Set(group.members.map((m) => m.email.toLowerCase().trim()));
    const addedMembers = [];
    const skippedEmails = [];

    candidates.forEach((c) => {
      if (existingEmails.has(c.email)) {
        skippedEmails.push(c.email);
        return;
      }
      existingEmails.add(c.email);
      const reg = regMap[c.email];
      const finalName = (reg && reg.name && (!c.name || c.name.toLowerCase() === c.email.split('@')[0].toLowerCase()))
        ? reg.name
        : c.name;
      const newMemberObj = {
        userId: reg ? reg._id : null,
        name: finalName,
        email: c.email,
        upiId: reg ? (reg.upiId || '') : '',
        role: 'member',
        status: 'pending_acceptance',
        invitedAt: new Date(),
        defaultWeight: c.defaultWeight
      };
      group.members.push(newMemberObj);
      addedMembers.push(newMemberObj);
    });

    if (addedMembers.length === 0) {
      return res.status(409).json({ error: 'All specified member(s) are already in this group.' });
    }

    appendGroupAuditLog(group, {
      action: 'members_invited',
      actorEmail: requesterEmail,
      actorName: req.user.name || requesterEmail,
      summary: `${req.user.name || requesterEmail} invited ${addedMembers.map((m) => m.name).join(', ')} to the group`,
      details: `${addedMembers.length} member(s) added as Pending Acceptance`
    });

    await group.save();
    await hydrateGroupMembersUpi(group);

    // Dispatch invitation emails asynchronously
    const inviterName = req.user.name || (currentAdmin ? currentAdmin.name : 'Group Admin');
    const inviterEmail = req.user.email || (currentAdmin ? currentAdmin.email : group.createdByEmail);

    addedMembers.forEach((am) => {
      sendGroupInviteEmail({
        toEmail: am.email,
        toName: am.name,
        groupName: group.name,
        inviteCode: group.inviteCode,
        adminName: inviterName,
        adminEmail: inviterEmail
      }).catch((err) => {
        logger.error(`[splits:invite] Background member invite dispatch failed for ${am.email}:`, err);
      });
    });

    logger.info(`[splits:members] Added ${addedMembers.length} member(s) to group "${group.name}"`);
    otel.metrics.counter('vasool_members_added_total', addedMembers.length, { status: 'pending_acceptance' });

    const msg = addedMembers.length === 1
      ? `Invitation sent to ${addedMembers[0].name} (${addedMembers[0].email}). Status: Pending Acceptance.`
      : `Invited ${addedMembers.length} members (${addedMembers.map((m) => m.name).join(', ')}) to "${group.name}"!`;

    return res.status(200).json({
      group,
      addedMembers,
      skippedEmails,
      message: msg
    });
  } catch (err) {
    logger.error('[splits:members] Error adding member to group:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/accept-invite - User accepts an invite to join the group
router.post('/groups/:id/accept-invite', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const userEmail = (req.user.email || '').toLowerCase().trim();
    const member = group.members.find((m) => m.email.toLowerCase().trim() === userEmail);
    if (!member) {
      return res.status(404).json({ error: 'You are not listed in this group.' });
    }

    member.status = 'active';
    member.acceptedAt = new Date();
    member.userId = req.user.sub || member.userId;
    if (req.user.name && (!member.name || member.name === userEmail.split('@')[0])) {
      member.name = req.user.name;
    }
    await group.save();

    logger.info(`[splits:invite] User ${userEmail} accepted invitation to join "${group.name}"`);
    otel.metrics.counter('vasool_invitations_accepted_total', 1, { group: group.name });
    return res.status(200).json({
      message: `You have successfully joined "${group.name}".`,
      group
    });
  } catch (err) {
    logger.error('[splits:invite] Error accepting invite:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/decline-invite - User declines an invite to join the group
router.post('/groups/:id/decline-invite', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const userEmail = (req.user.email || '').toLowerCase().trim();
    const initialCount = group.members.length;
    group.members = group.members.filter((m) => m.email.toLowerCase().trim() !== userEmail);

    if (group.members.length === initialCount) {
      return res.status(404).json({ error: 'You are not listed in this group.' });
    }

    await group.save();
    logger.info(`[splits:invite] User ${userEmail} declined invitation to join "${group.name}"`);
    otel.metrics.counter('vasool_invitations_declined_total', 1, { group: group.name });
    return res.status(200).json({
      message: `You declined the invitation to join "${group.name}".`,
      group
    });
  } catch (err) {
    logger.error('[splits:invite] Error declining invite:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/groups/:id/settings - Update group admin settings (allowMembersToAddOthers, splitsVisibility, minimizeDebts)
router.patch('/groups/:id/settings', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const requesterEmail = req.user.email.toLowerCase().trim();
    const currentAdmin = group.members.find((m) => m.role === 'admin') ||
      (group.adminEmail ? group.members.find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      group.members[0];

    const isCurrentAdmin = isSuperAdminUser(req.user) || (currentAdmin && currentAdmin.email.toLowerCase().trim() === requesterEmail);
    if (!isCurrentAdmin) {
      return res.status(403).json({ error: 'Only the group admin can update group settings.' });
    }

    if (req.body.allowMembersToAddOthers !== undefined) {
      group.allowMembersToAddOthers = Boolean(req.body.allowMembersToAddOthers);
    }
    if (req.body.splitsVisibility && ['personal_only', 'show_all'].includes(req.body.splitsVisibility)) {
      group.splitsVisibility = req.body.splitsVisibility;
    }
    if (req.body.minimizeDebts !== undefined) {
      group.minimizeDebts = Boolean(req.body.minimizeDebts);
    }
    if (req.body.adminHubSettlement !== undefined) {
      group.adminHubSettlement = Boolean(req.body.adminHubSettlement);
    }
    if (req.body.name && String(req.body.name).trim()) {
      group.name = String(req.body.name).trim();
    }
    if (req.body.category) {
      group.category = req.body.category;
    }

    await group.save();
    logger.info(`[splits:settings] Group "${group.name}" settings updated by ${requesterEmail}`);
    return res.status(200).json({
      message: 'Group settings updated successfully.',
      group
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { groupsRouter: router };
