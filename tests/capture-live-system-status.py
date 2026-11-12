import asyncio
import os
from playwright.async_api import async_playwright

CHROME_BIN = "/home/mrzoromit3/.agent-reach/cloak-binaries/chromium-146.0.7680.177.5/chrome"
BRAIN_DIR = "/home/mrzoromit3/.gemini/antigravity-cli/brain/50ffe334-de09-43df-a82a-537577ea13e4"
PROD_URL = "https://vasool.duckdns.org"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=CHROME_BIN,
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        )
        
        # 1. Desktop View with Abstracted Modal Open
        ctx_desktop = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page_desktop = await ctx_desktop.new_page()
        await page_desktop.goto(PROD_URL, wait_until='networkidle')
        await page_desktop.wait_for_timeout(1000)
        
        status_btn = page_desktop.locator('#btnAuthFooterSystemStatus')
        await status_btn.click()
        await page_desktop.wait_for_timeout(500)
        desktop_modal_path = os.path.join(BRAIN_DIR, "vasool_live_abstracted_status_desktop.png")
        await page_desktop.screenshot(path=desktop_modal_path)
        print("Desktop modal screenshot saved:", desktop_modal_path)
        
        # 2. Mobile View (360x780) with Abstracted Modal Open
        ctx_mobile = await browser.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True)
        page_mobile = await ctx_mobile.new_page()
        await page_mobile.goto(PROD_URL, wait_until='networkidle')
        await page_mobile.wait_for_timeout(1000)
        
        status_btn_mobile = page_mobile.locator('#btnAuthFooterSystemStatus')
        await status_btn_mobile.click()
        await page_mobile.wait_for_timeout(500)
        mobile_modal_path = os.path.join(BRAIN_DIR, "vasool_live_abstracted_status_mobile.png")
        await page_mobile.screenshot(path=mobile_modal_path)
        print("Mobile modal screenshot saved:", mobile_modal_path)
        
        await browser.close()
        print("All live screenshots captured successfully!")

if __name__ == '__main__':
    asyncio.run(main())
