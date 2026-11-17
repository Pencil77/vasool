const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Settlement = require('../models/Settlement');
const Expense = require('../models/Expense');
const { authRouter, signAuthToken } = require('../routes/auth');
const { splitsRouter } = require('../routes/splits');
const { settlementsRouter } = require('../routes/settlements');

console.log('🧪 Starting Settlement Revert & Settlement-Plan Privacy Test Suite...\n');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api', splitsRouter);
app.use('/api', settlementsRouter);

let server;
let baseUrl;

function request(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
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

async function main() {
  // Static checks
  const modelSrc = fs.readFileSync(path.join(__dirname, '../models/Settlement.js'), 'utf8');
  assert(modelSrc.includes("'reverted'"), 'Settlement status enum must include reverted');
  assert(modelSrc.includes('recordedByEmail'), 'Settlement must track recordedByEmail');
  assert(modelSrc.includes('revertedAt'), 'Settlement must track revertedAt');

  const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/settlements.js'), 'utf8');
  assert(routeSrc.includes("router.post('/settlements/:id/revert'"), 'Revert endpoint must exist');
  assert(routeSrc.includes('isRecorder'), 'Revert must allow the recorder');

  const clientSrc = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');
  assert(clientSrc.includes('handleRevertSettlement('), 'Settlement history must expose a revert action');
  assert(clientSrc.includes('recordedByEmail'), 'History card must consider the recorder for revert eligibility');
  const dashSrc = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');
  assert(!dashSrc.includes('hasPersonalOnly'), 'Settlement plan filtering must not depend on splitsVisibility');
  assert(routeSrc.includes('if (!isRequesterAdmin)'), 'Balances endpoint must always filter for non-admins');
  console.log('   ✅ Static checks passed (model, route, UI, privacy gating)');

  await connectToDatabase();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`   Test server running at ${baseUrl}`);

  const suffix = Date.now();
  let groupId;
  const aEmail = `rev_a_${suffix}@vasooltest.com`;
  const bEmail = `rev_b_${suffix}@vasooltest.com`;
  const cEmail = `rev_c_${suffix}@vasooltest.com`;
  const outEmail = `rev_out_${suffix}@vasooltest.com`;

  try {
    const userA = await User.create({ name: 'Alpha', email: aEmail, isEmailVerified: true });
    const userB = await User.create({ name: 'Beta', email: bEmail, isEmailVerified: true });
    const userC = await User.create({ name: 'Gamma', email: cEmail, isEmailVerified: true });
    const userOut = await User.create({ name: 'Outsider', email: outEmail, isEmailVerified: true });
    const tokenA = signAuthToken(userA);
    const tokenB = signAuthToken(userB);
    const tokenC = signAuthToken(userC);
    const tokenOut = signAuthToken(userOut);

    const createGrp = await request('POST', '/api/groups', {
      name: `Revert Group ${suffix}`,
      category: 'Trip',
      members: [
        { name: 'Beta', email: bEmail, defaultWeight: 1 },
        { name: 'Gamma', email: cEmail, defaultWeight: 1 }
      ]
    }, tokenA);
    assert.strictEqual(createGrp.status, 201, 'Group creation must succeed');
    groupId = createGrp.body.group._id;
    await request('POST', `/api/groups/${groupId}/accept-invite`, {}, tokenB);
    await request('POST', `/api/groups/${groupId}/accept-invite`, {}, tokenC);

    await request('POST', '/api/expenses', {
      groupId,
      description: 'Cabin',
      amount: 1200,
      paidByEmail: aEmail,
      paidByName: 'Alpha',
      splitType: 'equal',
      splits: [
        { memberEmail: aEmail, memberName: 'Alpha', amount: 400 },
        { memberEmail: bEmail, memberName: 'Beta', amount: 400 },
        { memberEmail: cEmail, memberName: 'Gamma', amount: 400 }
      ]
    }, tokenA);

    // Beta records a ₹400 settlement to Alpha (pending confirmation)
    const rec = await request('POST', '/api/settlements', {
      groupId,
      fromEmail: bEmail,
      fromName: 'Beta',
      toEmail: aEmail,
      toName: 'Alpha',
      amount: 400,
      method: 'UPI'
    }, tokenB);
    assert.strictEqual(rec.status, 201, 'Settlement recording must succeed');
    const stlId = rec.body.settlement._id;
    assert.strictEqual(rec.body.settlement.recordedByEmail, bEmail, 'Recorder must be stored');

    // Alpha confirms receipt
    const conf = await request('POST', `/api/settlements/${stlId}/confirm`, {}, tokenA);
    assert.strictEqual(conf.status, 200, 'Recipient must confirm settlement');
    assert.strictEqual(conf.body.settlement.status, 'confirmed');

    let bal = await request('GET', `/api/balances?groupId=${groupId}`, null, tokenA);
    assert.strictEqual(bal.status, 200);
    assert(!bal.body.simplifiedTransactions.some((t) => t.fromEmail === bEmail && t.toEmail === aEmail), 'Confirmed settlement must close that debt');
    console.log('   ✅ Confirmed settlement squares off balances');

    // Outsider cannot revert
    const outRes = await request('POST', `/api/settlements/${stlId}/revert`, {}, tokenOut);
    assert.strictEqual(outRes.status, 403, 'Unrelated user must not revert');
    console.log('   ✅ Unrelated user blocked with 403');

    // Payer (Beta) reverts the confirmed settlement
    const rev = await request('POST', `/api/settlements/${stlId}/revert`, {}, tokenB);
    assert.strictEqual(rev.status, 200, 'Payer must be able to revert');
    assert.strictEqual(rev.body.settlement.status, 'reverted');
    assert(rev.body.settlement.revertedAt, 'Revert timestamp must be stored');
    console.log('   ✅ Payer reverted the settlement');

    // Idempotent
    const revAgain = await request('POST', `/api/settlements/${stlId}/revert`, {}, tokenA);
    assert.strictEqual(revAgain.status, 200, 'Repeat revert must be idempotent');
    assert.strictEqual(revAgain.body.alreadyReverted, true);

    // Debt is due again
    bal = await request('GET', `/api/balances?groupId=${groupId}`, null, tokenA);
    const bToA = bal.body.simplifiedTransactions.find((t) => t.fromEmail === bEmail && t.toEmail === aEmail);
    assert(bToA, 'Reverted settlement must restore the debt');
    assert.strictEqual(bToA.amount, 400, 'Restored debt must be the full amount');
    console.log('   ✅ Reverted settlement restores the ₹400 debt');

    // Recipient can revert a pending claim recorded by someone else
    const rec2 = await request('POST', '/api/settlements', {
      groupId,
      fromEmail: cEmail,
      fromName: 'Gamma',
      toEmail: aEmail,
      toName: 'Alpha',
      amount: 400,
      method: 'UPI'
    }, tokenC);
    const stl2 = rec2.body.settlement._id;
    const rev2 = await request('POST', `/api/settlements/${stl2}/revert`, {}, tokenA);
    assert.strictEqual(rev2.status, 200, 'Recipient must be able to revert a pending claim');
    console.log('   ✅ Recipient reverted a pending claim');

    // Rejected claims cannot be reverted
    const rec3 = await request('POST', '/api/settlements', {
      groupId,
      fromEmail: bEmail,
      fromName: 'Beta',
      toEmail: aEmail,
      toName: 'Alpha',
      amount: 100,
      method: 'UPI'
    }, tokenB);
    const stl3 = rec3.body.settlement._id;
    await request('POST', `/api/settlements/${stl3}/reject`, { reason: 'Not received' }, tokenA);
    const rev3 = await request('POST', `/api/settlements/${stl3}/revert`, {}, tokenB);
    assert.strictEqual(rev3.status, 400, 'Rejected claims cannot be reverted');
    console.log('   ✅ Rejected claims rejected with 400');

    // Settlement plan privacy: show_all still hides other members' transfers
    await Group.findByIdAndUpdate(groupId, { splitsVisibility: 'show_all' });
    const cBal = await request('GET', `/api/balances?groupId=${groupId}`, null, tokenC);
    assert.strictEqual(cBal.status, 200);
    const leaked = cBal.body.simplifiedTransactions.find(
      (t) => t.fromEmail === bEmail && t.toEmail === aEmail
    );
    assert(!leaked, 'Non-admin must not see other members in settlement plan even with show_all');
    assert(!cBal.body.balances.some((b) => b.email === bEmail), 'Non-admin balances must hide other members');
    const aBal = await request('GET', `/api/balances?groupId=${groupId}`, null, tokenA);
    assert(aBal.body.simplifiedTransactions.some((t) => t.fromEmail === bEmail && t.toEmail === aEmail), 'Admin must still see all transfers');
    console.log('   ✅ show_all hides others in settlement plan, admin still sees all');

    console.log('\n🎉 ALL SETTLEMENT REVERT & PRIVACY TESTS PASSED');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (groupId) {
      await Settlement.deleteMany({ groupId });
      await Expense.deleteMany({ groupId });
      await Group.deleteMany({ _id: groupId });
    }
    await User.deleteMany({ email: { $in: [aEmail, bEmail, cEmail, outEmail] } });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
