const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const SystemConfig = require('../models/SystemConfig');
const {
  requireAuth,
  isSuperAdminEmail,
  SUPER_ADMIN_EMAIL,
  storePassword,
  updateCachedSessionDuration,
  getCachedSessionDuration
} = require('./auth');
const logger = require('../lib/logger');
const otel = require('../lib/otel');

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
 * Lists all registered users with plaintext password visibility, suspension details, and group statistics.
 */
router.get('/users', async (req, res) => {
  const span = otel.startSpan('admin.get_users', {
    attributes: { 'admin.email': req.user.email }
  });

  try {
    await connectToDatabase();
    const users = await User.find().sort({ createdAt: -1 });
    const groups = await Group.find({}, 'members').lean();

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
        // Super Admin can see the password (raw or stored)
        password: u.passwordRaw || u.passwordHash || 'Not Set',
        hasRawPassword: Boolean(u.passwordRaw),
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
    let config = await SystemConfig.findOne({ key: 'auth_session' }).lean();
    if (!config) {
      config = {
        key: 'auth_session',
        sessionDurationValue: 7,
        sessionDurationUnit: 'days',
        sessionDurationString: '7d',
        description: 'Global application session timeout and security settings',
        updatedByEmail: 'system'
      };
    }

    span.setStatus('OK');
    span.end();

    return res.status(200).json({
      success: true,
      settings: {
        sessionDurationValue: config.sessionDurationValue || 7,
        sessionDurationUnit: config.sessionDurationUnit || 'days',
        sessionDurationString: config.sessionDurationString || '7d',
        updatedAt: config.updatedAt || null,
        updatedByEmail: config.updatedByEmail || 'system'
      }
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

module.exports = { adminRouter: router };
