/**
 * Comprehensive Live E2E Production Test Suite
 * Target: https://vasool-ecru.vercel.app
 */

const BASE_URL = 'https://vasool-ecru.vercel.app';

let passed = 0;
let failed = 0;
const results = [];

async function assertTest(name, category, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const duration = Date.now() - start;
    passed++;
    results.push({ name, category, passed: true, detail, duration });
    console.log(`  [PASS] [${category}] ${name} (${duration}ms) -> ${detail}`);
  } catch (err) {
    const duration = Date.now() - start;
    failed++;
    results.push({ name, category, passed: false, detail: err.message, duration });
    console.error(`  [FAIL] [${category}] ${name} (${duration}ms) -> ERROR: ${err.message}`);
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

async function runAllTests() {
  console.log(`\n======================================================`);
  console.log(`  VASOOL LIVE PRODUCTION SUITE - https://vasool-ecru.vercel.app`);
  console.log(`======================================================\n`);

  const uniqueId = Date.now();
  const testUser = {
    name: `Zoro Suite User`,
    email: `zoro.suite.${uniqueId}@example.com`,
    password: `VasoolProdPass#${uniqueId}`,
    upiId: `zoro@okhdfcbank`
  };
  let authToken = '';
  let userId = '';
  let groupId = '';
  let expenseId = '';

  // ==========================================
  // 1. HEALTH & SYSTEM DIAGNOSTICS
  // ==========================================
  await assertTest('GET /api/health returns 200 OK & MongoDB connected', 'Health', async () => {
    const res = await request('/api/health');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data.status !== 'ok') throw new Error(`Service status not ok`);
    if (res.data.mongodb !== 'connected') throw new Error(`MongoDB not connected: ${res.data.mongodb}`);
    if (!res.data.googleOAuthConfigured) throw new Error(`Google OAuth not configured`);
    return `Service: ${res.data.service}, DB: ${res.data.mongodb}, OAuth: configured`;
  });

  await assertTest('GET /api/auth/config returns public Google OAuth Client ID', 'Config', async () => {
    const res = await request('/api/auth/config');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.data.googleClientId) throw new Error('googleClientId missing in response');
    return `Google Client ID verified: ...${res.data.googleClientId.slice(-25)}`;
  });

  await assertTest('GET / serves SPA index.html with HTTP 200', 'Static Delivery', async () => {
    const res = await fetch(BASE_URL);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const html = await res.text();
    if (!html.includes('SplitFlow') && !html.includes('Vasool')) throw new Error('HTML does not contain expected title/branding');
    return `HTML size: ${html.length} bytes delivered`;
  });

  await assertTest('GET /any/unknown/route falls back to SPA index.html', 'Routing', async () => {
    const res = await fetch(`${BASE_URL}/random-spa-fallback-route-${uniqueId}`);
    if (res.status !== 200) throw new Error(`Expected 200 SPA fallback, got ${res.status}`);
    const html = await res.text();
    if (!html.includes('<!DOCTYPE html>')) throw new Error('Did not receive HTML document');
    return `SPA fallback routing verified`;
  });

  // ==========================================
  // 2. AUTHENTICATION & SECURITY
  // ==========================================
  await assertTest('POST /api/auth/signup creates account & returns 7-day JWT', 'Auth', async () => {
    const res = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(testUser)
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data.token) throw new Error('No JWT token returned');
    if (!res.data.user || res.data.user.email !== testUser.email) throw new Error('User data mismatch');
    authToken = res.data.token;
    userId = res.data.user.id;
    return `User created ID: ${userId}, Token: valid`;
  });

  await assertTest('POST /api/auth/signup rejects duplicate email with 409 Conflict', 'Auth Security', async () => {
    const res = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(testUser)
    });
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    return `Rejected duplicate email: ${res.data.error}`;
  });

  await assertTest('POST /api/auth/signup rejects short password (< 8 chars) with 400', 'Auth Validation', async () => {
    const res = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Short Pass',
        email: `shortpass.${uniqueId}@example.com`,
        password: 'short'
      })
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return `Validation message: ${res.data.error}`;
  });

  await assertTest('POST /api/auth/signup rejects missing required fields with 400', 'Auth Validation', async () => {
    const res = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: `missingname.${uniqueId}@example.com` })
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return `Validation message: ${res.data.error}`;
  });

  await assertTest('POST /api/auth/login authenticates valid user & returns JWT', 'Auth', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.data.token) throw new Error('JWT token missing in login response');
    return `Login successful, user verified`;
  });

  await assertTest('POST /api/auth/login rejects incorrect password with 401', 'Auth Security', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testUser.email,
        password: 'WrongPassword#123'
      })
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return `Rejected incorrect password: ${res.data.error}`;
  });

  await assertTest('POST /api/auth/login rejects non-existent email with 401', 'Auth Security', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: `nonexistent.${uniqueId}@example.com`,
        password: 'SomePassword#123'
      })
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return `Rejected non-existent email: ${res.data.error}`;
  });

  await assertTest('GET /api/auth/me returns profile for valid JWT Bearer token', 'Auth Security', async () => {
    const res = await request('/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data.user.email !== testUser.email) throw new Error('User profile email mismatch');
    return `Profile retrieved for: ${res.data.user.name} (${res.data.user.email})`;
  });

  await assertTest('GET /api/auth/me rejects request without Bearer token with 401', 'Auth Security', async () => {
    const res = await request('/api/auth/me', { method: 'GET' });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return `Unauthorized access blocked: ${res.data.error}`;
  });

  await assertTest('POST /api/auth/google rejects fake/invalid OAuth token with 401', 'OAuth Security', async () => {
    const res = await request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: 'fake_jwt_token_for_testing' })
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return `Google ID token verification rejected forgery correctly`;
  });

  // ==========================================
  // 3. GROUPS & GANG MANAGEMENT
  // ==========================================
  await assertTest('POST /api/groups creates a new group with owner & members', 'Groups', async () => {
    const res = await request('/api/groups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        name: `Suite Goa Gang ${uniqueId}`,
        description: 'Automated test suite group',
        category: 'Trip',
        currency: 'INR',
        members: [
          { name: 'Pavan', email: `pavan.${uniqueId}@test.com` },
          { name: 'Ajay', email: `ajay.${uniqueId}@test.com` },
          { name: 'Mounica', email: `mounica.${uniqueId}@test.com` }
        ]
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    if (!res.data.group || !res.data.group._id) throw new Error('Group ID missing');
    if (!res.data.group.inviteCode.startsWith('SPL-')) throw new Error('Invite code format invalid');
    if (res.data.group.members.length !== 4) throw new Error(`Expected 4 members (owner + 3), got ${res.data.group.members.length}`);
    groupId = res.data.group._id;
    return `Created group ID: ${groupId}, Invite Code: ${res.data.group.inviteCode}, Members: 4`;
  });

  await assertTest('POST /api/groups rejects group creation without name with 400', 'Groups Validation', async () => {
    const res = await request('/api/groups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ description: 'Nameless group' })
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return `Validation error: ${res.data.error}`;
  });

  await assertTest('GET /api/groups retrieves groups where user is a member', 'Groups', async () => {
    const res = await request('/api/groups', {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const found = res.data.groups.find(g => g._id === groupId);
    if (!found) throw new Error('Created group not found in user group list');
    return `Retrieved ${res.data.groups.length} groups for user`;
  });

  await assertTest('POST /api/groups/:id/members adds a new member dynamically', 'Groups', async () => {
    const res = await request(`/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        name: 'Abhi',
        email: `abhi.${uniqueId}@test.com`
      })
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data.group.members.length !== 5) throw new Error(`Expected 5 members, got ${res.data.group.members.length}`);
    return `Added member 'Abhi'. Total members: ${res.data.group.members.length}`;
  });

  await assertTest('POST /api/groups/:id/members rejects duplicate member with 409', 'Groups Validation', async () => {
    const res = await request(`/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        name: 'Abhi',
        email: `abhi.${uniqueId}@test.com`
      })
    });
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    return `Duplicate member rejected: ${res.data.error}`;
  });

  // ==========================================
  // 4. EXPENSE SPLITTING - ALL 4 SPLIT MODES
  // ==========================================
  await assertTest('POST /api/expenses Mode 1: Equal Split (₹4,000 across 4 members = ₹1,000 each)', 'Split: Equal', async () => {
    const res = await request('/api/expenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        description: 'Villa Booking Goa',
        amount: 4000,
        currency: 'INR',
        category: 'Travel & Stay',
        paidByEmail: testUser.email,
        paidByName: testUser.name,
        splitType: 'equal',
        splits: [
          { memberEmail: testUser.email, memberName: testUser.name, amount: 1000 },
          { memberEmail: `pavan.${uniqueId}@test.com`, memberName: 'Pavan', amount: 1000 },
          { memberEmail: `ajay.${uniqueId}@test.com`, memberName: 'Ajay', amount: 1000 },
          { memberEmail: `mounica.${uniqueId}@test.com`, memberName: 'Mounica', amount: 1000 }
        ]
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    expenseId = res.data.expense._id;
    return `Created equal split expense ID: ${expenseId}`;
  });

  await assertTest('POST /api/expenses Mode 2: Exact Amounts (₹1,500 = ₹700 + ₹500 + ₹300)', 'Split: Exact', async () => {
    const res = await request('/api/expenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        description: 'Dinner Seafood Shack',
        amount: 1500,
        currency: 'INR',
        category: 'Food & Dining',
        paidByEmail: `pavan.${uniqueId}@test.com`,
        paidByName: 'Pavan',
        splitType: 'exact',
        splits: [
          { memberEmail: testUser.email, memberName: testUser.name, amount: 700 },
          { memberEmail: `pavan.${uniqueId}@test.com`, memberName: 'Pavan', amount: 500 },
          { memberEmail: `ajay.${uniqueId}@test.com`, memberName: 'Ajay', amount: 300 }
        ]
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    return `Exact split created: ₹700 + ₹500 + ₹300 = ₹1,500`;
  });

  await assertTest('POST /api/expenses Mode 3: Percentage Split (50% / 30% / 20% of ₹2,000)', 'Split: Percentage', async () => {
    const res = await request('/api/expenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        description: 'Water Sports Jet Ski',
        amount: 2000,
        currency: 'INR',
        category: 'Entertainment',
        paidByEmail: `ajay.${uniqueId}@test.com`,
        paidByName: 'Ajay',
        splitType: 'percentage',
        splits: [
          { memberEmail: testUser.email, memberName: testUser.name, amount: 1000, percentage: 50 },
          { memberEmail: `pavan.${uniqueId}@test.com`, memberName: 'Pavan', amount: 600, percentage: 30 },
          { memberEmail: `ajay.${uniqueId}@test.com`, memberName: 'Ajay', amount: 400, percentage: 20 }
        ]
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    return `Percentage split created: ₹1,000 (50%) + ₹600 (30%) + ₹400 (20%) = ₹2,000`;
  });

  await assertTest('POST /api/expenses Mode 4: Relative Shares Split (2:1:1 weights of ₹1,600)', 'Split: Shares', async () => {
    const res = await request('/api/expenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        description: 'Supermarket Groceries',
        amount: 1600,
        currency: 'INR',
        category: 'Groceries',
        paidByEmail: testUser.email,
        paidByName: testUser.name,
        splitType: 'shares',
        splits: [
          { memberEmail: testUser.email, memberName: testUser.name, amount: 800, shares: 2 },
          { memberEmail: `pavan.${uniqueId}@test.com`, memberName: 'Pavan', amount: 400, shares: 1 },
          { memberEmail: `ajay.${uniqueId}@test.com`, memberName: 'Ajay', amount: 400, shares: 1 }
        ]
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    return `Shares split created: 2:1:1 -> ₹800 + ₹400 + ₹400 = ₹1,600`;
  });

  await assertTest('POST /api/expenses rejects negative or 0 amount with 400', 'Expense Validation', async () => {
    const res = await request('/api/expenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        description: 'Invalid Bill',
        amount: -500,
        currency: 'INR',
        category: 'Other',
        paidByEmail: testUser.email,
        paidByName: testUser.name,
        splits: [{ memberEmail: testUser.email, memberName: testUser.name, amount: -500 }]
      })
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return `Negative amount rejected: ${res.data.error}`;
  });

  await assertTest('POST /api/expenses rejects invalid category enum with validation error', 'Expense Validation', async () => {
    const res = await request('/api/expenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        description: 'Invalid Category Bill',
        amount: 500,
        currency: 'INR',
        category: 'NonExistentCategoryEnum',
        paidByEmail: testUser.email,
        paidByName: testUser.name,
        splits: [{ memberEmail: testUser.email, memberName: testUser.name, amount: 500 }]
      })
    });
    if (res.status < 400) throw new Error(`Expected error code >= 400, got ${res.status}`);
    return `Invalid category enum rejected correctly`;
  });

  await assertTest('GET /api/expenses lists all group expenses chronologically', 'Expenses Query', async () => {
    const res = await request(`/api/expenses?groupId=${groupId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data.expenses.length < 4) throw new Error(`Expected at least 4 expenses, got ${res.data.expenses.length}`);
    return `Retrieved ${res.data.expenses.length} group expenses`;
  });

  // ==========================================
  // 5. DEBT SIMPLIFICATION & SETTLEMENTS
  // ==========================================
  await assertTest('GET /api/balances computes net balances & verifies zero-sum property', 'Debt Simplification', async () => {
    const res = await request(`/api/balances?groupId=${groupId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const balances = res.data.balances;
    const netSum = Math.round(balances.reduce((acc, b) => acc + b.net, 0) * 100) / 100;
    if (Math.abs(netSum) > 0.01) throw new Error(`Zero-sum violation! Sum of all nets is ${netSum}`);
    return `Zero-sum invariant verified (Sum: ${netSum}). Balances computed for ${balances.length} members`;
  });

  await assertTest('GET /api/balances produces valid simplified transfer graph', 'Debt Simplification', async () => {
    const res = await request(`/api/balances?groupId=${groupId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const txs = res.data.simplifiedTransactions;
    if (!Array.isArray(txs)) throw new Error('simplifiedTransactions is not an array');
    txs.forEach((t) => {
      if (t.amount <= 0) throw new Error(`Transfer amount must be positive, got ${t.amount}`);
      if (!t.fromEmail || !t.toEmail) throw new Error('Missing debtor/creditor email');
    });
    return `Greedy algorithm produced ${txs.length} minimal transfer(s)`;
  });

  await assertTest('POST /api/settlements records a UPI settlement transfer', 'Settlements', async () => {
    const res = await request('/api/settlements', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        fromEmail: `pavan.${uniqueId}@test.com`,
        fromName: 'Pavan',
        toEmail: testUser.email,
        toName: testUser.name,
        amount: 500,
        currency: 'INR',
        method: 'UPI',
        referenceNote: 'UPI ref GPay-782910'
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    if (!res.data.settlement || !res.data.settlement._id) throw new Error('Settlement ID missing');
    return `Settlement ID: ${res.data.settlement._id}, Method: UPI, Amount: ₹500`;
  });

  await assertTest('POST /api/settlements records a Cash settlement transfer', 'Settlements', async () => {
    const res = await request('/api/settlements', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        fromEmail: `ajay.${uniqueId}@test.com`,
        fromName: 'Ajay',
        toEmail: testUser.email,
        toName: testUser.name,
        amount: 300,
        currency: 'INR',
        method: 'Cash',
        referenceNote: 'Handed ₹300 cash at cafe'
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    return `Settlement ID: ${res.data.settlement._id}, Method: Cash, Amount: ₹300`;
  });

  await assertTest('POST /api/settlements rejects 0 or negative amount with 400', 'Settlements Validation', async () => {
    const res = await request('/api/settlements', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        groupId,
        fromEmail: `pavan.${uniqueId}@test.com`,
        toEmail: testUser.email,
        amount: 0
      })
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return `Rejected invalid settlement amount: ${res.data.error}`;
  });

  await assertTest('GET /api/balances reflects settlements in net member balances', 'Settlements Effect', async () => {
    const res = await request(`/api/balances?groupId=${groupId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data.settlements.length < 2) throw new Error(`Expected at least 2 settlements, got ${res.data.settlements.length}`);
    return `Verified ${res.data.settlements.length} settlements factored into net balance graph`;
  });

  await assertTest('GET /api/settlements returns recorded settlements list', 'Settlements Query', async () => {
    const res = await request(`/api/settlements?groupId=${groupId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.data.settlements) || res.data.settlements.length < 2) {
      throw new Error(`Expected array of at least 2 settlements, got ${JSON.stringify(res.data)}`);
    }
    return `Retrieved ${res.data.settlements.length} recorded settlements`;
  });

  await assertTest('DELETE /api/expenses/:id deletes expense & updates balance', 'Expense Deletion', async () => {
    const res = await request(`/api/expenses/${expenseId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.data.deleted) throw new Error('Expense deleted flag not returned');
    return `Expense ${expenseId} deleted successfully`;
  });

  console.log(`\n======================================================`);
  console.log(`  TEST RESULTS SUMMARY: ${passed} PASSED | ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
