# Vasool Technical & Engineering Specifications (`Specs.md`)

## 1. System Architecture & Runtime Specifications

- **Application Version**: `v3.1.0` (Aurora Modular Edition)
- **Source Repository**: [`https://github.com/Pencil77/vasool.git`](https://github.com/Pencil77/vasool.git)
- **Shared Drive Workspace**: [Wydia Shared Drive `vasool/`](https://drive.google.com/drive/folders/1MStbRP6wQUU529gPekcLKgJlEwp3GsB1)
- **Live Endpoints**: [`https://vasool.duckdns.org`](https://vasool.duckdns.org) (Cloud Shell / DuckDNS) and [`https://vasool-ecru.vercel.app`](https://vasool-ecru.vercel.app) (Vercel Serverless)
- **Backend Stack**: Node.js (`>= 18.x`), Express `4.19.x`, Mongoose `8.5.x`, Nodemailer `8.0.x`
- **Frontend Stack**: Vanilla ES2022 Modules (`core-and-telemetry.js`, `auth-and-admin.js`, `dashboard-and-expenses.js`, `groups-and-modals.js`, `qa-and-init.js`), Tailwind CSS `3.x`, Chart.js `4.4.x`

## 2. Database Schema Specifications (MongoDB / Mongoose)

### 2.1 `User` Collection (`models/User.js`)

| Field | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `name` | `String` | `required: true, trim: true` | Display name used across profile, splits, and settlements. |
| `email` | `String` | `required: true, unique: true, lowercase: true, index: true` | Primary account identifier. |
| `passwordHash` | `String` | `default: null` | PBKDF2-SHA512 salted hash (`salt:hash`). |
| `passwordPlain` | `String` | `default: null` | Encrypted/stored mirror visible only to Super Admin in `/api/admin/users`. |
| `role` | `String` | `enum: ['super_admin', 'user'], default: 'user'` | System privilege role (`super_admin` reserved for `mdzubair7592@gmail.com`). |
| `isSuperAdmin` | `Boolean` | `default: false` | Boolean flag for Super Admin authorization. |
| `upiId` | `String` | `default: ''` | Verified UPI Virtual Payment Address (e.g., `name@okaxis`). Empty string `''` if unset. |
| `defaultCurrency` | `String` | `default: 'INR'` | Preferred base currency (`INR`, `USD`, `EUR`, `GBP`). |
| `isEmailVerified` | `Boolean` | `default: false` | Set to `true` after 6-digit OTP or magic-link verification. |
| `isSuspended` | `Boolean` | `default: false` | Super Admin suspension flag. |
| `suspendedUntil` | `Date` | `default: null` | Timed suspension expiry timestamp (`null` if indefinite or active). |

### 2.2 `Group` Collection (`models/Group.js`)

| Field | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `name` | `String` | `required: true, trim: true` | Group title (e.g., `"Pondicherry Roadtrip"`). |
| `category` | `String` | `enum: ['Trip', 'Home', 'Couple', 'Event', 'Project', 'Other'], default: 'Trip'` | Group classification tag. |
| `currency` | `String` | `default: 'INR'` | Group base settlement currency. |
| `inviteCode` | `String` | `required: true, unique: true, index: true` | 6-hex invite code formatted as `SPL-XXXXXX`. |
| `adminEmail` | `String` | `default: ''` | Email of the single designated Group Admin (`👑`). |
| `splitsVisibility` | `String` | `enum: ['personal_only', 'show_all'], default: 'personal_only'` | Controls whether non-admin members see only their own split share or all shares. |
| `allowMembersToAddOthers` | `Boolean` | `default: false` | Whether non-admin members can invite new members. |
| `adminHubSettlement` | `Boolean` | `default: false` | `false` = Direct Peer-to-Peer (`simplifyDebtsGreedy`), `true` = Admin-Hub (`simplifyDebtsAdminHub`). |
| `minimizeDebts` | `Boolean` | `default: true` | `true` = Minimized cash flow, `false` = Direct Pair-Wise debts (`calculateDirectDebts`). |
| `members` | `[MemberSchema]` | `default: []` | Array of `{ userId, name, email, upiId, role: 'admin'|'member', status: 'active'|'pending_acceptance', defaultWeight: 1 }`. |
| `auditLog` | `[GroupAuditEntry]` | `default: []` | Capped array (latest 100 entries) of `{ action, actorEmail, actorName, summary, details, createdAt }`. |

### 2.3 `Expense` Collection ([`models/Expense.js`](https://drive.google.com/file/d/1OrGiLWLKWTDBimlQgxiwbpT54sJ5xwMs/view?usp=drivesdk))

| Field | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `groupId` | `ObjectId` | `ref: 'Group', required: true, index: true` | Owning group reference. |
| `description` | `String` | `required: true, trim: true` | Bill or refund title. |
| `amount` | `Number` | `required: true, min: 0.01` | Total bill value converted to base `INR`. |
| `originalAmount` | `Number` | `default: null` | Original foreign-currency amount prior to FX conversion. |
| `originalCurrency` | `String` | `default: 'INR'` | Bill entry currency (`INR`, `USD`, `EUR`, `GBP`, `AED`, `SGD`, `THB`). |
| `exchangeRate` | `Number` | `default: 1` | FX conversion multiplier applied to reach base `INR`. |
| `type` | `String` | `enum: ['expense', 'income'], default: 'expense'` | Standard expense or group income/refund. |
| `parentExpenseId` | `String` | `default: null` | Optional linked parent expense ID for refunds. |
| `paidByEmail` | `String` | `required: true, lowercase: true` | Primary payer email (first payer in `paidByAllocations`). |
| `paidByName` | `String` | `required: true` | Display label (e.g., `"Alice"` or `"Alice (₹700) + Bob (₹500)"`). |
| `paidByAllocations` | `[PayerAllocation]` | `default: []` | Multi-payer breakdown: `[{ memberEmail, memberName, amount }]` summing to `amount`. |
| `splitType` | `String` | `enum: ['equal', 'exact', 'percentage', 'shares'], default: 'equal'` | Split calculation mode used. |
| `splits` | `[SplitAllocation]` | `required: true` | Participant shares: `[{ memberEmail, memberName, amount, percentage, shares, roundingAdjustment }]`. |
| `roundingRemainder` | `Number` | `default: 0` | Cent/paisa rounding remainder (`±0.01` to `±0.05`) absorbed by the first participant. |

### 2.4 `Settlement` Collection (`models/Settlement.js`)

| Field | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `groupId` | `ObjectId` | `ref: 'Group', required: true, index: true` | Group in which settlement occurred. |
| `fromEmail` / `fromName` | `String` | `required: true` | Paying debtor email and display name. |
| `toEmail` / `toName` | `String` | `required: true` | Receiving creditor email and display name. |
| `amount` | `Number` | `required: true, min: 0.01` | Confirmed (or claimed) settlement amount in `INR`. |
| `originalClaimedAmount` | `Number` | `default: null` | Preserved when creditor/admin confirms a partial payment (`receivedAmount < claimedAmount`). |
| `method` | `String` | `enum: ['UPI', 'Cash', 'Bank Transfer', 'Card', 'Amazon Pay', 'Other'], default: 'UPI'` | Payment rail used. |
| `utrNumber` | `String` | `default: ''` | Optional 12-digit UPI UTR / reference number. |
| `status` | `String` | `enum: ['pending_admin_approval', 'confirmed', 'rejected']` | Handshake state. Only `'confirmed'` reduces net balances. |
| `confirmedByEmail` | `String` | `default: null` | Email of the creditor or Group Admin who verified receipt. |
| `confirmedRole` | `String` | `enum: ['creditor', 'admin', ''], default: ''` | Role of the user who confirmed receipt. |

## 3. Mathematical & Algorithmic Specifications ([`lib/debt-engine.js`](https://drive.google.com/file/d/1ev_uiwCLf2HvNVvftwP4-5tI0RivLkZB/view?usp=drivesdk))

### 3.1 Multi-Payer Net Balance Aggregation (`computeGroupBalanceMap`)
For each member $m$ in a group, initialize $\text{paid}_m = 0$, $\text{owed}_m = 0$, and $\text{net}_m = 0$:
1. **Expense Credit & Debit**:
   - Extract payer allocations $P = \text{getExpensePayerAllocations}(e)$. If `e.paidByAllocations` is non-empty, use each $\{p_{\text{email}}, p_{\text{amount}}\} \in e.\text{paidByAllocations}$; otherwise use single payer $\{e.\text{paidByEmail}, e.\text{amount}\}$.
   - For standard expenses (`type === 'expense'`):
     - For each payer $p \in P$: $\text{paid}_p \mathrel{+}= p_{\text{amount}}$ and $\text{net}_p \mathrel{+}= p_{\text{amount}}$.
     - For each split participant $s \in e.\text{splits}$: $\text{owed}_s \mathrel{+}= s_{\text{amount}}$ and $\text{net}_s \mathrel{-}= s_{\text{amount}}$.
   - For refunds/income (`type === 'income'`), signs are inverted ($\text{net}_p \mathrel{-}= p_{\text{amount}}$, $\text{net}_s \mathrel{+}= s_{\text{amount}}$).
2. **Confirmed Settlement Adjustment**:
   - For each settlement $st$ where $st.\text{status} === \text{'confirmed'}$:
     - $\text{net}_{st.\text{from}} \mathrel{+}= st.\text{amount}$
     - $\text{net}_{st.\text{to}} \mathrel{-}= st.\text{amount}$
   - Settlements with `status === 'pending_admin_approval'` or `'rejected'` do **not** alter $\text{net}_m$; pending amounts are tracked separately as `pendingApprovalAmount` and `remainingDue = max(0, amount - pendingApprovalAmount)`.

### 3.2 Debt Simplification Modes
- **Mode A — Greedy Minimum-Cash-Flow (`simplifyDebtsGreedy`)**:
  - Partition members into Debtors ($D = \{m \mid \text{net}_m < -0.01\}$) and Creditors ($C = \{m \mid \text{net}_m > 0.01\}$), sorted descending by $|\text{net}_m|$.
  - Iteratively match the largest debtor $d_i$ with the largest creditor $c_j$ for $\delta = \min(d_i.\text{amount}, c_j.\text{amount})$, emitting transfer $d_i \to c_j$ of $\delta$ in $O(N \log N)$ time.
- **Mode B — Centralized Admin-Hub (`simplifyDebtsAdminHub`)**:
  - For every non-admin member $m \neq \text{Admin}$:
    - If $\text{net}_m < -0.01$: emit transfer $m \to \text{Admin}$ for $|\text{net}_m|$ (`type: 'pay_to_admin'`).
    - If $\text{net}_m > 0.01$: emit transfer $\text{Admin} \to m$ for $\text{net}_m$ (`type: 'admin_payout'`).
- **Mode C — Direct Pair-Wise (`calculateDirectDebts`)**:
  - For each expense $e$ with payers $P$ and total $T = \sum_{p \in P} p_{\text{amount}}$, each participant $s$ owes each payer $p \neq s$ the proportional share $s_{\text{amount}} \times \frac{p_{\text{amount}}}{T}$. Bilateral pairs $(A \to B)$ and $(B \to A)$ are netted against each other and confirmed bilateral settlements.

## 4. REST API Endpoint Specifications

| Method & Path | Auth Guard | Request Payload / Query | Response Payload |
|---|---|---|---|
| `POST /api/auth/signup` | Public | `{ name, email, password, upiId? }` | `{ requiresVerification: true, email, message }` |
| `POST /api/auth/verify-otp` | Public | `{ email, otp }` | `{ token, user, message }` |
| `POST /api/auth/login` | Public | `{ email, password }` | `{ token, user, sessionDuration, message }` |
| `PATCH /api/auth/profile` | `requireAuth` | `{ name?, upiId?, defaultCurrency? }` | `{ success: true, user, message }` (syncs `upiId` to `User` & all `Group.members`) |
| `GET /api/users/search` | `requireAuth` | `?q=<search_token>` | `{ users: [{ id, name, email, upiId }] }` |
| `GET /api/users/check-email` | `requireAuth` | `?email=<email>` | `{ exists: boolean, user: { id, name, email, upiId } \| null }` |
| `GET /api/groups` | `requireAuth` | — | `{ groups, activeGroups, pendingInvites }` (with live hydrated `members[].upiId`) |
| `POST /api/groups` | `requireAuth` | `{ name, category, currency, members, adminHubSettlement }` | `{ group }` |
| `POST /api/groups/:id/members` | `requireAuth` | `{ email: "a@x.com, Bob <b@y.com>", name?, members?, defaultWeight? }` | `{ group, addedMembers, skippedEmails, message }` |
| `POST /api/groups/:id/remove-member` | `requireAuth` (Admin) | `{ targetEmail, force? }` | `{ success: true, group, message }` |
| `GET /api/expenses` | `requireAuth` | `?groupId=<optional>` | `{ expenses }` (redacts other shares if `personal_only` & non-admin) |
| `POST /api/expenses` | `requireAuth` | `{ groupId, description, amount, paidByAllocations, splitType, splits, ... }` | `{ expense }` |
| `PUT /api/expenses/:id` | `requireAuth` | `{ description, amount, paidByAllocations, splitType, splits, ... }` | `{ expense, message }` |
| `DELETE /api/expenses/:id` | `requireAuth` | — | `{ deleted: true, deletedExpense }` |
| `GET /api/balances` | `requireAuth` | `?groupId=<optional>` | `{ balances, simplifiedTransactions, settlements, pendingSettlements, whoShouldPay, isFullyClosed }` |
| `POST /api/settlements` | `requireAuth` | `{ groupId, fromEmail, toEmail, amount, method, utrNumber?, referenceNote? }` | `{ settlement, message }` |
| `POST /api/settlements/:id/confirm` | `requireAuth` (Creditor/Admin) | `{ receivedAmount?, adminNote? }` | `{ settlement, isPartial, message }` |
| `GET /api/admin/users` | `requireSuperAdmin` | — | `{ users, total }` |
| `GET /api/admin/groups` | `requireSuperAdmin` | — | `{ groups: [{ id, name, inviteCode, adminEmail, members, billCount, totalSpend }], total }` |
| `DELETE /api/admin/groups/:groupId` | `requireSuperAdmin` | — | `{ success: true, deletedGroupId, message }` (cascade deletes group, expenses & settlements) |
| `GET /api/admin/feedback` | `requireSuperAdmin` | `?status=&type=` | `{ feedbacks, total }` |
| `PATCH /api/admin/feedback/:id` | `requireSuperAdmin` | `{ status?, adminNotes? }` | `{ success: true, feedback }` |

## 5. Strict UPI Resolution & Deep-Link Specification

1. **Resolution Contract (`resolveRecipientUpiId(toEmail, groupId)`)**:
   - Inspects the recipient's live `User.upiId` and `Group.members[].upiId`.
   - Returns a non-empty string **only** if the recipient explicitly configured a valid VPA containing `'@'`.
   - Returns `''` (empty string) whenever the recipient has not configured a UPI ID. Fabricated fallbacks (`@okhdfcbank`, `vasool.settle@upi`) are strictly prohibited.
2. **UI Rendering Contract (`openSettleConfirm` & `updateSettlementUpiData`)**:
   - When `upiId !== ''`: Displays `#settleUpiSection`, hides `#settleNoUpiNotice`, renders the deterministic QR matrix SVG, and binds `#settleUpiDeepLink` to:
     `upi://pay?pa=<encodeURIComponent(upiId)>&pn=<encodeURIComponent(toName)>&am=<amount.toFixed(2)>&cu=INR&tn=Vasool%20Settlement`
   - When `upiId === ''`: Adds `.hidden` to `#settleUpiSection`, removes `.hidden` from `#settleNoUpiNotice`, clears `#settleUpiDeepLink`, and defaults `#settleMethodSelect` to `'Cash'`.
