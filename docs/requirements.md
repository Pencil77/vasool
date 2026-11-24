# Vasool Product & Engineering Requirements (`requirements.md`)

## 1. Document Scope

This document defines the functional, user-experience, security, and operational requirements for **Vasool v3.1 (Aurora Modular Edition)** ([GitHub Repository](https://github.com/Pencil77/vasool.git) · [Live App](https://vasool.duckdns.org) · [Wydia Shared Drive Folder](https://drive.google.com/drive/folders/1MStbRP6wQUU529gPekcLKgJlEwp3GsB1)).

## 2. Functional Requirements

### FR-01: Authentication, OTP Verification & Session Persistence
- **FR-01.1 (Email/Password & OTP Signup)**: Users must be able to register with their Full Name, Email Address, Password (minimum 8 characters with live strength meter), and an optional UPI ID (`upiId`). Registration dispatches a 6-digit OTP and a 1-click verification magic link via the privacy-masked SMTP relay (`wydia@duck.com`).
- **FR-01.2 (Configurable Session Lifetime)**: Authenticated JWT sessions must respect the global token lifetime configured by the Super Admin (default `7 days`, configurable from `1 hour` to `365 days`), preventing premature logouts on mobile networks.
- **FR-01.3 (Password Recovery & Rotation)**: Users must be able to reset forgotten passwords via a 6-digit email OTP or magic reset link and change their password inside Account Settings.
- **FR-01.4 (Production Logout Flow)**: Clicking Sign Out must open a clean Logout Confirmation Modal showing the user's current net balance without displaying any sample demo/test persona switchers.

### FR-02: Interactive New User Onboarding Wizard
- **FR-02.1 (Auto-Launch & Manual Trigger)**: First-time users completing registration must be greeted by a 4-step interactive Onboarding Tour (`#onboardingWizardModal`). Returning users must be able to launch the tour anytime via the **🧭 Guide** button in the top header, Home hero card, or footer.
- **FR-02.2 (Prominent Skip Option)**: The wizard must provide a one-tap **Skip Tour ✕** button (`data-testid="btn-skip-onboarding"`) and a footer **Skip** button that immediately dismisses the wizard and records completion in `localStorage`.

### FR-03: Group Management, Comma-Separated Multi-Invites & Live Autocomplete
- **FR-03.1 (Single Admin Ownership)**: Each group must have strictly one Group Admin (`👑`) at any time. The creator is assigned `role: 'admin'` and `status: 'active'` by default, and can transfer adminship to another active member or designate a successor before exiting.
- **FR-03.2 (Comma-Separated Multi-Member Invites)**: Both during **Create Group** (`#newGroupModal`) and when adding members later via **`+ Add Member`** (`#addMemberModal`), the user must be able to invite multiple people in a single submission using comma-separated format (`alice@gmail.com, Bob <bob@gmail.com>`).
- **FR-03.3 (Live Autocomplete in Both Modals)**: Typing a name or email token (including after a comma) in `#newGroupMembersInput` or `#addMemberEmail` must display a live autocomplete dropdown suggesting matching registered Vasool users and inserting `Name <email>, ` upon selection.
- **FR-03.4 (Working `+ Add Member` in Group Details Modal)**: Clicking `+ Add Member` inside the detailed view of a group (`#groupDetailsModal`) must layer `#addMemberModal` cleanly above `#groupDetailsModal` (`z-[65]` over `z-50`) and immediately refresh the Group Details member list upon submission.
- **FR-03.5 (Financial Guardrails on Group Exit & Member Removal)**: Members with unsettled negative balances (debt) cannot exit a group until settled. Members owed money must explicitly confirm balance forfeiture to exit. Group Admins can remove members (with a force-remove option if unsettled balances exist).

### FR-04: Settle-Up Style Multi-Payer Expenses & 4-Way Split Engine
- **FR-04.1 (Single & Multi-Payer Selection)**: When logging or editing a bill in `#addExpenseModal`, the **Paid By (Who Paid?)** checklist (`#expPaidByMultiContainer`) must select the logged-in user by default, allow them to unselect themselves, and allow selecting **one or multiple group members** who paid for the event.
- **FR-04.2 (Per-Payer Spend Allocation)**: When 2 or more payers are checked, the UI must provide editable amount inputs (`.exp-payer-amount`) beside each selected payer (`paidByAllocations: [{ memberEmail, memberName, amount }]`) and validate that individual payer contributions sum to the total bill amount.
- **FR-04.3 (Four Mathematical Split Modes)**: Every bill must support:
  1. **Equal (`=`)**: Equal division across checked participants with deterministic rounding remainder absorption (`roundingRemainder`, `remainderAbsorbedBy`).
  2. **Exact (`₹`)**: Exact currency amounts per participant validated against the bill total.
  3. **Percentage (`%`)**: Percentage allocations summing to `100%`.
  4. **Ratio / Parts (`×`)**: Relative share weights (respecting each member's `defaultWeight`, e.g., `2x` for couples).
- **FR-04.4 (Multi-Currency FX & Linked Refunds)**: Bills must support 7 currencies (`INR`, `USD`, `EUR`, `GBP`, `AED`, `SGD`, `THB`) with live exchange-rate conversion to base `INR`, as well as **Income / Refund** entries optionally linked to a parent bill (`parentExpenseId`).
- **FR-04.5 (1-Click Undo Delete & Immutable Audit Trail)**: Deleting a bill must display a 1-click **Undo Delete** banner to restore the snapshot, and all bill creations, edits, deletions, and settlements must be recorded in the group's chronological **Activity (`📜`)** audit log.

### FR-05: Strict UPI Profile Verification & Two-Way Settlement Handshake
- **FR-05.1 (Editable Profile UPI ID)**: Users must be able to add, edit, update, or clear their UPI ID (and display name) at any time from **Account Settings → Profile & UPI Payment Handle** (`PATCH /api/auth/profile`), automatically syncing the updated `upiId` across their `User` record and all `Group.members` entries.
- **FR-05.2 (Strict No-Fake-UPI Rule)**: The platform must **never** fabricate or guess a fallback UPI ID (such as `${handle}@okhdfcbank` or `vasool.settle@upi`) when a user has not entered a UPI ID.
- **FR-05.3 (Conditional UPI Redirect Visibility)**: When paying a member in `#settleConfirmModal`, if the recipient has not configured a verified UPI ID, the UPI QR code and **`⚡ Pay via UPI App`** redirect section (`#settleUpiSection`) must be **completely hidden**, and a clear notice (`#settleNoUpiNotice`) must be shown so the payer settles externally and records the transaction.
- **FR-05.4 (Three Debt Resolution Modes)**: Groups must support toggling between:
  1. **Greedy Minimum-Cash-Flow (Default)**: Simplifies multi-way IOUs into the minimum number of direct peer-to-peer transfers.
  2. **Centralized Admin-Hub Routing**: All net debtors pay the Group Admin, and the Group Admin pays all net creditors.
  3. **Direct Pair-Wise Debts**: Unsimplified bilateral debts directly between each participant and the specific payer(s) of each bill.
- **FR-05.5 (Dual Confirmation Handshake & Partial Approvals)**: Debtor-submitted settlements remain in `pending_admin_approval` status (and do not reduce net debt balances) until the **receiving creditor** or **Group Admin** confirms full receipt, confirms a **Partial Amount** (`receivedAmount < claimedAmount`), or rejects the claim.

### FR-06: Super Admin Governance Console (`mdzubair7592@gmail.com`)
- **FR-06.1 (Strict Super Admin Access Control)**: Only `mdzubair7592@gmail.com` may view or access the Super Admin Console (`#panelAdmin`), the bottom `System Status` button (`#btnFooterSystemStatus`), and internal diagnostic modals (`#systemStatusModal`, `#cloudModal`).
- **FR-06.2 (User Account Management)**: Super Admin must be able to inspect all registered users, manage account details, apply timed (`1h` to `30d`) or indefinite account suspensions, and permanently delete user accounts.
- **FR-06.5 (Admin Credential Reveal Modal — Hard Requirement)**: The Admin Console must show the registered-user list without displaying passwords directly. Each user entry must provide an explicit **View Credentials / Reveal Details** action. Selecting it must open a compact modal or pop-up for that selected user, displaying that user's username and password. Closing the modal must dismiss the sensitive details from view; credentials must never remain expanded in the main user list. This is a permanent product requirement unless the product owner explicitly changes it. Do not treat it as temporary, automatically schedule its removal, or gate it behind a production-disabled feature flag. Credential retrieval must be restricted to the Super Admin and the explicit per-user reveal action.
- **FR-06.3 (Platform-Wide Group Inspection & Deletion)**: Super Admin must be able to view **all groups across the platform** (`#adminGroupsSubSection` via `GET /api/admin/groups`), inspect every group's members, roles, invite code, bill count, and total spend, and permanently delete any group (`DELETE /api/admin/groups/:groupId`).
- **FR-06.4 (Mobile-Aligned User Feedback Triage)**: Super Admin must be able to filter, update status (`New`, `Reviewed`, `In Progress`, `Resolved`), save developer notes, and delete feedback entries inside `#adminFeedbackSubSection` with a mobile-first card layout that never overflows horizontally on small screens.

## 3. User Experience & Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| **NFR-01** | **Decluttered Tab Hierarchy** | The top "Welcome back" quick-action hero banner, "Who Should Pay Next?" banner, and the 4 Bento KPI tiles (`#homeDashboardTopSection`) must be displayed **only on the Home (`dashboard`) tab** and hidden on `Bills`, `Groups`, `Settle`, `QA`, and `Admin` tabs. |
| **NFR-02** | **Mobile-First Responsive Layout** | All cards, modals, admin feedback tiles, and bottom navigation bars must fit cleanly within `360px–430px` mobile viewports with zero horizontal button overflow. |
| **NFR-03** | **Split Privacy Enforcement** | When a group's Split Visibility is set to `Personal Only` (`personal_only`), non-admin members must only see their own split share and net balance, while other members' shares are redacted on both backend and frontend. |
| **NFR-04** | **Automated Verification Suite** | The platform must maintain a 30-case in-browser and CLI test suite covering Unit, Integration, and UI E2E assertions with `100%` pass verification. |
