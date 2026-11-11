const http = require('http');
const mongoose = require('mongoose');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { signAuthToken, authRouter } = require('../routes/auth');
const { splitsRouter } = require('../routes/splits');
const express = require('express');

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
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (e) {
            json = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Remove Member Test Suite ---');
  await connectToDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', splitsRouter);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  const testId = Date.now();
  const adminEmail = `admin_rm_${testId}@test.local`;
  const nonAdminEmail = `nonadmin_rm_${testId}@test.local`;
  const memberDebtEmail = `debt_rm_${testId}@test.local`;
  const memberCleanEmail = `clean_rm_${testId}@test.local`;

  // Fixtures
  const adminUser = await User.create({
    name: 'Admin User',
    fullName: 'Admin User',
    email: adminEmail,
    passwordHash: 'dummyhash',
    verified: true
  });

  const nonAdminUser = await User.create({
    name: 'Non Admin User',
    fullName: 'Non Admin User',
    email: nonAdminEmail,
    passwordHash: 'dummyhash',
    verified: true
  });

  const adminToken = signAuthToken(adminUser);
  const nonAdminToken = signAuthToken(nonAdminUser);

  const group = await Group.create({
    name: `Test Group ${testId}`,
    inviteCode: `TEST_RM_${testId}`,
    createdByEmail: adminEmail,
    adminEmail: adminEmail,
    members: [
      { name: 'Admin User', email: adminEmail, role: 'admin', status: 'active' },
      { name: 'Non Admin User', email: nonAdminEmail, role: 'member', status: 'active' },
      { name: 'Debt Member', email: memberDebtEmail, role: 'member', status: 'active' },
      { name: 'Clean Member', email: memberCleanEmail, role: 'member', status: 'active' }
    ]
  });

  // Create an expense: Admin paid 300, split between Admin, Debt Member, Clean Member
  // Admin paid 300. Debt Member owes 100. Clean Member has balance settled later or owes 0.
  await Expense.create({
    groupId: group._id,
    description: 'Dinner Party',
    amount: 200,
    paidByEmail: adminEmail,
    paidByName: 'Admin User',
    splitType: 'exact',
    splits: [
      { memberEmail: adminEmail, memberName: 'Admin User', amount: 100 },
      { memberEmail: memberDebtEmail, memberName: 'Debt Member', amount: 100 }
    ]
  });

  console.log('Group & Expenses created. Running test cases...');

  try {
    // 1. Non-admin cannot remove member (403)
    const t1 = await request('POST', `/api/groups/${group._id}/remove-member`, { targetEmail: memberCleanEmail }, nonAdminToken);
    console.log('Test 1 (Non-admin 403 Forbidden):', t1.status === 403 ? 'PASS' : `FAIL (${t1.status})`);
    if (t1.status !== 403) throw new Error('Expected 403 for non-admin');

    // 2. Admin cannot remove self (400)
    const t2 = await request('POST', `/api/groups/${group._id}/remove-member`, { targetEmail: adminEmail }, adminToken);
    console.log('Test 2 (Admin self-removal blocked 400):', t2.status === 400 ? 'PASS' : `FAIL (${t2.status})`);
    if (t2.status !== 400) throw new Error('Expected 400 for admin self-removal');

    // 3. Remove non-existent member (404)
    const t3 = await request('POST', `/api/groups/${group._id}/remove-member`, { targetEmail: 'ghost@test.local' }, adminToken);
    console.log('Test 3 (Member not found 404):', t3.status === 404 ? 'PASS' : `FAIL (${t3.status})`);
    if (t3.status !== 404) throw new Error('Expected 404 for ghost member');

    // 4. Remove member with debt without force -> blocked with canForce=true (400)
    const t4 = await request('POST', `/api/groups/${group._id}/remove-member`, { targetEmail: memberDebtEmail, force: false }, adminToken);
    console.log('Test 4 (Unsettled balance without force 400 + canForce):', t4.status === 400 && t4.body.canForce === true ? 'PASS' : `FAIL (${t4.status})`);
    if (t4.status !== 400 || !t4.body.canForce) throw new Error('Expected 400 with canForce: true');

    // 5. Remove member with debt WITH force -> 200 Success
    const t5 = await request('POST', `/api/groups/${group._id}/remove-member`, { targetEmail: memberDebtEmail, force: true }, adminToken);
    console.log('Test 5 (Force removal of indebted member 200):', t5.status === 200 && t5.body.success === true ? 'PASS' : `FAIL (${t5.status})`);
    if (t5.status !== 200) throw new Error('Expected 200 for force removal');

    // Verify memberDebtEmail is removed from group in DB
    const gCheck1 = await Group.findById(group._id);
    const stillHasDebtMember = gCheck1.members.some(m => m.email === memberDebtEmail);
    console.log('Test 5b (Debt member excluded from DB):', !stillHasDebtMember ? 'PASS' : 'FAIL');
    if (stillHasDebtMember) throw new Error('Debt member still in group');

    // 6. Remove member with clean zero balance without force -> 200 Success
    const t6 = await request('POST', `/api/groups/${group._id}/remove-member`, { targetEmail: memberCleanEmail }, adminToken);
    console.log('Test 6 (Normal removal of clean member 200):', t6.status === 200 && t6.body.success === true ? 'PASS' : `FAIL (${t6.status})`);
    if (t6.status !== 200) throw new Error('Expected 200 for clean removal');

    const gCheck2 = await Group.findById(group._id);
    const stillHasCleanMember = gCheck2.members.some(m => m.email === memberCleanEmail);
    console.log('Test 6b (Clean member excluded from DB):', !stillHasCleanMember ? 'PASS' : 'FAIL');
    if (stillHasCleanMember) throw new Error('Clean member still in group');

    console.log('--- ALL 6/6 REMOVE MEMBER TESTS PASSED! ---');
  } finally {
    // Cleanup fixtures
    await Group.deleteOne({ _id: group._id });
    await Expense.deleteMany({ groupId: group._id });
    await User.deleteMany({ _id: { $in: [adminUser._id, nonAdminUser._id] } });
    if (server) server.close();
    await mongoose.connection.close();
  }
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
