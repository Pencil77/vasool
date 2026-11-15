const assert = require('assert');
const {
  isUserInvolvedInExpense,
  calculateDirectDebts,
  simplifyDebtsGreedy,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
} = require('../lib/debt-engine');

console.log('🧪 Starting Test Suite: Involved Bills Privacy & Dynamic Debt Calculation Modes...\n');

// =========================================================================
// TEST 1: isUserInvolvedInExpense Helper Logic
// =========================================================================
console.log('--- Test 1: User Involvement Detection ---');

const bill1 = {
  id: 'exp1',
  description: 'Team Dinner',
  amount: 3000,
  paidByEmail: 'alice@test.com',
  paidByName: 'Alice',
  paidByAllocations: [],
  splits: [
    { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 1000 },
    { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1000 },
    { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 1000 }
  ],
  createdByEmail: 'alice@test.com'
};

const bill2 = {
  id: 'exp2',
  description: 'Coffee between Bob and Charlie',
  amount: 200,
  paidByEmail: 'bob@test.com',
  paidByName: 'Bob',
  paidByAllocations: [],
  splits: [
    { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 100 },
    { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 100 }
  ],
  createdByEmail: 'bob@test.com'
};

const billMultiPayer = {
  id: 'exp3',
  description: 'Shared Airbnb',
  amount: 6000,
  paidByEmail: 'alice@test.com',
  paidByAllocations: [
    { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 3000 },
    { memberEmail: 'dave@test.com', memberName: 'Dave', amount: 3000 }
  ],
  splits: [
    { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 1500 },
    { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1500 },
    { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 1500 },
    { memberEmail: 'dave@test.com', memberName: 'Dave', amount: 1500 }
  ],
  createdByEmail: 'organizer@test.com'
};

// Alice involved in Bill 1 (payer, split, creator)
assert.strictEqual(isUserInvolvedInExpense(bill1, 'alice@test.com'), true);
assert.strictEqual(isUserInvolvedInExpense(bill1, 'ALICE@TEST.COM '), true, 'Must be case-insensitive');

// Bob involved in Bill 1 (split participant)
assert.strictEqual(isUserInvolvedInExpense(bill1, 'bob@test.com'), true);

// Dave is NOT involved in Bill 1
assert.strictEqual(isUserInvolvedInExpense(bill1, 'dave@test.com'), false);

// Alice is NOT involved in Bill 2 (only Bob and Charlie)
assert.strictEqual(isUserInvolvedInExpense(bill2, 'alice@test.com'), false);

// Dave is involved in Multi-payer bill 3 via allocations
assert.strictEqual(isUserInvolvedInExpense(billMultiPayer, 'dave@test.com'), true);

// Organizer is involved in Bill 3 via createdByEmail
assert.strictEqual(isUserInvolvedInExpense(billMultiPayer, 'organizer@test.com'), true);

// Eve has no involvement in any bill
assert.strictEqual(isUserInvolvedInExpense(bill1, 'eve@test.com'), false);
assert.strictEqual(isUserInvolvedInExpense(bill2, 'eve@test.com'), false);
assert.strictEqual(isUserInvolvedInExpense(billMultiPayer, 'eve@test.com'), false);

console.log('✅ Test 1 Passed: User involvement detection is 100% accurate across single-payer, multi-payer, splits, and creator roles.\n');

// =========================================================================
// TEST 2: Filtered Bills Visibility Simulation
// =========================================================================
console.log('--- Test 2: Filtered Bills Visibility Simulation ---');

const allExpenses = [bill1, bill2, billMultiPayer];

// Alice's perspective (non-admin in group):
const aliceVisible = allExpenses.filter((e) => isUserInvolvedInExpense(e, 'alice@test.com'));
assert.strictEqual(aliceVisible.length, 2, 'Alice should only see Bill 1 and Bill 3');
assert.strictEqual(aliceVisible.some((e) => e.id === 'exp2'), false, 'Alice must NEVER see Bill 2 (Coffee between Bob and Charlie)');

// Bob's perspective:
const bobVisible = allExpenses.filter((e) => isUserInvolvedInExpense(e, 'bob@test.com'));
assert.strictEqual(bobVisible.length, 3, 'Bob is involved in all 3 bills');

// Dave's perspective:
const daveVisible = allExpenses.filter((e) => isUserInvolvedInExpense(e, 'dave@test.com'));
assert.strictEqual(daveVisible.length, 1, 'Dave should only see Bill 3');
assert.strictEqual(daveVisible[0].id, 'exp3');

// Eve's perspective:
const eveVisible = allExpenses.filter((e) => isUserInvolvedInExpense(e, 'eve@test.com'));
assert.strictEqual(eveVisible.length, 0, 'Eve is involved in 0 bills and sees 0 bills');

console.log('✅ Test 2 Passed: Users strictly only see bills they are involved in, completely hiding uninvolved private group bills.\n');

// =========================================================================
// TEST 3: Dynamic Debt Minimization Toggling across ALL Unsettled Bills
// =========================================================================
console.log('--- Test 3: Retroactive Application of Fewest Transfers vs Direct Pair-Wise ---');

const groupScenario = {
  id: 'grp_trip',
  name: 'Goa Holiday',
  minimizeDebts: true,
  members: [
    { email: 'alice@test.com', name: 'Alice', role: 'admin' },
    { email: 'bob@test.com', name: 'Bob', role: 'member' },
    { email: 'charlie@test.com', name: 'Charlie', role: 'member' }
  ]
};

