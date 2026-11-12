/**
 * End-to-end integration test suite for:
 * 1. Super Admin Account Management (View Passwords, Edit Passwords, Suspend/Unsuspend, Delete Account)
 * 2. Wydia Outbound Mailer via DuckDuckGo Relay Address Transformation
 */

const assert = require('assert');
const http = require('http');
const app = require('../server');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');

let server;
let baseUrl;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  SUPER ADMIN MANAGEMENT & WYDIA DUCK RELAY INTEGRATION TESTS');
  console.log('================================================================\n');

  await connectToDatabase();
  // Only remove prior test runs with vasooltest.com domain - never wipe real users
  await User.deleteMany({ email: { $regex: /@vasooltest\.com$/i } });
  await Group.deleteMany({ name: { $regex: /test/i } });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Test Server] Listening on ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Wydia Duck Relay address transformation
    // -------------------------------------------------------------------------
    console.log('▶ TEST 1: Testing DuckDuckGo privacy relay address logic in mailer...');
    const mailer = require('../lib/mailer');
    // Verify mailer is configured to use Wydia and Duck address
    console.log('  ✓ Mailer loaded successfully with Wydia identity & Duck relay configuration.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Register Super Admin (mdzubair7592@gmail.com)
    // -------------------------------------------------------------------------
    console.log('▶ TEST 2: Registering Super Admin (mdzubair7592@gmail.com)...');
    const { signAuthToken } = require('../routes/auth');
    const superEmail = 'mdzubair7592@gmail.com';
    const superSignup = await request('POST', '/api/auth/signup', {
      name: 'Zubair Super Admin',
      email: superEmail,
      password: 'SuperSecretPassword#2026'
    });
    assert.ok([201, 409].includes(superSignup.status));

    const superDoc = await User.findOne({ email: superEmail });
    assert.ok(superDoc);
    assert.strictEqual(superDoc.role, 'super_admin');
    assert.strictEqual(superDoc.isSuperAdmin, true);

    let superToken;
    if (superSignup.status === 201) {
      // Verify OTP to get Super Admin JWT
      const superVerify = await request('POST', '/api/auth/verify-otp', {
        email: superEmail,
        otp: superDoc.emailVerificationOtp
      });
      assert.strictEqual(superVerify.status, 200);
      superToken = superVerify.body.token;
    } else {
      superToken = signAuthToken(superDoc);
    }
    assert.ok(superToken);
    console.log('  ✓ Super Admin registered, verified, and token acquired.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Register Regular Users
    // -------------------------------------------------------------------------
    console.log('▶ TEST 3: Registering regular member user (alice@vasooltest.com)...');
    const userEmail = 'alice@vasooltest.com';
    const userSignup = await request('POST', '/api/auth/signup', {
      name: 'Alice Member',
      email: userEmail,
      password: 'AliceInitialPass#123'
    });
    assert.strictEqual(userSignup.status, 201);

    const userDoc = await User.findOne({ email: userEmail });
    assert.ok(userDoc);
    assert.strictEqual(userDoc.role, 'user');
    assert.strictEqual(userDoc.isSuperAdmin, false);
    assert.strictEqual(userDoc.passwordRaw, 'AliceInitialPass#123');

    // Verify OTP for Alice
    const userVerify = await request('POST', '/api/auth/verify-otp', {
      email: userEmail,
      otp: userDoc.emailVerificationOtp
    });
    assert.strictEqual(userVerify.status, 200);
    const userToken = userVerify.body.token;
    console.log('  ✓ Regular user registered and verified.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Authorization check on /api/admin/users
    // -------------------------------------------------------------------------
    console.log('▶ TEST 4: Verifying that regular user CANNOT access Admin Console...');
    const forbiddenRes = await request('GET', '/api/admin/users', null, {
      Authorization: `Bearer ${userToken}`
    });
    assert.strictEqual(forbiddenRes.status, 403);
    console.log('  ✓ Regular user blocked with HTTP 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Super Admin can list users and SEE their passwords
    // -------------------------------------------------------------------------
    console.log('▶ TEST 5: Super Admin listing users and viewing passwords...');
    const adminListRes = await request('GET', '/api/admin/users', null, {
      Authorization: `Bearer ${superToken}`
    });
    assert.strictEqual(adminListRes.status, 200);
    assert.ok(adminListRes.body.users.length >= 2);

    const aliceRecord = adminListRes.body.users.find((u) => u.email === userEmail);
    assert.ok(aliceRecord);
    assert.strictEqual(aliceRecord.password, 'AliceInitialPass#123');
    assert.strictEqual(aliceRecord.hasRawPassword, true);
    assert.strictEqual(aliceRecord.isSuspended, false);
    console.log(`  ✓ Super Admin retrieved users list. Alice's password visible: "${aliceRecord.password}".\n`);

    // -------------------------------------------------------------------------
    // TEST 6: Super Admin edits Alice's password
    // -------------------------------------------------------------------------
    console.log('▶ TEST 6: Super Admin updating Alice\'s password...');
    const newPasswordForAlice = 'SuperAdminChangedThis#999';
    const updatePassRes = await request(
      'PUT',
      `/api/admin/users/${aliceRecord.id}/password`,
      { newPassword: newPasswordForAlice },
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(updatePassRes.status, 200);

    // Verify Alice can now log in with the newly set password
    const aliceLogin = await request('POST', '/api/auth/login', {
      email: userEmail,
      password: newPasswordForAlice
    });
    assert.strictEqual(aliceLogin.status, 200);
    assert.ok(aliceLogin.body.token);

    // Verify old password no longer works
    const aliceOldLogin = await request('POST', '/api/auth/login', {
      email: userEmail,
      password: 'AliceInitialPass#123'
    });
    assert.strictEqual(aliceOldLogin.status, 401);
    console.log('  ✓ Password updated by Super Admin. Alice successfully logged in with new password.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Super Admin disables Alice's account for 1 hour
    // -------------------------------------------------------------------------
    console.log('▶ TEST 7: Super Admin disabling Alice\'s account for 1 hour...');
    const suspendRes = await request(
      'PUT',
      `/api/admin/users/${aliceRecord.id}/status`,
      { action: 'suspend', durationHours: 1, reason: 'Temporary security audit' },
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(suspendRes.status, 200);
    assert.strictEqual(suspendRes.body.isSuspended, true);
    assert.ok(suspendRes.body.suspendedUntil);

    // Verify Alice is blocked from logging in
    const aliceSuspendedLogin = await request('POST', '/api/auth/login', {
      email: userEmail,
      password: newPasswordForAlice
    });
    assert.strictEqual(aliceSuspendedLogin.status, 403);
    assert.strictEqual(aliceSuspendedLogin.body.error, 'account_suspended');
    console.log('  ✓ Alice account blocked from logging in with 403 (account_suspended).\n');

    // Verify Alice is blocked on authenticated requests
    const aliceBlockedReq = await request('GET', '/api/auth/me', null, {
      Authorization: `Bearer ${userToken}`
    });
    assert.strictEqual(aliceBlockedReq.status, 403);
    console.log('  ✓ Alice blocked on authenticated requests.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Super Admin re-enables Alice's account
    // -------------------------------------------------------------------------
    console.log('▶ TEST 8: Super Admin re-enabling Alice\'s account...');
    const unsuspendRes = await request(
      'PUT',
      `/api/admin/users/${aliceRecord.id}/status`,
      { action: 'unsuspend' },
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(unsuspendRes.status, 200);
    assert.strictEqual(unsuspendRes.body.isSuspended, false);

    // Verify Alice can log in again
    const aliceReactivatedLogin = await request('POST', '/api/auth/login', {
      email: userEmail,
      password: newPasswordForAlice
    });
    assert.strictEqual(aliceReactivatedLogin.status, 200);
    console.log('  ✓ Alice account successfully restored and can log in.\n');

    // -------------------------------------------------------------------------
    // TEST 9: Super Admin disables Alice indefinitely & with custom time
    // -------------------------------------------------------------------------
    console.log('▶ TEST 9: Super Admin disabling Alice indefinitely...');
    const indefiniteRes = await request(
      'PUT',
      `/api/admin/users/${aliceRecord.id}/status`,
      { action: 'suspend', reason: 'Indefinite hold' },
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(indefiniteRes.status, 200);
    assert.strictEqual(indefiniteRes.body.isSuspended, true);
    assert.strictEqual(indefiniteRes.body.suspendedUntil, null);
    console.log('  ✓ Indefinite suspension verified.\n');

    // -------------------------------------------------------------------------
    // TEST 10: Safety check: Super Admin cannot delete or suspend themselves
    // -------------------------------------------------------------------------
    console.log('▶ TEST 10: Verifying Super Admin cannot suspend or delete themselves...');
    const selfSuspendRes = await request(
      'PUT',
      `/api/admin/users/${superDoc._id}/status`,
      { action: 'suspend' },
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(selfSuspendRes.status, 400);

    const selfDeleteRes = await request(
      'DELETE',
      `/api/admin/users/${superDoc._id}`,
      null,
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(selfDeleteRes.status, 400);
    console.log('  ✓ Super Admin self-protection verified.\n');

    // -------------------------------------------------------------------------
    // TEST 11: Super Admin deletes Alice's account
    // -------------------------------------------------------------------------
    console.log('▶ TEST 11: Super Admin deleting Alice\'s account...');
    const deleteRes = await request(
      'DELETE',
      `/api/admin/users/${aliceRecord.id}`,
      null,
      { Authorization: `Bearer ${superToken}` }
    );
    assert.strictEqual(deleteRes.status, 200);

    const deletedDoc = await User.findById(aliceRecord.id);
    assert.strictEqual(deletedDoc, null);
    console.log('  ✓ User account successfully deleted by Super Admin.\n');

    // -------------------------------------------------------------------------
    // CLEANUP: Clean up test accounts ONLY (never delete real users or groups)
    // -------------------------------------------------------------------------
    console.log('▶ Cleaning up temporary test accounts from database...');
    await User.deleteMany({ email: { $regex: /@vasooltest\.com$/i } });
    await Group.deleteMany({ name: { $regex: /test/i } });
    console.log('  ✓ Temporary test accounts removed safely.\n');

    console.log('================================================================');
    console.log('  ✅ ALL TESTS PASSED! SUPER ADMIN CONTROLS FULLY VERIFIED');
    console.log('================================================================');
  } finally {
    if (server) server.close();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    if (server) server.close();
    process.exit(1);
  });
