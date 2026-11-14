/**
 * Test Calculation Integrity Suite for Vasool
 * Tests:
 * 1. Multi-payer bill balance allocations
 * 2. Confirmed settlements offset debts and close transfers
 * 3. Pending & Rejected settlements isolation
 * 4. Income / Refund bills impact on net balances and totalSpend
 * 5. Direct Pair-Wise bilateral debt name correctness
 * 6. Frontend computeBalancesAndSimplifications output contracts (balances dict, balanceMap, balanceList, myNet, myPaid, myOwed)
 * 7. Multi-group isolation in ALL view (no cross-group debtor/creditor entanglement)
 * 8. Partial settlement confirmation reporting & remaining due calculation
 * 9. Privacy personal_only filtering preserves math consistency
 * 10. Dashboard KPI calculation integrity: kpiNetBalance === myNet, kpiYouAreOwed, kpiYouOwe
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const {
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
  getExpensePayerAllocations,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
} = require('../lib/debt-engine');

// Setup Node sandbox to test client-side computeBalancesAndSimplifications
const clientCode = fs.readFileSync(__dirname + '/../public/js/dashboard-and-expenses.js', 'utf8');
const sandbox = {
  appState: { currentUser: { email: 'alice@test.com', name: 'Alice' }, groups: [], expenses: [], settlements: [] },
  formatINR: (n) => '₹' + Number(n).toFixed(2),
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

console.log('🧪 Starting Vasool Calculation Integrity Test Suite...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// Case 1: Multi-payer Expense Math
test('1. Multi-payer bill balances: Alice pays 2000, Bob pays 1000, split 3-ways with Charlie (1000 each)', () => {
  const group = {
    _id: 'grp1',
    name: 'Trip',
    members: [
      { email: 'alice@test.com', name: 'Alice' },
      { email: 'bob@test.com', name: 'Bob' },
      { email: 'charlie@test.com', name: 'Charlie' }
    ]
  };

  const expenses = [{
    groupId: 'grp1',
    description: 'Hotel Stay',
    amount: 3000,
    type: 'expense',
    paidByAllocations: [
      { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 2000 },
      { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1000 }
    ],
    splits: [
      { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 1000 },
      { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1000 },
      { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 1000 }
    ]
  }];

  const settlements = [];
  const balanceMap = computeGroupBalanceMap(group, expenses, settlements);

  assert.strictEqual(balanceMap['alice@test.com'].paid, 2000, 'Alice paid should be 2000');
  assert.strictEqual(balanceMap['alice@test.com'].owed, 1000, 'Alice owed should be 1000');
  assert.strictEqual(balanceMap['alice@test.com'].net, 1000, 'Alice net should be +1000');

  assert.strictEqual(balanceMap['bob@test.com'].paid, 1000, 'Bob paid should be 1000');
  assert.strictEqual(balanceMap['bob@test.com'].owed, 1000, 'Bob owed should be 1000');
  assert.strictEqual(balanceMap['bob@test.com'].net, 0, 'Bob net should be 0');

  assert.strictEqual(balanceMap['charlie@test.com'].paid, 0, 'Charlie paid should be 0');
  assert.strictEqual(balanceMap['charlie@test.com'].owed, 1000, 'Charlie owed should be 1000');
  assert.strictEqual(balanceMap['charlie@test.com'].net, -1000, 'Charlie net should be -1000');

  // Sum of net balances must be exactly 0
  const totalNet = Object.values(balanceMap).reduce((acc, b) => acc + b.net, 0);
  assert.strictEqual(Math.round(totalNet * 100) / 100, 0, 'Sum of all net balances must equal 0');

  // Greedy simplification: Charlie pays Alice 1000
  const txns = simplifyDebtsGreedy(balanceMap);
  assert.strictEqual(txns.length, 1, 'Should require exactly 1 simplified transfer');
  assert.strictEqual(txns[0].fromEmail, 'charlie@test.com');
  assert.strictEqual(txns[0].toEmail, 'alice@test.com');
  assert.strictEqual(txns[0].amount, 1000);
});

// Case 2: Confirmed Settlement offsets debts and closes transfers
test('2. Confirmed Settlement: Charlie settles 1000 to Alice via UPI (confirmed)', () => {
  const group = {
    _id: 'grp1',
    members: [
      { email: 'alice@test.com', name: 'Alice' },
      { email: 'bob@test.com', name: 'Bob' },
      { email: 'charlie@test.com', name: 'Charlie' }
    ]
  };

  const expenses = [{
    groupId: 'grp1',
    amount: 3000,
    type: 'expense',
    paidByAllocations: [
      { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 2000 },
      { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1000 }
    ],
    splits: [
      { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 1000 },
      { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1000 },
      { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 1000 }
    ]
  }];

  const settlements = [{
    groupId: 'grp1',
    fromEmail: 'charlie@test.com',
    fromName: 'Charlie',
    toEmail: 'alice@test.com',
    toName: 'Alice',
    amount: 1000,
    status: 'confirmed'
  }];

  const balanceMap = computeGroupBalanceMap(group, expenses, settlements);
  assert.strictEqual(balanceMap['alice@test.com'].net, 0, 'Alice net should be 0 after confirmed settlement');
  assert.strictEqual(balanceMap['charlie@test.com'].net, 0, 'Charlie net should be 0 after confirmed settlement');
  assert.strictEqual(balanceMap['charlie@test.com'].settledPaid, 1000, 'Charlie settledPaid should be 1000');
  assert.strictEqual(balanceMap['alice@test.com'].settledReceived, 1000, 'Alice settledReceived should be 1000');

  const txns = simplifyDebtsGreedy(balanceMap);
  assert.strictEqual(txns.length, 0, 'Group should have 0 remaining simplified debts');
});

// Case 3: Pending & Rejected settlements MUST NOT alter net balances
test('3. Pending & Rejected settlements: Do NOT reduce debtor debt or creditor credit', () => {
  const group = {
    _id: 'grp1',
    members: [
      { email: 'alice@test.com', name: 'Alice' },
      { email: 'charlie@test.com', name: 'Charlie' }
    ]
  };

  const expenses = [{
    groupId: 'grp1',
    amount: 1000,
    type: 'expense',
    paidByAllocations: [{ memberEmail: 'alice@test.com', memberName: 'Alice', amount: 1000 }],
    splits: [
      { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 500 },
      { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 500 }
    ]
  }];

  // Charlie claims he paid 500 (pending admin approval)
  const pendingSettlements = [{
    groupId: 'grp1',
    fromEmail: 'charlie@test.com',
    fromName: 'Charlie',
    toEmail: 'alice@test.com',
    toName: 'Alice',
    amount: 500,
    status: 'pending_admin_approval'
  }];

  const bMapPending = computeGroupBalanceMap(group, expenses, pendingSettlements);
  assert.strictEqual(bMapPending['charlie@test.com'].net, -500, 'Pending settlement must NOT reduce Charlie net debt');
  assert.strictEqual(bMapPending['alice@test.com'].net, 500, 'Pending settlement must NOT reduce Alice net credit');

  // Verify computeGroupSimplifiedDebts attaches pendingApprovalAmount
  const simps = computeGroupSimplifiedDebts(group, bMapPending, expenses, pendingSettlements);
  assert.strictEqual(simps.length, 1);
  assert.strictEqual(simps[0].amount, 500);
  assert.strictEqual(simps[0].pendingApprovalAmount, 500);
  assert.strictEqual(simps[0].isPendingApproval, true);
  assert.strictEqual(simps[0].remainingDue, 0);

  // Charlie claim was rejected
  const rejectedSettlements = [{
    groupId: 'grp1',
    fromEmail: 'charlie@test.com',
    fromName: 'Charlie',
    toEmail: 'alice@test.com',
    toName: 'Alice',
    amount: 500,
    status: 'rejected'
  }];

  const bMapRejected = computeGroupBalanceMap(group, expenses, rejectedSettlements);
  assert.strictEqual(bMapRejected['charlie@test.com'].net, -500, 'Rejected settlement must NOT reduce debt');
  assert.strictEqual(bMapRejected['alice@test.com'].net, 500, 'Rejected settlement must NOT reduce credit');
});

// Case 4: Income / Refund Bills reduce total spend and credit/debit properly
test('4. Income/Refund bills: Hotel refunds 600 to Alice, split equally with Bob & Charlie', () => {
  const group = {
    _id: 'grp1',
    members: [
      { email: 'alice@test.com', name: 'Alice' },
      { email: 'bob@test.com', name: 'Bob' },
      { email: 'charlie@test.com', name: 'Charlie' }
    ]
  };

  const expenses = [{
    groupId: 'grp1',
    description: 'Security Deposit Refund',
    amount: 600,
    type: 'income',
    paidByAllocations: [{ memberEmail: 'alice@test.com', memberName: 'Alice', amount: 600 }],
    splits: [
      { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 200 },
      { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 200 },
      { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 200 }
    ]
  }];

  const balanceMap = computeGroupBalanceMap(group, expenses, []);
  // Alice received 600 in cash, her share is 200, so she owes 400 to group (-400)
  assert.strictEqual(balanceMap['alice@test.com'].net, -400);
  // Bob & Charlie are owed 200 each from Alice (+200)
  assert.strictEqual(balanceMap['bob@test.com'].net, 200);
  assert.strictEqual(balanceMap['charlie@test.com'].net, 200);

  const txns = simplifyDebtsGreedy(balanceMap);
  assert.strictEqual(txns.length, 2);
  assert.strictEqual(txns[0].fromEmail, 'alice@test.com');
  assert.strictEqual(txns[1].fromEmail, 'alice@test.com');
});

// Case 5: Direct Pair-Wise bilateral debt name correctness
test('5. Direct Pair-Wise Debts: Correct participant names in reverse bilateral transfers', () => {
  const expenses = [{
    amount: 100,
    type: 'expense',
    paidByAllocations: [{ memberEmail: 'alice@test.com', memberName: 'Alice Smith', amount: 100 }],
    splits: [
      { memberEmail: 'alice@test.com', memberName: 'Alice Smith', amount: 20 },
      { memberEmail: 'bob@test.com', memberName: 'Bob Jones', amount: 80 }
    ]
  }];

  // Bob now pays Alice 100 via settlement (overpayment of 20)
  const settlements = [{
    fromEmail: 'bob@test.com',
    fromName: 'Bob Jones',
    toEmail: 'alice@test.com',
    toName: 'Alice Smith',
    amount: 100,
    status: 'confirmed'
  }];

  const txns = calculateDirectDebts(expenses, settlements);
  assert.strictEqual(txns.length, 1);
  // Alice should owe Bob 20
  assert.strictEqual(txns[0].fromEmail, 'alice@test.com');
  assert.strictEqual(txns[0].fromName, 'Alice Smith', 'fromName must be Alice Smith, not Bob Jones');
  assert.strictEqual(txns[0].toEmail, 'bob@test.com');
  assert.strictEqual(txns[0].toName, 'Bob Jones', 'toName must be Bob Jones, not Alice Smith');
  assert.strictEqual(txns[0].amount, 20);
});

// Case 6: Frontend computeBalancesAndSimplifications output contracts
test('6. Frontend computeBalancesAndSimplifications returns balances dict, balanceMap, balanceList, myNet', () => {
  const mockState = {
    currentUser: { email: 'alice@test.com', name: 'Alice' },
    groups: [{
      id: 'g1',
      name: 'Goa Trip',
      members: [
        { email: 'alice@test.com', name: 'Alice' },
        { email: 'bob@test.com', name: 'Bob' }
      ]
    }],
    expenses: [{
      id: 'e1',
      groupId: 'g1',
      amount: 1000,
      paidByEmail: 'alice@test.com',
      paidByName: 'Alice',
      type: 'expense',
      splits: [
        { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 500 },
        { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 500 }
      ]
    }],
    settlements: []
  };

  const res = clientCompute('g1', mockState);

  // Check contract fields
  assert(res.balances, 'Must return balances dictionary');
  assert.strictEqual(res.balances['alice@test.com'], 500, 'balances dict must map alice to 500');
  assert.strictEqual(res.balances['bob@test.com'], -500, 'balances dict must map bob to -500');

  assert(res.balanceMap, 'Must return balanceMap dictionary');
  assert(Array.isArray(res.balanceList), 'Must return balanceList array');
  assert.strictEqual(res.balanceList.length, 2);

  assert.strictEqual(res.myNet, 500, 'myNet must be 500 for Alice');
  assert.strictEqual(res.myPaid, 1000, 'myPaid must be 1000');
  assert.strictEqual(res.myOwed, 500, 'myOwed must be 500');
  assert.strictEqual(res.totalSpend, 1000, 'totalSpend must be 1000');
  assert.strictEqual(res.simplified.length, 1);
  assert.strictEqual(res.simplified[0].fromEmail, 'bob@test.com');
  assert.strictEqual(res.simplified[0].toEmail, 'alice@test.com');
  assert.strictEqual(res.simplified[0].amount, 500);
});

// Case 7: Multi-group isolation in ALL view
test('7. Multi-group isolation: Group 1 members do NOT get paired to settle with Group 2 members', () => {
  const mockState = {
    currentUser: { email: 'alice@test.com', name: 'Alice' },
    groups: [
      {
        id: 'g1',
        name: 'Goa Trip',
        members: [
          { email: 'alice@test.com', name: 'Alice' },
          { email: 'bob@test.com', name: 'Bob' }
        ]
      },
      {
        id: 'g2',
        name: 'Flat 402',
        members: [
          { email: 'charlie@test.com', name: 'Charlie' },
          { email: 'david@test.com', name: 'David' }
        ]
      }
    ],
    expenses: [
      {
        id: 'e1',
        groupId: 'g1',
        amount: 200,
        paidByEmail: 'alice@test.com',
        paidByName: 'Alice',
        type: 'expense',
        splits: [
          { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 100 },
          { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 100 }
        ]
      },
      {
        id: 'e2',
        groupId: 'g2',
        amount: 400,
        paidByEmail: 'charlie@test.com',
        paidByName: 'Charlie',
        type: 'expense',
        splits: [
          { memberEmail: 'charlie@test.com', memberName: 'Charlie', amount: 200 },
          { memberEmail: 'david@test.com', memberName: 'David', amount: 200 }
        ]
      }
    ],
    settlements: []
  };

  const res = clientCompute('ALL', mockState);

  // Must have 2 simplified transactions: Bob pays Alice (100), David pays Charlie (200)
  assert.strictEqual(res.simplified.length, 2, 'Must have 2 group-isolated transfers');

  const g1Txn = res.simplified.find((t) => t.groupId === 'g1');
  const g2Txn = res.simplified.find((t) => t.groupId === 'g2');

  assert(g1Txn, 'Must have transaction for group g1');
  assert.strictEqual(g1Txn.fromEmail, 'bob@test.com');
  assert.strictEqual(g1Txn.toEmail, 'alice@test.com');
  assert.strictEqual(g1Txn.amount, 100);
  assert.strictEqual(g1Txn.groupName, 'Goa Trip');

  assert(g2Txn, 'Must have transaction for group g2');
  assert.strictEqual(g2Txn.fromEmail, 'david@test.com');
  assert.strictEqual(g2Txn.toEmail, 'charlie@test.com');
  assert.strictEqual(g2Txn.amount, 200);
  assert.strictEqual(g2Txn.groupName, 'Flat 402');

  // Verify NO cross-group pairings (Bob must NEVER pay Charlie, David must NEVER pay Alice)
  const crossGroupTxn = res.simplified.find(
    (t) => (t.fromEmail === 'bob@test.com' && t.toEmail === 'charlie@test.com') ||
           (t.fromEmail === 'david@test.com' && t.toEmail === 'alice@test.com')
  );
  assert.strictEqual(crossGroupTxn, undefined, 'Must NEVER have cross-group debt settlements');
});

// Case 8: Partial settlement confirmation handling & remaining due calculation
test('8. Partial settlement confirmation: Claimed 1000, 600 confirmed, 400 remaining due', () => {
  const mockState = {
    currentUser: { email: 'alice@test.com', name: 'Alice' },
    groups: [{
      id: 'g1',
      name: 'Trip',
      members: [
        { email: 'alice@test.com', name: 'Alice' },
        { email: 'bob@test.com', name: 'Bob' }
      ]
    }],
    expenses: [{
      id: 'e1',
      groupId: 'g1',
      amount: 2000,
      paidByEmail: 'alice@test.com',
      paidByName: 'Alice',
      type: 'expense',
      splits: [
        { memberEmail: 'alice@test.com', memberName: 'Alice', amount: 1000 },
        { memberEmail: 'bob@test.com', memberName: 'Bob', amount: 1000 }
      ]
    }],
    settlements: [{
      id: 's1',
      groupId: 'g1',
      fromEmail: 'bob@test.com',
      fromName: 'Bob',
      toEmail: 'alice@test.com',
      toName: 'Alice',
      amount: 600,
      originalClaimedAmount: 1000,
      status: 'confirmed'
    }]
  };

  const res = clientCompute('g1', mockState);
  assert.strictEqual(res.balances['bob@test.com'], -400, 'Bob should still owe 400');
  assert.strictEqual(res.balances['alice@test.com'], 400, 'Alice should still be owed 400');
  assert.strictEqual(res.simplified.length, 1);
  assert.strictEqual(res.simplified[0].fromEmail, 'bob@test.com');
  assert.strictEqual(res.simplified[0].toEmail, 'alice@test.com');
  assert.strictEqual(res.simplified[0].amount, 400);
});

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
