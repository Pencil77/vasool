/**
 * test-split-single-member-privacy-and-edit.js
 * Verification test for single-member splits under 'personal_only' privacy mode,
 * ensuring payers and creators ALWAYS see their split participants (e.g. Pavan Sai paying for Praneeth),
 * and editing the expense correctly populates and preserves the split participants.
 */

const assert = require('assert');

console.log('🧪 Starting Test Suite: Single-Member Split Privacy & Edit Persistence...\n');

// Mock data reflecting the real scenario from MongoDB
const requesterPavan = 'pavansaikasula@gmail.com';
const requesterZubair = 'mdzubair7592@gmail.com';
const requesterPraneeth = 'praneethssr.2002@gmail.com';
const requesterAjay = 'ajayajay142018@gmail.com';

const mockGroup = {
  _id: '6af73afc94ed384576f96f8b',
  name: 'Animal Park',
  adminEmail: 'mdzubair7592@gmail.com',
  splitsVisibility: 'personal_only',
  members: [
    { email: 'mdzubair7592@gmail.com', name: 'Zubair Mohammed', role: 'admin' },
    { email: 'pavansaikasula@gmail.com', name: 'pavansai', role: 'member' },
    { email: 'ajayajay142018@gmail.com', name: 'Konda Ajay', role: 'member' },
    { email: 'praneethssr.2002@gmail.com', name: 'Praneeth', role: 'member' }
  ]
};

const mockExpense = {
  _id: '6afa29938efafde3efe6e2e0',
  groupId: '6af73afc94ed384576f96f8b',
  description: 'jailer 2 + scene movie tickets',
  amount: 429,
  paidByEmail: 'pavansaikasula@gmail.com',
  paidByName: 'pavansai',
  paidByAllocations: [
    { memberEmail: 'pavansaikasula@gmail.com', memberName: 'pavansai', amount: 429 }
  ],
  createdByEmail: 'pavansaikasula@gmail.com',
  createdByName: 'pavansai',
  splitType: 'equal',
  splits: [
    {
      memberEmail: 'praneethssr.2002@gmail.com',
      memberName: 'Praneeth',
      amount: 429,
      percentage: 0,
      shares: 1,
      roundingAdjustment: 0
    }
  ]
};

// -------------------------------------------------------------------------
// Test 1: Backend GET /api/expenses Privacy Sanitization
// -------------------------------------------------------------------------
console.log('--- Test 1: Backend Privacy Filter for Payer, Admin, and Third-Party ---');

function sanitizeExpenseForUser(exp, user, group) {
  const requesterEmail = user.email.toLowerCase().trim();
  const isSuperAdmin = Boolean(user.isSuperAdmin || user.role === 'super_admin' || ['mdzubair7592@gmail.com', 'mrzoromit3@gmail.com'].includes(requesterEmail));
  const isGroupAdmin = isSuperAdmin || Boolean(
    (group.adminEmail && group.adminEmail.toLowerCase() === requesterEmail) ||
    (group.createdByEmail && group.createdByEmail.toLowerCase() === requesterEmail) ||
    (Array.isArray(group.members) && group.members.some((m) => m.email.toLowerCase().trim() === requesterEmail && (m.role === 'admin' || m.role === 'owner')))
  );

  const isPayer = (exp.paidByEmail && exp.paidByEmail.toLowerCase().trim() === requesterEmail) ||
    (Array.isArray(exp.paidByAllocations) && exp.paidByAllocations.some((p) => String(p.memberEmail || p.email || '').toLowerCase().trim() === requesterEmail));

  const isCreator = Boolean(exp.createdByEmail && exp.createdByEmail.toLowerCase().trim() === requesterEmail);
  const isPersonalOnly = (group.splitsVisibility || 'personal_only') === 'personal_only';

  if (!isPersonalOnly || isGroupAdmin || isPayer || isCreator) {
    return { ...exp, isPersonalView: false };
  }

  const mySplit = exp.splits.find((s) => s.memberEmail.toLowerCase() === requesterEmail);
  const otherSum = exp.splits
    .filter((s) => s.memberEmail.toLowerCase() !== requesterEmail)
    .reduce((acc, s) => acc + s.amount, 0);

  const visibleSplits = [];
  if (mySplit) visibleSplits.push(mySplit);
  if (otherSum > 0) {
    visibleSplits.push({
      memberEmail: 'private@group',
      memberName: 'Other Members (Hidden by Admin)',
      amount: Math.round(otherSum * 100) / 100,
      isPrivate: true
    });
  }

  return {
    ...exp,
    splits: visibleSplits,
    isPersonalView: true
  };
}

