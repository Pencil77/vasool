const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const Notification = require('../models/Notification');
const { requireAuth } = require('./auth');
const { maybeRunScheduledSettlementCatchup } = require('../lib/settlement-scheduler');

const router = express.Router();

// GET /api/notifications - List notifications belonging strictly to the authenticated user
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    await maybeRunScheduledSettlementCatchup();

    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 100);
    const activeFilter = { recipientEmail: requesterEmail, isDismissed: { $ne: true } };

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(activeFilter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ ...activeFilter, isRead: false })
    ]);

    return res.status(200).json({
      notifications,
      unreadCount,
      serverNow: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/read-all - Mark all active notifications as read for authenticated user
router.post('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const now = new Date();
    const result = await Notification.updateMany(
      { recipientEmail: requesterEmail, isDismissed: { $ne: true }, isRead: false },
      { $set: { isRead: true, readAt: now } }
    );
    return res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount || 0,
      unreadCount: 0
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/dismiss-all - Dismiss all active notifications (with undo IDs returned)
router.post('/notifications/dismiss-all', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const now = new Date();
    const requestedIds = Array.isArray(req.body?.notificationIds) ? req.body.notificationIds.filter(Boolean) : null;
    const match = {
      recipientEmail: requesterEmail,
      isDismissed: { $ne: true },
      ...(requestedIds && requestedIds.length > 0 ? { _id: { $in: requestedIds } } : {})
    };
    const matchingDocs = await Notification.find(match).select('_id').lean();
    const dismissedIds = matchingDocs.map((d) => String(d._id));
    let modifiedCount = 0;
    if (dismissedIds.length > 0) {
      const result = await Notification.updateMany(
        { _id: { $in: dismissedIds }, recipientEmail: requesterEmail },
        { $set: { isDismissed: true, dismissedAt: now, isRead: true, readAt: now } }
      );
      modifiedCount = result.modifiedCount || 0;
    }
    const unreadCount = await Notification.countDocuments({ recipientEmail: requesterEmail, isDismissed: { $ne: true }, isRead: false });
    return res.status(200).json({
      success: true,
      dismissedIds,
      modifiedCount,
      unreadCount
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/restore-batch - Restore dismissed notifications (Undo action)
router.post('/notifications/restore-batch', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const notificationIds = Array.isArray(req.body?.notificationIds) ? req.body.notificationIds.filter(Boolean) : [];
    if (notificationIds.length === 0) {
      return res.status(400).json({ error: 'notificationIds array is required.' });
    }
    await Notification.updateMany(
      { _id: { $in: notificationIds }, recipientEmail: requesterEmail },
      { $set: { isDismissed: false, dismissedAt: null } }
    );
    const activeFilter = { recipientEmail: requesterEmail, isDismissed: { $ne: true } };
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(activeFilter).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ ...activeFilter, isRead: false })
    ]);
    return res.status(200).json({ success: true, notifications, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/:id/read - Mark single notification as read (ownership enforced)
router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientEmail: requesterEmail, isDismissed: { $ne: true } },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const unreadCount = await Notification.countDocuments({ recipientEmail: requesterEmail, isDismissed: { $ne: true }, isRead: false });
    return res.status(200).json({ notification: updated, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/:id/dismiss - Dismiss single notification (ownership enforced)
router.post('/notifications/:id/dismiss', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const now = new Date();
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientEmail: requesterEmail },
      { $set: { isDismissed: true, dismissedAt: now, isRead: true, readAt: now } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const unreadCount = await Notification.countDocuments({ recipientEmail: requesterEmail, isDismissed: { $ne: true }, isRead: false });
    return res.status(200).json({ success: true, notification: updated, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/:id/restore - Restore single dismissed notification (Undo action)
router.post('/notifications/:id/restore', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const restored = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientEmail: requesterEmail },
      { $set: { isDismissed: false, dismissedAt: null } },
      { new: true }
    ).lean();

    if (!restored) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const unreadCount = await Notification.countDocuments({ recipientEmail: requesterEmail, isDismissed: { $ne: true }, isRead: false });
    return res.status(200).json({ success: true, notification: restored, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { notificationsRouter: router };
