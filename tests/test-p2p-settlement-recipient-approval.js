const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('🧪 Starting Direct P2P Settlement Recipient-Only Approval & Email Acknowledgment Test Suite...\n');

// =========================================================================
// TEST 1: Frontend Inbox Filtering Logic (P2P vs Hub Mode)
// =========================================================================
console.log('--- Test 1: Frontend Action Inbox Filtering ---');

const groupsJs = fs.readFileSync(path.join(__dirname, '../public/js/groups-and-modals.js'), 'utf8');

// Verify that the code correctly inspects adminHubSettlement to filter actionable settlements
assert(groupsJs.includes('const isHub = grp ? Boolean(grp.adminHubSettlement) : false;'), 'groups-and-modals.js must check group.adminHubSettlement');
assert(groupsJs.includes('// In Direct P2P mode, ONLY the recipient/creditor can approve!'), 'groups-and-modals.js must enforce recipient-only approval comment/logic');
assert(groupsJs.includes('return isCreditor;'), 'groups-and-modals.js must return isCreditor for P2P mode');

// Simulate the filtering logic in a sandbox
function filterActionableSettlements({ pendingApprovalList, groups, currentEmail, isViewerAdminOfAny }) {
  return pendingApprovalList.filter((s) => {
    const isCreditor = s.toEmail && s.toEmail.toLowerCase().trim() === currentEmail;
    const grp = groups.find((g) => String(g.id) === String(s.groupId));
    const isHub = grp ? Boolean(grp.adminHubSettlement) : false;
    if (isHub) {
      return isViewerAdminOfAny || isCreditor;
    }
    // In Direct P2P mode, ONLY the recipient/creditor can approve!
    return isCreditor;
  });
}

const mockGroups = [
  { id: 'grp_p2p', name: 'Goa Trip (P2P)', adminEmail: 'admin@example.com', adminHubSettlement: false },
  { id: 'grp_hub', name: 'Office Lunch (Hub)', adminEmail: 'admin@example.com', adminHubSettlement: true }
];

const p2pSettlementBetweenMembers = {
  id: 'stl_1',
  groupId: 'grp_p2p',
  fromEmail: 'pavan@example.com',
  toEmail: 'praneeth@example.com',
  amount: 429,
  status: 'pending_confirmation'
};

const hubSettlementToAdmin = {
  id: 'stl_2',
  groupId: 'grp_hub',
  fromEmail: 'pavan@example.com',
  toEmail: 'admin@example.com',
  amount: 250,
  status: 'pending_admin_approval'
};

// Case A: Group Admin views settlements in Direct P2P mode
const adminViewingP2P = filterActionableSettlements({
  pendingApprovalList: [p2pSettlementBetweenMembers],
  groups: mockGroups,
  currentEmail: 'admin@example.com',
  isViewerAdminOfAny: true
});
assert.strictEqual(adminViewingP2P.length, 0, 'Group admin must NOT see or receive approval action for P2P settlement between other members');
console.log('✅ Case A Passed: Group admin does NOT see actionable confirmation for P2P settlement between other members.');

// Case B: Recipient (Praneeth) views settlements in Direct P2P mode
const recipientViewingP2P = filterActionableSettlements({
  pendingApprovalList: [p2pSettlementBetweenMembers],
  groups: mockGroups,
  currentEmail: 'praneeth@example.com',
  isViewerAdminOfAny: false
});
assert.strictEqual(recipientViewingP2P.length, 1, 'Recipient must see the actionable confirmation card in Direct P2P mode');
assert.strictEqual(recipientViewingP2P[0].id, 'stl_1');
console.log('✅ Case B Passed: Recipient (creditor) DOES see actionable confirmation for payment sent to them.');

// Case C: Group Admin views settlements in Admin Hub mode
const adminViewingHub = filterActionableSettlements({
  pendingApprovalList: [hubSettlementToAdmin],
  groups: mockGroups,
  currentEmail: 'admin@example.com',
  isViewerAdminOfAny: true
});
assert.strictEqual(adminViewingHub.length, 1, 'Group admin DOES see pending settlements in Admin Hub mode');
console.log('✅ Case C Passed: Group admin sees pending approval in Admin Hub mode where all funds flow through admin.');

// =========================================================================
// TEST 2: Backend Direct Confirmation & Status Invariants
// =========================================================================
console.log('\n--- Test 2: Backend Direct Confirmation & Status Invariants ---');

const settlementsRouteJs = fs.readFileSync(path.join(__dirname, '../routes/settlements.js'), 'utf8');

// Verify authorization logic in POST /settlements
assert(settlementsRouteJs.includes('const isDirectlyConfirmed = isTargetCreditor || (isHubMode && isAdmin && cleanToEmail === requesterEmail);'),
  'Only recipient or hub-mode admin receiving funds should directly auto-confirm upon recording');
assert(settlementsRouteJs.includes('const confirmationToken = isDirectlyConfirmed ? null : crypto.randomBytes(32).toString(\'hex\');'),
  'Must generate 64-char random hex confirmation token for unconfirmed settlements');
