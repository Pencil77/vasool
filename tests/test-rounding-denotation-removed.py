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
        
        print("\n--- Testing Rounding Absorbed Denotation Removal ---")
        
        # Setup an expense with an odd split having roundingRemainder and roundingAdjustment
        await page.evaluate('''() => {
            showingAuthPortal = false;
            appState.currentUser = { email: 'alice@example.com', name: 'Alice' };
            appState.groups = [{
                id: 'grp_odd_split',
                name: 'Flatmates',
                category: 'Home',
                members: [
                    { email: 'admin@example.com', name: 'Admin Aarav', role: 'admin' },
                    { email: 'bob@example.com', name: 'Bob', role: 'member' },
                    { email: 'charlie@example.com', name: 'Charlie', role: 'member' }
                ]
            }];
            appState.expenses = [{
                id: 'exp_odd_100',
                groupId: 'grp_odd_split',
                description: 'Groceries & Milk',
                amount: 100,
                type: 'expense',
                category: '🍔 Food & Dining',
                splitType: 'equal',
                paidByEmail: 'admin@example.com',
                paidByName: 'Admin Aarav',
                roundingRemainder: 0.01,
                remainderAbsorbedBy: 'Admin Aarav',
                splits: [
                    { memberEmail: 'admin@example.com', memberName: 'Admin Aarav', amount: 33.34, roundingAdjustment: 0.01 },
                    { memberEmail: 'bob@example.com', memberName: 'Bob', amount: 33.33, roundingAdjustment: 0 },
                    { memberEmail: 'charlie@example.com', memberName: 'Charlie', amount: 33.33, roundingAdjustment: 0 }
                ]
            }];
            renderTopLevelView();
            refreshAllViews();
            switchMainTab('expenses');
        }''')
        await page.wait_for_timeout(500)
        
        # Verify expense card is visible
        card_content = await page.evaluate('''() => {
            const card = document.querySelector('[data-testid="expense-card-exp_odd_100"]');
            return card ? card.innerText : '';
        }''')
        print(f"  Expense Card Text:\n{card_content}\n")
        
        has_absorbed_denotation = "rounding absorbed by" in card_content.lower()
        has_absorbed_word = "absorbed" in card_content.lower()
        has_adj_denotation = "adj)" in card_content.lower()
        
        print(f"  Contains 'rounding absorbed by': {has_absorbed_denotation}")
        print(f"  Contains 'absorbed': {has_absorbed_word}")
        print(f"  Contains 'adj)': {has_adj_denotation}")
        
        assert not has_absorbed_denotation, "Expense card should NOT contain 'rounding absorbed by' denotation!"
        assert not has_absorbed_word, "Expense card should NOT contain 'absorbed'!"
        assert not has_adj_denotation, "Expense card should NOT contain 'adj)' denotation!"
        
        # Take verification screenshot of the clean expense card
        screenshot_path = '/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4/vasool_clean_expense_card_no_absorbed_rounding.png'
        await page.screenshot(path=screenshot_path)
        print(f"\n  Screenshot saved to: {screenshot_path}")
        
        await browser.close()
        print("\n🎉 ROUNDING ABSORBED DENOTATION SUCCESSFULLY REMOVED & VERIFIED!")

if __name__ == '__main__':
    asyncio.run(main())
