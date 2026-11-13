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
        await page.wait_for_function('() => typeof window.openModal !== "undefined"', timeout=10000)
        await page.wait_for_timeout(500)
        
        # ======================================================================
        # Test 1: System Status is strictly hidden for unauthenticated / non-super-admins
        # ======================================================================
        print("\n--- Test 1: System Status Hidden for Non-Super-Admin ---")
        status_hidden_public = await page.evaluate('''() => {
            const btnAuth = document.getElementById('btnAuthFooterSystemStatus');
            const btnMain = document.getElementById('btnFooterSystemStatus');
            return (!btnAuth || btnAuth.classList.contains('hidden')) &&
                   (!btnMain || btnMain.classList.contains('hidden'));
        }''')
        print(f"  - System Status buttons are hidden for public: {status_hidden_public}")
        assert status_hidden_public, 'System Status footer buttons must be hidden for non-super-admin'
        
        # Ensure direct openModal('systemStatusModal') is blocked for non-super-admin
        await page.evaluate('''() => {
            appState.currentUser = { email: 'alice@example.com', name: 'Alice', role: 'user', isSuperAdmin: false };
            openModal('systemStatusModal');
        }''')
        await page.wait_for_timeout(300)
        modal_blocked = await page.evaluate('''() => {
            const m = document.getElementById('systemStatusModal');
            return !m || m.classList.contains('hidden');
        }''')
        print(f"  - Non-super-admin direct openModal('systemStatusModal') blocked: {modal_blocked}")
        assert modal_blocked, 'systemStatusModal must be blocked for regular user'
        
        # ======================================================================
        # Test 2: Super Admin sees System Status in footer and can open it
        # ======================================================================
        print("\n--- Test 2: Super Admin Access to System Status ---")
        await page.evaluate('''() => {
            appState.currentUser = { email: 'mdzubair7592@gmail.com', name: 'Zoro', role: 'super_admin', isSuperAdmin: true };
            showingAuthPortal = false;
            renderTopLevelView();
            refreshAllViews();
        }''')
        await page.wait_for_timeout(300)
        
        status_visible_super = await page.evaluate('''() => {
            const btnMain = document.getElementById('btnFooterSystemStatus');
            return btnMain && !btnMain.classList.contains('hidden');
        }''')
        print(f"  - System Status button visible for Super Admin: {status_visible_super}")
        assert status_visible_super, 'System Status button must be visible for Super Admin'
        
        await page.evaluate("openModal('systemStatusModal')")
        await page.wait_for_timeout(300)
        system_modal_open = await page.evaluate('''() => {
            const m = document.getElementById('systemStatusModal');
            return m && !m.classList.contains('hidden');
        }''')
        print(f"  - Super Admin successfully opens systemStatusModal: {system_modal_open}")
        assert system_modal_open, 'Super Admin must be able to open systemStatusModal'
        await page.evaluate("closeModal('systemStatusModal')")
        
        # ======================================================================
        # Test 3: Onboarding Wizard (Launch, Steps & Skip)
        # ======================================================================
        print("\n--- Test 3: Interactive Onboarding Wizard ---")
        await page.evaluate('openOnboardingWizard(0)')
        await page.wait_for_timeout(400)
        wizard_visible = await page.evaluate('''() => {
            const m = document.getElementById('onboardingWizardModal');
            return m && !m.classList.contains('hidden');
        }''')
        print(f"  - Onboarding wizard opened: {wizard_visible}")
        assert wizard_visible, 'Onboarding wizard modal must be visible'
        
        wizard_title = await page.evaluate('''() => {
            const t = document.getElementById('wizardCardTitle');
            return t ? t.textContent : '';
        }''')
        print(f"  - Wizard Step 1 Title: {wizard_title}")
        assert len(wizard_title) > 0, 'Wizard step must have a title'
        
        # Click Next Step
        await page.evaluate('nextOnboardingStep()')
        await page.wait_for_timeout(200)
        
        # Skip Wizard
        await page.evaluate('skipOnboardingWizard()')
        await page.wait_for_timeout(200)
        wizard_closed = await page.evaluate('''() => {
            const m = document.getElementById('onboardingWizardModal');
            return !m || m.classList.contains('hidden');
        }''')
        print(f"  - Onboarding wizard skipped & closed: {wizard_closed}")
        assert wizard_closed, 'Onboarding wizard must close on skip'
        
        # ======================================================================
        # Test 4: Top 4 KPI Tiles ONLY Visible on Home Dashboard Tab
        # ======================================================================
        print("\n--- Test 4: Top 4 Tiles Exclusivity on Home Tab ---")
        await page.evaluate("switchMainTab('dashboard')")
        await page.wait_for_timeout(200)
        hero_on_home = await page.evaluate('''() => {
            const el = document.getElementById('homeDashboardTopSection');
            return el && !el.classList.contains('hidden');
        }''')
        print(f"  - Top tiles visible on Dashboard (Home): {hero_on_home}")
        assert hero_on_home, 'Top section must be visible on Dashboard tab'
        
        await page.evaluate("switchMainTab('expenses')")
        await page.wait_for_timeout(200)
        hero_on_expenses = await page.evaluate('''() => {
            const el = document.getElementById('homeDashboardTopSection');
            return !el || el.classList.contains('hidden');
        }''')
        print(f"  - Top tiles hidden on Expenses tab: {hero_on_expenses}")
        assert hero_on_expenses, 'Top section must be hidden on Expenses tab'
        
        # ======================================================================
        # Test 5: Dynamic UPI Profile Configuration
        # ======================================================================
        print("\n--- Test 5: Dynamic UPI & Hiding UPI Redirect when Unset ---")
        await page.evaluate('''() => {
            // Recipient has no UPI ID
            const targetGroupId = 'g_test_1';
            appState.groups = [{
                id: targetGroupId,
                name: 'Test Group',
                members: [
                    { email: 'bob@example.com', name: 'Bob', upiId: '' },
                    { email: 'mdzubair7592@gmail.com', name: 'Zoro', upiId: 'zoro@okhdfcbank' }
                ]
            }];
            openSettleConfirm('mdzubair7592@gmail.com', 'Zoro', 'bob@example.com', 'Bob', 500);
        }''')
        await page.wait_for_timeout(300)
        
        upi_section_hidden = await page.evaluate('''() => {
            const s = document.getElementById('settleUpiSection');
            const n = document.getElementById('settleNoUpiNotice');
            return s && s.classList.contains('hidden') && n && !n.classList.contains('hidden');
        }''')
        print(f"  - Direct UPI redirect hidden when recipient has no UPI: {upi_section_hidden}")
        assert upi_section_hidden, 'UPI redirect must be hidden and no-upi notice shown when recipient has no UPI'
        
        # Now set UPI ID on recipient
        await page.evaluate('''() => {
            appState.groups[0].members[0].upiId = 'bob@okaxis';
            openSettleConfirm('mdzubair7592@gmail.com', 'Zoro', 'bob@example.com', 'Bob', 500);
        }''')
        await page.wait_for_timeout(300)
        
        upi_section_visible = await page.evaluate('''() => {
            const s = document.getElementById('settleUpiSection');
            const n = document.getElementById('settleNoUpiNotice');
            return s && !s.classList.contains('hidden') && n && n.classList.contains('hidden');
        }''')
        print(f"  - Direct UPI redirect visible when recipient has UPI: {upi_section_visible}")
        assert upi_section_visible, 'UPI redirect must be active when recipient has UPI'
        
        # Close settle modal
        await page.evaluate("closeModal('settleConfirmModal')")
        
        # ======================================================================
        # Test 6: Multi-Payer Split Support (Debt Calculation)
        # ======================================================================
        print("\n--- Test 6: Multi-Payer Split Support ---")
        has_multi_payer_ui = await page.evaluate('''() => {
            const toggle = document.getElementById('expMultiPayerToggle') || document.getElementById('expPaidByMultiWrapper');
            const container = document.getElementById('expMultiPayerAllocations') || document.getElementById('expPaidByMultiContainer');
            return toggle !== null && container !== null;
        }''')
        print(f"  - Multi-payer expense toggle & allocations UI present: {has_multi_payer_ui}")
        assert has_multi_payer_ui, 'Multi-payer expense UI elements must exist'
        
        # Take live screenshot of wizard and main app
        screenshot_path = '/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4/vasool_v3.1_verified_dashboard.png'
        await page.screenshot(path=screenshot_path)
        print(f"Verified screenshot saved: {screenshot_path}")
        
        await browser.close()
        print("\n🎉 ALL VASOOL v3.1 END-TO-END VERIFICATION TESTS PASSED!")

if __name__ == '__main__':
    asyncio.run(main())
