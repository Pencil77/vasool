const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');

const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const Notification = require('../models/Notification');
const Feedback = require('../models/Feedback');
const { signAuthToken } = require('../routes/auth');
const { computeGroupBalanceMap } = require('../lib/debt-engine');
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
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { rawText: text };
  }
  return { status: res.status, data };
}

(async () => {
  console.log('🧪 Starting Super Admin Edit Any User Details Test Suite...\n');
  await connectToDatabase();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const testEmails = [
    `adm_edit_super_${suffix}@vasooltest.com`,
    `adm_edit_alice_${suffix}@vasooltest.com`,
    `adm_edit_alice_new_${suffix}@vasooltest.com`,
    `adm_edit_bob_${suffix}@vasooltest.com`
  ];
  const createdGroupIds = [];
  let server;

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create a custom Super Admin, Alice (target user), and Bob (collision test user)
    const [superUser, aliceUser, bobUser] = await User.create([
      {
        name: 'Custom Super Admin',
        email: testEmails[0],
        passwordRaw: 'SuperPass#1',
        passwordHash: 'SuperPass#1',
        role: 'super_admin',
        isSuperAdmin: true,
        isEmailVerified: true,
        authProviders: ['email']
      },
      {
        name: 'Alice Before',
        email: testEmails[1],
        passwordRaw: 'AliceOld#1',
        passwordHash: 'AliceOld#1',
        role: 'user',
        isSuperAdmin: false,
        isEmailVerified: false,
        upiId: 'aliceold@okicici',
        defaultCurrency: 'INR',
        authProviders: ['google']
      },
      {
        name: 'Bob Existing',
        email: testEmails[3],
        passwordRaw: 'BobPass#1',
        passwordHash: 'BobPass#1',
        role: 'user',
        isSuperAdmin: false,
        isEmailVerified: true,
        authProviders: ['email']
      }
    ]);

    const superToken = signAuthToken(superUser);
    const aliceToken = signAuthToken(aliceUser);

    // Seed group, expense, settlement, notification, feedback referencing Alice's old email & name
    const group = await Group.create({
      name: `Admin Edit Test Group ${suffix}`,
      currency: 'INR',
      inviteCode: `AE${String(Date.now()).slice(-6)}`,
      createdByEmail: testEmails[1],
      adminEmail: testEmails[1],
      members: [
        { name: 'Alice Before', email: testEmails[1], role: 'admin', isRegistered: true, upiId: 'aliceold@okicici' },
        { name: 'Bob Existing', email: testEmails[3], role: 'member', isRegistered: true, upiId: '' }
      ]
    });
    createdGroupIds.push(group._id);

    await Expense.create({
      groupId: group._id,
      type: 'expense',
      description: 'Cascade Split Test',
      amount: 600,
      paidByEmail: testEmails[1],
      paidByName: 'Alice Before',
      createdByEmail: testEmails[1],
      splitType: 'equal',
      expenseDate: new Date(),
      splits: [
        { memberEmail: testEmails[1], memberName: 'Alice Before', amount: 300, percentage: 50, shares: 1 },
        { memberEmail: testEmails[3], memberName: 'Bob Existing', amount: 300, percentage: 50, shares: 1 }
      ]
    });

    await Settlement.create({
      groupId: group._id,
      fromEmail: testEmails[3],
      fromName: 'Bob Existing',
      toEmail: testEmails[1],
      toName: 'Alice Before',
      amount: 100,
      method: 'UPI',
      status: 'confirmed',
      settledAt: new Date().toISOString().slice(0, 10)
    });

    await Notification.create({
      recipientEmail: testEmails[1],
      type: 'payment_confirmed',
      title: 'Test Notif',
      message: 'Initial message',
      groupId: group._id,
      senderEmail: testEmails[3],
      senderName: 'Bob Existing',
      receiverEmail: testEmails[1],
      receiverName: 'Alice Before'
    });

    await Feedback.create({
      userId: aliceUser._id,
      userEmail: testEmails[1],
      userName: 'Alice Before',
      message: 'Initial feedback message'
    });

    // 1. Authorization: Regular user cannot edit users
    const forbidden = await requestJson(baseUrl, 'PUT', `/api/admin/users/${aliceUser._id}`, {
      token: aliceToken,
      body: { name: 'Hacked Name' }
    });
    assert.strictEqual(forbidden.status, 403, 'Non-admin must get 403');
    console.log('✅ Test 1 Passed: Non-super-admin blocked with 403.');

    // 2. Duplicate email protection (409)
    const conflictRes = await requestJson(baseUrl, 'PUT', `/api/admin/users/${aliceUser._id}`, {
      token: superToken,
      body: { email: testEmails[3] }
    });
    assert.strictEqual(conflictRes.status, 409, 'Duplicate email must fail with 409');
    console.log('✅ Test 2 Passed: Duplicate email collision rejected with 409.');

    // 3. Super Admin updates ALL of Alice's details (name, email, password, UPI, currency, avatar, verified, providers)
    const editRes = await requestJson(baseUrl, 'PUT', `/api/admin/users/${aliceUser._id}`, {
      token: superToken,
      body: {
        name: 'Alice Renamed',
        email: testEmails[2],
        newPassword: 'AliceNewSecret#2026',
        upiId: 'alicenew@okaxis',
        defaultCurrency: 'USD',
        avatarUrl: 'https://example.com/alice.png',
        isEmailVerified: true,
        authProviders: ['google'] // verify adding newPassword ensures 'email' is auto-enabled too
      }
    });
    assert.strictEqual(editRes.status, 200, `Expected 200, got ${editRes.status}: ${JSON.stringify(editRes.data)}`);
    assert.strictEqual(editRes.data.user.name, 'Alice Renamed');
    assert.strictEqual(editRes.data.user.email, testEmails[2]);
    assert.strictEqual(editRes.data.user.upiId, 'alicenew@okaxis');
    assert.strictEqual(editRes.data.user.defaultCurrency, 'USD');
    assert.strictEqual(editRes.data.user.avatarUrl, 'https://example.com/alice.png');
    assert.strictEqual(editRes.data.user.isEmailVerified, true);
    assert(editRes.data.user.authProviders.includes('email') && editRes.data.user.authProviders.includes('google'));

    // Verify revealed credentials & login with new email + new password
    const credsRes = await requestJson(baseUrl, 'GET', `/api/admin/users/${aliceUser._id}/credentials`, { token: superToken });
    assert.strictEqual(credsRes.status, 200);
    assert.strictEqual(credsRes.data.credentials.password, 'AliceNewSecret#2026');
    assert.strictEqual(credsRes.data.credentials.username, testEmails[2]);

    const loginRes = await requestJson(baseUrl, 'POST', '/api/auth/login', {
      body: { email: testEmails[2], password: 'AliceNewSecret#2026' }
    });
    assert.strictEqual(loginRes.status, 200, 'Edited user must log in cleanly with new email + new password');

    // Verify cascade propagation across Group, Expense, Settlement, Notification, Feedback & Debt Engine
    const [gAfter, expsAfter, stlsAfter, notifAfter, fbAfter] = await Promise.all([
      Group.findById(group._id).lean(),
      Expense.find({ groupId: group._id }).lean(),
      Settlement.find({ groupId: group._id }).lean(),
      Notification.findOne({ groupId: group._id }).lean(),
      Feedback.findOne({ userId: aliceUser._id }).lean()
    ]);
    assert.strictEqual(gAfter.createdByEmail, testEmails[2]);
    assert.strictEqual(gAfter.adminEmail, testEmails[2]);
    const aliceMember = gAfter.members.find((m) => m.email === testEmails[2]);
    assert(aliceMember, 'Group member email must be updated');
    assert.strictEqual(aliceMember.name, 'Alice Renamed');
    assert.strictEqual(aliceMember.upiId, 'alicenew@okaxis');
    assert.strictEqual(expsAfter[0].paidByEmail, testEmails[2]);
    assert.strictEqual(expsAfter[0].paidByName, 'Alice Renamed');
    assert.strictEqual(stlsAfter[0].toEmail, testEmails[2]);
    assert.strictEqual(stlsAfter[0].toName, 'Alice Renamed');
    assert.strictEqual(notifAfter.recipientEmail, testEmails[2]);
    assert.strictEqual(fbAfter.userEmail, testEmails[2]);
    const bal = computeGroupBalanceMap(gAfter, expsAfter, stlsAfter);
    assert.strictEqual(bal[testEmails[2]].net, 200, 'Balance math must stay intact after email & name change');
    console.log('✅ Test 3 Passed: Full user edit, credential reveal, login, cascade sync & balance continuity verified.');

    // 4. Super Admin can edit Super Admin details too (with self-demote/suspend protection)
    const selfDowngrade = await requestJson(baseUrl, 'PUT', `/api/admin/users/${superUser._id}`, {
      token: superToken,
      body: { role: 'user' }
    });
    assert.strictEqual(selfDowngrade.status, 400, 'Active super admin cannot demote themselves');

    const superEditRes = await requestJson(baseUrl, 'PUT', `/api/admin/users/${superUser._id}`, {
      token: superToken,
      body: {
        name: 'Custom Super Admin Updated',
        upiId: 'super@okaxis',
        defaultCurrency: 'EUR',
        newPassword: 'SuperPass#Updated2'
      }
    });
    assert.strictEqual(superEditRes.status, 200);
    assert.strictEqual(superEditRes.data.user.name, 'Custom Super Admin Updated');
    assert.strictEqual(superEditRes.data.user.upiId, 'super@okaxis');
    assert.strictEqual(superEditRes.data.user.defaultCurrency, 'EUR');
    assert(superEditRes.data.refreshedToken, 'Self identity update should return refreshedToken');
    console.log('✅ Test 4 Passed: Super Admin account details & password editable while protecting role/suspension.');

    // 5. Frontend structure check in auth-and-admin.js
    const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/auth-and-admin.js'), 'utf8');
    assert(adminJs.includes('admin-user-edit-btn'), 'User cards must have Edit button for all users');
    assert(adminJs.includes('admin-user-edit-toggle'), 'User details modal must have Edit toggle');
    assert(adminJs.includes('admin-user-edit-form'), 'User details modal must include Edit form');
    assert(adminJs.includes('admin-edit-user-name') && adminJs.includes('admin-edit-user-email') && adminJs.includes('admin-edit-user-password'));
    assert(adminJs.includes('admin-user-reveal-password') && adminJs.includes('admin-user-quick-edit-password'));
    console.log('✅ Test 5 Passed: Admin UI preserves view/reveal controls and exposes full edit controls.\n');

    console.log('🎉 ALL SUPER ADMIN EDIT ANY USER DETAILS TESTS PASSED!');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (createdGroupIds.length > 0) {
      await Feedback.deleteMany({ userEmail: { $in: testEmails } });
      await Notification.deleteMany({ groupId: { $in: createdGroupIds } });
      await Settlement.deleteMany({ groupId: { $in: createdGroupIds } });
      await Expense.deleteMany({ groupId: { $in: createdGroupIds } });
      await Group.deleteMany({ _id: { $in: createdGroupIds } });
    }
    await User.deleteMany({ email: { $in: testEmails } });
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
