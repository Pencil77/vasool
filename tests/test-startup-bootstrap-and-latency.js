const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const app = require('../server');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const { signAuthToken } = require('../routes/auth');

async function testBackendBootstrap() {
  await connectToDatabase();

  const superUser = await User.findOne({ email: 'mdzubair7592@gmail.com' }).lean();
  assert(superUser, 'Super admin user mdzubair7592@gmail.com must exist in DB');
  const normalUser = await User.findOne({ email: { $ne: 'mdzubair7592@gmail.com' }, isSuperAdmin: { $ne: true } }).lean();
  assert(normalUser, 'At least one regular user must exist in DB');

  const superToken = signAuthToken(superUser);
  const normalToken = signAuthToken(normalUser);

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated /api/bootstrap must return 401');
    console.log('✅ Test 1 Passed: /api/bootstrap rejects unauthenticated requests with 401');

    // 2. Normal user with ?includeAdmin=1 must NOT receive admin data
    const normalRes = await fetch(`${baseUrl}/api/bootstrap?includeAdmin=1`, {
      headers: { Authorization: `Bearer ${normalToken}` }
    });
    assert.strictEqual(normalRes.status, 200, 'Normal user /api/bootstrap must return 200');
    const normalData = await normalRes.json();
    assert(normalData.user && normalData.user.email === normalUser.email, 'Must return sanitized user');
    assert(Array.isArray(normalData.groups), 'Must return groups array');
    assert(Array.isArray(normalData.expenses), 'Must return expenses array');
    assert(Array.isArray(normalData.settlements), 'Must return settlements array');
    assert.strictEqual(normalData.admin, undefined, 'Non-super-admin must NEVER receive admin bootstrap payload');
    for (const g of normalData.groups) {
      assert.strictEqual(g.auditLog, undefined, 'Bootstrap groups must omit heavy auditLog arrays');
    }
    console.log('✅ Test 2 Passed: Regular user bootstrap works, omits auditLog, and strips admin data');

    // 3. Super admin with ?includeAdmin=1 receives full bootstrap + admin payload in 1 call
    const superRes = await fetch(`${baseUrl}/api/bootstrap?includeAdmin=1`, {
      headers: { Authorization: `Bearer ${superToken}` }
    });
    assert.strictEqual(superRes.status, 200, 'Super admin /api/bootstrap?includeAdmin=1 must return 200');
    const superData = await superRes.json();
    assert(superData.user && superData.user.isSuperAdmin === true, 'Super admin flag verified');
    assert(superData.admin && superData.admin.settings, 'Admin settings included in bootstrap');
    assert(Array.isArray(superData.admin.groups), 'Admin groups included in bootstrap');
    assert(Array.isArray(superData.admin.feedbacks), 'Admin feedbacks included in bootstrap');
    console.log('✅ Test 3 Passed: Super admin bootstrap?includeAdmin=1 hydrates user + ledger + admin in 1 roundtrip');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testFrontendStartupFlow() {
  const htmlPath = path.join(__dirname, '../public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const coreJs = fs.readFileSync(path.join(__dirname, '../public/js/core-and-telemetry.js'), 'utf8');
  const authJs = fs.readFileSync(path.join(__dirname, '../public/js/auth-and-admin.js'), 'utf8');
  const dashJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');
  const grpJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');
  const qaJs = fs.readFileSync(path.join(__dirname, '../public/js/qa-and-init.js'), 'utf8');
  const bundle = [coreJs, authJs, dashJs, grpJs, qaJs].join('\n;\n');

  // Verify precompiled CSS & no blocking CDN scripts in index.html
  assert(html.includes('/css/tailwind.min.css'), 'index.html must reference precompiled /css/tailwind.min.css');
  assert(!html.includes('cdn.tailwindcss.com'), 'index.html must not block on runtime cdn.tailwindcss.com');
  assert(!html.includes('chart.js'), 'index.html must not block on unused chart.js');
  assert(fs.existsSync(path.join(__dirname, '../public/css/tailwind.min.css')), 'tailwind.min.css must exist');
  console.log('✅ Test 4 Passed: Static HTML uses precompiled Tailwind CSS with zero blocking CDN scripts');

  // 5. Unauthenticated load: instant auth portal, no protected dashboard flash
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://vasool.local/' });
    const w = dom.window;
    w.fetch = async () => { throw new Error('Should not fetch without token'); };
    w.eval(bundle);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(w.__vasoolAuthReady, true, 'Auth must resolve immediately when no token');
    assert.strictEqual(w.document.getElementById('authViewSection').classList.contains('hidden'), false, 'Auth view visible');
    assert.strictEqual(w.document.getElementById('appWorkspaceSection').classList.contains('hidden'), true, 'Workspace hidden');
    assert.strictEqual(w.document.getElementById('startupNeutralLoader').classList.contains('hidden'), true, 'Loader hidden');
    console.log('✅ Test 5 Passed: Unauthenticated load shows Auth Portal immediately without workspace flash');
  }

  // 6. Authenticated reload on Settle tab restores Settle using 1 /api/bootstrap call
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://vasool.local/#settle' });
    const w = dom.window;
    const calls = [];
    w.localStorage.setItem('vasool_jwt_token', 'valid_token_abc');
    w.localStorage.setItem('vasool_active_tab', 'settle');
    w.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/api/bootstrap')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            user: { id: 'u1', name: 'Aarav', email: 'aarav@example.com', role: 'user', isSuperAdmin: false },
            groups: [],
            expenses: [],
            settlements: []
          })
        };
      }
      return { ok: true, status: 204, text: async () => '' };
    };
    w.eval(bundle);
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(calls.filter((c) => c.includes('/api/bootstrap')).length, 1, 'Expected exactly 1 /api/bootstrap call');
    assert.strictEqual(calls.some((c) => c.includes('/api/auth/me')), false, 'Should not make duplicate /api/auth/me call');
    assert.strictEqual(w.__vasoolAuthReady, true, 'Auth ready after bootstrap');
    assert.strictEqual(w.document.getElementById('appWorkspaceSection').classList.contains('hidden'), false, 'Workspace visible');
    assert.strictEqual(w.document.getElementById('panelSettle').classList.contains('hidden'), false, 'Settle tab restored');
    assert.strictEqual(w.document.getElementById('panelDashboard').classList.contains('hidden'), true, 'Dashboard hidden');
    console.log('✅ Test 6 Passed: Reload on Settle hydrates via single /api/bootstrap call and restores Settle tab');
  }

  // 7. Super Admin reload on #admin hydrates admin panels via /api/bootstrap?includeAdmin=1 with zero extra admin fetches
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://vasool.local/#admin' });
    const w = dom.window;
    const calls = [];
    w.localStorage.setItem('vasool_jwt_token', 'super_token_xyz');
    w.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/api/bootstrap')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            user: { id: 'u0', name: 'Zubair', email: 'mdzubair7592@gmail.com', role: 'super_admin', isSuperAdmin: true },
            groups: [],
            expenses: [],
            settlements: [],
            admin: {
              settings: { sessionDurationValue: 7, sessionDurationUnit: 'days', sessionDurationString: '7d' },
              groups: [{ id: 'g1', name: 'Animal Park', inviteCode: 'SPL-123', members: [], billCount: 0, totalSpend: 0 }],
              feedbacks: []
            }
          })
        };
      }
      return { ok: true, status: 204, text: async () => '' };
    };
    w.eval(bundle);
    await new Promise((r) => setTimeout(r, 30));
    assert(calls.some((c) => c.includes('/api/bootstrap?includeAdmin=1')), 'Must pass ?includeAdmin=1 for #admin hash');
    assert.strictEqual(calls.some((c) => c.includes('/api/admin/')), false, 'Should NOT fire extra /api/admin/* fetches after bootstrap');
    assert.strictEqual(w.document.getElementById('panelAdmin').classList.contains('hidden'), false, 'Admin panel visible');
    assert.strictEqual(w.document.getElementById('adminTotalGroupsStat').textContent, '1', 'Admin groups stat hydrated');
    console.log('✅ Test 7 Passed: Super Admin reload on #admin hydrates in 1 call with zero extra admin fetches');
  }

  // 8. Network error during startup fails closed (FR-XX)
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://vasool.local/' });
    const w = dom.window;
    w.localStorage.setItem('vasool_jwt_token', 'stale_or_offline_token');
    w.fetch = async () => { throw new Error('Network unavailable'); };
    w.eval(bundle);
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(w.__vasoolAuthReady, true, 'Auth ready resolves on failure');
    assert.strictEqual(w.document.getElementById('appWorkspaceSection').classList.contains('hidden'), true, 'Protected workspace remains hidden on verification error');
    assert.strictEqual(w.document.getElementById('authViewSection').classList.contains('hidden'), false, 'Auth view shown safely');
    assert.strictEqual(w.localStorage.getItem('vasool_jwt_token'), 'stale_or_offline_token', 'Transient error preserves token');
    console.log('✅ Test 8 Passed: Startup verification failure fails closed (FR-XX)');
  }
}

(async () => {
  await testBackendBootstrap();
  await testFrontendStartupFlow();
  console.log('\n🎉 ALL STARTUP BOOTSTRAP & LATENCY TESTS PASSED!');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
