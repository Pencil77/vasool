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

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipientEmail: requesterEmail })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ recipientEmail: requesterEmail, isRead: false })
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

// POST /api/notifications/read-all - Mark all notifications as read for authenticated user
router.post('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const now = new Date();
    const result = await Notification.updateMany(
      { recipientEmail: requesterEmail, isRead: false },
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

// POST /api/notifications/:id/read - Mark single notification as read (ownership enforced)
router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await connectToDatabase();
    const requesterEmail = String(req.user.email || '').toLowerCase().trim();
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientEmail: requesterEmail },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const unreadCount = await Notification.countDocuments({ recipientEmail: requesterEmail, isRead: false });
    return res.status(200).json({ notification: updated, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { notificationsRouter: router };
