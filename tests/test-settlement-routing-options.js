const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { simplifyDebtsGreedy, simplifyDebtsAdminHub } = require('../routes/splits');
const Group = require('../models/Group');

async function runTests() {
  console.log('🧪 Starting Settlement Routing Options Verification Suite...');

  // 1. Verify Group schema definition
  console.log('1. Checking Group Mongoose Schema:');
  const schemaPaths = Group.schema.paths;
  assert(schemaPaths.adminHubSettlement, 'Group schema must have adminHubSettlement path');
  assert.strictEqual(schemaPaths.adminHubSettlement.instance, 'Boolean', 'adminHubSettlement must be Boolean');
  assert.strictEqual(schemaPaths.adminHubSettlement.defaultValue, false, 'adminHubSettlement default must be false (Direct P2P)');
  console.log('   ✅ Group schema has adminHubSettlement (Boolean, default: false)');

  // 2. Test Backend Debt Algorithms
  console.log('2. Testing Backend Debt Simplification Algorithms:');
  // Scenario:
  // Admin is Bob (b@test.com)
  // Dave (d@test.com) owes 1000 net: net = -1000
  // Charlie (c@test.com) is owed 1000 net: net = +1000
  // Bob (b@test.com) is net 0: net = 0
  const balanceMap = {
    'b@test.com': { email: 'b@test.com', name: 'Bob (Admin)', paid: 0, owed: 0, net: 0 },
    'd@test.com': { email: 'd@test.com', name: 'Dave', paid: 0, owed: 1000, net: -1000 },
    'c@test.com': { email: 'c@test.com', name: 'Charlie', paid: 1000, owed: 0, net: 1000 }
  };

  // Test Direct Peer-to-Peer (Greedy)
  const p2pTrans = simplifyDebtsGreedy(balanceMap);
  console.log('   Direct P2P transactions:', p2pTrans);
  assert.strictEqual(p2pTrans.length, 1, 'Standard Direct P2P must produce 1 direct transfer');
  assert.strictEqual(p2pTrans[0].fromEmail, 'd@test.com');
  assert.strictEqual(p2pTrans[0].toEmail, 'c@test.com');
  assert.strictEqual(p2pTrans[0].amount, 1000);
  assert.strictEqual(p2pTrans[0].isAdminTransfer, false);
  assert.strictEqual(p2pTrans[0].type, 'standard_greedy');
  console.log('   ✅ Direct P2P correctly outputs: Dave pays Charlie directly ₹1,000 (1 transfer)');

  // Test Admin-Hub routing
  const adminMember = { email: 'b@test.com', name: 'Bob (Admin)', role: 'admin' };
  const hubTrans = simplifyDebtsAdminHub(balanceMap, adminMember);
  console.log('   Admin-Hub transactions:', hubTrans);
  assert.strictEqual(hubTrans.length, 2, 'Admin-Hub must produce 2 transfers routed through Admin');
  assert.strictEqual(hubTrans[0].fromEmail, 'd@test.com');
  assert.strictEqual(hubTrans[0].toEmail, 'b@test.com');
  assert.strictEqual(hubTrans[0].type, 'pay_to_admin');
  assert.strictEqual(hubTrans[0].isAdminTransfer, true);

  assert.strictEqual(hubTrans[1].fromEmail, 'b@test.com');
  assert.strictEqual(hubTrans[1].toEmail, 'c@test.com');
  assert.strictEqual(hubTrans[1].type, 'admin_payout');
  assert.strictEqual(hubTrans[1].isAdminTransfer, true);
  console.log('   ✅ Admin-Hub correctly outputs: Dave pays Admin Bob (₹1,000), Admin Bob settles Charlie (₹1,000) (2 transfers)');

  // 3. Inspect public/index.html UI elements and scripts
  console.log('3. Inspecting public/index.html frontend code:');
  const indexHtmlPath = path.join(__dirname, '../public/index.html');
  let html = fs.readFileSync(indexHtmlPath, 'utf8');
  const jsDir = path.join(__dirname, '../public/js');
  if (fs.existsSync(jsDir)) {
    fs.readdirSync(jsDir).forEach((f) => {
      if (f.endsWith('.js')) {
        html += '\n' + fs.readFileSync(path.join(jsDir, f), 'utf8');
      }
    });
  }

  // Verify modal elements
  assert(html.includes('id="newGroupAdminHub"'), 'index.html must have #newGroupAdminHub checkbox');
  assert(html.includes('data-testid="input-new-group-admin-hub"'), 'index.html must have data-testid input-new-group-admin-hub');
  console.log('   ✅ #newGroupAdminHub checkbox present in New Group modal');

  assert(html.includes('id="settingAdminHubSettlement"'), 'index.html must have #settingAdminHubSettlement checkbox');
  assert(html.includes('data-testid="input-setting-admin-hub"'), 'index.html must have data-testid input-setting-admin-hub');
  console.log('   ✅ #settingAdminHubSettlement present in Group Settings modal');

  // Verify group card toggle button
  assert(html.includes('btn-toggle-adminhub-'), 'index.html must have btn-toggle-adminhub- button on group cards');
  assert(html.includes('toggleGroupAdminHub('), 'index.html must have toggleGroupAdminHub function');
  console.log('   ✅ Quick toggle button and toggleGroupAdminHub handler present');

  // Verify Settle Up banner reflects routing
  assert(html.includes('Admin-Hub Routing Active:'), 'index.html must have Admin-Hub Routing Active banner');
  assert(html.includes('Direct Peer-to-Peer Settlement (Standard):'), 'index.html must have Direct Peer-to-Peer Settlement (Standard) banner');
  console.log('   ✅ Settle Up banners for both Admin-Hub and Direct P2P present');

  // Verify version bump
  assert(html.includes('v3.') || html.includes('v2.7') || html.includes('v2.6') || html.includes('v2.5'), 'index.html must have v3.x or v2.x badge');
  console.log('   ✅ Version badge verified');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Settlement routing options fully verified.');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
