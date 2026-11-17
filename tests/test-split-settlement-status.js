const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('🧪 Starting Evidence-Based Split Settlement Status Test Suite...\n');

const dashboardJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');

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
vm.runInContext(dashboardJs, sandbox);

const getSplitSettlementStatus = sandbox.window.getSplitSettlementStatus;
const buildGroupSplitSettlementLedger = sandbox.window.buildGroupSplitSettlementLedger;

assert.strictEqual(typeof getSplitSettlementStatus, 'function', 'getSplitSettlementStatus must be a function');
assert.strictEqual(typeof buildGroupSplitSettlementLedger, 'function', 'buildGroupSplitSettlementLedger must be a function');

// =========================================================================
// TEST 1: Payer gets (Payer) tag, not Settled
// =========================================================================
console.log('--- Test 1: Payer Identification ---');
const payerSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'pavansaikasula@gmail.com', memberName: 'Pavan Sai', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  ledger: {}
});
assert.strictEqual(payerSplitStatus.isPayer, true, 'Payer must have isPayer: true');
assert.strictEqual(payerSplitStatus.isSettled, false, 'Payer is not marked isSettled');
assert.strictEqual(payerSplitStatus.tag.includes('(Payer)'), true, 'Payer tag must say (Payer)');
console.log('✅ Test 1 Passed: Payer correctly assigned (Payer) status tag.');

// =========================================================================
// TEST 2: No settlement recorded -> Left to Pay, never Settled
// =========================================================================
console.log('--- Test 2: Unpaid Split Debtor ---');
const unpaidSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  ledger: { 'exp1|praneeth@example.com': { owed: 214.50, confirmed: 0, pending: 0 } }
});
assert.strictEqual(unpaidSplitStatus.isPayer, false);
assert.strictEqual(unpaidSplitStatus.isSettled, false, 'Participant who never paid must NOT be marked settled!');
assert.strictEqual(unpaidSplitStatus.hasPending, false);
assert.strictEqual(unpaidSplitStatus.tag.includes('Left to Pay'), true, 'Must display Left to Pay');
console.log('✅ Test 2 Passed: Unpaid debtor is accurately marked "⏳ Left to Pay".');

// =========================================================================
// TEST 3: Pending (recorded but unacknowledged) settlement
// =========================================================================
console.log('--- Test 3: Unconfirmed Pending Settlement ---');
const pendingSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  ledger: { 'exp1|praneeth@example.com': { owed: 214.50, confirmed: 0, pending: 225.34 } }
});
assert.strictEqual(pendingSplitStatus.isSettled, false);
assert.strictEqual(pendingSplitStatus.hasPending, true, 'Must indicate pending');
assert.strictEqual(pendingSplitStatus.pendingAmount, 214.50, 'Pending amount must be clamped to the share owed');
assert.strictEqual(pendingSplitStatus.tag.includes('Unconfirmed'), true, 'Must display Unconfirmed tag');
assert.strictEqual(pendingSplitStatus.pillClass.includes('border-amber-500'), true, 'Must use amber pill styling');
console.log('✅ Test 3 Passed: Pending settlement displays "⏳ Unconfirmed".');

// =========================================================================
// TEST 4: Receiver acknowledged a covering confirmed settlement -> Settled
// =========================================================================
console.log('--- Test 4: Fully Settled Split (confirmed settlement) ---');
const settledSplitStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 214.50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  ledger: { 'exp1|praneeth@example.com': { owed: 214.50, confirmed: 214.50, pending: 0 } }
});
assert.strictEqual(settledSplitStatus.isSettled, true, 'Must be settled only when a confirmed settlement covers the share');
assert.strictEqual(settledSplitStatus.tag.includes('✓ Settled'), true);
assert.strictEqual(settledSplitStatus.pillClass.includes('border-emerald-500'), true);
console.log('✅ Test 4 Passed: Confirmed + acknowledged share displays "✓ Settled".');

// =========================================================================
// TEST 5: Net-zero group balancing must NOT mark unpaid shares settled
// (regression for the reported bug: no payment recorded/acknowledged)
// =========================================================================
console.log('--- Test 5: Net-Zero Must Not Imply Settled ---');
const netZeroStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 50 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  ledger: { 'exp1|praneeth@example.com': { owed: 50, confirmed: 0, pending: 0 } }
});
assert.strictEqual(netZeroStatus.isSettled, false, 'No confirmed settlement means the share stays open even if group nets to zero');
assert.strictEqual(netZeroStatus.debtAmount, 50);
console.log('✅ Test 5 Passed: Net-zero balancing does not create a false "Settled".');