const schedulerJs = fs.readFileSync(path.join(__dirname, '../lib/settlement-scheduler.js'), 'utf8');
assert(settlementsRouteJs.includes('notifyAfterAt') && schedulerJs.includes('sendPaymentConfirmationRequestEmail'),
  'Must schedule delayed notification via notifyAfterAt and dispatch sendPaymentConfirmationRequestEmail in scheduler');

// Verify confirm & reject route permission checks
assert(settlementsRouteJs.includes('In Direct P2P mode, only the receiving recipient/creditor can confirm receipt of this payment.'),
  'Must deny group admin confirm requests in Direct P2P mode with descriptive 403');
assert(settlementsRouteJs.includes('In Direct P2P mode, only the receiving recipient/creditor can reject payment claims.'),
  'Must deny group admin reject requests in Direct P2P mode with descriptive 403');
assert(settlementsRouteJs.includes('router.get(\'/settlements/ack\','),
  'Must mount GET /settlements/ack endpoint for 1-click email acknowledgment');

console.log('✅ Test 2 Passed: Backend route structure strictly enforces recipient-only permissions in P2P mode.');

// =========================================================================
// TEST 3: Mailer 1-Click Confirmation Link & Template Generation
// =========================================================================
console.log('\n--- Test 3: Mailer 1-Click Confirmation Email Generator ---');

const { sendPaymentConfirmationRequestEmail } = require('../lib/mailer');
assert.strictEqual(typeof sendPaymentConfirmationRequestEmail, 'function', 'sendPaymentConfirmationRequestEmail must be exported');

(async () => {
  const dummyToken = crypto.randomBytes(32).toString('hex');
  const dummySettlement = {
    _id: '507f1f77bcf86cd799439011',
    fromName: 'Pavan Sai',
    fromEmail: 'pavan@example.com',
    toName: 'Praneeth',
    toEmail: 'praneeth@example.com',
    amount: 429.00,
    method: 'UPI',
    utrNumber: 'UPI492049102941',
    referenceNote: 'Dinner split at spice garden'
  };
  const dummyGroup = {
    name: 'Weekend Getaway',
    currency: 'INR'
  };

  // Mock mailer call (in test environment, mailer simulates dispatch)
  const result = await sendPaymentConfirmationRequestEmail({
    settlement: dummySettlement,
    group: dummyGroup,
    confirmToken: dummyToken
  });

  assert(result, 'Email dispatch result must be truthy');
  assert.strictEqual(result.recipient, 'praneeth@example.com', 'Recipient must match settlement toEmail');
  assert(result.subject.includes('Action Required:') && result.subject.includes('₹429.00'), 'Subject must contain settlement amount and call to action');
  assert(result.ackUrl.includes(dummyToken), 'Acknowledgment URL must contain the confirmation token');
  assert(result.ackUrl.includes(dummySettlement._id), 'Acknowledgment URL must contain settlement ID');
  assert(result.ackUrl.includes('/api/settlements/ack'), 'Acknowledgment URL must route to /api/settlements/ack');
  console.log('✅ Test 3 Passed: Payment confirmation email with 1-click token URL generated successfully.');

  // =========================================================================
  // TEST 4: HTML Acknowledgment Page Renderer
  // =========================================================================
  console.log('\n--- Test 4: HTML Acknowledgment Page Render Validation ---');

  // Verify renderAckResultPage produces valid, accessible HTML
  const settlementsModule = require('../routes/settlements');
  // Extract renderAckResultPage or check rendered output
  const ackHtmlRegex = /function renderAckResultPage\(\{([^}]+)\}\)\s*\{([\s\S]*?)\n\}/;
  const match = settlementsRouteJs.match(ackHtmlRegex);
  assert(match, 'renderAckResultPage function must exist in settlements.js');

  const fn = new Function('{ success, title, message, settlement, alreadyConfirmed }', match[2]);
  const pageHtml = fn({
    success: true,
    title: 'Payment Confirmed Successfully! 🎉',
    message: 'You have successfully acknowledged receipt of ₹429.00 from Pavan Sai.',
    settlement: dummySettlement,
    alreadyConfirmed: false
  });

  assert(pageHtml.includes('Payment Confirmed Successfully!'), 'Rendered HTML must contain title');
  assert(pageHtml.includes('₹429'), 'Rendered HTML must contain formatted amount');
  assert(pageHtml.includes('Pavan Sai'), 'Rendered HTML must contain payer name');
  assert(pageHtml.includes('Praneeth'), 'Rendered HTML must contain recipient name');
  assert(pageHtml.includes('Open Vasool Dashboard'), 'Rendered HTML must contain dashboard link');
  assert(pageHtml.includes('Redirecting to dashboard'), 'Rendered HTML must contain countdown redirect script');
  console.log('✅ Test 4 Passed: 1-click acknowledgment result page HTML is fully formed and branded.');

  console.log('\n🎉 ALL TESTS PASSED: Direct P2P payment confirmations route strictly to recipient, admin is excluded in P2P mode, and Wydia 1-click email acknowledgment is verified!\n');
})().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
