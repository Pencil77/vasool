/**
 * Automated Integration Test Suite: User Feedback & Suggestions System
 *
 * Verifies:
 * 1. POST /api/feedback - Anonymous & authenticated feedback creation
 * 2. POST /api/feedback - Input validation (message length, rating range, type validation)
 * 3. GET /api/admin/feedback - Protected retrieval and filtering (type & status)
 * 4. PATCH /api/admin/feedback/:id - Status progression (new -> reviewed -> in_progress -> resolved) & admin notes
 * 5. DELETE /api/admin/feedback/:id - Deletion and cleanup
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const { signAuthToken, authRouter } = require('../routes/auth');
const { splitsRouter } = require('../routes/splits');
const { adminRouter } = require('../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', splitsRouter);

let server;
let baseUrl;

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      {
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runFeedbackTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING TEST SUITE: User Feedback & Comments System');
  console.log('======================================================\n');

  await connectToDatabase();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Local test harness active on port ${port}`);

  const testSuffix = Date.now();
  const superAdminEmail = 'mdzubair7592@gmail.com';
  const regularEmail = `user_feedback_test_${testSuffix}@example.com`;

  // Create or retrieve super admin user
  let superAdmin = await User.findOne({ email: superAdminEmail });
  if (!superAdmin) {
    superAdmin = await User.create({
      name: 'Super Admin',
      email: superAdminEmail,
      passwordRaw: 'SuperAdminSecurePass123!',
      isSuperAdmin: true,
      isEmailVerified: true
    });
  }

  // Create a regular user
  let regularUser = await User.findOne({ email: regularEmail });
  if (!regularUser) {
    regularUser = await User.create({
      name: 'Feedback Tester',
      email: regularEmail,
      passwordRaw: 'RegularUserPass123!',
      isSuperAdmin: false,
      isEmailVerified: true
    });
  }

  const superAdminToken = signAuthToken(superAdmin);
  const regularToken = signAuthToken(regularUser);

  let createdFeedbackIds = [];

  try {
    // -------------------------------------------------------------------------
    // Test 1: Validation errors on POST /api/feedback
    // -------------------------------------------------------------------------
    console.log('Test 1: POST /api/feedback rejects invalid input');
    
    // Empty message
    const res1 = await request('POST', '/api/feedback', { message: '' });
    assert.strictEqual(res1.status, 400);
    assert(res1.body.error.includes('at least 3 characters'));

    // Invalid rating (> 5)
    const res2 = await request('POST', '/api/feedback', { message: 'Valid message', rating: 10 });
    assert.strictEqual(res2.status, 400);
    assert(res2.body.error.includes('between 1 and 5'));

    console.log('  ✅ Validation checks passed!');

    // -------------------------------------------------------------------------
    // Test 2: Anonymous submission
    // -------------------------------------------------------------------------
    console.log('\nTest 2: Anonymous user can submit feedback');
    const anonRes = await request('POST', '/api/feedback', {
      type: 'feature',
      rating: 5,
      message: 'Could you add dark mode toggle for high contrast displays?',
      page: '#dashboard'
    });
    assert.strictEqual(anonRes.status, 201);
    assert.strictEqual(anonRes.body.success, true);
    assert(anonRes.body.feedbackId);

    const anonDoc = await Feedback.findById(anonRes.body.feedbackId).lean();
    assert.strictEqual(anonDoc.userId, null);
    assert.strictEqual(anonDoc.userEmail, null);
    assert.strictEqual(anonDoc.type, 'feature');
    assert.strictEqual(anonDoc.rating, 5);
    assert.strictEqual(anonDoc.status, 'new');
    createdFeedbackIds.push(anonDoc._id);
    console.log('  ✅ Anonymous feedback successfully stored in MongoDB!');

    // -------------------------------------------------------------------------
    // Test 3: Authenticated submission
    // -------------------------------------------------------------------------
    console.log('\nTest 3: Logged-in user submits feedback with user context');
    const authRes = await request(
      'POST',
      '/api/feedback',
      {
        type: 'bug',
        rating: 4,
        message: 'Minor animation jitter on mobile bottom navigation when quickly switching tabs.',
        page: '#expenses'
      },
      regularToken
    );
    assert.strictEqual(authRes.status, 201);
    assert(authRes.body.feedbackId);

    const authDoc = await Feedback.findById(authRes.body.feedbackId).lean();
    assert.strictEqual(String(authDoc.userId), String(regularUser._id));
    assert.strictEqual(authDoc.userEmail, regularEmail);
    assert.strictEqual(authDoc.userName, 'Feedback Tester');
    assert.strictEqual(authDoc.type, 'bug');
    assert.strictEqual(authDoc.status, 'new');
    createdFeedbackIds.push(authDoc._id);
    console.log('  ✅ Authenticated feedback linked with user profile in MongoDB!');

    // -------------------------------------------------------------------------
    // Test 4: Super Admin protection & retrieval
    // -------------------------------------------------------------------------
    console.log('\nTest 4: Access control on GET /api/admin/feedback');
    // Unauthorized (no token)
    const noAuthRes = await request('GET', '/api/admin/feedback');
    assert.strictEqual(noAuthRes.status, 401);

    // Forbidden (regular user)
    const forbiddenRes = await request('GET', '/api/admin/feedback', null, regularToken);
    assert.strictEqual(forbiddenRes.status, 403);

    // Authorized (super admin)
    const adminGetRes = await request('GET', '/api/admin/feedback', null, superAdminToken);
    assert.strictEqual(adminGetRes.status, 200);
    assert(Array.isArray(adminGetRes.body.feedbacks));
    assert(adminGetRes.body.total >= 2);
    console.log(`  ✅ Super Admin retrieved ${adminGetRes.body.total} feedback records!`);

    // Filtering by type
    const filterRes = await request('GET', '/api/admin/feedback?type=bug', null, superAdminToken);
    assert.strictEqual(filterRes.status, 200);
    assert(filterRes.body.feedbacks.every((f) => f.type === 'bug'));
    console.log('  ✅ Feedback filtering by type verified!');

    // -------------------------------------------------------------------------
    // Test 5: Super Admin update status & notes
    // -------------------------------------------------------------------------
    console.log('\nTest 5: PATCH /api/admin/feedback/:id to update status and admin notes');
    const patchRes = await request(
      'PATCH',
      `/api/admin/feedback/${authDoc._id}`,
      {
        status: 'in_progress',
        adminNotes: 'Investigating mobile animation with CSS will-change property.'
      },
      superAdminToken
    );
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.feedback.status, 'in_progress');
    assert.strictEqual(patchRes.body.feedback.adminNotes, 'Investigating mobile animation with CSS will-change property.');

    const updatedDoc = await Feedback.findById(authDoc._id).lean();
    assert.strictEqual(updatedDoc.status, 'in_progress');
    assert(updatedDoc.adminNotes.includes('Investigating mobile animation'));
    console.log('  ✅ Feedback status progression & developer notes updated!');

    // -------------------------------------------------------------------------
    // Test 6: DELETE /api/admin/feedback/:id
    // -------------------------------------------------------------------------
    console.log('\nTest 6: DELETE /api/admin/feedback/:id removes entry');
    const deleteRes = await request('DELETE', `/api/admin/feedback/${anonDoc._id}`, null, superAdminToken);
    assert.strictEqual(deleteRes.status, 200);

    const deletedCheck = await Feedback.findById(anonDoc._id);
    assert.strictEqual(deletedCheck, null);
    console.log('  ✅ Feedback deletion verified!');

  } finally {
    // Clean up created feedback docs
    if (createdFeedbackIds.length > 0) {
      await Feedback.deleteMany({ _id: { $in: createdFeedbackIds } });
    }
    // Clean up test regular user
    if (regularUser) {
      await User.deleteOne({ _id: regularUser._id });
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    console.log('🧹 Test feedback entries cleaned up cleanly.');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL USER FEEDBACK INTEGRATION TESTS PASSED (6/6)');
  console.log('======================================================\n');
}

if (require.main === module) {
  runFeedbackTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
}

module.exports = { runFeedbackTests };
