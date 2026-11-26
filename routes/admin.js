const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const Notification = require('../models/Notification');
const SystemConfig = require('../models/SystemConfig');
const {
  requireAuth,
  isSuperAdminEmail,
  SUPER_ADMIN_EMAIL,
  storePassword,
  signAuthToken,
  updateCachedSessionDuration,
  getCachedSessionDuration
} = require('./auth');
const logger = require('../lib/logger');
const otel = require('../lib/otel');

const Feedback = require('../models/Feedback');

const router = express.Router();

/**
 * Middleware: Enforce Super Admin authorization
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }
  const isSuper =
    req.user.role === 'super_admin' ||
    req.user.isSuperAdmin === true ||
    (req.user.email && isSuperAdminEmail(req.user.email));

  if (!isSuper) {
    logger.warn(`[admin] Unauthorized admin console access attempted by ${req.user.email}`);
    return res.status(403).json({ error: 'forbidden', message: 'Access restricted to Super Admin only.' });
  }
  next();
}

// All admin routes require authentication and Super Admin privilege
router.use(requireAuth, requireSuperAdmin);

/**
 * GET /api/admin/users
 * Lists safe account summaries only. Credentials are served by a separate explicit-reveal endpoint.
 */
router.get('/users', async (req, res) => {
  const span = otel.startSpan('admin.get_users', {
    attributes: { 'admin.email': req.user.email }
  });

  try {
    await connectToDatabase();
    const rawUsers = await User.find().sort({ createdAt: -1 });
    const groups = await Group.find({}, 'members').lean();

    // Filter out automated test accounts from the Super Admin Console
    const isTestAccount = (email) => {
      const em = String(email || '').toLowerCase().trim();
      return (
        em.endsWith('.test') ||
        em.includes('@example.com') ||
        em.includes('@vasool.test') ||
        em.startsWith('user_feedback_test_') ||
        em.startsWith('live.browser.') ||
        em.startsWith('zoro.suite.')
      );
    };
    const users = rawUsers.filter((u) => !isTestAccount(u.email));

    // Map group counts per user email
    const groupCountMap = {};
    groups.forEach((g) => {
      (g.members || []).forEach((m) => {
        if (m.email) {
          const em = m.email.toLowerCase();
          groupCountMap[em] = (groupCountMap[em] || 0) + 1;
        }
      });
    });

    const sanitizedList = users.map((u) => {
      const isSuper = Boolean(u.isSuperAdmin) || isSuperAdminEmail(u.email);

      // Check if temporary suspension has expired
      let isSuspended = Boolean(u.isSuspended);
      let suspendedUntil = u.suspendedUntil;
      if (isSuspended && suspendedUntil && new Date() > new Date(suspendedUntil)) {
        isSuspended = false;
        suspendedUntil = null;
      }

      return {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: isSuper ? 'super_admin' : (u.role || 'user'),
        isSuperAdmin: isSuper,
        isEmailVerified: Boolean(u.isEmailVerified),
        authProviders: Array.isArray(u.authProviders) ? u.authProviders : ['email'],
        defaultCurrency: u.defaultCurrency || 'INR',
        updatedAt: u.updatedAt || null,
        isSuspended,
        suspendedUntil,
        suspensionReason: u.suspensionReason || '',
        suspendedAt: u.suspendedAt || null,
        groupCount: groupCountMap[u.email.toLowerCase()] || 0,
        upiId: u.upiId || '',
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt
      };
    });

    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'list_users' });
    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      users: sanitizedList,
      totalCount: sanitizedList.length
    });
  } catch (err) {
    logger.error('[admin] Failed to list users:', err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to list users.' });
  }
});

function formatAdminUserDetail(user, groupCount = 0) {
  const isSuper = Boolean(user.isSuperAdmin || user.role === 'super_admin' || isSuperAdminEmail(user.email));
  return {
    id: String(user._id),
    name: user.name || '',
    email: user.email || '',
    avatarUrl: user.avatarUrl || '',
    upiId: user.upiId || '',
    defaultCurrency: user.defaultCurrency || 'INR',
    role: isSuper ? 'super_admin' : (user.role || 'user'),
    isSuperAdmin: isSuper,
    isPrimaryOwner: isSuperAdminEmail(user.email),
    isEmailVerified: Boolean(user.isEmailVerified),
    authProviders: Array.isArray(user.authProviders) ? user.authProviders : ['email'],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    isSuspended: Boolean(user.isSuspended),
    suspensionReason: user.suspensionReason || '',
    suspendedAt: user.suspendedAt || null,
    suspendedUntil: user.suspendedUntil || null,
    groupCount
  };
}

