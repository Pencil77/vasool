/**
 * Automated test suite for Configurable Session Timeout & Super Admin Controls
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { signAuthToken, updateCachedSessionDuration, refreshSessionDurationCache } = require('../routes/auth');
const SystemConfig = require('../models/SystemConfig');

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
  console.log('--- Starting Configurable Session Timeout Tests ---');

  // Start test server on random port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`✓ Test server running on ${baseUrl}`);

  try {
    const { connectToDatabase } = require('../lib/mongodb');
    const User = require('../models/User');
    await connectToDatabase();

    // 1. Mock Super Admin Token & Regular User Token
    const superAdminUser = {
      _id: '672fd0000000000000000001',
      email: 'mdzubair7592@gmail.com',
      name: 'Mohammed Zubair',
      role: 'super_admin',
      isSuperAdmin: true,
      authProviders: ['email']
    };

    let regularUserDoc = await User.findOne({ email: { $ne: 'mdzubair7592@gmail.com' } });
    if (!regularUserDoc) {
      regularUserDoc = await User.create({
        name: 'Regular Test Member',
        email: 'regular_member_timeout_test@example.com',
        role: 'user',
        isEmailVerified: true
      });
    }

    const regularUser = {
      _id: regularUserDoc._id.toString(),
      email: regularUserDoc.email,
      name: regularUserDoc.name,
      role: 'user',
      isSuperAdmin: false,
      authProviders: ['email']
    };

    const superAdminToken = signAuthToken(superAdminUser);
    const regularToken = signAuthToken(regularUser);
    console.log('✓ Created test JWT tokens');

    // 2. Non-super admin cannot access admin settings
    const nonAdminGetRes = await request('GET', '/api/admin/settings', null, regularToken);
    assert.strictEqual(nonAdminGetRes.status, 403, 'Regular user must receive 403 Forbidden on GET /api/admin/settings');
    console.log('✓ Non-admin blocked with 403 Forbidden from GET /api/admin/settings');

    const nonAdminPatchRes = await request('PATCH', '/api/admin/settings', { sessionDurationValue: 14, sessionDurationUnit: 'days' }, regularToken);
    assert.strictEqual(nonAdminPatchRes.status, 403, 'Regular user must receive 403 Forbidden on PATCH /api/admin/settings');
    console.log('✓ Non-admin blocked with 403 Forbidden from PATCH /api/admin/settings');

    // 3. Validation tests
    const invalidUnitRes = await request('PATCH', '/api/admin/settings', { sessionDurationValue: 10, sessionDurationUnit: 'minutes' }, superAdminToken);
    assert.strictEqual(invalidUnitRes.status, 400, 'Invalid unit must be rejected with 400');
    console.log('✓ Invalid unit rejected with 400');

    const invalidValRes = await request('PATCH', '/api/admin/settings', { sessionDurationValue: -5, sessionDurationUnit: 'days' }, superAdminToken);
    assert.strictEqual(invalidValRes.status, 400, 'Negative value must be rejected with 400');
    console.log('✓ Negative value rejected with 400');

    const outOfRangeRes = await request('PATCH', '/api/admin/settings', { sessionDurationValue: 500, sessionDurationUnit: 'days' }, superAdminToken);
    assert.strictEqual(outOfRangeRes.status, 400, 'Duration > 365 days must be rejected with 400');
    console.log('✓ Out-of-range duration rejected with 400');

    // 4. Update session timeout to 14 days
    const updateRes14 = await request('PATCH', '/api/admin/settings', { sessionDurationValue: 14, sessionDurationUnit: 'days' }, superAdminToken);
    assert.strictEqual(updateRes14.status, 200, 'PATCH /api/admin/settings must return 200');
    assert.strictEqual(updateRes14.body.settings.sessionDurationValue, 14);
    assert.strictEqual(updateRes14.body.settings.sessionDurationUnit, 'days');
    assert.strictEqual(updateRes14.body.settings.sessionDurationString, '14d');
    console.log('✓ Successfully configured session duration to 14 days (14d)');

    // 5. Test GET /api/admin/settings retrieves updated config
    const getRes = await request('GET', '/api/admin/settings', null, superAdminToken);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.settings.sessionDurationValue, 14);
    assert.strictEqual(getRes.body.settings.sessionDurationString, '14d');
    console.log('✓ GET /api/admin/settings returns active 14d configuration');

    // 6. Test that tokens signed now have a 14-day expiry
    const token14d = signAuthToken(regularUser);
    const decoded14d = jwt.decode(token14d);
    const lifespanSeconds14d = decoded14d.exp - decoded14d.iat;
    const expectedSeconds14d = 14 * 24 * 60 * 60;
    assert.strictEqual(lifespanSeconds14d, expectedSeconds14d, `Token lifetime must be exactly 14 days (${expectedSeconds14d}s)`);
    console.log(`✓ Newly signed token lifetime verified: ${lifespanSeconds14d}s (14 days)`);

    // 7. Update to 30 days
    const updateRes30 = await request('PATCH', '/api/admin/settings', { sessionDurationValue: 30, sessionDurationUnit: 'days' }, superAdminToken);
    assert.strictEqual(updateRes30.status, 200);
    const token30d = signAuthToken(regularUser);
    const decoded30d = jwt.decode(token30d);
    const lifespanSeconds30d = decoded30d.exp - decoded30d.iat;
    const expectedSeconds30d = 30 * 24 * 60 * 60;
    assert.strictEqual(lifespanSeconds30d, expectedSeconds30d);
    console.log(`✓ Configured to 30 days: token lifetime verified: ${lifespanSeconds30d}s (30 days)`);

    // 8. Revert back to 7 days (default standard)
    const revertRes = await request('PATCH', '/api/admin/settings', { sessionDurationValue: 7, sessionDurationUnit: 'days' }, superAdminToken);
    assert.strictEqual(revertRes.status, 200);
    assert.strictEqual(revertRes.body.settings.sessionDurationString, '7d');
    const token7d = signAuthToken(regularUser);
    const decoded7d = jwt.decode(token7d);
    const lifespanSeconds7d = decoded7d.exp - decoded7d.iat;
    const expectedSeconds7d = 7 * 24 * 60 * 60;
    assert.strictEqual(lifespanSeconds7d, expectedSeconds7d);
    console.log(`✓ Reverted back to 7 days (1 week): token lifetime verified: ${lifespanSeconds7d}s (7 days)`);

    console.log('\n--- All Configurable Session Timeout Tests Passed! ---');
  } finally {
    if (server) {
      server.close();
    }
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  if (server) server.close();
  process.exit(1);
});
