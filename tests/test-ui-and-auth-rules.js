const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running Verification Suite for Vasool UX, Auth & Authorization Rules...');

// 1. Verify HTML: Logout removed from header, present in Profile modal
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

// Check header has no btnHeaderLogout
assert.strictEqual(indexHtml.includes('id="btnHeaderLogout"'), false, 'Header must NOT have btnHeaderLogout');
assert.strictEqual(indexHtml.includes('id="btnHeaderAccountSettings"'), false, 'Header must NOT have redundant btnHeaderAccountSettings');
assert.strictEqual(indexHtml.includes('id="fabFeedbackBtn"'), false, 'Floating feedback FAB must be removed to eliminate mobile screen clutter');

// Check Profile modal (accountSettingsModal) has btnSettingsLogout
assert.strictEqual(indexHtml.includes('id="btnSettingsLogout"'), true, 'Profile modal must have btnSettingsLogout');
assert.strictEqual(indexHtml.includes('Sign Out of Account'), true, 'Profile modal must display Sign Out button');

// Check expAmountInput has placeholder 0.00, not 1200.00
assert.strictEqual(indexHtml.includes('id="expAmountInput"'), true, 'expAmountInput must exist');
assert.strictEqual(indexHtml.includes('placeholder="1200.00"'), false, 'expAmountInput must NOT have placeholder 1200.00');
assert.strictEqual(indexHtml.includes('placeholder="0.00"'), true, 'expAmountInput must have placeholder 0.00');

console.log('✓ Test 1 Passed: Top header and Profile modal navigation hygiene verified.');

// 2. Verify groups-and-modals.js does not hardcode 1200 on openAddExpenseModal
const groupsJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');
assert.strictEqual(groupsJs.includes("expAmountInput').value = '1200'"), false, 'openAddExpenseModal must NOT prefill 1200');
assert.strictEqual(groupsJs.includes("expAmountInput').value = ''"), true, 'openAddExpenseModal must reset expAmountInput to empty string');

console.log('✓ Test 2 Passed: Split expense default amount of 1200 successfully removed.');

// 3. Verify Expense schema has createdByEmail & createdByName
const expenseModel = fs.readFileSync(path.join(__dirname, '../models/Expense.js'), 'utf8');
assert.strictEqual(expenseModel.includes('createdByEmail'), true, 'Expense schema must have createdByEmail');
assert.strictEqual(expenseModel.includes('createdByName'), true, 'Expense schema must have createdByName');

console.log('✓ Test 3 Passed: Expense data model audit tracking verified.');

// 4. Verify Authorization in routes/expenses.js
const expensesRoute = fs.readFileSync(path.join(__dirname, '../routes/expenses.js'), 'utf8');
assert.strictEqual(expensesRoute.includes('Permission denied. Only the person who created this bill or a group admin can edit it.'), true, 'PUT route must enforce creator or admin authorization');
assert.strictEqual(expensesRoute.includes('Permission denied. Only the person who created this bill or a group admin can delete it.'), true, 'DELETE route must enforce creator or admin authorization');

console.log('✓ Test 4 Passed: Backend authorization rules for bill editing and deletion verified.');

// 5. Verify Frontend Expense Card rendering checks canModify and renders settlement badges
const dashboardJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-and-expenses.js'), 'utf8');
assert.strictEqual(dashboardJs.includes('billSettlementBadge'), true, 'dashboard-and-expenses.js must calculate billSettlementBadge');
assert.strictEqual(dashboardJs.includes('✓ All Settled'), true, 'dashboard-and-expenses.js must render All Settled badge when all members settled');
assert.strictEqual(dashboardJs.includes('⏳ Left to Pay'), true, 'dashboard-and-expenses.js must render Left to Pay for pending debtors');
assert.strictEqual(dashboardJs.includes('canModify = isCreator || isGroupAdmin || isSuperAdmin'), true, 'dashboard-and-expenses.js must check canModify before rendering edit/delete buttons');

console.log('✓ Test 5 Passed: Bill settlement status and authorized action controls verified.');

console.log('\n=============================================');
console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY! (5/5)');
console.log('=============================================\n');