/**
 * GET /api/admin/users/:userId/details
 * Returns an allowlisted, non-credential account detail payload.
 */
router.get('/users/:userId/details', async (req, res) => {
  try {
    await connectToDatabase();
    const user = await User.findById(req.params.userId)
      .select('_id name email avatarUrl upiId defaultCurrency role isSuperAdmin isEmailVerified authProviders createdAt updatedAt lastLoginAt isSuspended suspensionReason suspendedAt suspendedUntil')
      .lean();
    if (!user) return res.status(404).json({ error: 'User account not found.' });

    const [groupCount] = await Group.aggregate([
      { $match: { 'members.email': String(user.email || '').toLowerCase() } },
      { $count: 'count' }
    ]);

    return res.status(200).json({
      success: true,
      user: formatAdminUserDetail(user, groupCount ? groupCount.count : 0)
    });
  } catch (err) {
    logger.error('[admin] Failed to fetch user details:', err);
    return res.status(500).json({ error: 'Failed to retrieve user details.' });
  }
});

/**
 * Helper: Propagate updated user email, name, or UPI ID across all related collections
 * so group memberships, expense splits, settlements, notifications, and feedback stay linked.
 */
async function propagateUserIdentityChanges({ oldEmail, newEmail, oldName, newName, upiId, updateUpi }) {
  const emailChanged = Boolean(oldEmail && newEmail && oldEmail !== newEmail);
  const nameChanged = Boolean(newName && oldName !== newName);
  if (!emailChanged && !nameChanged && !updateUpi) return;

  const lookupEmail = oldEmail;
  const tasks = [];

  // 1. Groups: members array, createdByEmail, adminEmail, auditLog
  if (emailChanged) {
    tasks.push(
      Group.updateMany({ createdByEmail: lookupEmail }, { $set: { createdByEmail: newEmail } }),
      Group.updateMany({ adminEmail: lookupEmail }, { $set: { adminEmail: newEmail } }),
      Group.updateMany(
        { 'auditLog.actorEmail': lookupEmail },
        {
          $set: {
            'auditLog.$[a].actorEmail': newEmail,
            ...(nameChanged ? { 'auditLog.$[a].actorName': newName } : {})
          }
        },
        { arrayFilters: [{ 'a.actorEmail': lookupEmail }] }
      )
    );
  } else if (nameChanged) {
    tasks.push(
      Group.updateMany(
        { 'auditLog.actorEmail': lookupEmail },
        { $set: { 'auditLog.$[a].actorName': newName } },
        { arrayFilters: [{ 'a.actorEmail': lookupEmail }] }
      )
    );
  }

  const memberSet = {};
  if (emailChanged) memberSet['members.$[m].email'] = newEmail;
  if (nameChanged) memberSet['members.$[m].name'] = newName;
  if (updateUpi) memberSet['members.$[m].upiId'] = upiId || '';
  if (Object.keys(memberSet).length > 0) {
    tasks.push(
      Group.updateMany(
        { 'members.email': lookupEmail },
        { $set: memberSet },
        { arrayFilters: [{ 'm.email': lookupEmail }] }
      )
    );
  }

  // 2. Expenses: paidBy, createdBy, paidByAllocations, splits
  if (emailChanged || nameChanged) {
    const expPaidSet = {};
    const expCreatedSet = {};
    const allocSet = {};
    const splitSet = {};
    if (emailChanged) {
      expPaidSet.paidByEmail = newEmail;
      expCreatedSet.createdByEmail = newEmail;
      allocSet['paidByAllocations.$[p].memberEmail'] = newEmail;
      splitSet['splits.$[s].memberEmail'] = newEmail;
    }
    if (nameChanged) {
      expPaidSet.paidByName = newName;
      expCreatedSet.createdByName = newName;
      allocSet['paidByAllocations.$[p].memberName'] = newName;
      splitSet['splits.$[s].memberName'] = newName;
    }

    tasks.push(
      Expense.updateMany({ paidByEmail: lookupEmail }, { $set: expPaidSet }),
      Expense.updateMany({ createdByEmail: lookupEmail }, { $set: expCreatedSet }),
      Expense.updateMany(
        { 'paidByAllocations.memberEmail': lookupEmail },
        { $set: allocSet },
        { arrayFilters: [{ 'p.memberEmail': lookupEmail }] }
      ),
      Expense.updateMany(
        { 'splits.memberEmail': lookupEmail },
        { $set: splitSet },
        { arrayFilters: [{ 's.memberEmail': lookupEmail }] }
      )
    );
  }

  // 3. Settlements: from, to, actor emails
  if (emailChanged || nameChanged) {
    const fromSet = {};
    const toSet = {};
    if (emailChanged) {
      fromSet.fromEmail = newEmail;
      toSet.toEmail = newEmail;
    }
    if (nameChanged) {
      fromSet.fromName = newName;
      toSet.toName = newName;
    }
    tasks.push(
      Settlement.updateMany({ fromEmail: lookupEmail }, { $set: fromSet }),
      Settlement.updateMany({ toEmail: lookupEmail }, { $set: toSet })
    );
    if (emailChanged) {
      tasks.push(
        Settlement.updateMany({ recordedByEmail: lookupEmail }, { $set: { recordedByEmail: newEmail } }),
        Settlement.updateMany({ confirmedByEmail: lookupEmail }, { $set: { confirmedByEmail: newEmail } }),
        Settlement.updateMany({ revertedByEmail: lookupEmail }, { $set: { revertedByEmail: newEmail } }),
        Settlement.updateMany({ disputedByEmail: lookupEmail }, { $set: { disputedByEmail: newEmail } }),
        Settlement.updateMany({ disputeResolvedByEmail: lookupEmail }, { $set: { disputeResolvedByEmail: newEmail } })
      );
    }
  }

  // 4. Notifications & Feedback
  if (emailChanged || nameChanged) {
    const notifSenderSet = {};
    const notifReceiverSet = {};
    const fbSet = {};
    if (emailChanged) {
      notifSenderSet.senderEmail = newEmail;
      notifReceiverSet.receiverEmail = newEmail;
      fbSet.userEmail = newEmail;
      tasks.push(Notification.updateMany({ recipientEmail: lookupEmail }, { $set: { recipientEmail: newEmail } }));
    }
    if (nameChanged) {
      notifSenderSet.senderName = newName;
      notifReceiverSet.receiverName = newName;
      fbSet.userName = newName;
    }
    tasks.push(
      Notification.updateMany({ senderEmail: lookupEmail }, { $set: notifSenderSet }),
      Notification.updateMany({ receiverEmail: lookupEmail }, { $set: notifReceiverSet }),
      Feedback.updateMany({ userEmail: lookupEmail }, { $set: fbSet })
    );
  }

  await Promise.all(tasks);
}

