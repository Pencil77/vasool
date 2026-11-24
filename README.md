# Vasool v2.8 — Full-Stack Smart Expense Splitting & Debt Simplification Platform

Full-stack expense splitting and verifiable debt settlement platform built with **Node.js, Express, MongoDB (Mongoose), Tailwind CSS, Chart.js**, **OpenTelemetry RUM / Grafana Loki**, and **Infisical Agent Vault** secret management.

- **Repository**: [https://github.com/Pencil77/vasool.git](https://github.com/Pencil77/vasool.git)
- **Live Deployment**: [https://vasool.duckdns.org](https://vasool.duckdns.org)

## What's New in Vasool v2.8
1. **In-Place Expense Editing (`PUT /api/expenses/:id`) & 1-Click Undo Delete**:
   - Edit any existing bill or refund directly from the **Expenses & Splits** view or **Group Details** modal.
   - Authorized deletion (`DELETE /api/expenses/:id`) returns a snapshot of the removed expense and surfaces a **1-Click Undo Delete** banner so accidental deletions can be restored immediately.
2. **Single-Currency INR Bills**:
   - All bills are recorded in `INR (₹)` only. Legacy multi-currency fields (`originalAmount`, `originalCurrency`, `exchangeRate`) remain in the schema for backward compatibility but the FX selector UI has been removed.
3. **Linked Refund Accounting (`parentExpenseId`)**:
   - Link positive inflows (*Income & Refunds*, such as security deposit refunds) directly to their original parent expense so group statements show exact refund lineage.
4. **Explicit Rounding Remainder (`±₹0.01`) Attribution**:
   - When odd bill totals or weighted shares (`defaultWeight: 2` for couples) produce a `±₹0.01` rounding remainder, Vasool explicitly tags and displays which participant absorbed the adjustment.
5. **Partial Settlement Confirmation & Offline-Resilient UPI QR**:
   - Creditors and Group Admins can confirm **Partial Amounts Received** (`POST /api/settlements/:id/confirm` with `receivedAmount` and `adminNote`), automatically leaving the remaining balance open.
   - Automatically resolves each payee's configured `upiId` and includes an offline SVG QR matrix fallback alongside `upi://pay` deep links and 12-digit UTR capture.
6. **Group Activity & Audit Trail (`GET /api/groups/:id/activity`)**:
   - Dedicated **📜 Activity** tab inside the **Group Details** modal logging bill creations, edits, deletions, settlement handshakes, and group setting changes.
7. **Printable PDF Group Summary Statement (`🖨️ Export PDF`)**:
   - Generates a formatted, print-ready Group Statement & Audit Ledger modal (`window.print()` / Save as PDF + downloadable `.html` statement) alongside CSV and plain-text exports.
8. **Interactive Chart Drill-Downs & 1-Click Demo Persona Switcher**:
   - Click any category slice in *Spending by Category* or member bar in *Net Member Balances* to filter matching bills in one tap.
   - 1-Click Demo Persona Switcher pills on the Sign-In view and top header for instant multi-role testing (`Aarav`, `Vikram`, `Rohan`, `Neha & Partner`, `Priya`).

## Documentation & Architecture
- [Platform Documentation](docs/docs.md): Comprehensive system architecture, module breakdowns, domain workflows, and API specifications.
- [Product & Engineering Requirements](docs/requirements.md): Functional and non-functional requirements for the Aurora Modular Edition (v3.1).
- [Technical Specifications](docs/Specs.md): Database schemas, runtime configurations, and security model.
- [Scope of Improvements](docs/Vasool_Scope_of_Improvements.md): Production hardening roadmap and feature enhancements.
- [Implementation Specifications](docs/implementation/): Admin user-details/credential reveal modal and UI/UX, frontend architecture, and quality improvement roadmap.

