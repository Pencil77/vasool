const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('🧪 Starting Debt-Aware Split Settlement Status Test Suite...\n');

// 1. Load dashboard-and-expenses.js in a VM context to test getSplitSettlementStatus directly
const dashboardJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');

// Set up mock window and environment
const mockWindow = {
  formatINR: (val) => `₹${Number(val).toFixed(2)}`,
  escapeHtml: (str) => String(str || ''),
};

const sandbox = {
  window: mockWindow,
  formatINR: mockWindow.formatINR,
  escapeHtml: mockWindow.escapeHtml,
  appState: { groups: [], expenses: [], settlements: [], currentUser: { email: 'zubair@example.com' } },
  selectedGroupId: 'ALL',
  console: console,
  document: {
    getElementById: () => null,
    querySelectorAll: () => []
  }
};

vm.createContext(sandbox);

// Extract getSplitSettlementStatus function by evaluating dashboard-and-expenses.js
// Since dashboard-and-expenses.js defines window.getSplitSettlementStatus, we can extract it:
try {
  const start = dashboardJs.indexOf('function getSplitSettlementStatus');
  const end = dashboardJs.indexOf('function renderExpensesList');
  assert(start !== -1 && end !== -1, 'getSplitSettlementStatus must exist in dashboard-and-expenses.js');
  const fnCode = dashboardJs.substring(start, end);
  vm.runInContext(fnCode, sandbox);
} catch (err) {
  console.error('Failed to parse getSplitSettlementStatus:', err);
  process.exit(1);
}

const getSplitSettlementStatus = sandbox.window.getSplitSettlementStatus;
assert.strictEqual(typeof getSplitSettlementStatus, 'function', 'getSplitSettlementStatus must be a function');

// =========================================================================
// TEST 1: Payer gets (Payer) tag, not Settled
// =========================================================================
console.log('--- Test 1: Payer Identification ---');
const payerSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'pavansaikasula@gmail.com', memberName: 'Pavan Sai', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  simplified: [{ groupId: 'grp1', fromEmail: 'praneeth@example.com', toEmail: 'pavansaikasula@gmail.com', amount: 214.50 }],
  pendingSettlements: [],
  isFullyClosed: false,
  isMinimizedMode: false
});
assert.strictEqual(payerSplitStatus.isPayer, true, 'Payer must have isPayer: true');
assert.strictEqual(payerSplitStatus.isSettled, false, 'Payer is not marked isSettled');
assert.strictEqual(payerSplitStatus.tag.includes('(Payer)'), true, 'Payer tag must say (Payer)');
console.log('✅ Test 1 Passed: Payer correctly assigned (Payer) status tag.');

// =========================================================================
// TEST 2: Participant who owes the payer gets "Left to Pay", NEVER "Settled"
// (The exact bug reported by Zoro: Pavan paid for Praneeth, but it showed Settled)
// =========================================================================
console.log('--- Test 2: Unpaid Split Debtor (Zoro Bug Reproduction) ---');
const unpaidSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  simplified: [{ groupId: 'grp1', fromEmail: 'praneeth@example.com', toEmail: 'pavansaikasula@gmail.com', amount: 225.34 }],
  pendingSettlements: [],
  isFullyClosed: false,
  isMinimizedMode: false
});
assert.strictEqual(unpaidSplitStatus.isPayer, false, 'Participant is not payer');
assert.strictEqual(unpaidSplitStatus.isSettled, false, 'Participant who owes payer must NOT be marked settled!');
assert.strictEqual(unpaidSplitStatus.hasPending, false, 'No pending payment');
assert.strictEqual(unpaidSplitStatus.tag.includes('Left to Pay'), true, 'Must display Left to Pay');
assert.strictEqual(unpaidSplitStatus.pillClass.includes('border-slate-700'), true, 'Must use standard unpaid pill border');
console.log('✅ Test 2 Passed: Unpaid debtor is accurately marked "⏳ Left to Pay", NOT "✓ Settled".');

// =========================================================================
// TEST 3: Participant with pending unconfirmed settlement
// =========================================================================
console.log('--- Test 3: Unconfirmed Pending Settlement ---');
const pendingSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  simplified: [{ groupId: 'grp1', fromEmail: 'praneeth@example.com', toEmail: 'pavansaikasula@gmail.com', amount: 225.34 }],
  pendingSettlements: [{ groupId: 'grp1', fromEmail: 'praneeth@example.com', toEmail: 'pavansaikasula@gmail.com', amount: 225.34 }],
  isFullyClosed: false,
  isMinimizedMode: false
});
assert.strictEqual(pendingSplitStatus.isPayer, false);
assert.strictEqual(pendingSplitStatus.isSettled, false);
assert.strictEqual(pendingSplitStatus.hasPending, true, 'Must indicate pending');
assert.strictEqual(pendingSplitStatus.tag.includes('Unconfirmed'), true, 'Must display Unconfirmed tag');
assert.strictEqual(pendingSplitStatus.pillClass.includes('border-amber-500'), true, 'Must use amber pill styling');
console.log('✅ Test 3 Passed: Pending settlement displays "⏳ Unconfirmed" with amber badge.');

// =========================================================================
// TEST 4: Fully Settled participant (no active debts to payer)
// =========================================================================
console.log('--- Test 4: Fully Settled Split ---');
const settledSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  simplified: [], // No debt to payer
  pendingSettlements: [],
  isFullyClosed: false,
  isMinimizedMode: false
});
assert.strictEqual(settledSplitStatus.isPayer, false);
assert.strictEqual(settledSplitStatus.isSettled, true, 'Must be settled when no debt exists');
assert.strictEqual(settledSplitStatus.tag.includes('✓ Settled'), true, 'Must display ✓ Settled tag');
assert.strictEqual(settledSplitStatus.pillClass.includes('border-emerald-500'), true, 'Must use emerald border');
console.log('✅ Test 4 Passed: Fully settled split displays "✓ Settled" with emerald badge.');

// =========================================================================
// TEST 5: Verify group-isolation (debts in Group B do not affect Group A)
// =========================================================================
console.log('--- Test 5: Multi-Group Debt Isolation ---');
const isolatedStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  simplified: [
    // Praneeth owes Pavan in grp2, but NOT in grp1
    { groupId: 'grp2', fromEmail: 'praneeth@example.com', toEmail: 'pavansaikasula@gmail.com', amount: 500 }
  ],
  pendingSettlements: [],
  isFullyClosed: false,
  isMinimizedMode: false
});
assert.strictEqual(isolatedStatus.isSettled, true, 'Must be settled in grp1 since debt is only in grp2');
console.log('✅ Test 5 Passed: Group isolation prevents cross-group debt pollution.');

// =========================================================================
// TEST 6: Static file check in groups-and-modals.js
// =========================================================================
console.log('--- Test 6: groups-and-modals.js Integration ---');
const groupsJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');
assert.strictEqual(groupsJs.includes('getSplitSettlementStatus'), true, 'groups-and-modals.js must call getSplitSettlementStatus');
assert.strictEqual(groupsJs.includes('const isGroupMinimized = grp.minimizeDebts !== false;'), true, 'groups-and-modals.js must compute isGroupMinimized');
console.log('✅ Test 6 Passed: groups-and-modals.js cleanly integrates getSplitSettlementStatus.');

console.log('\n======================================================');
console.log('🎉 ALL 6 DEBT-AWARE SETTLEMENT TESTS PASSED SUCCESSFULLY!');
console.log('======================================================\n');