/**
 * PUT / PATCH /api/admin/users/:userId
 * Allows Super Admin to edit any platform user's profile, email, credentials, role, verification, and suspension details.
 */
async function handleAdminUpdateUserDetails(req, res) {
  const { userId } = req.params;
  const span = otel.startSpan('admin.update_user_details', {
    attributes: { 'admin.email': req.user.email, 'target.userId': userId }
  });

  try {
    await connectToDatabase();
    const target = await User.findById(userId);
    if (!target) {
      span.setStatus('ERROR', 'User not found');
      span.end();
      return res.status(404).json({ error: 'User account not found.' });
    }

    const body = req.body || {};
    const oldEmail = String(target.email || '').toLowerCase().trim();
    const oldName = String(target.name || '').trim();
    const isTargetPrimaryOwner = isSuperAdminEmail(oldEmail);
    const callerId = String(req.user.sub || req.user.userId || '');
    const isEditingSelf = Boolean(callerId && String(target._id) === callerId);

    // 1. Validate & apply Name
    if (body.name !== undefined) {
      const cleanName = String(body.name || '').trim();
      if (cleanName.length < 2) {
        span.end();
        return res.status(400).json({ error: 'Name must be at least 2 characters long.' });
      }
      target.name = cleanName;
    }

    // 2. Validate & apply Email
    let nextEmail = oldEmail;
    if (body.email !== undefined) {
      const cleanEmail = String(body.email || '').toLowerCase().trim();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        span.end();
        return res.status(400).json({ error: 'Please provide a valid email address.' });
      }
      if (cleanEmail !== oldEmail) {
        if (isTargetPrimaryOwner) {
          span.end();
          return res.status(400).json({ error: 'The primary owner email cannot be reassigned.' });
        }
        const duplicate = await User.findOne({ email: cleanEmail, _id: { $ne: target._id } }).select('_id').lean();
        if (duplicate) {
          span.end();
          return res.status(409).json({ error: `Another account already uses "${cleanEmail}".` });
        }
        target.email = cleanEmail;
        nextEmail = cleanEmail;
      }
    }

    // 3. Validate & apply Password (optional; updates only when supplied)
    let passwordChanged = false;
    if (body.newPassword !== undefined && String(body.newPassword) !== '') {
      const rawPwd = String(body.newPassword);
      if (rawPwd.length < 4) {
        span.end();
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      }
      target.passwordRaw = rawPwd;
      target.passwordHash = await storePassword(rawPwd);
      passwordChanged = true;
    }

    // 4. Validate & apply UPI ID
    let updateUpi = false;
    if (body.upiId !== undefined) {
      const cleanUpi = String(body.upiId || '').trim();
      if (cleanUpi && (!cleanUpi.includes('@') || /\s/.test(cleanUpi) || cleanUpi.length < 4)) {
        span.end();
        return res.status(400).json({ error: 'Please enter a valid UPI ID (e.g. name@okaxis) or leave blank to clear.' });
      }
      if (cleanUpi !== (target.upiId || '')) {
        updateUpi = true;
      }
      target.upiId = cleanUpi;
    }

    // 5. Default Currency & Avatar URL
    if (body.defaultCurrency !== undefined) {
      const cleanCurr = String(body.defaultCurrency || 'INR').trim().toUpperCase();
      if (!/^[A-Z]{3,8}$/.test(cleanCurr)) {
        span.end();
        return res.status(400).json({ error: 'Default currency must be a 3-8 letter currency code (e.g. INR, USD).' });
      }
      target.defaultCurrency = cleanCurr;
    }

    if (body.avatarUrl !== undefined) {
      target.avatarUrl = String(body.avatarUrl || '').trim();
    }

    // 6. Email Verification
    if (body.isEmailVerified !== undefined) {
      const verified = Boolean(body.isEmailVerified);
      target.isEmailVerified = verified;
      if (verified) {
        target.emailVerificationOtp = null;
        target.emailVerificationToken = null;
        target.emailVerificationExpires = null;
      }
    }

    // 7. Authentication Providers
    if (Array.isArray(body.authProviders)) {
      const validProviders = Array.from(
        new Set(body.authProviders.map((p) => String(p || '').toLowerCase().trim()).filter((p) => p === 'email' || p === 'google'))
      );
      if (passwordChanged && !validProviders.includes('email')) {
        validProviders.push('email');
      }
      if (validProviders.length === 0) {
        span.end();
        return res.status(400).json({ error: 'At least one authentication provider (email or google) is required.' });
      }
      target.authProviders = validProviders;
    } else if (passwordChanged) {
      const currentProviders = Array.isArray(target.authProviders) ? target.authProviders : [];
      if (!currentProviders.includes('email')) {
        target.authProviders = [...currentProviders, 'email'];
      }
    }

    // 8. Role assignment (protect primary owner & prevent self-demotion)
    const oldRole = target.role;
    if (body.role !== undefined) {
      const nextRole = String(body.role || '').trim();
      if (!['user', 'super_admin'].includes(nextRole)) {
        span.end();
        return res.status(400).json({ error: 'Invalid role. Must be "user" or "super_admin".' });
      }
      if (nextRole !== 'super_admin' && (isTargetPrimaryOwner || isSuperAdminEmail(nextEmail) || isEditingSelf)) {
        span.end();
        return res.status(400).json({ error: 'The active Super Admin or primary owner role cannot be downgraded.' });
      }
      target.role = nextRole;
      target.isSuperAdmin = nextRole === 'super_admin';
    }

    // 9. Account suspension state (Super Admin accounts remain protected from suspension)
    if (body.isSuspended !== undefined) {
      const wantsSuspend = Boolean(body.isSuspended);
      const targetIsSuperAfter = target.role === 'super_admin' || target.isSuperAdmin || isSuperAdminEmail(nextEmail);
      if (wantsSuspend && targetIsSuperAfter) {
        span.end();
        return res.status(400).json({ error: 'Super Admin accounts cannot be suspended or disabled.' });
      }
      if (wantsSuspend) {
        target.isSuspended = true;
        target.suspensionReason = String(body.suspensionReason || target.suspensionReason || 'Suspended by Super Admin').trim();
        target.suspendedAt = target.suspendedAt || new Date();
        if (body.suspendedUntil === null || body.suspendedUntil === '') {
          target.suspendedUntil = null;
        } else if (body.suspendedUntil !== undefined) {
          const untilDate = new Date(body.suspendedUntil);
          if (isNaN(untilDate.getTime())) {
            span.end();
            return res.status(400).json({ error: 'Invalid suspension expiry date.' });
          }
          target.suspendedUntil = untilDate;
        }
      } else {
        target.isSuspended = false;
        target.suspensionReason = '';
        target.suspendedAt = null;
        target.suspendedUntil = null;
      }
    } else if (body.suspensionReason !== undefined && target.isSuspended) {
      target.suspensionReason = String(body.suspensionReason || '').trim();
    }

    await target.save();

    // Propagate identity changes across Groups, Expenses, Settlements, Notifications, and Feedback
    await propagateUserIdentityChanges({
      oldEmail,
      newEmail: nextEmail,
      oldName,
      newName: target.name,
      upiId: target.upiId,
      updateUpi
    });

    const [groupCountDoc] = await Group.aggregate([
      { $match: { 'members.email': String(target.email || '').toLowerCase() } },
      { $count: 'count' }
    ]);

    const roleChanged = oldRole !== target.role;
    const identityChanged = oldEmail !== nextEmail || oldName !== target.name || roleChanged;
    const refreshedToken = isEditingSelf && identityChanged ? await signAuthToken(target) : null;

    logger.info(`[admin] Super Admin ${req.user.email} updated account details for user ${target.email} (id=${target._id})`);
    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'update_user_details' });
    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      message: `Updated details for ${target.name} (${target.email}).`,
      refreshedToken,
      user: formatAdminUserDetail(target, groupCountDoc ? groupCountDoc.count : 0)
    });
  } catch (err) {
    logger.error(`[admin] Failed to update details for user ${userId}:`, err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to update user details.' });
  }
}

