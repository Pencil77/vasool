const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const Feedback = require('../models/Feedback');
const SystemConfig = require('../models/SystemConfig');
const { requireAuth, sanitizeUser } = require('./auth');
const { groupsRouter, hydrateGroupMembersUpi, classifyUserGroups } = require('./groups');
const { expensesRouter, sanitizeExpensesForRequester } = require('./expenses');
const { settlementsRouter } = require('./settlements');
const { buildAdminGroupsSummary, formatAdminSettings } = require('./admin');
const {
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
 * GET /api/bootstrap
 * Single-roundtrip startup hydration endpoint returning the authenticated user,
 * their groups (excluding heavy auditLog arrays), privacy-filtered expenses,
 * settlements, and optional Super Admin bootstrap payload when ?includeAdmin=1.
 */
router.get('/bootstrap', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const userEmail = (req.user.email || '').toLowerCase().trim();
    const emailRegex = new RegExp('^' + userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
    const wantsAdmin = req.query.includeAdmin === '1' && isSuperAdminUser(req.user);

    // Step 1: Resolve user, user's groups, and (when ?includeAdmin=1) platform admin data concurrently in 1 RTT
    const step1Promises = [
      req.userDoc ? Promise.resolve(req.userDoc) : User.findById(req.user.sub).lean(),
      Group.find({ 'members.email': emailRegex }, { auditLog: 0 }).sort({ updatedAt: -1 }).lean()
    ];

    if (wantsAdmin) {
      step1Promises.push(
        SystemConfig.findOne({ key: 'auth_session' }).lean(),
        Group.find({}, { auditLog: 0 }).sort({ updatedAt: -1, createdAt: -1 }).lean(),
        Expense.find({}, 'groupId amount type').lean(),
        Settlement.find({}, 'groupId amount status').lean(),
        Feedback.find({}).sort({ createdAt: -1 }).limit(100).lean()
      );
    }

    const step1Results = await Promise.all(step1Promises);
    const userDoc = step1Results[0];
    const groups = step1Results[1];

    if (!userDoc) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const groupIds = groups.map((g) => g._id);

    // Step 2: Hydrate member UPIs, expenses, and settlements concurrently
    const [, rawExpenses, settlements] = await Promise.all([
      hydrateGroupMembersUpi(groups),
      groupIds.length > 0
        ? Expense.find({ groupId: { $in: groupIds } }).sort({ expenseDate: -1, createdAt: -1 }).lean()
        : Promise.resolve([]),
      groupIds.length > 0
        ? Settlement.find({ groupId: { $in: groupIds } }).sort({ settledAt: -1, createdAt: -1 }).lean()
        : Promise.resolve([])
    ]);

    const { activeGroups, pendingInvites } = classifyUserGroups(groups, userEmail);
    const expenses = sanitizeExpensesForRequester(rawExpenses, groups, userDoc, false);

    const payload = {
      user: sanitizeUser(userDoc),
      groups,
      activeGroups,
      pendingInvites,
      expenses,
      settlements
    };

    if (wantsAdmin && isSuperAdminUser(userDoc)) {
      const adminConfig = step1Results[2];
      const allGroups = step1Results[3];
      const allExpStats = step1Results[4];
      const allStlStats = step1Results[5];
      const feedbacks = step1Results[6];

      payload.admin = {
        settings: formatAdminSettings(adminConfig),
        groups: buildAdminGroupsSummary(allGroups, allExpStats, allStlStats),
        feedbacks,
        feedbackTotal: feedbacks.length
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Bootstrap failed.' });
  }
});

router.use(groupsRouter);
router.use(expensesRouter);
router.use(settlementsRouter);

module.exports = {
  splitsRouter: router,
  isSuperAdminUser,
  appendGroupAuditLog,
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
};
