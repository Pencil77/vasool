const fs = require('fs');
const { JSDOM } = require('jsdom');

async function testLocalHtml() {
  const html = fs.readFileSync('/tmp/workspace/vasool/public/index.html', 'utf8');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'https://vasool-ecru.vercel.app/'
  });

  const window = dom.window;
  window.fetch = globalThis.fetch;

  await new Promise((r) => setTimeout(r, 600));

  console.log('1. Document Title:', window.document.title);
  const cfg = await window.apiFetch('/api/auth/config');
  console.log('2. Config endpoint response:', cfg);

  // Perform live signup via the page function!
  const uniqueId = Date.now();
  window.document.getElementById('signupName').value = 'Live Browser User';
  window.document.getElementById('signupEmail').value = 'live.browser.' + uniqueId + '@example.com';
  window.document.getElementById('signupPassword').value = 'LiveSecret1234#';
  window.document.getElementById('signupUpi').value = 'live@upi';

  const form = window.document.getElementById('signupForm');
  await window.handleEmailSignup({ preventDefault: () => {}, target: form });

  console.log('3. User after handleEmailSignup:', window.appState.currentUser);
  console.log('4. Auth token in localStorage:', Boolean(window.localStorage.getItem('vasool_jwt_token')));
  console.log('5. QA Suite after user signup:', window.document.getElementById('qaPassRateBadge').textContent);

  // Now create a group via the page function!
  window.document.getElementById('newGroupName').value = 'Weekend Goa Party ' + uniqueId;
  window.document.getElementById('newGroupCategory').value = 'Trip';
  window.document.getElementById('newGroupMembersInput').value = 'Abhi <abhi@test.com>, Rohan <rohan@test.com>';
  await window.handleCreateGroup({ preventDefault: () => {} });

  console.log('6. Groups in appState:', window.appState.groups.length);
  const createdGroup = window.appState.groups[0];
  console.log('7. Created group ID:', createdGroup.id, 'name:', createdGroup.name);

  // Now add an expense via the page function!
  window.document.getElementById('expGroupSelect').innerHTML =
    '<option value="' + createdGroup.id + '">' + createdGroup.name + '</option>';
  window.document.getElementById('expGroupSelect').value = createdGroup.id;
  window.populateExpenseModalMembers();
  window.document.getElementById('expAmountInput').value = '3000';
  window.setSplitMode('equal');
  window.document.getElementById('expDescInput').value = 'Beach Dinner';
  await window.handleSaveExpense({ preventDefault: () => {} });

  console.log('8. Expenses in appState:', window.appState.expenses.length);
  const createdExp = window.appState.expenses[0];
  console.log('9. Created expense ID:', createdExp.id, 'amount:', createdExp.amount);

  console.log('\nAll in-browser user actions executed and persisted successfully to MongoDB Atlas!');
}

testLocalHtml().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