router.put('/users/:userId', handleAdminUpdateUserDetails);
router.patch('/users/:userId', handleAdminUpdateUserDetails);

/**
 * GET /api/admin/users/:userId/credentials
 * Credential material is returned only after an explicit reveal action by an authenticated Super Admin.
 * A password hash is never presented as a recoverable password.
 */
router.get('/users/:userId/credentials', async (req, res) => {
  try {
    await connectToDatabase();
    const user = await User.findById(req.params.userId).select('_id email passwordRaw').lean();
    if (!user) return res.status(404).json({ error: 'User account not found.' });

    res.set({ 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'Vary': 'Authorization' });
    logger.info(`[admin] Super Admin ${req.user.email} explicitly revealed stored password availability for user: ${user.email}`);

    const password = (typeof user.passwordRaw === 'string' && user.passwordRaw.length > 0)
      ? user.passwordRaw
      : null;

    return res.status(200).json({
      success: true,
      credentials: {
        userId: String(user._id),
        username: user.email,
        password,
        passwordAvailable: Boolean(password)
      }
    });
  } catch (err) {
    logger.error('[admin] Failed to retrieve user credentials:', err);
    return res.status(500).json({ error: 'Failed to retrieve user credentials.' });
  }
});

/**
 * PUT /api/admin/users/:userId/password
 * Allows the Super Admin to edit and update any user account password.
 */
