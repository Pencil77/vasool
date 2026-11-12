const http = require('http');
const assert = require('assert');
const app = require('../server');
const { signAuthToken } = require('../routes/auth');

async function run() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test backend server listening at ${baseUrl}`);

  try {
    // 1. Unauthenticated GET /api/health
    console.log('\n--- 1. Testing Unauthenticated GET /api/health ---');
    const resPublic = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(resPublic.status, 200, 'Expected 200 OK');
    const bodyPublic = await resPublic.json();
    console.log('Public health response:', bodyPublic);
    assert.strictEqual(bodyPublic.service, 'vasool');
    assert.strictEqual(bodyPublic.status, 'operational');
    assert.strictEqual(bodyPublic.infisicalConfigured, undefined, 'infisicalConfigured must NOT be leaked to public');
    assert.strictEqual(bodyPublic.grafanaLokiConfigured, undefined, 'grafanaLokiConfigured must NOT be leaked to public');
    assert.strictEqual(bodyPublic.openTelemetryConfigured, undefined, 'openTelemetryConfigured must NOT be leaked to public');
    assert.strictEqual(bodyPublic.mongodb, undefined, 'mongodb internal state must NOT be leaked to public');
    console.log('✅ Unauthenticated health check is strictly abstracted!');

    // 2. Non-Super Admin Authenticated GET /api/health
    console.log('\n--- 2. Testing Non-Super-Admin Authenticated GET /api/health ---');
    const regularToken = signAuthToken({
      _id: 'user123',
      email: 'regular.user@example.com',
      role: 'user',
      isSuperAdmin: false
    });
    const resRegular = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${regularToken}` }
    });
    assert.strictEqual(resRegular.status, 200);
    const bodyRegular = await resRegular.json();
    assert.strictEqual(bodyRegular.infisicalConfigured, undefined, 'Regular user must NOT receive internal config flags');
    assert.strictEqual(bodyRegular.grafanaLokiConfigured, undefined);
    assert.strictEqual(bodyRegular.mongodb, undefined);
    console.log('✅ Regular user health check is strictly abstracted!');

    // 3. Super Admin Authenticated GET /api/health
    console.log('\n--- 3. Testing Super Admin Authenticated GET /api/health ---');
    const superAdminToken = signAuthToken({
      _id: 'admin123',
      email: 'mdzubair7592@gmail.com',
      role: 'super_admin',
      isSuperAdmin: true
    });
    const resSuper = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(resSuper.status, 200);
    const bodySuper = await resSuper.json();
    console.log('Super Admin health response keys:', Object.keys(bodySuper));
    assert(bodySuper.mongodb !== undefined, 'Super Admin must see MongoDB connectivity');
    assert(bodySuper.googleOAuthConfigured !== undefined, 'Super Admin must see Google OAuth configuration');
    assert(bodySuper.infisicalConfigured !== undefined, 'Super Admin must see Infisical configuration');
    assert(bodySuper.grafanaLokiConfigured !== undefined, 'Super Admin must see Loki configuration');
    assert(bodySuper.openTelemetryConfigured !== undefined, 'Super Admin must see OTel configuration');
    console.log('✅ Super Admin receives full diagnostic telemetry!');

    // 4. Non-Super Admin access to /api/admin/system-status
    console.log('\n--- 4. Testing Non-Super Admin /api/admin/system-status ---');
    const resForbidden = await fetch(`${baseUrl}/api/admin/system-status`, {
      headers: { Authorization: `Bearer ${regularToken}` }
    });
    assert([401, 403].includes(resForbidden.status), `Regular user must receive 401 or 403 on /api/admin/system-status (got ${resForbidden.status})`);
    console.log(`✅ Regular user correctly blocked from /api/admin/system-status (HTTP ${resForbidden.status})!`);

    // 5. Super Admin access to /api/admin/system-status
    console.log('\n--- 5. Testing Super Admin /api/admin/system-status ---');
    const resAdminStatus = await fetch(`${baseUrl}/api/admin/system-status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(resAdminStatus.status, 200, 'Super Admin must receive 200 OK');
    const bodyAdminStatus = await resAdminStatus.json();
    console.log('Admin system-status response keys:', Object.keys(bodyAdminStatus));
    assert(bodyAdminStatus.stats !== undefined, 'Admin status must include database collection statistics');
    assert(bodyAdminStatus.nodeVersion !== undefined, 'Admin status must include Node version');
    console.log('✅ Super Admin successfully accessed /api/admin/system-status!');

    console.log('\n🎯 ALL BACKEND HEALTH & SYSTEM STATUS SECURITY TESTS PASSED!');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
