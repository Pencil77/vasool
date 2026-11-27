const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const { JSDOM } = require('jsdom');

const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const Notification = require('../models/Notification');
const { signAuthToken } = require('../routes/auth');
const { computeGroupBalanceMap } = require('../lib/debt-engine');
const {
  NOTIFICATION_DELAY_MS,
  GRACE_PERIOD_MS,
  processDueDelayedNotifications,
  processDueAutoConfirmations
} = require('../lib/settlement-scheduler');
const mailer = require('../lib/mailer');
const app = require('../server');

async function requestJson(baseUrl, method, urlPath, { token = null, body = null } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { rawText: text };
  }
  return { status: res.status, data };
}

(async () => {
  console.log('🧪 Starting Payment Grace Period, Delay, Revert, Dispute & Notification Centre E2E Test Suite...\n');
  await connectToDatabase();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const adminEmail = `gp_admin_${suffix}@vasooltest.com`;
  const senderEmail = `gp_sender_${suffix}@vasooltest.com`;
  const receiverEmail = `gp_receiver_${suffix}@vasooltest.com`;
  const receiverUpi = `receiver_${suffix}@okaxis`;
  const createdGroupIds = [];

  global.__vasoolCapturedTestEmails = [];

  let server;
  let baseUrl = '';

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create 3 verified test users (Admin, Sender, Receiver with UPI ID)
    const [adminUser, senderUser, receiverUser] = await User.create([
      { name: 'GP Admin', email: adminEmail, passwordHash: 'x', isVerified: true, authProvider: 'email' },
      { name: 'GP Sender', email: senderEmail, passwordHash: 'x', isVerified: true, authProvider: 'email' },
      { name: 'GP Receiver', email: receiverEmail, passwordHash: 'x', isVerified: true, authProvider: 'email', upiId: receiverUpi }
    ]);

    const adminToken = await signAuthToken(adminUser);
    const senderToken = await signAuthToken(senderUser);
    const receiverToken = await signAuthToken(receiverUser);

    // Create Direct P2P Group where Admin is distinct from Receiver & Sender
    const group = await Group.create({
      name: `GP Test Group ${suffix}`,
      currency: 'INR',
      inviteCode: `GP${String(Date.now()).slice(-6)}`,
      createdByEmail: adminEmail,
      adminEmail,
      adminHubSettlement: false,
      minimizeDebts: true,
      members: [
        { name: 'GP Admin', email: adminEmail, role: 'admin', isRegistered: true, upiId: '' },
        { name: 'GP Sender', email: senderEmail, role: 'member', isRegistered: true, upiId: '' },
        { name: 'GP Receiver', email: receiverEmail, role: 'member', isRegistered: true, upiId: receiverUpi }
      ]
    });
    createdGroupIds.push(group._id);

    // Create Expense: Receiver paid 1000 split 50/50 with Sender -> Sender owes Receiver ₹500
    await Expense.create({
      groupId: group._id,
      type: 'expense',
      description: 'Grace Period Baseline Expense',
      amount: 1000,
      paidByEmail: receiverEmail,
      paidByName: 'GP Receiver',
      createdByEmail: receiverEmail,
      splitType: 'equal',
      expenseDate: new Date(),
      splits: [
        { memberEmail: receiverEmail, memberName: 'GP Receiver', amount: 500, percentage: 50, shares: 1 },
        { memberEmail: senderEmail, memberName: 'GP Sender', amount: 500, percentage: 50, shares: 1 }
      ]
    });

    // =========================================================================
    // TEST 1: Payment acknowledgement -> 10m delay, zero immediate notifications/emails
    // =========================================================================
    console.log('--- Test 1: Delayed Acknowledgement Recording ---');
    const createRes1 = await requestJson(baseUrl, 'POST', '/api/settlements', {
      token: senderToken,
      body: {
        groupId: String(group._id),
        fromEmail: senderEmail,
        fromName: 'GP Sender',
        toEmail: receiverEmail,
        toName: 'GP Receiver',
        amount: 200,
        method: 'UPI',
        utrNumber: 'UTRGP0001'
      }
    });
    assert.strictEqual(createRes1.status, 201, `Expected 201, got ${createRes1.status}: ${JSON.stringify(createRes1.data)}`);
    const stl1 = createRes1.data.settlement;
    assert.strictEqual(stl1.status, 'pending_confirmation');
    assert.strictEqual(stl1.workflowVersion, 2);
    assert.strictEqual(stl1.verificationStage, 'notification_pending');
    assert.strictEqual(stl1.receiverNotifiedAt, null);
    assert.strictEqual(stl1.receiverUpiIdSnapshot, receiverUpi);
    const ackMs1 = new Date(stl1.acknowledgedAt).getTime();
    const notifyMs1 = new Date(stl1.notifyAfterAt).getTime();
    assert.strictEqual(notifyMs1 - ackMs1, NOTIFICATION_DELAY_MS, 'notifyAfterAt must be exactly acknowledgedAt + 10m');
    assert.strictEqual(global.__vasoolCapturedTestEmails.length, 0, 'Must NOT send email immediately on settlement submission');
    assert.strictEqual(await Notification.countDocuments({ settlementId: stl1._id }), 0, 'Must NOT create in-app notification before 10m');
    console.log('✅ Test 1 Passed: Payment marked paid with 10m delay, UPI snapshot saved, zero premature alerts.');

    // =========================================================================
    // TEST 2: Before 10m elapsed -> Scheduler is a no-op; At/After 10m -> Retry backoff & Idempotency
    // =========================================================================
    console.log('--- Test 2: Scheduler Before 10m + Retry Backoff + Concurrency Idempotency ---');
    const before10m = await processDueDelayedNotifications({ now: new Date(ackMs1 + 9 * 60 * 1000) });
    assert.strictEqual(before10m.notifiedCount, 0);
    assert.strictEqual(await Notification.countDocuments({ settlementId: stl1._id }), 0);

    // Simulate transient email delivery failure on first attempt after 10 minutes
    const after11m = new Date(ackMs1 + 11 * 60 * 1000);
    const failRun = await processDueDelayedNotifications({
      now: after11m,
      mailSenders: {
        sendPaymentConfirmationRequestEmail: async () => ({ success: false, error: 'Simulated SMTP transient outage' })
      }
    });
    assert.strictEqual(failRun.notifiedCount, 1);
    assert.strictEqual(failRun.emailFailedCount, 1);
    let stl1Db = await Settlement.findById(stl1._id).lean();
    assert.strictEqual(stl1Db.verificationStage, 'awaiting_verification');
    assert.strictEqual(stl1Db.emailDeliveryStatus, 'failed');
    assert.strictEqual(stl1Db.notificationAttempts, 1);
    assert(stl1Db.notificationNextRetryAt, 'notificationNextRetryAt should be set for retry');
    assert.strictEqual(
      new Date(stl1Db.gracePeriodEndsAt).getTime() - new Date(stl1Db.gracePeriodStartedAt).getTime(),
      GRACE_PERIOD_MS,
      'Grace period must equal exact 48 hours from server notification anchor'
    );
    assert.strictEqual(await Notification.countDocuments({ settlementId: stl1._id }), 1, 'In-app notification created once even if email fails');

    // Retry after backoff using real mailer (which captures into global.__vasoolCapturedTestEmails)
    const after13m = new Date(ackMs1 + 13 * 60 * 1000);
    const [retryRunA, retryRunB] = await Promise.all([
      processDueDelayedNotifications({ now: after13m }),
      processDueDelayedNotifications({ now: after13m })
    ]);
    assert.strictEqual(retryRunA.emailRetrySuccessCount + retryRunB.emailRetrySuccessCount, 1, 'Concurrent retry runs must succeed exactly once');
    stl1Db = await Settlement.findById(stl1._id).lean();
    assert.strictEqual(stl1Db.emailDeliveryStatus, 'sent');
    assert(stl1Db.receiverNotifiedAt, 'receiverNotifiedAt must be set once email succeeds');
    assert.strictEqual(await Notification.countDocuments({ settlementId: stl1._id }), 1, 'In-app notification must NOT duplicate on email retry');

    assert.strictEqual(global.__vasoolCapturedTestEmails.length, 1);
    const email1 = global.__vasoolCapturedTestEmails[0];
    assert.strictEqual(email1.toEmail, receiverEmail);
    assert(email1.html.includes(receiverUpi), 'Delayed email must explicitly display receiver registered UPI ID');
    assert(email1.html.includes('200.00'), 'Delayed email must include payment amount');
    assert(email1.html.includes('GP Sender'), 'Delayed email must include sender name');
    assert(email1.html.includes(group.name), 'Delayed email must include group name');
    assert(email1.html.includes('report-view?token='), 'Delayed email must include report-not-received link');
    assert(email1.html.includes('ack?token='), 'Delayed email must include confirm receipt link');
    console.log('✅ Test 2 Passed: 10m gate enforced, email retry idempotent, UPI ID & links verified.');

    // =========================================================================
    // TEST 3: Sender Revert During 10m Delay AND During 48h Grace Period
    // =========================================================================
    console.log('--- Test 3: Sender Revert During Delay & Grace Period ---');
    // 3a. Revert during 10m notification_pending
    const createForEarlyRevert = await requestJson(baseUrl, 'POST', '/api/settlements', {
      token: senderToken,
      body: {
        groupId: String(group._id),
        fromEmail: senderEmail,
        fromName: 'GP Sender',
        toEmail: receiverEmail,
        toName: 'GP Receiver',
        amount: 50,
        method: 'UPI',
        utrNumber: 'UTRREV1'
      }
    });
    assert.strictEqual(createForEarlyRevert.status, 201);
    const stlEarlyId = createForEarlyRevert.data.settlement._id;
    const revertEarly = await requestJson(baseUrl, 'POST', `/api/settlements/${stlEarlyId}/revert`, { token: senderToken, body: {} });
    assert.strictEqual(revertEarly.status, 200);
    assert.strictEqual(revertEarly.data.settlement.status, 'reverted');
    assert.strictEqual(revertEarly.data.settlement.verificationStage, 'reverted');
    assert.strictEqual(revertEarly.data.settlement.confirmationToken, null);
    assert.strictEqual(revertEarly.data.settlement.disputeToken, null);
    // Scheduler after +15m must NOT fire on reverted settlement
    const countBeforeDelayedRevert = global.__vasoolCapturedTestEmails.length;
    await processDueDelayedNotifications({ now: new Date(Date.now() + 20 * 60 * 1000) });
    assert.strictEqual(global.__vasoolCapturedTestEmails.length, countBeforeDelayedRevert, 'Reverted settlement must never fire delayed email');

    const getGroupBal = async () => {
      const [gDoc, exps, stls] = await Promise.all([
        Group.findById(group._id).lean(),
        Expense.find({ groupId: group._id }).lean(),
        Settlement.find({ groupId: group._id }).lean()
      ]);
      return computeGroupBalanceMap(gDoc, exps, stls);
    };

    // 3b. Revert stl1 during active 48h grace period
    const revertGrace = await requestJson(baseUrl, 'POST', `/api/settlements/${stl1._id}/revert`, { token: senderToken, body: {} });
    assert.strictEqual(revertGrace.status, 200);
    assert.strictEqual(revertGrace.data.settlement.status, 'reverted');
    // Verify debt balance is back to exact ₹500
    const balAfterRevert = await getGroupBal();
    assert.strictEqual(balAfterRevert[senderEmail].net, -500);
    assert.strictEqual(balAfterRevert[receiverEmail].net, 500);
    console.log('✅ Test 3 Passed: Sender can revert cleanly during 10m delay and 48h grace window without disrupting balances.');

    // =========================================================================
    // TEST 4: Report Not Received -> Disputed State, Immediate Emails & Halt Auto-Confirm
    // =========================================================================
    console.log('--- Test 4: Report Not Received Workflow & Halted Auto-Confirmation ---');
    const createForDispute = await requestJson(baseUrl, 'POST', '/api/settlements', {
      token: senderToken,
      body: {
        groupId: String(group._id),
        fromEmail: senderEmail,
        fromName: 'GP Sender',
        toEmail: receiverEmail,
        toName: 'GP Receiver',
        amount: 150,
        method: 'UPI',
        utrNumber: 'UTRDISP1'
      }
    });
    assert.strictEqual(createForDispute.status, 201);
    const stlDispute = createForDispute.data.settlement;
    const disputeNotifyNow = new Date(new Date(stlDispute.acknowledgedAt).getTime() + 11 * 60 * 1000);
    await processDueDelayedNotifications({ now: disputeNotifyNow });

    // Sender trying to report not received as non-receiver must fail 403
    const forbiddenDispute = await requestJson(baseUrl, 'POST', `/api/settlements/${stlDispute._id}/report-not-received`, {
      token: senderToken,
      body: { reason: 'Should fail' }
    });
    assert.strictEqual(forbiddenDispute.status, 403);

    const emailsBeforeDispute = global.__vasoolCapturedTestEmails.length;
    const reportRes = await requestJson(baseUrl, 'POST', `/api/settlements/${stlDispute._id}/report-not-received`, {
      token: receiverToken,
      body: { reason: 'Amount did not arrive in my Axis UPI statement' }
    });
    assert.strictEqual(reportRes.status, 200, `Expected 200, got ${reportRes.status}: ${JSON.stringify(reportRes.data)}`);
    assert.strictEqual(reportRes.data.settlement.status, 'disputed');
    assert.strictEqual(reportRes.data.settlement.verificationStage, 'disputed');
    assert(reportRes.data.settlement.disputedAt);

    // Check immediate emails to sender + group admin
    const newEmails = global.__vasoolCapturedTestEmails.slice(emailsBeforeDispute);
    assert.strictEqual(newEmails.length, 2, `Expected 2 dispute emails (sender + admin), got ${newEmails.length}`);
    const senderDisputeEmail = newEmails.find((e) => e.toEmail === senderEmail);
    const adminDisputeEmail = newEmails.find((e) => e.toEmail === adminEmail);
    assert(senderDisputeEmail, 'Original sender must immediately receive dispute email');
    assert(adminDisputeEmail, 'Group admin must immediately receive dispute email');
    assert(senderDisputeEmail.html.includes('150.00') && senderDisputeEmail.html.includes('Axis UPI statement'));
    assert(adminDisputeEmail.html.includes('GP Receiver') && adminDisputeEmail.html.includes('GP Sender'));

    // Check balance excludes disputed settlement (sender still owes full ₹500)
    const balWhileDisputed = await getGroupBal();
    assert.strictEqual(balWhileDisputed[senderEmail].net, -500);
    assert.strictEqual(balWhileDisputed[senderEmail].pendingPaid, 0);

    // Advance 72 hours -> disputed settlement must NEVER auto-confirm!
    const plus72h = new Date(disputeNotifyNow.getTime() + 72 * 60 * 60 * 1000);
    await processDueAutoConfirmations({ now: plus72h });
    const stlDisputedStill = await Settlement.findById(stlDispute._id).lean();
    assert.strictEqual(stlDisputedStill.status, 'disputed', 'Disputed payment must NOT auto-confirm after grace period');

    // Resolve dispute via admin confirm
    const resolveConfirm = await requestJson(baseUrl, 'POST', `/api/settlements/${stlDispute._id}/resolve-dispute`, {
      token: adminToken,
      body: { action: 'confirm', note: 'Verified bank statement later' }
    });
    assert.strictEqual(resolveConfirm.status, 200);
    assert.strictEqual(resolveConfirm.data.settlement.status, 'confirmed');
    const balAfterDisputeResolved = await getGroupBal();
    assert.strictEqual(balAfterDisputeResolved[senderEmail].net, -350);
    console.log('✅ Test 4 Passed: Dispute blocks auto-confirm, notifies sender+admin via email & in-app, resolves cleanly.');

    // =========================================================================
    // TEST 5: Auto-Confirmation After 48h & Blocking Late Reports (409)
    // =========================================================================
    console.log('--- Test 5: 48-Hour Auto-Confirmation & Post-Expiry Dispute Lockout ---');
    const createForAuto = await requestJson(baseUrl, 'POST', '/api/settlements', {
      token: senderToken,
      body: {
        groupId: String(group._id),
        fromEmail: senderEmail,
        fromName: 'GP Sender',
        toEmail: receiverEmail,
        toName: 'GP Receiver',
        amount: 100,
        method: 'UPI',
        utrNumber: 'UTRAUTO1'
      }
    });
    assert.strictEqual(createForAuto.status, 201);
    const stlAuto = createForAuto.data.settlement;
    const autoNotifyNow = new Date(new Date(stlAuto.acknowledgedAt).getTime() + 11 * 60 * 1000);
    await processDueDelayedNotifications({ now: autoNotifyNow });
    const stlAutoAwaiting = await Settlement.findById(stlAuto._id).lean();
    const graceEndMs = new Date(stlAutoAwaiting.gracePeriodEndsAt).getTime();

    // Run before grace expires -> must remain awaiting_verification
    const beforeExpiryRes = await processDueAutoConfirmations({ now: new Date(graceEndMs - 60 * 1000) });
    assert.strictEqual(beforeExpiryRes.autoConfirmedCount, 0);

    // Run after 48h grace period expires
    const emailsBeforeAuto = global.__vasoolCapturedTestEmails.length;
    const afterExpiryNow = new Date(graceEndMs + 60 * 1000);
    const [autoRes1, autoRes2] = await Promise.all([
      processDueAutoConfirmations({ now: afterExpiryNow }),
      processDueAutoConfirmations({ now: afterExpiryNow })
    ]);
    assert.strictEqual(autoRes1.autoConfirmedCount + autoRes2.autoConfirmedCount, 1, 'Concurrent auto-confirm must execute once');
    const stlAutoFinal = await Settlement.findById(stlAuto._id).lean();
    assert.strictEqual(stlAutoFinal.status, 'confirmed');
    assert.strictEqual(stlAutoFinal.verificationStage, 'auto_confirmed_48h');
    assert.strictEqual(stlAutoFinal.confirmationSource, 'auto_48h');

    // Receiver attempting report-not-received after 48h auto-confirm must get 409
    const lateReport = await requestJson(baseUrl, 'POST', `/api/settlements/${stlAuto._id}/report-not-received`, {
      token: receiverToken,
      body: { reason: 'Too late' }
    });
    assert.strictEqual(lateReport.status, 409);

    const autoEmails = global.__vasoolCapturedTestEmails.slice(emailsBeforeAuto);
    assert.strictEqual(autoEmails.length, 2, 'Auto-confirm email should go to both sender and receiver');
    console.log('✅ Test 5 Passed: 48h auto-confirm atomic, idempotent, sends Email #4, and rejects late disputes.');

    // =========================================================================
    // TEST 6: Exact Expiry Boundary Concurrency Race (Dispute vs Auto-Confirm)
    // =========================================================================
    console.log('--- Test 6: Concurrency Race at Grace Period Boundary ---');
    const createForRace = await requestJson(baseUrl, 'POST', '/api/settlements', {
      token: senderToken,
      body: {
        groupId: String(group._id),
        fromEmail: senderEmail,
        fromName: 'GP Sender',
        toEmail: receiverEmail,
        toName: 'GP Receiver',
        amount: 25,
        method: 'UPI',
        utrNumber: 'UTRRACE1'
      }
    });
    assert.strictEqual(createForRace.status, 201);
    const stlRace = createForRace.data.settlement;
    await processDueDelayedNotifications({ now: new Date(new Date(stlRace.acknowledgedAt).getTime() + 11 * 60 * 1000) });
    // Force gracePeriodEndsAt to just now so auto-confirmer can compete directly with report-not-received
    const raceDeadline = new Date(Date.now() - 1000);
    await Settlement.updateOne({ _id: stlRace._id }, { $set: { gracePeriodEndsAt: raceDeadline } });

    const [httpDisputeRace, jobAutoRace] = await Promise.all([
      requestJson(baseUrl, 'POST', `/api/settlements/${stlRace._id}/report-not-received`, {
        token: receiverToken,
        body: { reason: 'Boundary race report' }
      }),
      processDueAutoConfirmations({ now: new Date() })
    ]);
    const raceWinnerDoc = await Settlement.findById(stlRace._id).lean();
    assert(
      (raceWinnerDoc.status === 'confirmed' && raceWinnerDoc.verificationStage === 'auto_confirmed_48h' && httpDisputeRace.status === 409) ||
      (raceWinnerDoc.status === 'disputed' && raceWinnerDoc.verificationStage === 'disputed' && httpDisputeRace.status === 200 && jobAutoRace.autoConfirmedCount === 0),
      `Race must have clean single winner; got status=${raceWinnerDoc.status}, http=${httpDisputeRace.status}, autoCount=${jobAutoRace.autoConfirmedCount}`
    );
    console.log(`✅ Test 6 Passed: Race resolved cleanly without inconsistent state (winner: ${raceWinnerDoc.status}).`);

    // =========================================================================
    // TEST 7: In-App Notification Centre Isolation, Unread Counts & Legacy v1 Untouched
    // =========================================================================
    console.log('--- Test 7: Notification Centre Auth Isolation + Legacy v1 Safety ---');
    // Insert a legacy workflowVersion: 1 pending settlement
    const legacyStl = await Settlement.create({
      groupId: group._id,
      fromEmail: senderEmail,
      fromName: 'GP Sender',
      toEmail: receiverEmail,
      toName: 'GP Receiver',
      amount: 10,
      currency: 'INR',
      method: 'UPI',
      settlementMode: 'direct_p2p',
      status: 'pending_confirmation',
      workflowVersion: 1,
      verificationStage: 'legacy',
      settledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    });

    await processDueDelayedNotifications({ now: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) });
    await processDueAutoConfirmations({ now: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) });
    const legacyAfterJobs = await Settlement.findById(legacyStl._id).lean();
    assert.strictEqual(legacyAfterJobs.status, 'pending_confirmation', 'Legacy v1 settlement must remain untouched');
    assert.strictEqual(legacyAfterJobs.workflowVersion, 1);

    // Receiver notifications
    const recNotifRes = await requestJson(baseUrl, 'GET', '/api/notifications', { token: receiverToken });
    assert.strictEqual(recNotifRes.status, 200);
    assert(recNotifRes.data.notifications.length >= 2);
    assert(recNotifRes.data.notifications.every((n) => n.recipientEmail === receiverEmail), 'Must only return logged-in user notifications');
    assert(recNotifRes.data.unreadCount >= 2);

    // Sender cannot mark receiver's notification as read -> 404
    const recNotifId = recNotifRes.data.notifications[0]._id;
    const crossRead = await requestJson(baseUrl, 'POST', `/api/notifications/${recNotifId}/read`, { token: senderToken, body: {} });
    assert.strictEqual(crossRead.status, 404, 'User must NOT be able to mark another user notification read');

    // Receiver marks one read -> unread count decrements and persists
    const singleRead = await requestJson(baseUrl, 'POST', `/api/notifications/${recNotifId}/read`, { token: receiverToken, body: {} });
    assert.strictEqual(singleRead.status, 200);
    assert.strictEqual(singleRead.data.notification.isRead, true);

    const bootstrapRes = await requestJson(baseUrl, 'GET', '/api/bootstrap', { token: receiverToken });
    assert.strictEqual(bootstrapRes.status, 200);
    assert(bootstrapRes.data.serverNow, 'Bootstrap must return authoritative serverNow');
    assert.strictEqual(bootstrapRes.data.unreadNotificationCount, singleRead.data.unreadCount);

    // Mark all read
    const readAllRes = await requestJson(baseUrl, 'POST', '/api/notifications/read-all', { token: receiverToken, body: {} });
    assert.strictEqual(readAllRes.status, 200);
    assert.strictEqual(readAllRes.data.unreadCount, 0);

    // Dismiss & Undo (Restore) verification
    const crossDismiss = await requestJson(baseUrl, 'POST', `/api/notifications/${recNotifId}/dismiss`, { token: senderToken, body: {} });
    assert.strictEqual(crossDismiss.status, 404, 'User must NOT be able to dismiss another user notification');

    const totalBeforeDismiss = recNotifRes.data.notifications.length;
    const singleDismiss = await requestJson(baseUrl, 'POST', `/api/notifications/${recNotifId}/dismiss`, { token: receiverToken, body: {} });
    assert.strictEqual(singleDismiss.status, 200);
    assert.strictEqual(singleDismiss.data.notification.isDismissed, true);

    const afterSingleDismiss = await requestJson(baseUrl, 'GET', '/api/notifications', { token: receiverToken });
    assert.strictEqual(afterSingleDismiss.data.notifications.length, totalBeforeDismiss - 1, 'Dismissed notification must stay hidden across fetches');

    const singleRestore = await requestJson(baseUrl, 'POST', `/api/notifications/${recNotifId}/restore`, { token: receiverToken, body: {} });
    assert.strictEqual(singleRestore.status, 200);
    assert.strictEqual(singleRestore.data.notification.isDismissed, false);

    const afterRestore = await requestJson(baseUrl, 'GET', '/api/notifications', { token: receiverToken });
    assert.strictEqual(afterRestore.data.notifications.length, totalBeforeDismiss, 'Restored notification must reappear after Undo');

    const dismissAllRes = await requestJson(baseUrl, 'POST', '/api/notifications/dismiss-all', { token: receiverToken, body: {} });
    assert.strictEqual(dismissAllRes.status, 200);
    assert.strictEqual(dismissAllRes.data.dismissedIds.length, totalBeforeDismiss);
    const afterDismissAll = await requestJson(baseUrl, 'GET', '/api/notifications', { token: receiverToken });
    assert.strictEqual(afterDismissAll.data.notifications.length, 0);

    const restoreBatchRes = await requestJson(baseUrl, 'POST', '/api/notifications/restore-batch', {
      token: receiverToken,
      body: { notificationIds: dismissAllRes.data.dismissedIds }
    });
    assert.strictEqual(restoreBatchRes.status, 200);
    assert.strictEqual(restoreBatchRes.data.notifications.length, totalBeforeDismiss);
    console.log('✅ Test 7 Passed: Notification Centre isolation, persistence, dismiss, undo/restore, serverNow, and legacy v1 preservation verified.');

    // =========================================================================
    // TEST 8: JSDOM Frontend Notification Bell + Graceful 48h Expiry UI Hiding
    // =========================================================================
    console.log('--- Test 8: Frontend UI Bell & Server-Clock Expiry Hiding ---');
    const htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const coreJs = fs.readFileSync(path.join(__dirname, '../public/js/core-and-telemetry.js'), 'utf8');
    const dashJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');
    const groupsJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');

    const dom = new JSDOM(htmlContent, { url: 'https://vasool.test/', runScripts: 'outside-only' });
    const win = dom.window;
    assert(win.document.getElementById('btnNotificationBell'), 'Notification bell button must exist in index.html');
    assert(win.document.getElementById('notificationCenterPanel'), 'Notification popover panel must exist in index.html');
    assert(win.document.getElementById('btnDismissAllNotifications'), 'Dismiss all button must exist in notification header');
    assert(win.document.getElementById('notificationUndoBar'), 'Bottom undo bar must exist in index.html');
    assert(win.document.getElementById('btnUndoNotificationDismiss'), 'Undo button must exist in bottom undo bar');
    assert(win.document.getElementById('rejectSettleModeInput'), 'Dispute/Reject mode hidden input must exist');
    assert(dashJs.includes('5000') && dashJs.includes('undoLastNotificationDismiss') && dashJs.includes('dismissNotification'), '5-second dismiss + undo handlers must exist in dashboard-and-expenses.js');

    // Verify getSettlementTimingMeta strictly follows server clock and hides Report Not Received after 48h
    const baseServerNow = Date.parse('2026-11-26T12:00:00.000Z');
    const timingHarness = {
      getServerNowMs: () => baseServerNow,
      evaluate: null
    };
    const metaMatch = groupsJs.match(/function getSettlementTimingMeta\(s\) \{[\s\S]*?\n    \}/);
    assert(metaMatch, 'getSettlementTimingMeta function must exist in groups-and-modals.js');
    const fn = new Function('getServerNowMs', `${metaMatch[0]}; return getSettlementTimingMeta;`)(() => timingHarness.getServerNowMs());

    const activeMeta = fn({
      workflowVersion: 2,
      status: 'pending_confirmation',
      notifyAfterAt: '2026-11-26T11:30:00.000Z',
      gracePeriodEndsAt: '2026-11-28T11:30:00.000Z',
      receiverNotifiedAt: '2026-11-26T11:31:00.000Z'
    });
    assert.strictEqual(activeMeta.isGraceActive, true);
    assert.strictEqual(activeMeta.canDispute, true);
    assert.strictEqual(activeMeta.isGraceExpired, false);

    timingHarness.getServerNowMs = () => Date.parse('2026-11-28T11:30:01.000Z');
    const expiredMeta = fn({
      workflowVersion: 2,
      status: 'pending_confirmation',
      notifyAfterAt: '2026-11-26T11:30:00.000Z',
      gracePeriodEndsAt: '2026-11-28T11:30:00.000Z',
      receiverNotifiedAt: '2026-11-26T11:31:00.000Z'
    });
    assert.strictEqual(expiredMeta.isGraceExpired, true);
    assert.strictEqual(expiredMeta.canDispute, false, 'Report Not Received MUST be hidden/disabled after 48h server clock');
    assert(coreJs.includes('updateServerClockOffset') && dashJs.includes('renderNotificationCenter'));
    console.log('✅ Test 8 Passed: Notification bell UI + server-time grace expiry UI behavior verified.\n');

    console.log('🎉 ALL 8 GRACE PERIOD, REVERT, DISPUTE & NOTIFICATION CENTRE TESTS PASSED SUCCESSFULLY!');
  } finally {
    delete global.__vasoolCapturedTestEmails;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (createdGroupIds.length > 0) {
      await Notification.deleteMany({ groupId: { $in: createdGroupIds } });
      await Settlement.deleteMany({ groupId: { $in: createdGroupIds } });
      await Expense.deleteMany({ groupId: { $in: createdGroupIds } });
      await Group.deleteMany({ _id: { $in: createdGroupIds } });
    }
    await User.deleteMany({ email: { $in: [adminEmail, senderEmail, receiverEmail] } });
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
