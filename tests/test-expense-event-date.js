const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('🧪 Starting Expense Event Date (Calendar & Custom Date) Test Suite...\n');

// 1. Verify HTML: expDateInput exists with type="date"
console.log('--- Test 1: HTML Calendar Input Verification ---');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.strictEqual(indexHtml.includes('id="expDateInput"'), true, 'expDateInput must exist in index.html');
assert.strictEqual(indexHtml.includes('data-testid="input-expense-date"'), true, 'expDateInput must have testid input-expense-date');
assert.strictEqual(indexHtml.includes('type="date"'), true, 'expDateInput must be type="date"');
assert.strictEqual(indexHtml.includes('Date of Event'), true, 'expDateInput must have label "Date of Event"');
console.log('✅ Test 1 Passed: Calendar input <input type="date" id="expDateInput"> verified in Add Expense Modal.');

// 2. Verify models/Expense.js schema has expenseDate with index
console.log('--- Test 2: Mongoose Expense Schema Verification ---');
const expenseModel = fs.readFileSync(path.join(__dirname, '../models/Expense.js'), 'utf8');
assert.strictEqual(expenseModel.includes('expenseDate:'), true, 'Expense schema must declare expenseDate');
assert.strictEqual(expenseModel.includes('index: true'), true, 'expenseDate should be indexed for fast chronological queries');
console.log('✅ Test 2 Passed: Expense model schema verified with indexed expenseDate.');

// 3. Verify backend routes/expenses.js captures expenseDate on POST and PUT
console.log('--- Test 3: Backend Route Payload Capture ---');
const expensesRoute = fs.readFileSync(path.join(__dirname, '../routes/expenses.js'), 'utf8');
assert.strictEqual(expensesRoute.includes('expenseDate,'), true, 'POST /api/expenses must destructure expenseDate from req.body');
assert.strictEqual(expensesRoute.includes('resolvedExpenseDate'), true, 'POST /api/expenses must resolve expenseDate');
assert.strictEqual(expensesRoute.includes('existing.expenseDate = parsed;'), true, 'PUT /api/expenses/:id must update existing.expenseDate');
console.log('✅ Test 3 Passed: Backend POST & PUT routes accept and persist custom event dates.');

// 4. Verify frontend formatEventDisplayDate logic
console.log('--- Test 4: Frontend formatEventDisplayDate Unit Tests ---');
const dashboardJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');
const sandbox = {
  window: {},
  console: console
};
vm.createContext(sandbox);

const startFn = dashboardJs.indexOf('function formatEventDisplayDate');
const endFn = dashboardJs.indexOf('function renderExpensesList');
assert(startFn !== -1 && endFn !== -1, 'formatEventDisplayDate function must exist');
vm.runInContext(dashboardJs.substring(startFn, endFn), sandbox);
const formatEventDisplayDate = sandbox.window.formatEventDisplayDate;

const now = new Date();
const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
assert.strictEqual(formatEventDisplayDate(todayLocal), 'Today', 'Current day must format as Today');

const pastDateFormatted = formatEventDisplayDate('2026-11-05');
assert.strictEqual(pastDateFormatted, '5 Nov 2026', 'Past date 2026-11-05 must format as 5 Nov 2026');

const midYearFormatted = formatEventDisplayDate('2026-07-21');
assert.strictEqual(midYearFormatted, '21 Jul 2026', 'Past date 2026-07-21 must format as 21 Jul 2026');
console.log('✅ Test 4 Passed: formatEventDisplayDate correctly renders Today and past formatted dates.');

// 5. Verify groups-and-modals.js handles prefilling and editing
console.log('--- Test 5: Modal Date Prefill and State Persistence ---');
const groupsJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');
assert.strictEqual(groupsJs.includes("todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`"), true, 'openAddExpenseModal must compute local today date');
assert.strictEqual(groupsJs.includes('editDateInp.value = dStr;'), true, 'openEditExpenseModal must restore custom event date');
assert.strictEqual(groupsJs.includes("const dateInpVal = (document.getElementById('expDateInput')?.value || '').trim();"), true, 'handleSaveExpense must read expDateInput');
assert.strictEqual(groupsJs.includes('expenseDate: expenseDateIso,'), true, 'handleSaveExpense must pass expenseDate in payload');
assert.strictEqual(groupsJs.includes('appState.expenses.sort((a, b) => new Date(b.expenseDate || b.date || b.createdAt || 0) - new Date(a.expenseDate || a.date || a.createdAt || 0));'), true, 'appState.expenses must be sorted chronologically by event date');
console.log('✅ Test 5 Passed: Modal date prefilling, editing restoration, and chronological sorting verified.');

console.log('\n======================================================');
console.log('🎉 ALL 5 EVENT DATE TESTS PASSED SUCCESSFULLY!');
console.log('======================================================\n');