// Bill A: Alice pays 300, split 3-ways with Alice, Bob, Charlie (100 each)
const expenseA = {
  groupId: 'grp_trip',
  description: 'Lunch',
  amount: 300,
  paidByEmail: 'alice@test.com',
  paidByName: 'Alice',
  paidByAllocations: [],
  splits: [
    { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 100 },
    { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 100 },
    { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 100 }
  ]
};

// Bill B: Bob pays 100, split 2-ways with Bob, Charlie (50 each)
const expenseB = {
  groupId: 'grp_trip',
  description: 'Taxi',
  amount: 100,
  paidByEmail: 'bob@test.com',
  paidByName: 'Bob',
  paidByAllocations: [],
  splits: [
    { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 50 },
    { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 50 }
  ]
};

const groupExpenses = [expenseA, expenseB];
const settlements = [];

// MODE 1: Fewest Transfers (Minimized Net Cash Flow: minimizeDebts = true)
groupScenario.minimizeDebts = true;
const balanceMap1 = computeGroupBalanceMap(groupScenario, groupExpenses, settlements);
const simplifiedMode1 = computeGroupSimplifiedDebts(groupScenario, balanceMap1, groupExpenses, settlements);

console.log('Fewest Transfers Result:');
simplifiedMode1.forEach((t) => console.log(`   ${t.fromName} pays ${t.toName}: ₹${t.amount} (${t.type})`));

assert.strictEqual(simplifiedMode1.length, 2, 'Fewest transfers should simplify to 2 transactions');
// Net balances: Alice: +200, Bob: -100 + 50 = -50, Charlie: -100 - 50 = -150
// Charlie pays Alice 150, Bob pays Alice 50
const charlieToAlice = simplifiedMode1.find((t) => t.fromEmail === 'charlie@test.com' && t.toEmail === 'alice@test.com');
const bobToAlice = simplifiedMode1.find((t) => t.fromEmail === 'bob@test.com' && t.toEmail === 'alice@test.com');
assert.ok(charlieToAlice, 'Charlie pays Alice');
assert.strictEqual(charlieToAlice.amount, 150);
assert.ok(bobToAlice, 'Bob pays Alice');
assert.strictEqual(bobToAlice.amount, 50);

// MODE 2: Admin toggles to Direct Pair-Wise (Exact person-to-person debts: minimizeDebts = false)
console.log('\nAdmin toggles to Direct Pair-Wise (minimizeDebts = false)...');
groupScenario.minimizeDebts = false;
const balanceMap2 = computeGroupBalanceMap(groupScenario, groupExpenses, settlements);
const directMode2 = computeGroupSimplifiedDebts(groupScenario, balanceMap2, groupExpenses, settlements);

console.log('Direct Pair-Wise Result:');
directMode2.forEach((t) => console.log(`   ${t.fromName} pays ${t.toName}: ₹${t.amount} (${t.type})`));

// In Direct Pair-Wise mode:
// From Bill A: Bob owes Alice 100, Charlie owes Alice 100
// From Bill B: Charlie owes Bob 50
// Total: 3 bilateral debts!
assert.strictEqual(directMode2.length, 3, 'Direct mode should produce 3 direct pairwise transfers');
const bobOwesAlice = directMode2.find((t) => t.fromEmail === 'bob@test.com' && t.toEmail === 'alice@test.com');
const charlieOwesAlice = directMode2.find((t) => t.fromEmail === 'charlie@test.com' && t.toEmail === 'alice@test.com');
const charlieOwesBob = directMode2.find((t) => t.fromEmail === 'charlie@test.com' && t.toEmail === 'bob@test.com');

assert.ok(bobOwesAlice, 'Bob directly owes Alice for Bill A');
assert.strictEqual(bobOwesAlice.amount, 100);
assert.strictEqual(bobOwesAlice.type, 'direct_pairwise');

assert.ok(charlieOwesAlice, 'Charlie directly owes Alice for Bill A');
assert.strictEqual(charlieOwesAlice.amount, 100);
assert.strictEqual(charlieOwesAlice.type, 'direct_pairwise');

assert.ok(charlieOwesBob, 'Charlie directly owes Bob for Bill B');
assert.strictEqual(charlieOwesBob.amount, 50);
assert.strictEqual(charlieOwesBob.type, 'direct_pairwise');

console.log('✅ Test 3 Passed: Dynamic toggle immediately switches between Fewest Transfers and Direct Pair-Wise across ALL existing unsettled bills.\n');

// =========================================================================
// TEST 4: Partial Settlement Application in Direct Pair-Wise Mode
// =========================================================================
console.log('--- Test 4: Settlement in Direct Pair-Wise Mode ---');

// Charlie pays Bob 50
const st1 = {
  id: 'st1',
  groupId: 'grp_trip',
  fromEmail: 'charlie@test.com',
  fromName: 'Charlie',
  toEmail: 'bob@test.com',
  toName: 'Bob',
  amount: 50,
  status: 'confirmed'
};

const directModeWithSettlement = computeGroupSimplifiedDebts(groupScenario, balanceMap2, groupExpenses, [st1]);
console.log('Direct Pair-Wise after Charlie pays Bob ₹50:');
directModeWithSettlement.forEach((t) => console.log(`   ${t.fromName} pays ${t.toName}: ₹${t.amount}`));

assert.strictEqual(directModeWithSettlement.length, 2, 'Charlie debt to Bob should be completely settled and removed');
assert.strictEqual(directModeWithSettlement.some((t) => t.fromEmail === 'charlie@test.com' && t.toEmail === 'bob@test.com'), false);

console.log('✅ Test 4 Passed: Direct Pair-Wise correctly eliminates settled debts between pairs.\n');

console.log('=========================================================================');
console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! Both user requests verified.');
console.log('=========================================================================');
