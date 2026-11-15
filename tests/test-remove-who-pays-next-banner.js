/**
 * Verification test for complete removal of "Who Should Pay Next? / Balance Heatmap" banner
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Starting Who Should Pay Next Banner Removal Test Suite...\n');

// 1. Verify public/index.html does not contain the banner or its elements
const htmlPath = path.join(__dirname, '../public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

assert.strictEqual(
  htmlContent.includes('id="whoPaysNextBanner"'),
  false,
  'whoPaysNextBanner ID should not exist in public/index.html'
);
assert.strictEqual(
  htmlContent.includes('data-testid="who-pays-next-banner"'),
  false,
  'who-pays-next-banner testid should not exist in public/index.html'
);
assert.strictEqual(
  htmlContent.includes('Who Should Pay Next?'),
  false,
  'Text "Who Should Pay Next?" should not exist in public/index.html'
);
assert.strictEqual(
  htmlContent.includes('Balance Heatmap'),
  false,
  'Text "Balance Heatmap" should not exist in public/index.html'
);
console.log('  ✅ PASS: 1. public/index.html has no Who Should Pay Next banner or Balance Heatmap elements');

// 2. Verify public/js/dashboard-and-expenses.js has no references to whoPaysNext
const jsPath = path.join(__dirname, '../public/js/dashboard-and-expenses.js');
const jsContent = fs.readFileSync(jsPath, 'utf8');

assert.strictEqual(
  jsContent.includes('whoPaysNextBanner'),
  false,
  'whoPaysNextBanner should not be referenced in dashboard-and-expenses.js'
);
assert.strictEqual(
  jsContent.includes('whoPaysNextText'),
  false,
  'whoPaysNextText should not be referenced in dashboard-and-expenses.js'
);
console.log('  ✅ PASS: 2. public/js/dashboard-and-expenses.js does not query or render whoPaysNext elements');

// 3. Verify backend routes/settlements.js sets whoShouldPay to null
const routePath = path.join(__dirname, '../routes/settlements.js');
const routeContent = fs.readFileSync(routePath, 'utf8');
assert.strictEqual(
  routeContent.includes('minNet < -0.01'),
  false,
  'routes/settlements.js should not calculate minNet for debtor heatmap recommendation'
);
assert.ok(
  routeContent.includes('const whoShouldPay = null;'),
  'routes/settlements.js should explicitly set whoShouldPay to null'
);
console.log('  ✅ PASS: 3. routes/settlements.js sets whoShouldPay to null without performing debtor calculations');

console.log('\n========================================');
console.log('Results: All 3 tests passed successfully!');
console.log('========================================\n');
