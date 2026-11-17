const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const SCRIPTS = ['core-and-telemetry', 'auth-and-admin', 'dashboard-and-expenses', 'groups-and-modals', 'qa-and-init'];

function buildLocalDom() {
  let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  html = html
    .replace(/<script src="https:\/\/cdn\.tailwindcss[^>]*><\/script>/, '')
    .replace(/<script src="https:\/\/cdn\.jsdelivr[^>]*><\/script>/, '');
  for (const name of SCRIPTS) {
    const js = fs.readFileSync(path.join(root, 'public', 'js', `${name}.js`), 'utf8');
    html = html.replace(`<script src="/js/${name}.js"></script>`, () => `<script>\n${js}\n</script>`);
  }

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:5099/',
    virtualConsole,
    pretendToBeVisual: true
  });
  dom.window.fetch = () => Promise.reject(new Error('offline'));
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  return dom;
}

function testInBrowserQaSuite() {
  return new Promise((resolve, reject) => {
    const dom = buildLocalDom();
    setTimeout(() => {
      try {
        const w = dom.window;
        w.appState.currentUser = {
          email: 'mdzubair7592@gmail.com',
          name: 'Super Admin',
          role: 'super_admin',
          isSuperAdmin: true
        };
        const result = w.runAutomatedTestSuite(false);
        const failures = result.results.filter((t) => !t.passed);
        for (const t of failures) console.log(`  FAIL ${t.name} -> ${t.detail}`);
        console.log(`In-browser QA suite: ${result.passedCount}/${result.totalCount} passing`);
        if (failures.length) return reject(new Error(`${failures.length} in-browser QA test(s) failed`));
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 2500);
  });
}

testInBrowserQaSuite()
  .then(() => {
    console.log('ALL IN-BROWSER QA TESTS PASSED');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test failed:', err.message);
    process.exit(1);
  });
