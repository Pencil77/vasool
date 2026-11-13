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
    return server, f"http://127.0.0.1:{port}"

async def main():
    print("======================================================")
    print("🛡️  RUNNING VASOOL V3.0 MODULAR UI INVARIANTS TEST")
    print("======================================================\n")

    server, base_url = start_server()
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=CHROME_BIN,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
        )

        viewports = [
            {"name": "Mobile Compact (360x800)", "width": 360, "height": 800},
            {"name": "Mobile Standard (390x844)", "width": 390, "height": 844},
            {"name": "Desktop Standard (1280x800)", "width": 1280, "height": 800}
        ]

        try:
            for vp in viewports:
                print(f"🔍 Testing Viewport: {vp['name']}")
                context = await browser.new_context(viewport={"width": vp["width"], "height": vp["height"]})
                page = await context.new_page()

                await page.goto(base_url + '/', wait_until="networkidle")
                await page.wait_for_timeout(1000)

                # Simulate active authenticated Super Admin
                await page.evaluate("""() => {
                    showingAuthPortal = false;
                    appState.currentUser = { email: 'mdzubair7592@gmail.com', name: 'Zoro' };
                    renderTopLevelView();
                    refreshAllViews();
                }""")
                await page.wait_for_timeout(500)

                # Invariant 1: Header scrollWidth <= viewport width
                header_box = await page.eval_on_selector("header", "el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })")
                print(f"  [Invariant 1] Header scrollWidth: {header_box['scrollWidth']}px vs Viewport: {vp['width']}px")
                if header_box["scrollWidth"] > vp["width"] + 1:
                    raise Exception(f"Header horizontally overflows viewport! (scrollWidth {header_box['scrollWidth']} > {vp['width']})")
                print("  ✅ Invariant 1 Passed: No header horizontal overflow.")

                # Invariant 2: Header Logout button fully within viewport
                logout_box = await page.eval_on_selector("#btnHeaderLogout", """el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return {
                        x: rect.x,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        display: style.display,
                        visibility: style.visibility
                    };
                }""")
                print(f"  [Invariant 2] #btnHeaderLogout right edge: {logout_box['right']}px vs Viewport: {vp['width']}px, box: {logout_box}")
                if logout_box["right"] > vp["width"]:
                    raise Exception(f"#btnHeaderLogout is cut off! (right: {logout_box['right']} > viewport {vp['width']})")
                if logout_box["width"] == 0 or logout_box["height"] == 0 or logout_box["display"] == "none":
                    raise Exception("#btnHeaderLogout is hidden or zero dimensions!")
                print("  ✅ Invariant 2 Passed: #btnHeaderLogout is completely visible and reachable.")

                # Invariant 3: Clicking Header Logout opens #logoutConfirmModal
                await page.click("#btnHeaderLogout")
                await page.wait_for_timeout(400)
                is_modal_visible = await page.eval_on_selector("#logoutConfirmModal", "el => !el.classList.contains('hidden')")
                if not is_modal_visible:
                    raise Exception("#logoutConfirmModal failed to open when clicking #btnHeaderLogout!")
                print("  ✅ Invariant 3 Passed: #logoutConfirmModal opened successfully.")
                await page.click('[data-testid="btn-close-logout-modal"]')
                await page.wait_for_timeout(300)

                # Invariant 4: Account Settings modal has visible Sign Out button
                await page.click("#headerUserAvatar")
                await page.wait_for_timeout(400)
                is_settings_open = await page.eval_on_selector("#accountSettingsModal", "el => !el.classList.contains('hidden')")
                is_settings_logout_visible = await page.eval_on_selector("#btnSettingsLogout", "el => el.getBoundingClientRect().width > 0")
                if not is_settings_open or not is_settings_logout_visible:
                    raise Exception("#accountSettingsModal or #btnSettingsLogout missing/hidden!")
                print("  ✅ Invariant 4 Passed: Account Settings modal has prominent Sign Out button.")

                # Invariant 5: Sign out from Account Settings triggers confirmation
                await page.click("#btnSettingsLogout")
                await page.wait_for_timeout(400)
                is_confirm_open = await page.eval_on_selector("#logoutConfirmModal", "el => !el.classList.contains('hidden')")
                if not is_confirm_open:
                    raise Exception("Sign out from Account Settings failed to open confirmation modal!")
                print("  ✅ Invariant 5 Passed: Sign Out from Account Settings triggered confirmation.")
                await page.click('[data-testid="btn-close-logout-modal"]')
                await page.wait_for_timeout(300)

                # Invariant 6: Core Navigation components exist
                nav_check = await page.evaluate("""() => ({
                    hasDashboard: Boolean(document.getElementById('navTabDashboard') || document.getElementById('mobileNavDashboard')),
                    hasBills: Boolean(document.getElementById('navTabExpenses') || document.getElementById('mobileNavExpenses')),
                    hasGroups: Boolean(document.getElementById('navTabGroups') || document.getElementById('mobileNavGroups')),
                    hasSettle: Boolean(document.getElementById('navTabSettle') || document.getElementById('mobileNavSettle')),
                    hasFeedback: Boolean(document.getElementById('fabFeedbackBtn') || document.getElementById('btnHeaderFeedback'))
                })""")
                for key, val in nav_check.items():
                    if not val:
                        raise Exception(f"Missing navigation component: {key}")
                print("  ✅ Invariant 6 Passed: Core navigation targets intact.\n")

                await context.close()

            print("======================================================")
            print("🎉 ALL 18/18 INVARIANT CHECKS PASSED ON VASOOL V3.0!")
            print("======================================================\n")

        finally:
            await browser.close()
            server.shutdown()

asyncio.run(main())
