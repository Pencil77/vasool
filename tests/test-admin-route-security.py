import asyncio
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading
from playwright.async_api import async_playwright

CHROME_BIN = "/home/mrzoromit3/.agent-reach/cloak-binaries/chromium-146.0.7680.177.5/chrome"
PUBLIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../public"))

class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)
    def log_message(self, format, *args):
        pass

def start_server():
    server = HTTPServer(('127.0.0.1', 0), StaticHandler)
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, f'http://127.0.0.1:{port}'

async def main():
    server, base_url = start_server()
    print("Static test server running at", base_url)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=CHROME_BIN,
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        )
        context = await browser.new_context()
        page = await context.new_page()
        
        # Test 1: Direct navigation to /#admin while logged out
        await page.goto(base_url + '/#admin', wait_until='networkidle')
        await page.wait_for_timeout(1000)
        
        url_hash = await page.evaluate('window.location.hash')
        panel_hidden = await page.evaluate('''() => {
            const p = document.getElementById('panelAdmin');
            return p ? p.classList.contains('hidden') : true;
        }''')
        print('Test 1 (Logged-out direct #admin navigation):')
        print('  - URL hash:', repr(url_hash))
        print('  - panelAdmin is hidden:', panel_hidden)
        assert url_hash in ['', '#dashboard'], f'Hash should not be #admin, got {url_hash}'
        assert panel_hidden, 'panelAdmin must be hidden for unauthenticated user'
        
        # Test 2: Non-super admin user tries to switch to admin tab
        await page.evaluate('''() => {
            showingAuthPortal = false;
            appState.currentUser = { email: 'regular_user@example.com', name: 'Regular User', role: 'user', isSuperAdmin: false };
            renderTopLevelView();
            refreshAllViews();
            switchMainTab('admin');
        }''')
        await page.wait_for_timeout(500)
        
        url_hash2 = await page.evaluate('window.location.hash')
        panel_hidden2 = await page.evaluate('''() => {
            const p = document.getElementById('panelAdmin');
            return p ? p.classList.contains('hidden') : true;
        }''')
        active_tab2 = await page.evaluate('activeMainTab')
        print('Test 2 (Regular user switchMainTab("admin")):')
        print('  - URL hash:', repr(url_hash2))
        print('  - Active main tab:', active_tab2)
        print('  - panelAdmin is hidden:', panel_hidden2)
        assert active_tab2 == 'dashboard', f'Expected tab dashboard, got {active_tab2}'
        assert panel_hidden2, 'panelAdmin must be hidden for regular user'
        assert url_hash2 != '#admin', f'Hash must not be #admin for regular user'
        
        # Test 3: Super Admin user accesses admin tab
        await page.evaluate('''() => {
            appState.currentUser = { email: 'mdzubair7592@gmail.com', name: 'Zoro', role: 'super_admin', isSuperAdmin: true };
            renderTopLevelView();
            refreshAllViews();
            switchMainTab('admin');
        }''')
        await page.wait_for_timeout(500)
        
        url_hash3 = await page.evaluate('window.location.hash')
        panel_hidden3 = await page.evaluate('''() => {
            const p = document.getElementById('panelAdmin');
            return p ? p.classList.contains('hidden') : true;
        }''')
        active_tab3 = await page.evaluate('activeMainTab')
        print('Test 3 (Super admin switchMainTab("admin")):')
        print('  - URL hash:', repr(url_hash3))
        print('  - Active main tab:', active_tab3)
        print('  - panelAdmin is hidden:', panel_hidden3)
        assert active_tab3 == 'admin', 'Super admin must be able to switch to admin'
        assert not panel_hidden3, 'panelAdmin must be visible for super admin'
        assert url_hash3 == '#admin', 'Hash must be #admin for super admin'
        
        # Test 4: Super Admin logs out -> must reset to dashboard and hide panelAdmin
        await page.evaluate('''() => {
            handleLogout();
        }''')
        await page.wait_for_timeout(500)
        
        url_hash4 = await page.evaluate('window.location.hash')
        panel_hidden4 = await page.evaluate('''() => {
            const p = document.getElementById('panelAdmin');
            return p ? p.classList.contains('hidden') : true;
        }''')
        active_tab4 = await page.evaluate('activeMainTab')
        print('Test 4 (Super admin logout):')
        print('  - URL hash:', repr(url_hash4))
        print('  - Active main tab:', active_tab4)
        print('  - panelAdmin is hidden:', panel_hidden4)
        assert active_tab4 == 'dashboard', 'Must reset to dashboard on logout'
        assert panel_hidden4, 'panelAdmin must be hidden on logout'
        assert url_hash4 != '#admin', 'Hash must not be #admin after logout'
        
        await browser.close()
        server.shutdown()
        print('=== ALL 4 ADMIN SECURITY & ROUTING TESTS PASSED! ===')

if __name__ == '__main__':
    asyncio.run(main())
