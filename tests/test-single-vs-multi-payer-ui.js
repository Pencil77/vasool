/**
 * tests/test-single-vs-multi-payer-ui.js
 * Verification of Single Payer default view with toggleable Multiple Payers list.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

console.log('🧪 Starting Single vs Multi Payer UI Test Suite...\n');

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

// Set up mock DOM and state
function createMockEnvironment() {
  const elements = {};

  function makeElement(id, tagName = 'div') {
    const el = {
      id,
      tagName,
      className: '',
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); el.className = Array.from(this._classes).join(' '); },
        remove(c) { this._classes.delete(c); el.className = Array.from(this._classes).join(' '); },
        contains(c) { return this._classes.has(c); },
        toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
      },
      innerHTML: '',
      value: '',
      textContent: '',
      disabled: false,
      options: [],
      dataset: {},
      querySelector(sel) {
        if (sel === '.exp-payer-check') return this._chk;
        if (sel === '.exp-payer-amount') return this._inp;
        return null;
      }
    };
    elements[id] = el;
    return el;
  }

  // Define modal elements
  makeElement('expGroupSelect', 'SELECT');
  makeElement('expSinglePayerSection');
  makeElement('expPaidBySingleSelect', 'SELECT');
  makeElement('expPaidBySelect', 'SELECT');
  makeElement('expMultiPayerSection');
  elements['expMultiPayerSection'].classList.add('hidden');
  makeElement('expPaidByMultiContainer');
  makeElement('btnToggleMultiPayer', 'BUTTON');
  makeElement('btnToggleMultiPayerText');
  makeElement('btnToggleMultiPayerIcon');
  makeElement('expPaidBySummaryBadge');
  makeElement('expPayerValidationBanner');
  elements['expPayerValidationBanner'].classList.add('hidden');
  makeElement('expAmountInput', 'INPUT');
  elements['expAmountInput'].value = '1000';
  makeElement('expMemberSplitsContainer');

  const mockGroup = {
    id: 'g1',
    name: 'Flatmates',
    members: [
      { email: 'zubair@test.com', name: 'Zubair Mohammed' },
      { email: 'pavan@test.com', name: 'Pavan Sai' },
      { email: 'praneeth@test.com', name: 'Praneeth' }
    ]
  };

  const sandbox = {
    appState: {
      currentUser: { email: 'zubair@test.com', name: 'Zubair Mohammed' },
      groups: [mockGroup],
      expenses: [],
      settlements: []
    },
    currentSplitMode: 'equal',
    CURRENCY_META: { INR: { symbol: '₹', rate: 1, locale: 'en-IN' } },
    activeCurrency: 'INR',
    formatINR: (v) => '₹' + Number(v).toFixed(2),
    escapeHtml: (s) => String(s),
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll(sel) {
        if (sel === '#expPaidByMultiContainer > div') {
          return elements['expPaidByMultiContainer']._children || [];
        }
        if (sel === '#expMemberSplitsContainer > div') {
          return elements['expMemberSplitsContainer']._children || [];
        }
        return [];
      }
    },
    console: console
  };

  elements['expGroupSelect'].value = 'g1';

  // Read code
  const code = fs.readFileSync(require.resolve('../public/js/groups-and-modals.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  return { sandbox, elements, mockGroup };
}

// Test 1: By default, Paid By shows Single Payer only (user name selected) and hides full member list
test('1. Default view shows single payer dropdown only and hides multi-payer list', () => {
  const { sandbox, elements } = createMockEnvironment();

  sandbox.populateExpenseModalMembers();

  // Multi-payer section MUST be hidden
  assert(elements['expMultiPayerSection'].classList.contains('hidden'), 'expMultiPayerSection must be hidden by default');
  // Single-payer section MUST be visible
  assert(!elements['expSinglePayerSection'].classList.contains('hidden'), 'expSinglePayerSection must be visible by default');

  // Single select must contain current user marked as (You)
  const singleSel = elements['expPaidBySingleSelect'];
  assert(singleSel.innerHTML.includes('Zubair Mohammed (You)'), 'Current user must be marked with (You)');
  assert(singleSel.innerHTML.includes('Pavan Sai'), 'Other members must be available in single payer select dropdown');
  assert.strictEqual(singleSel.value, 'zubair@test.com', 'Single payer dropdown must default to current user');

  // Toggle button text must offer adding multiple payers
  assert.strictEqual(elements['btnToggleMultiPayerText'].textContent, '+ Multiple Payers');
  assert.strictEqual(elements['btnToggleMultiPayerIcon'].textContent, '👥');
});

// Test 2: Clicking + Multiple Payers reveals all group members with checkboxes
test('2. Toggling to Multiple Payers hides single selector and reveals full member list', () => {
  const { sandbox, elements } = createMockEnvironment();

  sandbox.populateExpenseModalMembers();
  assert(elements['expMultiPayerSection'].classList.contains('hidden'));

  // Toggle to multi-payer
  sandbox.toggleMultiPayerMode();

  assert(!elements['expMultiPayerSection'].classList.contains('hidden'), 'expMultiPayerSection must now be visible');
  assert(elements['expSinglePayerSection'].classList.contains('hidden'), 'expSinglePayerSection must now be hidden');
  assert.strictEqual(elements['btnToggleMultiPayerText'].textContent, 'Single Payer');
  assert.strictEqual(elements['btnToggleMultiPayerIcon'].textContent, '👤');

  // expPaidByMultiContainer contains all 3 members
  const multiContainer = elements['expPaidByMultiContainer'];
  assert(multiContainer.innerHTML.includes('Zubair Mohammed'), 'Multi-payer list contains Zubair');
  assert(multiContainer.innerHTML.includes('Pavan Sai'), 'Multi-payer list contains Pavan');
  assert(multiContainer.innerHTML.includes('Praneeth'), 'Multi-payer list contains Praneeth');
});

// Test 3: Toggling back to Single Payer collapses list and restores single payer
test('3. Toggling back to Single Payer mode restores single payer view', () => {
  const { sandbox, elements } = createMockEnvironment();

  sandbox.populateExpenseModalMembers();
  sandbox.toggleMultiPayerMode(); // into multi
  sandbox.toggleMultiPayerMode(); // back to single

  assert(elements['expMultiPayerSection'].classList.contains('hidden'), 'expMultiPayerSection must be hidden again');
  assert(!elements['expSinglePayerSection'].classList.contains('hidden'), 'expSinglePayerSection must be visible again');
  assert.strictEqual(elements['btnToggleMultiPayerText'].textContent, '+ Multiple Payers');
  assert.strictEqual(elements['btnToggleMultiPayerIcon'].textContent, '👥');
});

// Test 4: Editing expense with multiple payers opens in Multi-Payer mode automatically
test('4. Editing expense with multi-payers automatically opens multi-payer section', () => {
  const { sandbox, elements } = createMockEnvironment();

  const preselected = [
    { memberEmail: 'zubair@test.com', memberName: 'Zubair', amount: 600 },
    { memberEmail: 'pavan@test.com', memberName: 'Pavan', amount: 400 }
  ];

  sandbox.populateExpenseModalMembers(preselected);

  assert(!elements['expMultiPayerSection'].classList.contains('hidden'), 'Multi-payer section must be open when editing multi-payer bill');
  assert(elements['expSinglePayerSection'].classList.contains('hidden'), 'Single-payer section must be hidden when editing multi-payer bill');
  assert.strictEqual(elements['btnToggleMultiPayerText'].textContent, 'Single Payer');
});

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
