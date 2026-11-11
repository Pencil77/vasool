const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const { signAuthToken } = require('../routes/auth');

const ARTIFACT_DIR = '/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4';
const BASE_URL = 'https://vasool-ecru.vercel.app';

function waitPort(port, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
    }
    function retry() {
      if (Date.now() - start > timeoutMs) return reject(new Error('Port timeout'));
      setTimeout(check, 250);
    }
    check();
  });
}

async function run() {
  console.log('1. Starting Obscura background CDP server on port 9222...');
  const obscura = spawn('obscura', ['serve', '-p', '9222', '--allow-private-network'], {
    stdio: 'ignore'
  });

  try {
    await waitPort(9222);
    console.log('   ✓ Obscura CDP server listening on port 9222');

    await connectToDatabase();
    const zubairUser = await User.findOne({ email: 'mdzubair7592@gmail.com' });
    if (!zubairUser) throw new Error('User Zubair not found');
    const token = signAuthToken(zubairUser);
    console.log('   ✓ Generated valid Super Admin token for Zoro (mdzubair7592@gmail.com)');

    const group = await Group.findOne({ 'members.email': 'mdzubair7592@gmail.com' });
    const groupId = group ? group._id.toString() : '';
    console.log(`   ✓ Found active group: "${group ? group.name : 'None'}" (${groupId})`);

    console.log('2. Connecting Puppeteer to Obscura...');
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
    const page = await browser.newPage();

    // Mobile viewport (Pixel 7 style)
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });

    console.log(`3. Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // Inject Auth Token and reload state
    await page.evaluate((jwtToken, userObj) => {
      localStorage.setItem('VASOOL_AUTH_TOKEN_V1', jwtToken);
      if (window.appState) {
        window.appState.currentUser = {
          id: userObj._id.toString(),
          name: userObj.name,
          email: userObj.email,
          role: 'super_admin',
          avatarUrl: userObj.avatarUrl || ''
        };
      }
      if (typeof renderTopLevelView === 'function') renderTopLevelView();
      if (typeof refreshAllViews === 'function') refreshAllViews();
    }, token, zubairUser.toObject());

    await new Promise((r) => setTimeout(r, 2000));

    // Switch to Groups panel
    console.log('4. Opening Groups view...');
    await page.evaluate(() => {
      if (typeof switchMainTab === 'function') switchMainTab('groups');
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Capture Group Card View
    const groupsCardPath = path.join(ARTIFACT_DIR, 'vasool_groups_with_details_button.png');
    await page.screenshot({ path: groupsCardPath, fullPage: false });
    console.log(`   ✓ Captured Groups card view: ${groupsCardPath}`);

    // Click "Details & Activity" button to open Group Details Modal
    console.log('5. Opening Group Details Modal...');
    await page.evaluate((gId) => {
      if (typeof openGroupDetailsModal === 'function') openGroupDetailsModal(gId);
    }, groupId);
    await new Promise((r) => setTimeout(r, 1500));

    const detailsModalMembersPath = path.join(ARTIFACT_DIR, 'vasool_group_details_modal_members.png');
    await page.screenshot({ path: detailsModalMembersPath, fullPage: false });
    console.log(`   ✓ Captured Group Details Modal (Members tab): ${detailsModalMembersPath}`);

    // Switch to Bills Tab
    console.log('6. Switching to Bills & Splits tab...');
    await page.evaluate(() => {
      if (typeof switchGroupDetailsTab === 'function') switchGroupDetailsTab('bills');
    });
    await new Promise((r) => setTimeout(r, 800));

    const detailsModalBillsPath = path.join(ARTIFACT_DIR, 'vasool_group_details_modal_bills.png');
    await page.screenshot({ path: detailsModalBillsPath, fullPage: false });
    console.log(`   ✓ Captured Group Details Modal (Bills tab): ${detailsModalBillsPath}`);

    // Switch to Settle Tab
    console.log('7. Switching to Settle Up tab...');
    await page.evaluate(() => {
      if (typeof switchGroupDetailsTab === 'function') switchGroupDetailsTab('settle');
    });
    await new Promise((r) => setTimeout(r, 800));

    const detailsModalSettlePath = path.join(ARTIFACT_DIR, 'vasool_group_details_modal_settle.png');
    await page.screenshot({ path: detailsModalSettlePath, fullPage: false });
    console.log(`   ✓ Captured Group Details Modal (Settle Up tab): ${detailsModalSettlePath}`);

    // Trigger Exit Group Confirmation Modal
    console.log('8. Opening Exit Group Confirmation Modal...');
    await page.evaluate((gId) => {
      if (typeof openExitGroupConfirmModal === 'function') openExitGroupConfirmModal(gId);
    }, groupId);
    await new Promise((r) => setTimeout(r, 800));

    const exitModalPath = path.join(ARTIFACT_DIR, 'vasool_exit_group_modal.png');
    await page.screenshot({ path: exitModalPath, fullPage: false });
    console.log(`   ✓ Captured Exit Group Modal: ${exitModalPath}`);

    await page.close();
    await browser.disconnect();
    console.log('\n🎉 ALL SCREENSHOTS SUCCESSFULLY CAPTURED VIA OBSCURA!');
  } finally {
    obscura.kill();
  }
}

run().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
