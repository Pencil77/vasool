/**
 * tests/test-confirmed-and-unconfirmed-amounts.js
 * Verification of dual confirmed and unconfirmed balance/owe/split reporting in Vasool.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { computeGroupBalanceMap } = require('../lib/debt-engine');

console.log('🧪 Starting Confirmed & Unconfirmed Dual-Reporting Test Suite...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

// Case 1: Backend debt-engine computes pendingPaid, pendingReceived, and unconfirmedNet
test('1. Backend computeGroupBalanceMap computes pendingPaid, pendingReceived, and unconfirmedNet', () => {
  const group = {
    id: 'g1',
    members: [
      { email: 'pavan@test.com', name: 'Pavan Sai' },
      { email: 'zubair@test.com', name: 'Zubair Mohammed' }
    ]
  };

  const expenses = [
    {
      id: 'e1',
      groupId: 'g1',
      amount: 3000,
      paidByEmail: 'zubair@test.com',
      paidByName: 'Zubair Mohammed',
      type: 'expense',
      splits: [
        { memberEmail: 'zubair@test.com', memberName: 'Zubair Mohammed', amount: 0 },
        { memberEmail: 'pavan@test.com', memberName: 'Pavan Sai', amount: 3000 }
      ]
    }
  ];

  // Pavan sends 3000 settlement to Zubair, awaiting confirmation
  const settlements = [
    {
      id: 's1',
      groupId: 'g1',
      fromEmail: 'pavan@test.com',
      fromName: 'Pavan Sai',
      toEmail: 'zubair@test.com',
      toName: 'Zubair Mohammed',
      amount: 3000,
      status: 'pending_admin_approval'
    }
  ];

  const balanceMap = computeGroupBalanceMap(group, expenses, settlements);

  // Zubair: Confirmed net +3000, pendingReceived 3000, unconfirmedNet 0
  assert.strictEqual(balanceMap['zubair@test.com'].net, 3000, 'Zubair confirmed net must be +3000');
  assert.strictEqual(balanceMap['zubair@test.com'].pendingReceived, 3000, 'Zubair pendingReceived must be 3000');
  assert.strictEqual(balanceMap['zubair@test.com'].unconfirmedNet, 0, 'Zubair unconfirmedNet must be 0 after pending');

  // Pavan: Confirmed net -3000, pendingPaid 3000, unconfirmedNet 0
  assert.strictEqual(balanceMap['pavan@test.com'].net, -3000, 'Pavan confirmed net must be -3000');
  assert.strictEqual(balanceMap['pavan@test.com'].pendingPaid, 3000, 'Pavan pendingPaid must be 3000');
  assert.strictEqual(balanceMap['pavan@test.com'].unconfirmedNet, 0, 'Pavan unconfirmedNet must be 0 after pending');
});

// Case 2: Frontend computeBalancesAndSimplifications exposes pending fields & remainingDue
test('2. Frontend computeBalancesAndSimplifications attaches pending amounts and remainingDue', () => {
  const clientCode = fs.readFileSync(require.resolve('../public/js/dashboard-and-expenses.js'), 'utf8');
  const sandbox = {
    appState: { currentUser: { email: 'pavan@test.com', name: 'Pavan Sai' }, groups: [], expenses: [], settlements: [] },
    CURRENCY_META: { INR: { symbol: '₹', rate: 1, locale: 'en-IN' } },
    activeCurrency: 'INR',
    formatINR: (v) => '₹' + Number(v).toFixed(2),
    escapeHtml: (s) => String(s),
    window: {},
    document: {
      getElementById: () => null,
      querySelectorAll: () => []
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(clientCode, sandbox);
  const clientCompute = sandbox.computeBalancesAndSimplifications;

  const mockState = {
    currentUser: { email: 'pavan@test.com', name: 'Pavan Sai' },
    groups: [{
      id: 'g1',
      name: 'Friends',
      minimizeDebts: true,
      members: [
        { email: 'pavan@test.com', name: 'Pavan Sai' },
        { email: 'zubair@test.com', name: 'Zubair Mohammed' }
      ]
    }],
    expenses: [{
      id: 'e1',
      groupId: 'g1',
      amount: 3000,
      paidByEmail: 'zubair@test.com',
      paidByName: 'Zubair Mohammed',
      type: 'expense',
      splits: [
        { memberEmail: 'pavan@test.com', memberName: 'Pavan Sai', amount: 3000 }
      ]
    }],
    settlements: [{
      id: 's1',
      groupId: 'g1',
      fromEmail: 'pavan@test.com',
      fromName: 'Pavan Sai',
      toEmail: 'zubair@test.com',
      toName: 'Zubair Mohammed',
      amount: 3000,
      status: 'pending_admin_approval'
    }]
  };

  const res = clientCompute('g1', mockState);
  assert.strictEqual(res.balanceMap['pavan@test.com'].net, -3000, 'Pavan confirmed net must be -3000');
  assert.strictEqual(res.balanceMap['pavan@test.com'].pendingPaid, 3000, 'Pavan pendingPaid must be 3000');
  assert.strictEqual(res.balanceMap['pavan@test.com'].unconfirmedNet, 0, 'Pavan unconfirmedNet must be 0');

  assert.strictEqual(res.simplified.length, 1);
  const transfer = res.simplified[0];
  assert.strictEqual(transfer.amount, 3000, 'Transfer confirmed debt must be 3000');
  assert.strictEqual(transfer.pendingApprovalAmount, 3000, 'Transfer pendingApprovalAmount must be 3000');
  assert.strictEqual(transfer.remainingDue, 0, 'Transfer remainingDue must be 0');
});

// Case 3: Partial payment reporting
test('3. Partial payment reporting: Pavan owes 3000, pays 1000 unconfirmed, remainingDue is 2000', () => {
  const clientCode = fs.readFileSync(require.resolve('../public/js/dashboard-and-expenses.js'), 'utf8');
  const sandbox = {
    appState: { currentUser: { email: 'pavan@test.com', name: 'Pavan Sai' }, groups: [], expenses: [], settlements: [] },
    CURRENCY_META: { INR: { symbol: '₹', rate: 1, locale: 'en-IN' } },
    activeCurrency: 'INR',
    formatINR: (v) => '₹' + Number(v).toFixed(2),
    escapeHtml: (s) => String(s),
    window: {},
    document: {
      getElementById: () => null,
      querySelectorAll: () => []
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(clientCode, sandbox);
  const clientCompute = sandbox.computeBalancesAndSimplifications;

  const mockState = {
    currentUser: { email: 'pavan@test.com', name: 'Pavan Sai' },
    groups: [{
      id: 'g1',
      name: 'Friends',
      minimizeDebts: true,
      members: [
        { email: 'pavan@test.com', name: 'Pavan Sai' },
        { email: 'zubair@test.com', name: 'Zubair Mohammed' }
      ]
    }],
    expenses: [{
      id: 'e1',
      groupId: 'g1',
      amount: 3000,
      paidByEmail: 'zubair@test.com',
      paidByName: 'Zubair Mohammed',
      type: 'expense',
      splits: [
        { memberEmail: 'pavan@test.com', memberName: 'Pavan Sai', amount: 3000 }
      ]
    }],
    settlements: [{
      id: 's1',
      groupId: 'g1',
      fromEmail: 'pavan@test.com',
      fromName: 'Pavan Sai',
      toEmail: 'zubair@test.com',
      toName: 'Zubair Mohammed',
      amount: 1000,
      status: 'pending_admin_approval'
    }]
  };

  const res = clientCompute('g1', mockState);
  assert.strictEqual(res.balanceMap['pavan@test.com'].net, -3000);
  assert.strictEqual(res.balanceMap['pavan@test.com'].pendingPaid, 1000);
  assert.strictEqual(res.balanceMap['pavan@test.com'].unconfirmedNet, -2000);

  const transfer = res.simplified[0];
  assert.strictEqual(transfer.amount, 3000);
  assert.strictEqual(transfer.pendingApprovalAmount, 1000);
  assert.strictEqual(transfer.remainingDue, 2000);
});

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
