const assert = require('assert');
const http = require('http');
const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const { authRouter } = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

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

async function runTestSuite() {
  console.log('================================================================');
  console.log('  VASOOL EMAIL & PASSWORD + OTP AUTHENTICATION TEST SUITE');
  console.log('================================================================\n');

  await connectToDatabase();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Test Server] Listening on ${baseUrl}\n`);

  const suffix = Date.now();
  // Using @vasooltest.com domain so isTestEmail skips real external SMTP
  const testEmail = `zoro_auth_${suffix}@vasooltest.com`;
  const initialPassword = 'InitialSecurePwd2026!';
  const resetPassword = 'ResetSecretPwd2026!';
  const changedPassword = 'ChangedSecretPwd2026!';

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Registration with minlength validation
    // -------------------------------------------------------------------------
    console.log('▶ STEP 1: Testing registration password length validation...');
    const shortPwdRes = await request('POST', '/api/auth/signup', {
      name: 'Zoro Test User',
      email: testEmail,
      password: 'short'
    });
    assert.strictEqual(shortPwdRes.status, 400, 'Expected 400 for password < 8 characters');
    console.log('  ✓ Short password rejected as expected.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Successful Sign Up (Requires OTP Email Verification)
    // -------------------------------------------------------------------------
    console.log('▶ STEP 2: Registering user with Email & Password...');
    const signupRes = await request('POST', '/api/auth/signup', {
      name: 'Zoro Test User',
      email: testEmail,
      password: initialPassword,
      upiId: 'zoro@okaxis'
    });
    assert.strictEqual(signupRes.status, 201, 'Expected 201 Created');
    assert.strictEqual(signupRes.body.requiresVerification, true, 'Must indicate verification required');
    assert.strictEqual(signupRes.body.email, testEmail);

    const createdUser = await User.findOne({ email: testEmail });
    assert.ok(createdUser, 'User document must be created in DB');
    assert.strictEqual(createdUser.isEmailVerified, false, 'Account must start as unverified');
    assert.ok(createdUser.emailVerificationOtp, 'OTP must be generated');
    const signupOtp = createdUser.emailVerificationOtp;
    console.log(`  ✓ User created with isEmailVerified: false, OTP generated: ${signupOtp}\n`);

    // -------------------------------------------------------------------------
    // STEP 3: Attempting Login with unverified account
    // -------------------------------------------------------------------------
    console.log('▶ STEP 3: Attempting login before verifying account...');
    const unverifiedLoginRes = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: initialPassword
    });
    assert.strictEqual(unverifiedLoginRes.status, 200, 'Expected 200 with requiresVerification flag');
    assert.strictEqual(unverifiedLoginRes.body.requiresVerification, true, 'Login must require email verification');
    console.log('  ✓ Login correctly prompted for OTP verification.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Email OTP Verification (Testing fresh OTP from unverified login)
    // -------------------------------------------------------------------------
    console.log('▶ STEP 4: Verifying that old OTP was invalidated by fresh login OTP...');
    const invalidOldOtpRes = await request('POST', '/api/auth/verify-otp', {
      email: testEmail,
      otp: signupOtp
    });
    assert.strictEqual(invalidOldOtpRes.status, 400, 'Expected 400 because fresh OTP was generated on login');
    console.log('  ✓ Old OTP successfully rejected after fresh code generation.');

    const freshUser = await User.findOne({ email: testEmail });
    const freshLoginOtp = freshUser.emailVerificationOtp;
    assert.ok(freshLoginOtp, 'Fresh OTP must exist in DB');

    console.log(`  Submitting fresh 6-digit OTP (${freshLoginOtp}) to verify account...`);
    const verifyRes = await request('POST', '/api/auth/verify-otp', {
      email: testEmail,
      otp: freshLoginOtp
    });
    assert.strictEqual(verifyRes.status, 200, 'Expected 200 OK');
    assert.ok(verifyRes.body.token, 'Auth token must be returned upon verification');
    assert.strictEqual(verifyRes.body.user.email, testEmail);
    assert.strictEqual(verifyRes.body.user.isEmailVerified, true);

    const verifiedUser = await User.findOne({ email: testEmail });
    assert.strictEqual(verifiedUser.isEmailVerified, true, 'User isEmailVerified must now be true');
    console.log('  ✓ Account verified successfully with fresh OTP! Session token received.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Login with verified account
    // -------------------------------------------------------------------------
    console.log('▶ STEP 5: Logging in with verified account...');
    const loginRes = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: initialPassword
    });
    assert.strictEqual(loginRes.status, 200, 'Expected 200 OK');
    assert.ok(loginRes.body.token, 'Token returned');
    assert.strictEqual(loginRes.body.user.name, 'Zoro Test User');
    const authToken = loginRes.body.token;
    console.log('  ✓ Logged in successfully with password.\n');

    // Wrong password test
    const wrongPwdRes = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: 'WrongPassword999!'
    });
    assert.strictEqual(wrongPwdRes.status, 401, 'Expected 401 for wrong password');
    console.log('  ✓ Incorrect password rejected.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Forgot Password Flow (OTP & Reset)
    // -------------------------------------------------------------------------
    console.log('▶ STEP 6: Initiating Forgot Password request...');
    const forgotRes = await request('POST', '/api/auth/forgot-password', {
      email: testEmail
    });
    assert.strictEqual(forgotRes.status, 200, 'Expected 200 OK');

    const resetUser = await User.findOne({ email: testEmail });
    assert.ok(resetUser.passwordResetOtp, 'Password reset OTP must be set');
    const resetOtp = resetUser.passwordResetOtp;
    console.log(`  ✓ Reset OTP generated: ${resetOtp}`);

    console.log('  Executing Password Reset via OTP code...');
    const executeResetRes = await request('POST', '/api/auth/reset-password', {
      email: testEmail,
      otp: resetOtp,
      newPassword: resetPassword
    });
    assert.strictEqual(executeResetRes.status, 200, 'Expected 200 OK');
    assert.ok(executeResetRes.body.token, 'Auth token returned upon password reset');
    console.log('  ✓ Password reset succeeded! Verifying login with new password...');

    const newPwdLoginRes = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: resetPassword
    });
    assert.strictEqual(newPwdLoginRes.status, 200, 'Expected 200 OK with new password');
    const newAuthToken = newPwdLoginRes.body.token;
    console.log('  ✓ Successfully logged in with newly reset password.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Change Password in Account Settings (Authenticated)
    // -------------------------------------------------------------------------
    console.log('▶ STEP 7: Testing Change Password in Account Settings...');
    const changeFailRes = await request('POST', '/api/auth/change-password', {
      currentPassword: 'IncorrectOldPassword!',
      newPassword: changedPassword
    }, newAuthToken);
    assert.strictEqual(changeFailRes.status, 400, 'Expected 400 for incorrect current password');
    console.log('  ✓ Incorrect current password rejected.');

    const changeSuccessRes = await request('POST', '/api/auth/change-password', {
      currentPassword: resetPassword,
      newPassword: changedPassword
    }, newAuthToken);
    assert.strictEqual(changeSuccessRes.status, 200, 'Expected 200 OK for successful password change');
    console.log('  ✓ Password changed in settings! Verifying login with changed password...');

    const changedPwdLoginRes = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: changedPassword
    });
    assert.strictEqual(changedPwdLoginRes.status, 200, 'Expected 200 OK with changed password');
    console.log('  ✓ Logged in with updated password.\n');

    // -------------------------------------------------------------------------
    // STEP 8: Deprecated Google endpoint check
    // -------------------------------------------------------------------------
    console.log('▶ STEP 8: Verifying legacy Google Sign-In endpoint status...');
    const googleRes = await request('POST', '/api/auth/google', { credential: 'dummy' });
    assert.strictEqual(googleRes.status, 410, 'Expected 410 Gone for removed Google endpoint');
    console.log('  ✓ Google endpoint properly disabled with HTTP 410 Gone.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Hardcoded Super Admin Verification (mdzubair7592@gmail.com)
    // -------------------------------------------------------------------------
    console.log('▶ STEP 9: Verifying hardcoded Super Admin designation for mdzubair7592@gmail.com...');
    const superAdminEmail = 'mdzubair7592@gmail.com';
    const superSignup = await request('POST', '/api/auth/signup', {
      name: 'Zoro',
      email: superAdminEmail,
      password: 'ZoroSuperSecret2026!'
    });
    assert.ok([200, 201, 409].includes(superSignup.status), 'Expected 200, 201, or 409 for signup');
    const superDoc = await User.findOne({ email: superAdminEmail });
    assert.ok(superDoc, 'Super Admin user must exist in DB');
    assert.strictEqual(superDoc.role, 'super_admin', 'DB role must be hardcoded super_admin');
    assert.strictEqual(superDoc.isSuperAdmin, true, 'DB isSuperAdmin must be hardcoded true');

    if (superSignup.status !== 409) {
      // Verify OTP for super admin
      const superVerify = await request('POST', '/api/auth/verify-otp', {
        email: superAdminEmail,
        otp: superDoc.emailVerificationOtp
      });
      assert.strictEqual(superVerify.status, 200);
      assert.strictEqual(superVerify.body.user.role, 'super_admin');
      assert.strictEqual(superVerify.body.user.isSuperAdmin, true);
    }
    console.log('  ✓ Hardcoded Super Admin role and isSuperAdmin verified in MongoDB & JWT token.\n');

    // -------------------------------------------------------------------------
    // CLEANUP (Safely clean up test accounts without touching real users)
    // -------------------------------------------------------------------------
    console.log('▶ Cleaning up temporary test accounts from database...');
    await User.deleteMany({ email: { $regex: /@vasooltest\.com$/i } });
    console.log(`  ✓ All test users deleted safely.\n`);

    console.log('================================================================');
    console.log('  ✅ ALL TESTS PASSED! EMAIL & OTP AUTH SYSTEM VERIFIED 100%');
    console.log('================================================================');
  } catch (err) {
    console.error('\n❌ Error during test run:', err);
    throw err;
  } finally {
    if (server) server.close();
  }
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  });
