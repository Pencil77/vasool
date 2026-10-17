const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/tmp/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const BASE_URL = 'https://vasool-ecru.vercel.app';
const ARTIFACT_DIR = '/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4';

async function capture() {
  console.log('Launching headless Chrome for Android mobile verification...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=390,844'
    ]
  });

  const page = await browser.newPage();

  // Set modern Android phone viewport (Pixel 7 / Galaxy S22 ratio)
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });

  console.log(`Navigating to ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  // 1. Mobile Dashboard Screenshot
  console.log('1. Capturing Mobile Dashboard...');
  const dashPath = path.join(ARTIFACT_DIR, 'screenshot-mobile-dashboard.png');
  await page.screenshot({ path: dashPath, fullPage: false });
  console.log(`Saved: ${dashPath}`);

  // 2. Mobile Groups Screenshot
  console.log('2. Clicking Groups tab on Mobile Bottom Nav...');
  await page.click('#mobileNavGroups');
  await new Promise((r) => setTimeout(r, 1000));
  const groupsPath = path.join(ARTIFACT_DIR, 'screenshot-mobile-groups.png');
  await page.screenshot({ path: groupsPath, fullPage: false });
  console.log(`Saved: ${groupsPath}`);

  // 3. Mobile Settle Screenshot
  console.log('3. Clicking Settle tab on Mobile Bottom Nav...');
  await page.click('#mobileNavSettle');
  await new Promise((r) => setTimeout(r, 1000));
  const settlePath = path.join(ARTIFACT_DIR, 'screenshot-mobile-settle.png');
  await page.screenshot({ path: settlePath, fullPage: false });
  console.log(`Saved: ${settlePath}`);

  // 4. Mobile Add Expense Bottom Sheet Screenshot
  console.log('4. Clicking Mobile FAB to open Add Expense Bottom Sheet...');
  await page.click('#mobileFabAddExpense');
  await new Promise((r) => setTimeout(r, 1000));
  const expensePath = path.join(ARTIFACT_DIR, 'screenshot-mobile-add-expense.png');
  await page.screenshot({ path: expensePath, fullPage: false });
  console.log(`Saved: ${expensePath}`);

  await browser.close();
  console.log('\nAll 4 Android mobile screenshots successfully captured and saved to artifact directory!');
}

capture().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
