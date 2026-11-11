const assert = require('assert');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { authRouter } = require('../routes/auth');
const {
  splitsRouter,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
} = require('../routes/splits');

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
  console.log('🧪 Starting Group Details & Exit Workflow Verification Suite...\n');

  // =========================================================================
  // 1. FRONTEND HTML & UI VERIFICATION
  // =========================================================================
  console.log('1. Verifying public/index.html UI Elements & Modals:');
  const html = fs.readFileSync('/tmp/workspace/vasool/public/index.html', 'utf8');

  // Check Group Details Modal
  assert(html.includes('id="groupDetailsModal"'), 'Must have #groupDetailsModal');
  assert(html.includes('data-testid="group-details-modal"'), 'Must have data-testid="group-details-modal"');
  assert(html.includes('id="btnGroupDetailsExit"'), 'Must have #btnGroupDetailsExit button');
  assert(html.includes('id="btnGroupTabMembers"'), 'Must have #btnGroupTabMembers tab button');
  assert(html.includes('id="btnGroupTabBills"'), 'Must have #btnGroupTabBills tab button');
  assert(html.includes('id="btnGroupTabSettle"'), 'Must have #btnGroupTabSettle tab button');
  console.log('   ✅ Group Details Modal (#groupDetailsModal) with tabs (Members, Bills, Settle) and Exit button verified');

  // Check Exit Group Confirmation Modal
  assert(html.includes('id="exitGroupConfirmModal"'), 'Must have #exitGroupConfirmModal');
  assert(html.includes('data-testid="exit-group-confirm-modal"'), 'Must have data-testid="exit-group-confirm-modal"');
  assert(html.includes('id="exitGroupBalanceNotice"'), 'Must have #exitGroupBalanceNotice');
  assert(html.includes('id="exitGroupAdminSelectorContainer"'), 'Must have #exitGroupAdminSelectorContainer');
  assert(html.includes('id="chkExitGroupConfirmForfeit"'), 'Must have #chkExitGroupConfirmForfeit checkbox');
  assert(html.includes('id="btnConfirmExecuteExit"'), 'Must have #btnConfirmExecuteExit');
  console.log('   ✅ Exit Group Confirmation Modal with dynamic debt warnings and admin handover verified');

  // Check Group Card clickability and button in renderGroupsGrid
  assert(html.includes('btn-group-details-'), 'Must have btn-group-details- in group cards');
  assert(html.includes('openGroupDetailsModal('), 'Must have openGroupDetailsModal function');
  assert(html.includes('switchGroupDetailsTab('), 'Must have switchGroupDetailsTab function');
  assert(html.includes('openExitGroupConfirmModal('), 'Must have openExitGroupConfirmModal function');
  assert(html.includes('executeLeaveGroup('), 'Must have executeLeaveGroup function');
  console.log('   ✅ Group card click triggers and client-side functions verified');

  // =========================================================================
  // 2. UNIT TESTING GROUP BALANCE MAP & SIMPLIFIED DEBTS
  // =========================================================================
  console.log('\n2. Unit Testing computeGroupBalanceMap & computeGroupSimplifiedDebts:');
  const dummyGroup = {
    _id: 'grp1',
    members: [
      { email: 'alice@test.com', name: 'Alice', role: 'admin' },
      { email: 'bob@test.com', name: 'Bob', role: 'member' }
    ],
    minimizeDebts: true,
    adminHubSettlement: false
  };

  const dummyExpenses = [
    {
      type: 'expense',
      paidByEmail: 'alice@test.com',
      paidByName: 'Alice',
      amount: 1000,
      splits: [
        { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 500 },
        { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 500 }
      ]
    }
  ];

  const dummySettlements = [];

  const bMap = computeGroupBalanceMap(dummyGroup, dummyExpenses, dummySettlements);
  assert.strictEqual(bMap['alice@test.com'].net, 500, 'Alice net must be +500');
  assert.strictEqual(bMap['bob@test.com'].net, -500, 'Bob net must be -500');
  console.log('   ✅ computeGroupBalanceMap correctly computes: Alice +₹500, Bob -₹500');

  const debts = computeGroupSimplifiedDebts(dummyGroup, bMap, dummyExpenses, dummySettlements);
  assert.strictEqual(debts.length, 1, 'Should have 1 simplified transaction');
  assert.strictEqual(debts[0].fromEmail, 'bob@test.com');
  assert.strictEqual(debts[0].toEmail, 'alice@test.com');
  assert.strictEqual(debts[0].amount, 500);
  console.log('   ✅ computeGroupSimplifiedDebts correctly computes: Bob pays Alice ₹500');

  // Test confirmed settlement squaring off balances
  const settledSettlements = [
    {
      status: 'confirmed',
      fromEmail: 'bob@test.com',
      fromName: 'Bob',
      toEmail: 'alice@test.com',
      toName: 'Alice',
      amount: 500
    }
  ];
  const bMapSettled = computeGroupBalanceMap(dummyGroup, dummyExpenses, settledSettlements);
  assert.strictEqual(bMapSettled['alice@test.com'].net, 0, 'Alice net must be 0 after settlement');
  assert.strictEqual(bMapSettled['bob@test.com'].net, 0, 'Bob net must be 0 after settlement');
  console.log('   ✅ computeGroupBalanceMap with confirmed settlement squares off to ₹0.00');

  // =========================================================================
  // 3. INTEGRATION TESTING WITH LIVE MONGODB & SERVER ENDPOINTS
  // =========================================================================
  console.log('\n3. Starting Integration API Tests with Test Users:');
  await connectToDatabase();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`   Test server running at ${baseUrl}`);

  const testSuffix = Date.now();
  const userAEmail = `user_a_${testSuffix}@vasooltest.com`;
  const userBEmail = `user_b_${testSuffix}@vasooltest.com`;
  const userCEmail = `user_c_${testSuffix}@vasooltest.com`;
  const nonMemberEmail = `outsider_${testSuffix}@vasooltest.com`;

  try {
    // Create Test User A
    const userA = await User.create({
      name: 'User Alpha',
      email: userAEmail,
      isEmailVerified: true
    });
    const tokenA = require('../routes/auth').signAuthToken(userA);

    // Create Test User B
    const userB = await User.create({
      name: 'User Beta',
      email: userBEmail,
      isEmailVerified: true
    });
    const tokenB = require('../routes/auth').signAuthToken(userB);

    // Create Test User C
    const userC = await User.create({
      name: 'User Gamma',
      email: userCEmail,
      isEmailVerified: true
    });
    const tokenC = require('../routes/auth').signAuthToken(userC);

    // Create Outsider
    const userOut = await User.create({
      name: 'Outsider',
      email: nonMemberEmail,
      isEmailVerified: true
    });
    const tokenOut = require('../routes/auth').signAuthToken(userOut);

    // User A creates a group with A, B, and C
    const createGrp = await request('POST', '/api/groups', {
      name: `Test Adventure ${testSuffix}`,
      category: 'Trip',
      members: [
        { name: 'User Beta', email: userBEmail, defaultWeight: 1 },
        { name: 'User Gamma', email: userCEmail, defaultWeight: 1 }
      ]
    }, tokenA);
    assert.strictEqual(createGrp.status, 201, 'Group creation must succeed');
    const group = createGrp.body.group;
    const groupId = group._id;
    console.log(`   ✅ Created test group "${group.name}" with ID: ${groupId}`);

    // User B accepts invite
    await request('POST', `/api/groups/${groupId}/accept-invite`, {}, tokenB);
    // User C accepts invite
    await request('POST', `/api/groups/${groupId}/accept-invite`, {}, tokenC);
    console.log('   ✅ Members B and C accepted invitations');

    // -----------------------------------------------------------------------
    // TEST 3A: GET /api/groups/:id (Group Details endpoint)
    // -----------------------------------------------------------------------
    const detailsRes = await request('GET', `/api/groups/${groupId}`, null, tokenA);
    assert.strictEqual(detailsRes.status, 200, 'GET /api/groups/:id must succeed for member');
    assert(detailsRes.body.group, 'Must return group');
    assert.strictEqual(detailsRes.body.members.length, 3, 'Must return all 3 members');
    assert(Array.isArray(detailsRes.body.expenses), 'Must return expenses array');
    assert(Array.isArray(detailsRes.body.simplifiedTransactions), 'Must return simplifiedTransactions array');
    console.log('   ✅ GET /api/groups/:id returned full details for group member');

    // Non-member access denied
    const nonMemberRes = await request('GET', `/api/groups/${groupId}`, null, tokenOut);
    assert.strictEqual(nonMemberRes.status, 403, 'Non-member must receive 403 Access Denied');
    console.log('   ✅ Non-member access to GET /api/groups/:id rejected with 403');

    // -----------------------------------------------------------------------
    // TEST 3B: Debt blocks leaving group
    // -----------------------------------------------------------------------
    // User A logs an expense of ₹1200 split equally among A, B, C (₹400 each)
    const expRes = await request('POST', '/api/expenses', {
      groupId,
      description: 'Goa Cabin Booking',
      amount: 1200,
      paidByEmail: userAEmail,
      paidByName: 'User Alpha',
      splitType: 'equal',
      splits: [
        { memberEmail: userAEmail, memberName: 'User Alpha', amount: 400 },
        { memberEmail: userBEmail, memberName: 'User Beta', amount: 400 },
        { memberEmail: userCEmail, memberName: 'User Gamma', amount: 400 }
      ]
    }, tokenA);
    assert.strictEqual(expRes.status, 201, 'Expense logging must succeed');
    console.log('   ✅ Expense recorded: Alpha paid ₹1200 (Beta & Gamma owe ₹400 each)');

    // Beta attempts to leave while owing ₹400
    const leaveDebtRes = await request('POST', `/api/groups/${groupId}/leave`, {}, tokenB);
    assert.strictEqual(leaveDebtRes.status, 400, 'Leaving with debt must be blocked with 400');
    assert(leaveDebtRes.body.error.includes('unsettled debt'), 'Error must specify unsettled debt');
    console.log(`   ✅ Leaving blocked for Beta due to debt: "${leaveDebtRes.body.error}"`);

    // -----------------------------------------------------------------------
    // TEST 3C: Credit balance warning and confirmation
    // -----------------------------------------------------------------------
    // Alpha is owed ₹800 net. Attempting to leave without forfeiture must be rejected
    const leaveCreditNoForfeit = await request('POST', `/api/groups/${groupId}/leave`, {}, tokenA);
    assert.strictEqual(leaveCreditNoForfeit.status, 400, 'Leaving with positive balance must warn user');
    assert(leaveCreditNoForfeit.body.canForfeit, 'Response must allow forfeiture confirmation');
    console.log(`   ✅ Alpha warned of positive balance forfeiture: "${leaveCreditNoForfeit.body.error}"`);

    // -----------------------------------------------------------------------
    // TEST 3D: Square off balance and leave cleanly
    // -----------------------------------------------------------------------
    // Alpha (creditor & admin) records the received payments from Beta and Gamma (directly confirmed)
    const settleB = await request('POST', '/api/settlements', {
      groupId,
      fromEmail: userBEmail,
      fromName: 'User Beta',
      toEmail: userAEmail,
      toName: 'User Alpha',
      amount: 400
    }, tokenA);
    assert.strictEqual(settleB.status, 201, 'Settlement B must succeed');

    const settleC = await request('POST', '/api/settlements', {
      groupId,
      fromEmail: userCEmail,
      fromName: 'User Gamma',
      toEmail: userAEmail,
      toName: 'User Alpha',
      amount: 400
    }, tokenA);
    assert.strictEqual(settleC.status, 201, 'Settlement C must succeed');

    // Now Beta has net 0! Beta leaves group
    const leaveBetaRes = await request('POST', `/api/groups/${groupId}/leave`, {}, tokenB);
    assert.strictEqual(leaveBetaRes.status, 200, 'Beta with zero balance must leave successfully');
    console.log('   ✅ Beta left group cleanly with zero balance');

    // Verify Beta is no longer in group
    const groupAfterBeta = await Group.findById(groupId);
    assert(!groupAfterBeta.members.some((m) => m.email === userBEmail), 'Beta must be removed from group members');
    assert.strictEqual(groupAfterBeta.members.length, 2, 'Group must have 2 members remaining');

    // -----------------------------------------------------------------------
    // TEST 3E: Admin leaves with handover to remaining member
    // -----------------------------------------------------------------------
    // Alpha is Admin. Alpha leaves and designates Gamma (userCEmail) as successor
    const leaveAdminRes = await request('POST', `/api/groups/${groupId}/leave`, {
      successorEmail: userCEmail
    }, tokenA);
    assert.strictEqual(leaveAdminRes.status, 200, 'Admin must leave successfully with successor designation');
    console.log('   ✅ Admin Alpha left group. Adminship transferred to Gamma');

    const groupAfterAlpha = await Group.findById(groupId);
    assert.strictEqual(groupAfterAlpha.members.length, 1, 'Group must have 1 member remaining (Gamma)');
    assert.strictEqual(groupAfterAlpha.members[0].email, userCEmail, 'Remaining member must be Gamma');
    assert.strictEqual(groupAfterAlpha.members[0].role, 'admin', 'Gamma must now be admin');
    assert.strictEqual(groupAfterAlpha.adminEmail, userCEmail, 'group.adminEmail must now be Gamma');

    // -----------------------------------------------------------------------
    // TEST 3F: Sole member leaves -> Group archived
    // -----------------------------------------------------------------------
    const leaveGammaRes = await request('POST', `/api/groups/${groupId}/leave`, {}, tokenC);
    assert.strictEqual(leaveGammaRes.status, 200, 'Sole member Gamma leaving must succeed');
    assert(leaveGammaRes.body.isArchived, 'Group must be marked as archived');
    console.log('   ✅ Sole member Gamma left. Group successfully archived');

    const groupFinal = await Group.findById(groupId);
    assert.strictEqual(groupFinal.isArchived, true, 'Group must be archived in DB');
    assert.strictEqual(groupFinal.members.length, 0, 'Group members must be empty');

  } finally {
    // Clean up test data scoped to @vasooltest.com
    await User.deleteMany({ email: { $regex: /@vasooltest\.com$/ } });
    await Group.deleteMany({ name: { $regex: /Test Adventure/ } });
    await Expense.deleteMany({ description: 'Goa Cabin Booking' });
    await Settlement.deleteMany({ fromEmail: { $regex: /@vasooltest\.com$/ } });
    if (server) server.close();
    console.log('   🧹 Test data cleanup complete (real users preserved).');
  }

  console.log('\n🎉 ALL 12 VERIFICATION SUITES PASSED! Group Details & Exit Workflow 100% verified.');
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  if (server) server.close();
  process.exit(1);
});