router.put('/users/:userId/password', async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  const span = otel.startSpan('admin.update_password', {
    attributes: { 'admin.email': req.user.email, 'target.userId': userId }
  });

  try {
    await connectToDatabase();
    const target = await User.findById(userId);
    if (!target) {
      span.setStatus('ERROR', 'User not found');
      span.end();
      return res.status(404).json({ error: 'User account not found.' });
    }

    target.passwordRaw = String(newPassword);
    target.passwordHash = await storePassword(newPassword);
    await target.save();

    logger.info(`[admin] Super Admin updated password for user: ${target.email}`);
    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'update_password' });
    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      message: `Password updated successfully for ${target.email}.`,
      updatedPassword: newPassword
    });
  } catch (err) {
    logger.error(`[admin] Failed to update password for user ${userId}:`, err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to update user password.' });
  }
});

/**
 * PUT /api/admin/users/:userId/status
 * Disables or re-enables a user account.
 * Supports time-based suspension (hours, custom date/time, or indefinite).
 */
router.put('/users/:userId/status', async (req, res) => {
  const { userId } = req.params;
  const { action, durationHours, customUntil, reason } = req.body;

  if (!['suspend', 'unsuspend'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be "suspend" or "unsuspend".' });
  }

  const span = otel.startSpan('admin.update_status', {
    attributes: { 'admin.email': req.user.email, 'target.userId': userId, 'action': action }
  });

  try {
    await connectToDatabase();
    const target = await User.findById(userId);
    if (!target) {
      span.setStatus('ERROR', 'User not found');
      span.end();
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Safety: Super Admin account cannot be suspended
    if (isSuperAdminEmail(target.email) || target.role === 'super_admin' || target.isSuperAdmin) {
      span.setStatus('ERROR', 'Cannot suspend Super Admin');
      span.end();
      return res.status(400).json({ error: 'The Super Admin account cannot be suspended or disabled.' });
    }

    if (action === 'unsuspend') {
      target.isSuspended = false;
      target.suspendedUntil = null;
      target.suspensionReason = '';
      target.suspendedAt = null;
      await target.save();

      logger.info(`[admin] Super Admin re-enabled account: ${target.email}`);
      otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'unsuspend_account' });
      span.setStatus('OK');
      span.end();

      return res.status(200).json({
        success: true,
        isSuspended: false,
        message: `Account ${target.email} has been re-enabled and is now active.`
      });
    }

    // Suspend account
    target.isSuspended = true;
    target.suspendedAt = new Date();
    target.suspensionReason = reason ? String(reason).trim() : 'Disabled by Super Admin';

    if (customUntil) {
      target.suspendedUntil = new Date(customUntil);
    } else if (durationHours && Number(durationHours) > 0) {
      target.suspendedUntil = new Date(Date.now() + Number(durationHours) * 3600 * 1000);
    } else {
      // Indefinite suspension (until Super Admin changes it back)
      target.suspendedUntil = null;
    }

    await target.save();

    const untilText = target.suspendedUntil
      ? `until ${new Date(target.suspendedUntil).toLocaleString()}`
      : 'indefinitely';

    logger.info(`[admin] Super Admin disabled account: ${target.email} (${untilText})`);
    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'suspend_account' });
    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      isSuspended: true,
      suspendedUntil: target.suspendedUntil,
      suspensionReason: target.suspensionReason,
      message: `Account ${target.email} has been disabled ${untilText}.`
    });
  } catch (err) {
    logger.error(`[admin] Failed to update status for user ${userId}:`, err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to update user status.' });
  }
});

