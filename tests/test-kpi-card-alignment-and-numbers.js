/**
 * tests/test-kpi-card-alignment-and-numbers.js
 * Verification of home page 4 Bento KPI cards alignment, layout symmetry, and full number visibility.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('🧪 Starting KPI Card Alignment & Number Representation Test Suite...\n');

// 1. Verify HTML Structure and Classes in public/index.html
const htmlPath = path.join(__dirname, '../public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Check that parent grid has items-stretch and responsive grid columns
assert.ok(
  htmlContent.includes('grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 items-stretch'),
  'KPI cards parent grid must have items-stretch for equal-height alignment'
);

// Check that all 4 cards have flex flex-col justify-between h-full min-w-0
const cardClassRegex = /class="glass-panel glass-card-hover rounded-2xl sm:rounded-3xl p-3 sm:p-4\.5 relative overflow-hidden group flex flex-col justify-between h-full min-w-0"/g;
const matchedCards = htmlContent.match(cardClassRegex);
assert.strictEqual(matchedCards && matchedCards.length >= 4, true, 'All 4 KPI cards must have flex flex-col justify-between h-full min-w-0');

// Check that none of the 4 primary KPI amounts have "truncate"
const amountIds = ['kpiNetBalance', 'kpiYouAreOwed', 'kpiYouOwe', 'kpiTotalSpend'];
amountIds.forEach(id => {
  const elementRegex = new RegExp(`id="${id}"[^>]*class="([^"]*)"`);
  const match = htmlContent.match(elementRegex);
  assert.ok(match, `Element with id="${id}" must exist in public/index.html`);
  assert.strictEqual(
    match[1].includes('truncate'),
    false,
    `Element #${id} must NOT have class "truncate" to ensure complete numbers are visible`
  );
  assert.ok(
    match[1].includes('tabular-nums') && match[1].includes('break-words'),
    `Element #${id} must have tabular-nums and break-words for clean numerical alignment`
  );
});

// Check that dedicated pending rows exist for all 4 cards
const pendingRowIds = ['kpiNetPendingRow', 'kpiOwedPendingRow', 'kpiOwePendingRow', 'kpiSpendPendingRow'];
pendingRowIds.forEach(rowId => {
  assert.ok(
    htmlContent.includes(`id="${rowId}"`),
    `Dedicated secondary row #${rowId} must exist for symmetric height across all cards`
  );
});

console.log('  ✅ PASS: 1. public/index.html layout structure enforces items-stretch, flex symmetry, and no truncation');

// 2. Verify Client-Side JavaScript Logic in public/js/dashboard-and-expenses.js
const jsPath = path.join(__dirname, '../public/js/dashboard-and-expenses.js');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// Mock a lightweight DOM in sandbox
const mockElements = {};
function getMockElement(id) {
  if (!mockElements[id]) {
    mockElements[id] = {
      id,
      textContent: '',
      innerHTML: '',
      className: '',
      classList: {
        add: () => {},
        remove: () => {},
        contains: () => false
      }
    };
  }
  return mockElements[id];
}

const sandbox = {
  appState: {
    currentUser: { email: 'zubair@test.com', name: 'Zubair Mohammed' },
    groups: [{ id: 'g1', name: 'Trip', minimizeDebts: true, members: [{ email: 'zubair@test.com' }, { email: 'pavan@test.com' }] }],
    expenses: [],
    settlements: []
  },
  selectedGroupId: 'ALL',
  formatINR: (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  escapeHtml: (s) => String(s),
  document: {
    getElementById: (id) => getMockElement(id),
    querySelectorAll: () => []
  },
  window: {},
  console: console
};

vm.createContext(sandbox);
vm.runInContext(jsContent, sandbox);

// Simulate KPI render when Zubair is owed 3000, and Pavan has paid 3000 (pending approval)
const computeFn = sandbox.computeBalancesAndSimplifications;
assert.strictEqual(typeof computeFn, 'function', 'computeBalancesAndSimplifications must be defined');

// Verify refreshAllViews executes cleanly and sets clean numbers without jamming HTML inside kpiNetBalance
const refreshFn = sandbox.refreshAllViews;
assert.strictEqual(typeof refreshFn, 'function', 'refreshAllViews must be defined');

// Mock dependencies for refreshAllViews
sandbox.renderTopLevelView = () => {};
sandbox.populateGroupFilterDropdown = () => {};
sandbox.renderDashboardWidgets = () => {};
sandbox.renderExpensesList = () => {};
sandbox.renderGroupsGrid = () => {};
sandbox.renderSettleView = () => {};
sandbox.updateCloudInspector = () => {};

// Add expenses and pending settlement
sandbox.appState.expenses = [{
  id: 'e1',
  groupId: 'g1',
  title: 'Hotel',
  amount: 6000,
  paidByEmail: 'zubair@test.com',
  paidByName: 'Zubair',
  category: 'Stay',
  splits: [
    { memberEmail: 'zubair@test.com', memberName: 'Zubair', amount: 3000 },
    { memberEmail: 'pavan@test.com', memberName: 'Pavan Sai', amount: 3000 }
  ]
}];

sandbox.appState.settlements = [{
  id: 's1',
  groupId: 'g1',
  fromEmail: 'pavan@test.com',
  fromName: 'Pavan Sai',
  toEmail: 'zubair@test.com',
  toName: 'Zubair',
  amount: 3000,
  status: 'pending_admin_approval'
}];

refreshFn();

const netEl = getMockElement('kpiNetBalance');
const netPending = getMockElement('kpiNetPendingRow');
const owedEl = getMockElement('kpiYouAreOwed');
const owedPending = getMockElement('kpiOwedPendingRow');
const spendEl = getMockElement('kpiTotalSpend');

// 1. Primary numbers must be pure text, not containing raw HTML tags
assert.strictEqual(netEl.textContent, '+₹3,000.00', 'Net balance textContent must be pure "+₹3,000.00" without crammed HTML tags');
assert.strictEqual(owedEl.textContent, '₹3,000.00', 'You are owed textContent must be pure "₹3,000.00"');
assert.strictEqual(spendEl.textContent, '₹6,000.00', 'Total spend textContent must be pure "₹6,000.00"');

// 2. Pending amounts must be placed into dedicated pending rows
assert.ok(netPending.innerHTML.includes('Pending:'), 'Net pending row must display dedicated pending pill');
assert.ok(owedPending.innerHTML.includes('Due after pending:'), 'Owed pending row must display dedicated pending due pill');

// 3. None of the primary amount elements should have truncate class
assert.strictEqual(netEl.className.includes('truncate'), false, 'kpiNetBalance className must not contain truncate');
assert.strictEqual(owedEl.className.includes('truncate'), false, 'kpiYouAreOwed className must not contain truncate');
assert.strictEqual(spendEl.className.includes('truncate'), false, 'kpiTotalSpend className must not contain truncate');

console.log('  ✅ PASS: 2. refreshAllViews renders pure currency numbers in primary elements and dedicated pending status rows');

console.log('\n========================================');
console.log('Results: All 2 tests passed successfully!');
console.log('========================================\n');