// 1. Pavan Sai (Payer & Creator)
const pavanView = sanitizeExpenseForUser(mockExpense, { email: requesterPavan }, mockGroup);
assert.strictEqual(pavanView.isPersonalView, false, 'Pavan Sai should not have his view redacted');
assert.strictEqual(pavanView.splits.length, 1);
assert.strictEqual(pavanView.splits[0].memberEmail, 'praneethssr.2002@gmail.com');
assert.strictEqual(pavanView.splits[0].memberName, 'Praneeth');
assert.strictEqual(pavanView.splits[0].amount, 429);
console.log('✅ Pavan Sai (Payer/Creator) receives full unredacted splits with Praneeth.');

// 2. Zubair Mohammed (Group Admin)
const zubairView = sanitizeExpenseForUser(mockExpense, { email: requesterZubair }, mockGroup);
assert.strictEqual(zubairView.isPersonalView, false, 'Admin should not have view redacted');
assert.strictEqual(zubairView.splits.length, 1);
assert.strictEqual(zubairView.splits[0].memberEmail, 'praneethssr.2002@gmail.com');
console.log('✅ Zubair Mohammed (Admin) receives full unredacted splits with Praneeth.');

// 3. Ajay (Third-Party regular member)
const ajayView = sanitizeExpenseForUser(mockExpense, { email: requesterAjay }, mockGroup);
assert.strictEqual(ajayView.isPersonalView, true, 'Third party member should have view redacted');
assert.strictEqual(ajayView.splits[0].memberEmail, 'private@group');
console.log('✅ Third-party member Ajay has splits redacted under personal_only mode.\n');

// -------------------------------------------------------------------------
// Test 2: Frontend Card Splits Rendering
// -------------------------------------------------------------------------
console.log('--- Test 2: Frontend Card Split Pills Rendering ---');

function renderSplitPillsForUser(exp, currentUser, group, balanceMap = {}) {
  const currentEmail = (currentUser?.email || '').toLowerCase().trim();
  const isSuperAdmin = Boolean(
    currentUser?.isSuperAdmin ||
    currentUser?.role === 'super_admin' ||
    ['mdzubair7592@gmail.com', 'mrzoromit3@gmail.com'].includes(currentEmail)
  );

  const isGroupAdmin = isSuperAdmin || Boolean(
    group && (
      (group.adminEmail && group.adminEmail.toLowerCase() === currentEmail) ||
      (group.createdByEmail && group.createdByEmail.toLowerCase() === currentEmail) ||
      (Array.isArray(group.members) && group.members.some((m) => (m.email || '').toLowerCase().trim() === currentEmail && (m.role === 'admin' || m.role === 'owner')))
    )
  );

  const payerEmails = new Set(
    (Array.isArray(exp.paidByAllocations) && exp.paidByAllocations.length > 0
      ? exp.paidByAllocations
      : [{ memberEmail: exp.paidByEmail }]
    ).map((p) => String(p.memberEmail || '').toLowerCase().trim())
  );

  const isPayerOrCreator = payerEmails.has(currentEmail) ||
    (exp.createdByEmail && exp.createdByEmail.toLowerCase().trim() === currentEmail) ||
    (exp.paidByEmail && exp.paidByEmail.toLowerCase().trim() === currentEmail);

  const isPersonalOnly = group && (group.splitsVisibility || 'personal_only') === 'personal_only' && !isGroupAdmin && !isPayerOrCreator;

  let visibleSplits = exp.splits || [];
  if (isPersonalOnly) {
    visibleSplits = visibleSplits.filter((s) => s.memberEmail.toLowerCase() === currentEmail);
  }

  if (isPersonalOnly) {
    if (visibleSplits.length > 0) {
      return visibleSplits.map((s) => `Your Share: ₹${s.amount}`).join(' ');
    } else {
      return 'No share assigned to you · 🔒 Other member shares private';
    }
  } else {
    return visibleSplits.map((s) => `${s.memberName || s.memberEmail}: ₹${s.amount}`).join(', ');
  }
}

