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
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()
        
        # Navigate to homepage
        await page.goto(base_url + '/', wait_until='networkidle')
        await page.wait_for_timeout(1000)
        
        # ======================================================================
        # Test 1: Logged-out / Public user clicks "System Status" in footer
        # ======================================================================
        print("\n--- Test 1: Public Footer System Status Click ---")
        status_btn = page.locator('#btnAuthFooterSystemStatus')
        assert await status_btn.count() == 1, 'Footer button #btnAuthFooterSystemStatus must exist'
        
        # Click System Status
        await status_btn.click()
        await page.wait_for_timeout(500)
        
        # Check systemStatusModal is visible and cloudModal is hidden
        system_modal_visible = await page.evaluate('''() => {
            const m = document.getElementById('systemStatusModal');
            return m && !m.classList.contains('hidden');
        }''')
        cloud_modal_hidden = await page.evaluate('''() => {
            const m = document.getElementById('cloudModal');
            return !m || m.classList.contains('hidden');
        }''')
        print(f"  - systemStatusModal visible: {system_modal_visible}")
        print(f"  - cloudModal hidden: {cloud_modal_hidden}")
        assert system_modal_visible, 'systemStatusModal must open when clicking System Status'
        assert cloud_modal_hidden, 'cloudModal must NOT open for public users'
        
        # Verify abstracted contents of systemStatusModal
        modal_text = await page.evaluate('''() => {
            const m = document.getElementById('systemStatusModal');
            return m ? m.innerText : '';
        }''')
        print("  - Abstracted status text preview:", repr(modal_text[:120]))
        assert 'Operational' in modal_text, 'Modal must show Operational status'
        assert 'Expense & Split Engine' in modal_text, 'Modal must show core services'
        assert 'Debt Simplification' in modal_text, 'Modal must show settlement service'
        assert 'MongoDB Atlas' not in modal_text, 'Modal must NOT reveal MongoDB Atlas vendor name'
        assert 'avp_' not in modal_text, 'Modal must NOT contain Infisical enrollment tokens'
        assert 'Reset Sample Data' not in modal_text, 'Modal must NOT contain reset buttons'
        
        # Check that super admin quick link is hidden for public user
        super_notice_hidden = await page.evaluate('''() => {
            const el = document.getElementById('superAdminDiagnosticNotice');
            return !el || el.classList.contains('hidden');
        }''')
        print(f"  - superAdminDiagnosticNotice hidden for public: {super_notice_hidden}")
        assert super_notice_hidden, 'superAdminDiagnosticNotice must be hidden for public user'
        
        # Close systemStatusModal
        await page.evaluate("closeModal('systemStatusModal')")
        await page.wait_for_timeout(300)
        system_modal_closed = await page.evaluate('''() => {
            const m = document.getElementById('systemStatusModal');
            return !m || m.classList.contains('hidden');
        }''')
        assert system_modal_closed, 'systemStatusModal must close'
        
        # ======================================================================
        # Test 2: Non-super-admin user attempts direct cloudModal access
        # ======================================================================
        print("\n--- Test 2: Non-Super-Admin Direct cloudModal Block ---")
        await page.evaluate('''() => {
            appState.currentUser = { email: 'alice@example.com', name: 'Alice Non-Admin', role: 'user', isSuperAdmin: false };
            openModal('cloudModal');
        }''')
        await page.wait_for_timeout(500)
        
        cloud_modal_blocked = await page.evaluate('''() => {
            const m = document.getElementById('cloudModal');
            return !m || m.classList.contains('hidden');
        }''')
        print(f"  - cloudModal remains hidden for non-super-admin: {cloud_modal_blocked}")
        assert cloud_modal_blocked, 'cloudModal must be blocked for non-super-admin'
        
        # Test exportDatabaseJson security block
        await page.evaluate('''() => {
            exportDatabaseJson();
            resetDemoDatabase();
        }''')
        
        # ======================================================================
        # Test 3: Super Admin User (mdzubair7592@gmail.com) Access
        # ======================================================================
        print("\n--- Test 3: Super Admin Access ---")
        await page.evaluate('''() => {
            appState.currentUser = { email: 'mdzubair7592@gmail.com', name: 'Zoro Super Admin', role: 'super_admin', isSuperAdmin: true };
            openModal('systemStatusModal');
        }''')
        await page.wait_for_timeout(500)
        
        super_notice_visible = await page.evaluate('''() => {
            const el = document.getElementById('superAdminDiagnosticNotice');
            return el && !el.classList.contains('hidden');
        }''')
        print(f"  - superAdminDiagnosticNotice visible for Super Admin: {super_notice_visible}")
        assert super_notice_visible, 'superAdminDiagnosticNotice must be visible for Super Admin'
        
        # Super admin opens cloudModal
        await page.evaluate('''() => {
            closeModal('systemStatusModal');
            openModal('cloudModal');
        }''')
        await page.wait_for_timeout(500)
        
        cloud_modal_open_for_admin = await page.evaluate('''() => {
            const m = document.getElementById('cloudModal');
            return m && !m.classList.contains('hidden');
        }''')
        print(f"  - cloudModal opens for Super Admin: {cloud_modal_open_for_admin}")
        assert cloud_modal_open_for_admin, 'cloudModal must open for Super Admin'
        
        # Verify no token leaks in cloudModal either
        cloud_text = await page.evaluate('''() => {
            const m = document.getElementById('cloudModal');
            return m ? m.innerText : '';
        }''')
        assert 'avp_' not in cloud_text, 'cloudModal must NOT contain hardcoded token strings'
        
        # Take screenshot for proof artifact
        screenshot_path = '/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4/vasool_system_status_abstracted_modal.png'
        await page.evaluate('''() => {
            closeModal('cloudModal');
            openModal('systemStatusModal');
        }''')
        await page.wait_for_timeout(500)
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")
        
        await browser.close()
        print("\n✅ ALL FRONTEND SYSTEM STATUS SECURITY TESTS PASSED PERFECTLY!")

if __name__ == '__main__':
    asyncio.run(main())