// =========================================================================
// TEST 6: Partial confirmed payment keeps the remainder open
// =========================================================================
console.log('--- Test 6: Partial Confirmed Payment ---');
const partialStatus = getSplitSettlementStatus({
  expense: { id: 'exp1', groupId: 'grp1' },
  split: { memberEmail: 'praneeth@example.com', memberName: 'Praneeth', amount: 300 },
  payerEmails: new Set(['pavansaikasula@gmail.com']),
  ledger: { 'exp1|praneeth@example.com': { owed: 300, confirmed: 100, pending: 0 } }
});
assert.strictEqual(partialStatus.isSettled, false);
assert.strictEqual(partialStatus.debtAmount, 200, 'Only the confirmed part is settled');
assert.strictEqual(partialStatus.tag.includes('Left to Pay'), true);
console.log('✅ Test 6 Passed: Partial confirmed payment leaves ₹200 open.');

// =========================================================================
// TEST 7: Ledger allocates confirmed settlements oldest-bill-first
// =========================================================================
console.log('--- Test 7: Ledger Allocation (oldest bill first) ---');
const ledgerExpenses = [
  {
    id: 'e1', groupId: 'g1', amount: 100, paidByEmail: 'a@test.com', paidByName: 'A', type: 'expense',
    expenseDate: '2026-01-01T00:00:00.000Z',
    splits: [{ memberEmail: 'a@test.com', memberName: 'A', amount: 50 }, { memberEmail: 'b@test.com', memberName: 'B', amount: 50 }]
  },
  {
    id: 'e2', groupId: 'g1', amount: 200, paidByEmail: 'a@test.com', paidByName: 'A', type: 'expense',
    expenseDate: '2026-02-01T00:00:00.000Z',
    splits: [{ memberEmail: 'a@test.com', memberName: 'A', amount: 100 }, { memberEmail: 'b@test.com', memberName: 'B', amount: 100 }]
  }
];
const ledgerSettlements = [
  { id: 's1', groupId: 'g1', fromEmail: 'b@test.com', toEmail: 'a@test.com', amount: 60, status: 'confirmed' },
  { id: 's2', groupId: 'g1', fromEmail: 'b@test.com', toEmail: 'a@test.com', amount: 40, status: 'pending_confirmation' }
];
const ledger = buildGroupSplitSettlementLedger('g1', ledgerExpenses, ledgerSettlements);
assert.deepStrictEqual({ ...ledger['e1|b@test.com'] }, { owed: 50, confirmed: 50, pending: 0 }, 'Oldest bill must be covered first');
assert.deepStrictEqual({ ...ledger['e2|b@test.com'] }, { owed: 100, confirmed: 10, pending: 40 }, 'Remainder flows to the newer bill');

const e1Status = getSplitSettlementStatus({ expense: ledgerExpenses[0], split: { memberEmail: 'b@test.com', amount: 50 }, payerEmails: new Set(['a@test.com']), ledger });
const e2Status = getSplitSettlementStatus({ expense: ledgerExpenses[1], split: { memberEmail: 'b@test.com', amount: 100 }, payerEmails: new Set(['a@test.com']), ledger });
assert.strictEqual(e1Status.isSettled, true, 'Oldest bill fully covered by confirmed payment');
assert.strictEqual(e2Status.isSettled, false, 'Newer bill still open');
assert.strictEqual(e2Status.hasPending, true, 'Newer bill shows the recorded-but-unconfirmed remainder');
console.log('✅ Test 7 Passed: Confirmed ₹60 covers oldest bill; newer bill correctly stays open.');

// =========================================================================
// TEST 8: Ledger ignores rejected/reverted settlements
// =========================================================================
console.log('--- Test 8: Rejected/Reverted Ignored ---');
const ignoredLedger = buildGroupSplitSettlementLedger('g1', ledgerExpenses, [
  { id: 's3', groupId: 'g1', fromEmail: 'b@test.com', toEmail: 'a@test.com', amount: 500, status: 'rejected' },
  { id: 's4', groupId: 'g1', fromEmail: 'b@test.com', toEmail: 'a@test.com', amount: 500, status: 'reverted' }
]);
assert.deepStrictEqual({ ...ignoredLedger['e1|b@test.com'] }, { owed: 50, confirmed: 0, pending: 0 });
assert.deepStrictEqual({ ...ignoredLedger['e2|b@test.com'] }, { owed: 100, confirmed: 0, pending: 0 });
console.log('✅ Test 8 Passed: Rejected/reverted settlements never mark shares settled.');

// =========================================================================
// TEST 9: Static integration check
// =========================================================================
console.log('--- Test 9: groups-and-modals.js Integration ---');
const groupsJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');
assert.strictEqual(groupsJs.includes('getSplitSettlementStatus'), true, 'groups-and-modals.js must call getSplitSettlementStatus');
assert.strictEqual(groupsJs.includes('buildGroupSplitSettlementLedger'), true, 'groups-and-modals.js must build the settlement ledger');
console.log('✅ Test 9 Passed: groups-and-modals.js integrates the evidence-based ledger.');

console.log('\n======================================================');
console.log('🎉 ALL EVIDENCE-BASED SETTLEMENT TESTS PASSED SUCCESSFULLY!');
console.log('======================================================\n');