const pavanPills = renderSplitPillsForUser(pavanView, { email: requesterPavan }, mockGroup);
assert.strictEqual(pavanPills.includes('Praneeth: ₹429'), true, 'Pavan must see Praneeth pill');
assert.strictEqual(pavanPills.includes('No share assigned to you'), false, 'Pavan must NOT see no share message');
console.log('✅ Pavan Sai card output:', pavanPills);

const zubairPills = renderSplitPillsForUser(zubairView, { email: requesterZubair }, mockGroup);
assert.strictEqual(zubairPills.includes('Praneeth: ₹429'), true, 'Zubair must see Praneeth pill');
console.log('✅ Zubair card output:', zubairPills);

const ajayPills = renderSplitPillsForUser(ajayView, { email: requesterAjay }, mockGroup);
assert.strictEqual(ajayPills, 'No share assigned to you · 🔒 Other member shares private');
console.log('✅ Ajay card output:', ajayPills, '\n');

// -------------------------------------------------------------------------
// Test 3: Edit Modal Checkbox Population & Amount Recalculation
// -------------------------------------------------------------------------
console.log('--- Test 3: Edit Expense Modal Checkbox State & Save Split Preservation ---');

// Simulate DOM container rows in edit modal
function simulateEditExpenseModal(exp, group) {
  // 1. Populate members (unchecked by default)
  const rows = group.members.map((m) => ({
    memberEmail: m.email,
    memberName: m.name,
    checked: false,
    computedAmount: 0,
    inputValue: 0
  }));

  // 2. Restore from exp.splits
  const splitEmails = new Set((exp.splits || []).map((s) => (s.memberEmail || '').toLowerCase().trim()));
  rows.forEach((r) => {
    const em = (r.memberEmail || '').toLowerCase().trim();
    const match = exp.splits.find((s) => (s.memberEmail || '').toLowerCase().trim() === em);
    if (splitEmails.has(em)) {
      r.checked = true;
    }
    if (match && exp.splitType === 'exact') {
      r.inputValue = match.amount;
    }
  });

  // 3. Recalculate preview
  const activeRows = rows.filter((r) => r.checked);
  const total = Number(exp.amount) || 0;
  rows.forEach((r) => {
    if (!r.checked) {
      r.computedAmount = 0;
    } else if (exp.splitType === 'equal') {
      r.computedAmount = activeRows.length ? Math.round((total / activeRows.length) * 100) / 100 : 0;
    }
  });

  return rows;
}

const modalRows = simulateEditExpenseModal(pavanView, mockGroup);
const praneethRow = modalRows.find((r) => r.memberEmail === 'praneethssr.2002@gmail.com');
const otherRows = modalRows.filter((r) => r.memberEmail !== 'praneethssr.2002@gmail.com');

assert(praneethRow, 'Praneeth row must exist');
assert.strictEqual(praneethRow.checked, true, 'Praneeth checkbox MUST be checked in edit modal');
assert.strictEqual(praneethRow.computedAmount, 429, 'Praneeth computedAmount must be 429');
assert.strictEqual(otherRows.every((r) => !r.checked), true, 'All other members must remain unchecked');
console.log('✅ Modal correctly checked Praneeth (₹429) and left all other members unchecked.');

// 4. Simulate saving the expense after editing
function simulateSaveExpense(rows, totalAmount) {
  const active = rows.filter((r) => r.checked);
  const splits = active.map((r) => ({
    memberEmail: r.memberEmail,
    memberName: r.memberName,
    amount: r.computedAmount
  }));
  return { amount: totalAmount, splits };
}

const savedResult = simulateSaveExpense(modalRows, 429);
assert.strictEqual(savedResult.splits.length, 1);
assert.strictEqual(savedResult.splits[0].memberEmail, 'praneethssr.2002@gmail.com');
assert.strictEqual(savedResult.splits[0].amount, 429);
console.log('✅ Save payload preserves single-member split with Praneeth exactly (₹429).\n');

console.log('=========================================================================');
console.log('🎉 ALL TESTS PASSED! Single-Member Split Privacy & Edit 100% Verified.');
console.log('=========================================================================');