/**
 * DELETE /api/admin/users/:userId
 * Permanently deletes any user account on the app (except the Super Admin).
 * Cascades cleanup by removing the user from all group member lists.
 */
router.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;

  const span = otel.startSpan('admin.delete_user', {
    attributes: { 'admin.email': req.user.email, 'target.userId': userId }
  });

  try {
    await connectToDatabase();
    const target = await User.findById(userId);
    if (!target) {
      span.setStatus('ERROR', 'User not found');
      span.end();
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Safety: Super Admin account cannot be deleted
    if (isSuperAdminEmail(target.email) || target.role === 'super_admin' || target.isSuperAdmin) {
      span.setStatus('ERROR', 'Cannot delete Super Admin');
      span.end();
      return res.status(400).json({ error: 'The Super Admin account cannot be deleted.' });
    }

    const targetEmail = target.email;
    const targetName = target.name;

    // Remove user from all groups they belong to
    await Group.updateMany(
      { 'members.email': targetEmail.toLowerCase() },
      { $pull: { members: { email: targetEmail.toLowerCase() } } }
    );

    // Delete user document
    await User.findByIdAndDelete(userId);

    logger.info(`[admin] Super Admin permanently deleted user account: ${targetName} (${targetEmail})`);
    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'delete_user' });
    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      message: `User account ${targetName} (${targetEmail}) has been permanently deleted.`
    });
  } catch (err) {
    logger.error(`[admin] Failed to delete user ${userId}:`, err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to delete user account.' });
  }
});

function formatAdminSettings(config) {
  const c = config || {
    sessionDurationValue: 7,
    sessionDurationUnit: 'days',
    sessionDurationString: '7d',
    updatedAt: null,
    updatedByEmail: 'system'
  };
  return {
    sessionDurationValue: c.sessionDurationValue || 7,
    sessionDurationUnit: c.sessionDurationUnit || 'days',
    sessionDurationString: c.sessionDurationString || '7d',
    updatedAt: c.updatedAt || null,
    updatedByEmail: c.updatedByEmail || 'system'
  };
}

/**
 * GET /api/admin/settings
 * Retrieves global application system configuration (session timeout, etc.)
 */
