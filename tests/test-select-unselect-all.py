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
        
        await page.goto(base_url + '/', wait_until='networkidle')
        await page.wait_for_function('() => typeof window.appState !== "undefined"', timeout=10000)
        await page.wait_for_timeout(500)
        
        print("\n--- Testing Select/Unselect All & Default Unselected State ---")
        
        # 1. Setup mock logged-in state with a group having 4 members
        await page.evaluate('''() => {
            showingAuthPortal = false;
            appState.currentUser = { email: 'alice@example.com', name: 'Alice' };
            appState.groups = [{
                id: 'grp_test_split',
                name: 'Goa Trip 2026',
                category: 'Trip',
                members: [
                    { email: 'alice@example.com', name: 'Alice', role: 'admin' },
                    { email: 'bob@example.com', name: 'Bob', role: 'member' },
                    { email: 'charlie@example.com', name: 'Charlie', role: 'member' },
                    { email: 'david@example.com', name: 'David', role: 'member' }
                ]
            }];
            renderTopLevelView();
            refreshAllViews();
            openAddExpenseModal();
        }''')
        await page.wait_for_timeout(400)
        
        # Verify modal is open
        is_modal_open = await page.evaluate('''() => {
            const m = document.getElementById('addExpenseModal');
            return m && !m.classList.contains('hidden');
        }''')
        print(f"  1. Add Expense Modal open: {is_modal_open}")
        assert is_modal_open, "Modal addExpenseModal should be open"
        
        # Verify default state: ALL 4 member checkboxes must be UNSELECTED
        unselected_info = await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
            const checks = rows.map(r => r.querySelector('.exp-member-check').checked);
            const btn = document.getElementById('btnToggleAllSplitMembers');
            return {
                totalRows: rows.length,
                allUnchecked: checks.every(c => c === false),
                checks: checks,
                btnText: btn ? btn.textContent.trim() : null
            };
        }''')
        print(f"  2. Total members: {unselected_info['totalRows']}")
        print(f"  3. All members unselected by default: {unselected_info['allUnchecked']}")
        print(f"  4. Button text when all unselected: '{unselected_info['btnText']}'")
        assert unselected_info['totalRows'] == 4, "Should have 4 member rows"
        assert unselected_info['allUnchecked'], "All members must be unselected by default!"
        assert unselected_info['btnText'] == "Select All", "Button must say 'Select All' when all unselected"
        
        # 2. Click "Select All" button
        print("\n--- Clicking 'Select All' Button ---")
        await page.click('#btnToggleAllSplitMembers')
        await page.wait_for_timeout(200)
        
        selected_info = await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
            const checks = rows.map(r => r.querySelector('.exp-member-check').checked);
            const btn = document.getElementById('btnToggleAllSplitMembers');
            const summary = document.getElementById('splitAllocationSummary').textContent.trim();
            const amounts = rows.map(r => r.querySelector('.exp-member-computed').textContent.trim());
            return {
                allChecked: checks.every(c => c === true),
                btnText: btn ? btn.textContent.trim() : null,
                summary: summary,
                amounts: amounts
            };
        }''')
        print(f"  5. All members checked: {selected_info['allChecked']}")
        print(f"  6. Button text after clicking: '{selected_info['btnText']}'")
        print(f"  7. Allocation summary: {selected_info['summary']}")
        print(f"  8. Member computed amounts: {selected_info['amounts']}")
        assert selected_info['allChecked'], "All members should now be checked"
        assert selected_info['btnText'] == "Unselect All", "Button should now say 'Unselect All'"
        assert "1,200" in selected_info['summary'], "Summary should reflect total 1200"
        
        # 3. Click "Unselect All" button
        print("\n--- Clicking 'Unselect All' Button ---")
        await page.click('#btnToggleAllSplitMembers')
        await page.wait_for_timeout(200)
        
        re_unselected_info = await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
            const checks = rows.map(r => r.querySelector('.exp-member-check').checked);
            const btn = document.getElementById('btnToggleAllSplitMembers');
            const summary = document.getElementById('splitAllocationSummary').textContent.trim();
            return {
                allUnchecked: checks.every(c => c === false),
                btnText: btn ? btn.textContent.trim() : null,
                summary: summary
            };
        }''')
        print(f"  9. All members unchecked again: {re_unselected_info['allUnchecked']}")
        print(f"  10. Button text: '{re_unselected_info['btnText']}'")
        print(f"  11. Allocation summary: {re_unselected_info['summary']}")
        assert re_unselected_info['allUnchecked'], "All members should now be unchecked"
        assert re_unselected_info['btnText'] == "Select All", "Button should say 'Select All'"
        assert "₹0.00 /" in re_unselected_info['summary'], "Summary should reflect 0 allocated"
        
        # 4. Test manual checking of individual members
        print("\n--- Testing Individual Member Toggles ---")
        # Check first member
        await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
            rows[0].querySelector('.exp-member-check').click();
        }''')
        await page.wait_for_timeout(200)
        
        one_checked_btn = await page.evaluate('''() => {
            return document.getElementById('btnToggleAllSplitMembers').textContent.trim();
        }''')
        print(f"  12. Button text when 1 of 4 checked: '{one_checked_btn}'")
        assert one_checked_btn == "Select All", "Button should stay 'Select All' when only some are checked"
        
        # Check remaining 3 members
        await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
            rows[1].querySelector('.exp-member-check').click();
            rows[2].querySelector('.exp-member-check').click();
            rows[3].querySelector('.exp-member-check').click();
        }''')
        await page.wait_for_timeout(200)
        
        all_manually_checked_btn = await page.evaluate('''() => {
            return document.getElementById('btnToggleAllSplitMembers').textContent.trim();
        }''')
        print(f"  13. Button text when 4 of 4 manually checked: '{all_manually_checked_btn}'")
        assert all_manually_checked_btn == "Unselect All", "Button should become 'Unselect All' when all are manually checked"
        
        # Uncheck 1 member manually
        await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
            rows[0].querySelector('.exp-member-check').click();
        }''')
        await page.wait_for_timeout(200)
        
        partial_checked_btn = await page.evaluate('''() => {
            return document.getElementById('btnToggleAllSplitMembers').textContent.trim();
        }''')
        print(f"  14. Button text when 3 of 4 checked: '{partial_checked_btn}'")
        assert partial_checked_btn == "Select All", "Button should return to 'Select All' when 1 is unchecked"
        
        # Take verification screenshot
        screenshot_path = '/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4/vasool_select_unselect_all_verified.png'
        await page.screenshot(path=screenshot_path)
        print(f"\n  Screenshot saved to: {screenshot_path}")
        
        await browser.close()
        print("\n🎉 ALL SELECT/UNSELECT ALL AND DEFAULT UNCHECKED TESTS PASSED PERFECTLY!")

if __name__ == '__main__':
    asyncio.run(main())
