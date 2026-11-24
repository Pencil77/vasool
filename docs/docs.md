# Vasool Platform Documentation — Understanding of the Platform (v3.1 Aurora Modular Edition)

## 1. Platform Overview & Purpose

**Vasool** ([GitHub Repository](https://github.com/Pencil77/vasool.git) · [Live Cloud Shell / DuckDNS Deployment](https://vasool.duckdns.org) · [Vercel Deployment](https://vasool-ecru.vercel.app) · [Wydia Shared Drive Folder](https://drive.google.com/drive/folders/1MStbRP6wQUU529gPekcLKgJlEwp3GsB1)) is a full-stack, mobile-first group expense splitting, multi-payer bill tracking, and minimum-cash-flow debt settlement web application built for trips, flatmates, couples, office teams, and shared events.

Vasool eliminates the friction of tracking who paid for what and calculating complex multi-person IOUs. It combines **Settle-Up style multi-payer bill entry**, **four mathematical split modes** (`Equal`, `Exact`, `Percentage`, and `Ratio / Shares`), **multi-currency FX conversion**, **three configurable debt resolution algorithms** (`Greedy Minimum-Cash-Flow`, `Centralized Admin-Hub`, and `Direct Pair-Wise`), and a **strictly verified two-way UPI settlement handshake**.

## 2. Core Architectural Pillars

| Layer | Technology & Module Breakdown | Primary Responsibility |
|---|---|---|
| **Runtime & API Server** | Node.js + Express ([`server.js`](https://drive.google.com/file/d/1hntJhkvgvpqY2C9PqapAUcQRbvXAXexh/view?usp=drivesdk)) | HTTP request routing, CORS, static asset delivery, health probing (`/api/health`), and OpenTelemetry RUM ingestion (`/api/telemetry/rum`). |
| **Database & Persistence** | MongoDB Atlas + Mongoose (`lib/mongodb.js`, `models/*.js`) | Connection-pooled document storage across six collections: `User`, `Group`, `Expense`, `Settlement`, `Feedback`, and `SystemConfig`. |
| **Debt & Balance Engine** | Pure Algorithmic Module ([`lib/debt-engine.js`](https://drive.google.com/file/d/1ev_uiwCLf2HvNVvftwP4-5tI0RivLkZB/view?usp=drivesdk)) | Multi-payer net balance aggregation (`computeGroupBalanceMap`), Greedy Min-Cash-Flow (`simplifyDebtsGreedy`), Admin-Hub routing (`simplifyDebtsAdminHub`), and Direct Pair-Wise debts (`calculateDirectDebts`). |
| **Modular REST Routes** | `routes/auth.js`, `routes/groups.js`, `routes/expenses.js`, `routes/settlements.js`, `routes/admin.js`, `routes/splits.js` | Authenticated domain APIs for identity/OTP, group lifecycle, multi-payer expenses, two-way settlements, and Super Admin platform governance. |
| **Secret & Config Management** | Infisical Cloud CLI + Environment Variables | Zero-plaintext secret injection for `MONGO_URI`, `JWT_SECRET`, `SMTP_*` mail relay (`wydia@duck.com`), and `GRAFANA_CLOUD_TOKEN`. |
| **Observability & Telemetry** | OpenTelemetry + Grafana Cloud Loki (`lib/otel.js`, `lib/logger.js`) | Distributed W3C `traceparent` spans, structured JSON logs, domain counters/histograms, and browser Real User Monitoring (RUM). |
| **Frontend Architecture** | Modular Vanilla JS + Tailwind CSS Aurora Glass UI ([`public/index.html`](https://drive.google.com/file/d/1APtGirP6-REg0Svh6d_VHYr6aQFpRPJT/view?usp=drivesdk), `public/css/aurora-theme.css`, `public/js/*.js`) | Responsive single-page workspace optimized for `360px–430px` mobile screens and desktop viewports with offline local-storage resilience. |

## 3. Modular Codebase Organization

To keep the platform maintainable and fast to load, both the backend and frontend are modularized by functional domain inside the [Wydia Shared Drive `vasool` folder](https://drive.google.com/drive/folders/1MStbRP6wQUU529gPekcLKgJlEwp3GsB1):

### Backend Modules
- **`server.js`** ([Drive](https://drive.google.com/file/d/1hntJhkvgvpqY2C9PqapAUcQRbvXAXexh/view?usp=drivesdk)): Express application entry point, static file middleware, RUM endpoint, and role-aware `/api/health` endpoint (abstracted for general requests, detailed diagnostics for Super Admin).
- **`lib/debt-engine.js`** ([Drive](https://drive.google.com/file/d/1ev_uiwCLf2HvNVvftwP4-5tI0RivLkZB/view?usp=drivesdk)): Pure mathematical debt simplification, multi-payer credit allocation (`getExpensePayerAllocations`), and immutable group audit trail helper (`appendGroupAuditLog`).
- **`routes/auth.js`** ([Drive](https://drive.google.com/file/d/1cZVFNuA6JBZypzgPRaYB17PDm-QGAqR8/view?usp=drivesdk)): Email/password registration, 6-digit OTP & magic-link email verification, JWT session issuance with configurable lifetimes, password reset, live user search (`/api/users/search`, `/api/users/check-email`), and live profile & UPI ID updates (`PATCH /api/auth/profile`).
- **`routes/groups.js`** ([Drive](https://drive.google.com/file/d/13zOIWmOUUgRcTmGJGSN9gmNjAWs8cgeW/view?usp=drivesdk)): Group creation, 6-character invite code joining (`SPL-XXXXXX`), comma-separated multi-member batch invitations (`POST /api/groups/:id/members`), live `upiId` hydration across group members (`hydrateGroupMembersUpi`), invitation acceptance/decline, admin succession & group exit checks, and privacy/routing settings.
- **`routes/expenses.js`** ([Drive](https://drive.google.com/file/d/1kz1zAcBp2PFtdqwQCXDhlrsGVdAem_Ab/view?usp=drivesdk)): Expense & income/refund creation, editing, deletion with 1-click undo snapshots, multi-payer allocation persistence (`paidByAllocations`), multi-currency FX conversion, and personal-only split privacy redaction.
- **`routes/settlements.js`** ([Drive](https://drive.google.com/file/d/1niq--v3-Glin4pqfuoygcSM1KYeQ5W3K/view?usp=drivesdk)): Live balance & simplified debt calculation (`GET /api/balances`), "Who Should Pay Next?" debtor recommendation, two-way settlement recording (`POST /api/settlements`), full or partial receipt confirmation (`POST /api/settlements/:id/confirm`), rejection (`POST /api/settlements/:id/reject`), and user feedback submission (`POST /api/feedback`).
- **`routes/admin.js`** ([Drive](https://drive.google.com/file/d/1orJp7-CMLSrF1c_rcTSZJcFklzudgHP9/view?usp=drivesdk)): Super Admin (`mdzubair7592@gmail.com`) governance APIs for viewing/editing user accounts and passwords, timed or indefinite account suspensions, global session lifetime configuration, platform-wide group inspection and deletion (`GET /api/admin/groups`, `DELETE /api/admin/groups/:groupId`), and user feedback triage.

### Frontend Modules
- **`public/index.html`** ([Drive](https://drive.google.com/file/d/1APtGirP6-REg0Svh6d_VHYr6aQFpRPJT/view?usp=drivesdk)): Semantic HTML5 structure containing the Auth Portal, the Home-only Overview Hero & 4 Bento KPI Tiles (`#homeDashboardTopSection`), the 6 main workspace panels (`Home`, `Bills`, `Groups`, `Settle`, `QA`, `Super Admin`), and mobile bottom-sheet modals.
- **`public/js/core-and-telemetry.js`** ([Drive](https://drive.google.com/file/d/1_F26x3Q-dL0d5d4-Y1A5-x7m0f5d8z0X/view?usp=drivesdk)): Client state initialization, W3C OpenTelemetry trace context propagation (`apiFetch`), backend state synchronization (`syncWithBackend`), multi-currency display formatting (`formatINR`), and pure split calculation (`calculatePureSplitAllocations`).
- **`public/js/auth-and-admin.js`** ([Drive](https://drive.google.com/file/d/1cCuCQtO_OfNj61LMqmmTvZ6Akm-xpTAl/view?usp=drivesdk)): Authentication flows, OTP countdown timers, Account Settings & UPI Profile editor (`handleUpdateProfileUpiSubmit`), the 4-step interactive New User Onboarding Wizard (`openOnboardingWizard`, `skipOnboardingWizard`), and the Super Admin Console (User Accounts, All Platform Groups, and Mobile-Aligned User Feedback tiles).
- **`public/js/dashboard-and-expenses.js`** ([Drive](https://drive.google.com/file/d/1c9fMCX75jH9tJ7Co5jYq0KTOaQU5uN4K/view?usp=drivesdk)): Client-side multi-payer balance and debt simplification engine (`computeBalancesAndSimplifications`), tab routing (`switchMainTab`) that restricts the top Welcome Hero and 4 KPI cards exclusively to the `Home` tab, interactive Chart.js doughnut/bar visualizations, expense list filtering, and CSV/TXT/PDF statement exports.
- **`public/js/groups-and-modals.js`** ([Drive](https://drive.google.com/file/d/1128U8Jt3ZbuwhnBFxZR4dOBFDZriq-g9/view?usp=drivesdk)): Group Details modal (`openGroupDetailsModal`), Settle-Up style multi-payer bill selector (`#expPaidByMultiContainer`), 4-mode split calculator, comma-separated multi-member invite parser and live autocomplete (`queryUserSuggestions`), and strict UPI verification (`resolveRecipientUpiId`, `openSettleConfirm`).
- **`public/js/qa-and-init.js`** ([Drive](https://drive.google.com/file/d/1hC62CyhdQrc5uDOyAXqqfAizTcH90S65/view?usp=drivesdk)): Built-in 30-test automated QA runner (Unit, Integration, and DOM UI E2E tests), Super-Admin-gated modal security checks (`openModal`), and application bootstrap lifecycle.

## 4. Key Domain Workflows

### A. Group Creation, Comma-Separated Invites & Live Autocomplete
1. Any authenticated user can create a group (becomes the single **Group Admin** `👑` with `status: 'active'`).
2. Both during **Group Creation** (`#newGroupModal`) and when clicking **`+ Add Member`** later (`#addMemberModal` or inside `#groupDetailsModal`), the user can enter **one or multiple comma-separated members** (`alice@gmail.com, Bob <bob@gmail.com>`).
3. As the user types each name or email after a comma, Vasool queries known members and `/api/users/search` to display an instant autocomplete dropdown.
4. Invited members are added with `status: 'pending_acceptance'` (`⏳ Pending`) and receive an email invitation with a 1-click join link and 6-character invite code (`SPL-XXXXXX`) until they accept or join via code.

### B. Settle-Up Style Multi-Payer Expense Entry & 4 Split Modes
1. When raising a bill in `#addExpenseModal`, the **Paid By (Who Paid?)** checklist (`#expPaidByMultiContainer`) selects the logged-in user by default for the full bill amount.
2. Just like the Settle Up app, the user can **uncheck themselves**, select any other single member, or **multi-select 2 or more members** who contributed to the event and enter the exact amount each selected person spent (`paidByAllocations: [{ memberEmail, memberName, amount }]`).
3. The total bill can be entered in **7 currencies** (`INR`, `USD`, `EUR`, `GBP`, `AED`, `SGD`, `THB`) with live FX conversion to base `INR`, or marked as an **Income / Refund** linked to an earlier bill.
4. The bill is divided among selected participants using one of **4 Split Modes**:
   - **Equal (`=`)**: Divides equally with automatic `±₹0.01` rounding remainder absorption on the first participant.
   - **Exact (`₹`)**: Custom exact rupee amounts per participant validated against the total bill.
   - **Percentage (`%`)**: Custom percentage breakdown summing to `100%`.
   - **Ratio / Parts (`×`)**: Proportional share weights (e.g., `2x` for a couple, `1x` for a single member, `0.5x` for a child).

### C. Strict UPI Profile Verification & Two-Way Settlement Handshake
1. Users can add, edit, or clear their **UPI ID (VPA)** at any time during signup or inside **Account Settings → Profile & UPI Payment Handle** (`PATCH /api/auth/profile`), which immediately syncs across their `User` record and all their `Group.members` entries.
2. **Zero Fabricated UPI Rule**: Vasool never guesses or fabricates a dummy UPI address if a user leaves their UPI ID blank. When someone opens **Record Settlement Payment** (`#settleConfirmModal`) to pay a member:
   - If the recipient **has** configured a verified UPI ID, Vasool displays the QR code and the **`⚡ Pay via UPI App`** deep link (`upi://pay?pa=...`).
   - If the recipient **has not** configured a UPI ID, Vasool **completely hides** the UPI redirect card (`#settleUpiSection`) and displays `#settleNoUpiNotice` instructing the payer to settle externally (Cash/Bank) and log the payment.
3. **Dual Confirmation Handshake**: When a debtor logs a payment (optionally attaching a 12-digit UPI UTR), its status is `pending_admin_approval` (`⏳ Awaiting Confirmation`). Only when the **receiving creditor** or the **Group Admin** confirms full (or partial) receipt does the settlement transition to `confirmed` (`✅`) and reduce the net debt balance.

### D. Super Admin Governance & Decluttered Mobile Navigation
1. **Home-Only Overview & KPI Tiles**: To prevent visual redundancy on mobile screens, the top "Welcome back" quick-action card, the "Who Should Pay Next?" banner, and the 4 KPI cards (*Your Net Balance*, *You Are Owed*, *You Owe*, *Group Spend*) are wrapped in `#homeDashboardTopSection` and rendered **only on the Home (`dashboard`) tab**—staying hidden when switching to `Bills`, `Groups`, `Settle`, `QA`, or `Admin`.
2. **Super Admin Exclusivity (`mdzubair7592@gmail.com`)**:
   - The bottom `System Status` link (`#btnFooterSystemStatus`) and diagnostic modals are strictly hidden from all non-super-admin users.
   - The dedicated **Super Admin Console** (`#panelAdmin`) provides three management sub-tabs: **👥 User Accounts** (view/edit passwords, suspend or delete users, configure global session token lifetime from 1 hour to 365 days), **🏘️ All Platform Groups** (inspect all groups on the platform, their members, bill counts, and total spend, and permanently delete any group), and **💬 User Feedback & Suggestions** (mobile-aligned feedback cards with status triage and developer notes).

## 8. Implementation Specifications

- [Admin User Details & Credential Reveal Modal](implementation/admin-user-details-modal.md): Required per-user details modal, explicit password reveal behavior, API contract, and acceptance criteria.
- [UI/UX, Frontend Architecture & Quality Improvements](implementation/ui-ux-frontend-quality.md): Detailed implementation roadmap for the interface, core user journeys, incremental frontend restructuring, accessibility, performance, and automated regression coverage.