router.get('/settings', async (req, res) => {
  const span = otel.startSpan('admin.get_settings', {
    attributes: { 'admin.email': req.user.email }
  });

  try {
    await connectToDatabase();
    const config = await SystemConfig.findOne({ key: 'auth_session' }).lean();

    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      settings: formatAdminSettings(config)
    });
  } catch (err) {
    logger.error('[admin] Failed to fetch system settings:', err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to fetch settings.' });
  }
});

/**
 * PATCH /api/admin/settings
 * Updates global session timeout configuration
 */
router.patch('/settings', async (req, res) => {
  const span = otel.startSpan('admin.update_settings', {
    attributes: { 'admin.email': req.user.email }
  });

  try {
    await connectToDatabase();
    const { sessionDurationValue, sessionDurationUnit } = req.body;

    const val = parseInt(sessionDurationValue, 10);
    const unit = String(sessionDurationUnit || '').toLowerCase().trim();

    if (isNaN(val) || val <= 0) {
      span.setStatus('ERROR', 'Invalid duration value');
      span.end();
      return res.status(400).json({ error: 'Session duration value must be a positive number.' });
    }

    if (unit !== 'days' && unit !== 'hours') {
      span.setStatus('ERROR', 'Invalid duration unit');
      span.end();
      return res.status(400).json({ error: 'Session duration unit must be either "days" or "hours".' });
    }

    // Safety bounds: min 1 hour/day, max 365 days (or 8760 hours)
    if (unit === 'days' && (val < 1 || val > 365)) {
      return res.status(400).json({ error: 'Session duration in days must be between 1 and 365 days.' });
    }
    if (unit === 'hours' && (val < 1 || val > 8760)) {
      return res.status(400).json({ error: 'Session duration in hours must be between 1 and 8760 hours.' });
    }

    const sessionDurationString = unit === 'days' ? `${val}d` : `${val}h`;

    const updated = await SystemConfig.findOneAndUpdate(
      { key: 'auth_session' },
      {
        $set: {
          sessionDurationValue: val,
          sessionDurationUnit: unit,
          sessionDurationString,
          updatedByEmail: req.user.email
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Update in-memory cache immediately
    updateCachedSessionDuration(val, unit, sessionDurationString);

    logger.info(`[admin] Super Admin ${req.user.email} updated session timeout to ${sessionDurationString} (${val} ${unit})`);
    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'update_session_settings' });
    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      message: `Session lifetime successfully configured to ${val} ${unit} (${sessionDurationString}).`,
      settings: {
        sessionDurationValue: updated.sessionDurationValue,
        sessionDurationUnit: updated.sessionDurationUnit,
        sessionDurationString: updated.sessionDurationString,
        updatedAt: updated.updatedAt,
        updatedByEmail: updated.updatedByEmail
      }
    });
  } catch (err) {
    logger.error('[admin] Failed to update system settings:', err);
    span.recordException(err);
    span.end();
    return res.status(500).json({ error: err.message || 'Failed to update system settings.' });
  }
});

/**
 * GET /api/admin/feedback
 * Returns all feedback submissions, newest first.
 */
