const assert = require('assert');
const http = require('http');
const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const { authRouter, requireAuth } = require('../routes/auth');
const { splitsRouter } = require('../routes/splits');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api', splitsRouter);

let server;
let baseUrl;

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== STARTING VASOOL LIFECYCLE & INVITATION VERIFICATION SUITE ===\n');

  await connectToDatabase();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  const testSuffix = Date.now();
  const adminEmail = `admin_test_${testSuffix}@vasooltest.com`;
  const memberEmail = `member_test_${testSuffix}@vasooltest.com`;
  const thirdEmail = `third_test_${testSuffix}@vasooltest.com`;
  const unregEmail = `unregistered_${testSuffix}@example.com`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unified Sign In / Sign Up (Auto-creation of non-existing user)
    // -------------------------------------------------------------------------
    console.log('▶ TEST 1: Unified Sign In (Signing in without signing up beforehand)...');
    const adminLoginRes = await request('POST', '/api/auth/login', {
      email: adminEmail,
      password: 'SecurePassword123!',
      name: 'Admin Zoro Test',
      upiId: 'admin@okicici'
    });
    assert.strictEqual(adminLoginRes.status, 200, 'Expected 200 OK for auto-signup on login');
    assert.ok(adminLoginRes.body.token, 'Token must be returned');
    assert.strictEqual(adminLoginRes.body.user.name, 'Admin Zoro Test', 'Name must be recorded');
    assert.strictEqual(adminLoginRes.body.user.email, adminEmail, 'Email must match');
    assert.strictEqual(adminLoginRes.body.user.upiId, 'admin@okicici', 'UPI ID must be recorded');
    const adminToken = adminLoginRes.body.token;
    console.log('  ✓ Admin account automatically created & details recorded on sign-in');

    // -------------------------------------------------------------------------
    // TEST 2: Member auto-signup on sign-in
    // -------------------------------------------------------------------------
    console.log('▶ TEST 2: Member auto-signup on sign-in...');
    const memberLoginRes = await request('POST', '/api/auth/login', {
      email: memberEmail,
      password: 'MemberPassword123!',
      name: 'Pavan Sai Test'
    });
    assert.strictEqual(memberLoginRes.status, 200);
    const memberToken = memberLoginRes.body.token;
    console.log('  ✓ Member account automatically created & logged in seamlessly');

    // -------------------------------------------------------------------------
    // TEST 3: Autocomplete & Email Check Endpoints
    // -------------------------------------------------------------------------
    console.log('▶ TEST 3: User search autocomplete and email checking...');
    const searchRes = await request('GET', `/api/users/search?q=Pavan`, null, adminToken);
    assert.strictEqual(searchRes.status, 200);
    assert.ok(Array.isArray(searchRes.body.users), 'Must return users array');
    const foundMember = searchRes.body.users.find((u) => u.email === memberEmail);
    assert.ok(foundMember, 'Search must find registered member');
    console.log(`  ✓ Search autocomplete found: ${foundMember.name} (${foundMember.email})`);

    const checkRegRes = await request('GET', `/api/users/check-email?email=${encodeURIComponent(memberEmail)}`, null, adminToken);
    assert.strictEqual(checkRegRes.body.exists, true, 'Registered user must return exists: true');

    const checkUnregRes = await request('GET', `/api/users/check-email?email=${encodeURIComponent(unregEmail)}`, null, adminToken);
    assert.strictEqual(checkUnregRes.body.exists, false, 'Unregistered email must return exists: false');
    console.log('  ✓ Email registration check verified (exists: true vs exists: false)');

    // -------------------------------------------------------------------------
    // TEST 4: Group Creation with Creator 'active' & Invited Members 'pending_acceptance'
    // -------------------------------------------------------------------------
    console.log('▶ TEST 4: Group creation member status validation...');
    const groupCreateRes = await request(
      'POST',
      '/api/groups',
      {
        name: `Goa Trip ${testSuffix}`,
        category: 'Trip',
        members: [{ name: 'Pavan Sai Test', email: memberEmail }]
      },
      adminToken
    );
    assert.strictEqual(groupCreateRes.status, 201);
    const group = groupCreateRes.body.group;
    const adminInGroup = group.members.find((m) => m.email === adminEmail);
    const memberInGroup = group.members.find((m) => m.email === memberEmail);

    assert.strictEqual(adminInGroup.status, 'active', 'Group creator must have status: active');
    assert.strictEqual(memberInGroup.status, 'pending_acceptance', 'Invited member must have status: pending_acceptance');
    assert.strictEqual(group.allowMembersToAddOthers, false, 'allowMembersToAddOthers must default to false');
    console.log('  ✓ Creator is active; invited member is strictly pending_acceptance');

    // -------------------------------------------------------------------------
    // TEST 5: Non-Admin Member Adding Permission Check (Must be 403 by default)
    // -------------------------------------------------------------------------
    console.log('▶ TEST 5: Non-admin member adding others when allowMembersToAddOthers is false...');
    const nonAdminAddRes = await request(
      'POST',
      `/api/groups/${group._id}/members`,
      { name: 'Third Person', email: thirdEmail },
      memberToken
    );
    assert.strictEqual(nonAdminAddRes.status, 403, 'Non-admin member should get 403 Forbidden');
    console.log('  ✓ Non-admin member correctly blocked from adding members (403 Forbidden)');

    // -------------------------------------------------------------------------
    // TEST 6: Admin Updates Group Settings (Toggles allowMembersToAddOthers)
    // -------------------------------------------------------------------------
    console.log('▶ TEST 6: Admin updates group settings to allow members to add others...');
    const settingsRes = await request(
      'PATCH',
      `/api/groups/${group._id}/settings`,
      { allowMembersToAddOthers: true },
      adminToken
    );
    assert.strictEqual(settingsRes.status, 200);
    assert.strictEqual(settingsRes.body.group.allowMembersToAddOthers, true);
    console.log('  ✓ Group settings updated: allowMembersToAddOthers is now true');

    // -------------------------------------------------------------------------
    // TEST 7: Non-Admin Member Adding Others Now Allowed & Set as pending_acceptance
    // -------------------------------------------------------------------------
    console.log('▶ TEST 7: Non-admin member adds another user after permission granted...');
    const nonAdminAddAllowedRes = await request(
      'POST',
      `/api/groups/${group._id}/members`,
      { name: 'Third Person', email: thirdEmail },
      memberToken
    );
    assert.strictEqual(nonAdminAddAllowedRes.status, 200);
    const thirdInGroup = nonAdminAddAllowedRes.body.group.members.find((m) => m.email === thirdEmail);
    assert.strictEqual(thirdInGroup.status, 'pending_acceptance');
    console.log('  ✓ Non-admin member successfully invited third person with status: pending_acceptance');

    // -------------------------------------------------------------------------
    // TEST 8: Member Listing & Pending Invites Filter
    // -------------------------------------------------------------------------
    console.log('▶ TEST 8: Verifying GET /api/groups separates active groups and pendingInvites...');
    const memberGroupsRes = await request('GET', '/api/groups', null, memberToken);
    assert.strictEqual(memberGroupsRes.status, 200);
    assert.ok(Array.isArray(memberGroupsRes.body.pendingInvites), 'pendingInvites array must be present');
    const hasPendingInvite = memberGroupsRes.body.pendingInvites.some((g) => g._id === group._id);
    assert.strictEqual(hasPendingInvite, true, 'Group must appear in member pendingInvites');
    console.log('  ✓ Pending group invite correctly listed in pendingInvites');

    // -------------------------------------------------------------------------
    // TEST 9: Member Accepts Group Invitation
    // -------------------------------------------------------------------------
    console.log('▶ TEST 9: Member accepts group invitation (POST /api/groups/:id/accept-invite)...');
    const acceptRes = await request('POST', `/api/groups/${group._id}/accept-invite`, {}, memberToken);
    assert.strictEqual(acceptRes.status, 200);
    const acceptedMember = acceptRes.body.group.members.find((m) => m.email === memberEmail);
    assert.strictEqual(acceptedMember.status, 'active', 'Member status must transition to active');
    assert.ok(acceptedMember.acceptedAt, 'acceptedAt timestamp must be set');
    console.log('  ✓ Member successfully accepted invitation! Status transitioned to active.');

    // -------------------------------------------------------------------------
    // TEST 10: Third Person Declines Group Invitation
    // -------------------------------------------------------------------------
    console.log('▶ TEST 10: Third person auto-sign-in and declines invitation...');
    const thirdLogin = await request('POST', '/api/auth/login', {
      email: thirdEmail,
      password: 'ThirdPassword123!',
      name: 'Third Person'
    });
    const thirdToken = thirdLogin.body.token;

    const declineRes = await request('POST', `/api/groups/${group._id}/decline-invite`, {}, thirdToken);
    assert.strictEqual(declineRes.status, 200);
    const thirdStillInGroup = declineRes.body.group.members.some((m) => m.email === thirdEmail);
    assert.strictEqual(thirdStillInGroup, false, 'Declined member must be removed from group');
    console.log('  ✓ Declined member successfully removed from group');

    console.log('\n===============================================================');
    console.log('🎉 ALL 10 TESTS PASSED WITH 100% SUCCESS!');
    console.log('===============================================================\n');
  } finally {
    // Clean up test data
    try {
      await User.deleteMany({ email: { $in: [adminEmail, memberEmail, thirdEmail] } });
      await Group.deleteMany({ createdByEmail: adminEmail });
    } catch {}
    if (server) server.close();
  }
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  if (server) server.close();
  process.exit(1);
});
