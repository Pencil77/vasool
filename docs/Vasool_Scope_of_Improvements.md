Vasool — Scope of Improvements & Product Enhancement Roadmap
Application Under Review: Vasool Expense Splitter
Evaluation Context: Live functional walkthrough across the 5 pre-configured group personas (Aarav Sharma, Vikram Patel, Rohan Gupta, Neha & Partner, and Priya Das) on the ₹28,000.00 trip ledger.
1. Executive Summary
Vasool delivers a clean, responsive dark-mode interface with strong core group-accounting primitives: 4 split modes (Equal, Exact, Percentage, Ratio/Shares with couple multiplier defaultWeight: 2), positive-inflow tracking (Income & Refunds for security deposits), algorithmic debt simplification (3 simplified transfers across ₹28,000.00 in bills), a "Who Should Pay Next?" recommendation banner, and a two-step settlement verification handshake (pending_admin_approval → Admin Confirm Received).

To transition Vasool from a strong interactive prototype into a production-hardened group finance platform, improvements should focus on five areas:

Frictionless Persona Switching & Session Safety (1-click demo switcher on login, logout confirmation modal, and session persistence across reloads)
Verifiable UPI Settlement Handshake (UPI deep links/QR generation, UTR reference capture, and partial/disputed settlement handling)
Granular Accounting & Multi-Currency Precision (per-bill currency conversion with live FX rates, itemized receipt OCR, and an immutable edit audit log)
Data Portability & Offline Resilience (CSV/PDF ledger statements and PWA offline queue for low-connectivity travel)
Automated E2E Quality Assurance (data-testid instrumentation and multi-persona Playwright regression suites)
2. Prioritized Scope of Improvements
Priority
Module
Current Behavior in Vasool
Recommended Improvement
Expected Impact
P0 (High)
Auth & Demo UX
App boots directly into Rohan Gupta's session; switching between the 5 test accounts requires signing out and manually typing each email and password.
Add 1-Click Demo Persona Pills (Aarav, Vikram, Rohan, Neha & Partner, Priya) on the Login card and inside a top-bar Switch Test User menu when running in demo/staging mode.
Eliminates manual credential entry when testing multi-actor flows like Priya → Aarav settlement approval.
P0 (High)
Logout Confirmation
Clicking Sign Out immediately terminates the session and returns to the landing page (Sign In).
Add a Logout Confirmation Modal ("Are you sure you want to sign out as [User]?") with a warning if unsaved draft splits exist.
Prevents accidental sign-outs on mobile viewports and fulfills the planned Logout Confirmation screen specification.
P0 (High)
Smart Settle-Up & UPI Proof
Priya Das's ₹2,500 UPI settlement sits in pending_admin_approval for Aarav Sharma to click Confirm Received, without transaction metadata.
Attach optional 12-digit UPI UTR / Reference ID and screenshot upload when marking a payment sent, plus auto-generated upi://pay?pa=...&am=... QR codes and deep links.
Gives group admins verifiable proof before confirming receipts and eliminates manual VPA copy-pasting on mobile.
P1 (Medium)
Admin Dispute & Partial Settle
Admin Confirmation Inbox supports binary confirmation/rejection of pending settlements.
Allow the admin or creditor to Record Partial Amount Received (e.g., ₹2,000 of ₹2,500) or Request UTR Clarification with an inline reason note.
Handles real-world bank transfer limits and partial repayments without forcing full rejection and re-entry.
P1 (Medium)
Multi-Currency Ledger Math
Top bar provides a 4-currency display switcher (₹ INR, $ USD, € EUR, £ GBP) at the dashboard level.
Support Per-Bill Currency Entry with automatic historical/live FX rate lookup (plus manual rate override) converted into the group's base currency.
Enables international travel groups to log airport cabs in USD/EUR alongside local INR bookings accurately.
P1 (Medium)
Export & Statements
Group analytics show donut (Spending by Category) and bar (Net Member Balances) charts, plus 4 bills on screen.
Add Export Group Statement (CSV & PDF) containing itemized bills, member weights (2x for Neha & Partner), refunds (Priya's ₹3,000 deposit refund), and confirmed vs. pending settlements.
Provides a shareable offline record for trip archival and external reimbursement claims.
P2 (Polish)
Audit Trail & Privacy Guardrails
Aarav Sharma can toggle Debt Minimization and Split Privacy, and members can add/edit bills.
Add an Activity & Audit Feed logging who created, modified, or deleted a bill, or toggled group settings, with a 1-click Undo window.
Prevents silent ledger discrepancies when multiple members log expenses concurrently.
P2 (Polish)
Receipt OCR & Attachments
Bills are entered manually via the + Add Expense modal.
Add Receipt Image Upload & Auto-Itemization so dining bills can be split by assigning scanned line items plus proportional tax/tip.
Speeds up complex restaurant splits beyond fixed ratio weights.
P2 (Polish)
PWA & Offline Sync
Requires active network connectivity to load and mutate state on Vasool.
Configure a Web App Manifest + Service Worker with IndexedDB optimistic offline queueing for new expenses.
Lets travelers log expenses in low-signal areas (mountains, flights, villas) and syncs automatically when back online.
3. Detailed Technical Recommendations by Area
3.1 Authentication, Role Visibility & Session UX
Quick Persona Switcher for Evaluators: Because Vasool's core value proposition relies on multi-role interactions—such as Priya Das (priya.settler@vasool.test) initiating a ₹2,500 UPI settlement and Aarav Sharma (admin.aarav@vasool.test) approving it—adding a collapsible "Demo Role Switcher" bar at the bottom of the screen allows instant state inspection across all 5 roles without clearing session storage.
Role & Weight Badges in Member Lists: Display explicit badges next to member names across all bill modals and settlement cards (👑 Admin for Aarav, 2x Couple Weight for Neha & Partner, Pending Approval pill for Priya) so every participant immediately understands why a dining split or settlement total was calculated that way.
Logout Confirmation Dialog: Intercept the header Sign Out button with an accessible modal (role="dialog", aria-modal="true", Escape-key dismissal) that summarizes the current user's net balance before confirming sign-out.
3.2 Smart Settle-Up & Creditor Approval Workflow
Dual Confirmation Option (Creditor OR Admin): Currently, Priya's ₹2,500 payment awaits admin approval in Aarav's inbox while Vikram Patel (+₹19,600.00) is the primary creditor owed across the villa and airport van bills. Allow either the receiving creditor (Vikram) or the group organizer (Aarav) to confirm receipt, with real-time status badges (Awaiting Confirmation → Confirmed by Aarav at 14:32).
WhatsApp Reminder Templates with Deep Links: Enhance Rohan Gupta's 1-tap WhatsApp reminder flow so the pre-filled message includes:
Exact net amount owed (₹5,400.00)
Breakdown of contributing bills
Direct link back to the group's Smart Settle-Up drawer on Vasool
Payee's configured UPI ID
3.3 Expense Engine, Refunds & Analytics
First-Class Refund & Income Allocation: Priya Das's ₹3,000 security deposit refund is tracked under Income & Refunds. Ensure the + Add Expense flow offers a dedicated Record Refund / Group Income tab that can link a refund directly to its original parent expense (e.g., linking the ₹3,000 deposit refund to Vikram's villa booking) so net category spend reflects true net cost (Gross Spend - Refunds).
Interactive Chart Drill-Downs: Allow clicking any slice of the Spending by Category donut chart (Food & Dining, Travel & Fuel, Rent & Stay, Income & Refunds) or a member bar in Net Member Balances to filter the bill list below to only matching transactions.
Rounding Remainder Transparency: When splitting odd bill amounts across weighted shares (such as 1 + 1 + 1 + 2 + 1 = 6 parts when Neha & Partner has defaultWeight: 2), explicitly show which member absorbed the ±₹0.01 rounding remainder in the bill breakdown drawer.
3.4 Accessibility, Testing & Engineering Hardening
Deterministic Test Selectors (data-testid): Add stable attributes (data-testid="nav-settle-up", data-testid="admin-inbox-confirm-btn", data-testid="logout-confirm-modal", data-testid="who-pays-next-banner") to streamline automated Playwright end-to-end verification.
Keyboard & Screen-Reader Accessibility: Ensure all custom drawers (Smart Settle-Up, Add Expense, View Bills), currency selector dropdowns, and chart tooltips have full keyboard focus trapping, aria-live="polite" balance announcements, and WCAG AA contrast ratios across both dark and light themes.