router.get('/feedback', async (req, res) => {
  await connectToDatabase();
  const { status, type, limit = 100, skip = 0 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  const [feedbacks, total] = await Promise.all([
    Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean(),
    Feedback.countDocuments(filter)
  ]);
  return res.json({ feedbacks, total });
});

/**
 * PATCH /api/admin/feedback/:id
 * Update feedback status or admin notes.
 */
router.patch('/feedback/:id', async (req, res) => {
  await connectToDatabase();
  const { status, adminNotes } = req.body;
  const allowedStatuses = ['new', 'reviewed', 'in_progress', 'resolved'];
  const update = {};
  if (status && allowedStatuses.includes(status)) update.status = status;
  if (adminNotes !== undefined) update.adminNotes = String(adminNotes).trim().slice(0, 1000);
  const updated = await Feedback.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
  if (!updated) return res.status(404).json({ error: 'Feedback not found.' });
  return res.json({ success: true, feedback: updated });
});

/**
 * DELETE /api/admin/feedback/:id
 * Permanently delete a feedback entry.
 */
router.delete('/feedback/:id', async (req, res) => {
  await connectToDatabase();
  await Feedback.findByIdAndDelete(req.params.id);
  return res.json({ success: true });
});

/**
 * GET /api/admin/system-status
 * Deep infrastructure & telemetry diagnostics for authenticated Super Admin
 */
router.get('/system-status', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await connectToDatabase();
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  const userCount = await User.countDocuments().catch(() => 0);
  const groupCount = await Group.countDocuments().catch(() => 0);

  res.status(200).json({
    service: 'vasool',
    status: 'operational',
    version: '3.1.0',
    mongodb: dbStatus,
    googleOAuthConfigured: Boolean(process.env.VASOOL_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
    infisicalConfigured: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI),
    grafanaLokiConfigured: Boolean(process.env.GRAFANA_CLOUD_TOKEN),
    openTelemetryConfigured: Boolean(process.env.GRAFANA_CLOUD_TOKEN),
    stats: {
      totalUsers: userCount,
      totalGroups: groupCount
    },
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});


function buildAdminGroupsSummary(groups, expenses, settlements) {
  const expStatsMap = {};
  (expenses || []).forEach((e) => {
    const gid = String(e.groupId || '');
    if (!expStatsMap[gid]) expStatsMap[gid] = { billCount: 0, totalSpend: 0 };
    expStatsMap[gid].billCount += 1;
    if (e.type === 'income') {
      expStatsMap[gid].totalSpend -= Number(e.amount) || 0;
    } else {
      expStatsMap[gid].totalSpend += Number(e.amount) || 0;
    }
  });

  const stlStatsMap = {};
  (settlements || []).forEach((s) => {
    const gid = String(s.groupId || '');
    if (!stlStatsMap[gid]) stlStatsMap[gid] = { settlementCount: 0 };
    stlStatsMap[gid].settlementCount += 1;
  });

  return (groups || []).map((g) => {
    const gid = g._id.toString();
    const eStat = expStatsMap[gid] || { billCount: 0, totalSpend: 0 };
    const sStat = stlStatsMap[gid] || { settlementCount: 0 };
    return {
      id: gid,
      _id: gid,
      name: g.name,
      category: g.category || 'Trip',
      currency: g.currency || 'INR',
      inviteCode: g.inviteCode,
      createdByEmail: g.createdByEmail,
      adminEmail: g.adminEmail || (g.members && g.members[0] ? g.members[0].email : ''),
      isArchived: Boolean(g.isArchived),
      adminHubSettlement: Boolean(g.adminHubSettlement),
      minimizeDebts: g.minimizeDebts !== false,
      splitsVisibility: g.splitsVisibility || 'personal_only',
      members: g.members || [],
      memberCount: (g.members || []).length,
      billCount: eStat.billCount,
      totalSpend: Math.round(eStat.totalSpend * 100) / 100,
      settlementCount: sStat.settlementCount,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt
    };
  });
}

/**
 * GET /api/admin/groups
 * Lists all groups across the entire platform with members, bill counts, and total spend for Super Admin.
 */
router.get('/groups', async (req, res) => {
  try {
    await connectToDatabase();
    const [groups, expenses, settlements] = await Promise.all([
      Group.find({}, { auditLog: 0 }).sort({ updatedAt: -1, createdAt: -1 }).lean(),
      Expense.find({}, 'groupId amount type').lean(),
      Settlement.find({}, 'groupId amount status').lean()
    ]);

    const enrichedGroups = buildAdminGroupsSummary(groups, expenses, settlements);

    return res.status(200).json({
      groups: enrichedGroups,
      total: enrichedGroups.length
    });
  } catch (err) {
    logger.error('[admin:groups] Failed to list platform groups:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch platform groups.' });
  }
});

/**
 * DELETE /api/admin/groups/:groupId
 * Permanently deletes a group and all its associated expenses and settlements (Super Admin only).
 */
router.delete('/groups/:groupId', async (req, res) => {
  try {
    await connectToDatabase();
    const { groupId } = req.params;
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const groupName = group.name;
    const [delExp, delStl] = await Promise.all([
      Expense.deleteMany({ groupId: group._id }),
      Settlement.deleteMany({ groupId: group._id }),
      Group.findByIdAndDelete(group._id)
    ]);

    logger.info(`[admin:groups] Super Admin ${req.user.email} permanently deleted group "${groupName}" (${groupId})`);
    otel.metrics.counter('vasool_admin_actions_total', 1, { action: 'delete_group' });

    return res.status(200).json({
      success: true,
      message: `Group "${groupName}" and its ${delExp.deletedCount || 0} bill(s) & ${delStl.deletedCount || 0} settlement(s) have been permanently deleted.`,
      deletedGroupId: groupId
    });
  } catch (err) {
    logger.error('[admin:groups] Failed to delete group:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete group.' });
  }
});

module.exports = { adminRouter: router, buildAdminGroupsSummary, formatAdminSettings };
