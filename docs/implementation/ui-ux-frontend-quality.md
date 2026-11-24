# Vasool UI/UX, Frontend Architecture & Quality Improvements

**Status:** Implementation roadmap and acceptance specification  
**Scope:** Non-security improvements to the current Vasool application. Security hardening is tracked separately and is intentionally excluded from this document.

## 1. Objective

Evolve the current Vasool v3.1 interface into a cleaner, faster, more consistent experience without replacing working product capabilities or changing financial rules.

The work should be incremental. Preserve the existing Node.js/Express, MongoDB/Mongoose, and vanilla ES2022 frontend architecture while improving the user experience and gradually reducing frontend complexity.

## 2. Product experience principles

1. **Make the next action obvious.** Each screen should have one clear primary action.
2. **Prioritize the financial answer.** Balances, who owes whom, pending settlements, and confirmation status should be easier to scan than decorative analytics.
3. **Mobile first.** Core workflows must work comfortably at 360px–430px widths, then scale to tablet and desktop.
4. **Progressive disclosure.** Show summaries first; place advanced split settings, audit details, and secondary actions behind expandable sections or focused modals.
5. **Consistency.** Reuse the same spacing, typography, buttons, badges, form controls, modal behavior, and empty/loading/error states.
6. **Preserve accounting behavior.** UI refactoring must not alter split calculations, rounding, debt simplification, refund accounting, or settlement confirmation semantics.

## 3. UI/UX implementation scope

### 3.1 Design system and visual consistency

Create a small reusable design system using the existing Aurora theme and CSS variables.

Define and consistently apply:
- Color tokens for page, surface, elevated surface, border, primary text, secondary text, success, warning, danger, and informational states.
- Typography scale for page titles, section headings, card titles, body text, labels, helper text, and financial values.
- Spacing scale and standard content widths.
- Shared button variants: primary, secondary, quiet, danger, and icon-only.
- Shared form styles, focus states, disabled states, validation messages, and helper text.
- Shared badges for roles, payment states, verification states, and group membership states.
- Shared card, divider, empty-state, loading, and error patterns.
- Consistent modal sizing, header/footer layout, close controls, and mobile bottom-sheet behavior.

Do not introduce a second competing visual language. Retain the existing dark/Aurora identity while improving contrast, hierarchy, and consistency. If a light theme is retained or added, it must use the same semantic tokens.

**Acceptance criteria**
- Equivalent controls look and behave consistently across Home, Bills, Groups, Settle, and Admin.
- Status is never communicated by color alone; pair color with text or an icon and label.
- Focus, hover, active, disabled, and validation states are defined.
- No page-level horizontal overflow at supported mobile widths.

### 3.2 Navigation and information hierarchy

- Keep the primary navigation limited to the main user jobs: Home, Bills, Groups, and Settle, with Admin visible only to the Super Admin.
- Keep the Home overview hero and KPI summary exclusive to the Home tab.
- Reduce repeated headings, duplicate totals, and secondary cards that compete with the primary task.
- Use clear page titles and short contextual descriptions.
- Keep the most important action visible without requiring excessive scrolling.
- Preserve the current mobile bottom navigation and ensure the active tab is visually unambiguous.
- Keep secondary actions in contextual menus or section-level action areas rather than giving every action equal visual weight.

**Acceptance criteria**
- A user can identify the current section and its primary action immediately.
- The navigation remains usable at 360px width.
- Switching tabs does not leave stale modal or tab state visible.

### 3.3 Home dashboard

Reorganize Home around the questions users need answered:

1. What is my overall position?
2. Which groups need my attention?
3. Who should pay next / what should I settle?
4. What did I spend recently?

Recommended hierarchy:
- Compact balance summary with clear positive/negative/settled labels.
- Action-needed section for pending invitations, settlement confirmations, or outstanding balances.
- Group overview cards with group name, net position, and a direct link to details.
- Recent expenses/activity below the primary financial summary.
- Charts as supporting context, not the first or largest element on small screens.

Keep the existing KPI information, but avoid four equally dominant cards pushing actionable information below the fold.

**Acceptance criteria**
- The user's net position and pending actions are visible near the top.
- Each group card links to the correct group.
- Empty states explain how to create or join a group.
- Dashboard values reconcile with the existing balance engine.

### 3.4 Fast expense creation

Optimize the Add Expense flow for the common case while retaining all four split modes and multi-payer support.

Suggested flow:
1. Enter expense title and amount.
2. Select who paid (default to the current user, preserving the existing ability to unselect or multi-select payers).
3. Select participants.
4. Use Equal split by default.
5. Reveal Exact, Percentage, and Ratio/Shares controls only when selected.
6. Show a live allocation summary and validation before save.

Additional behavior:
- Keep currency and group context visible.
- Clearly show when payer allocations do not sum to the bill total.
- Show the rounding adjustment and who absorbs it when applicable.
- Preserve edit, delete, undo, refund/income, and linked-refund behavior.
- Prevent accidental dismissal when there are unsaved changes; offer Save, Discard, and Continue Editing.

**Acceptance criteria**
- A simple equal split can be entered with minimal interaction.
- Advanced split modes remain fully available.
- Payer totals and participant allocations are validated before submission.
- Existing stored expenses render and edit without data loss.
- No change to financial calculation results is introduced by this UI work.

### 3.5 Group details simplification

Organize Group Details into clear sections or tabs:
- **Overview:** group balance, member count, and primary group actions.
- **Bills:** group expenses and refunds.
- **Members:** roles, status, default weights, and member actions.
- **Settle:** suggested transfers and pending settlement actions.
- **Activity:** chronological group activity and audit history.
- **Settings:** debt simplification and split visibility settings.

Keep group name, group currency, and current balance visible in the group header. Move less-frequently-used settings out of the default overview. Retain the existing group admin ownership and member management behavior.

**Acceptance criteria**
- Users can find bills, members, settlements, and settings without scanning one long modal.
- Member role and weight information is visible where it affects a split.
- Pending invitations and pending settlements have clear status labels.
- Group actions remain permission-aware and preserve existing behavior.

### 3.6 Settlement experience

Make the settlement screen the clearest financial workflow in the app.

- Separate **You owe**, **Owed to you**, **Pending confirmation**, and **Settled** states.
- Present each suggested transfer as a compact debtor → creditor row with amount and action.
- Make the payment method, recipient UPI ID availability, and payment instructions clear before leaving Vasool.
- Keep Record Payment, Confirm Received, Confirm Partial Amount, and Reject/Request Clarification visually distinct.
- Show who must act next and why a settlement is still pending.
- Display confirmation history and timestamps in the settlement detail view.
- Keep the existing two-way confirmation handshake and partial amount semantics unchanged.

**Acceptance criteria**
- Users can distinguish a claimed payment from a confirmed payment.
- Pending settlements do not appear as completed balance reductions.
- Partial confirmations show both received and remaining amounts.
- UPI actions are only presented when a recipient UPI ID is configured.
- The next responsible actor is clear for every pending item.

### 3.7 Admin Console usability

- Use a consistent section navigation for User Accounts, Platform Groups, Feedback, and System Status.
- Use summary cards and responsive tables/cards appropriate to screen width.
- Keep destructive actions visually distinct and confirmation-protected.
- Keep account status, suspension duration, and verification state readable.
- Implement the dedicated User Details and Credential Reveal modal according to [admin-user-details-modal.md](admin-user-details-modal.md). That specification is a hard requirement.
- Do not place all user fields or credentials directly in the main user list.

**Acceptance criteria**
- Admin sections work on mobile without horizontal scrolling.
- User actions remain reachable and clearly labelled.
- The user details modal follows its dedicated specification.

### 3.8 Empty, loading, error, and feedback states

Standardize states across all major screens:
- Loading skeleton or concise progress indicator for network-backed lists.
- Empty state with a relevant next action.
- Inline validation beside the field that needs correction.
- Recoverable error message with a retry action where appropriate.
- Success feedback for saved expenses, updated settings, and completed settlements.
- Avoid relying only on transient toast messages for important financial state changes.

**Acceptance criteria**
- Every major list has loading, empty, error, and populated states.
- Forms preserve entered values after recoverable server errors.
- Financial mutations clearly communicate whether the operation succeeded.

### 3.9 Accessibility and responsive behavior

- Use semantic buttons for actions and links for navigation.
- Ensure every input has a programmatic label.
- Ensure dialogs expose dialog semantics, have a visible title, and manage focus correctly.
- Support Escape to close dismissible dialogs and return focus to the opener.
- Ensure keyboard access to navigation, dropdowns, modals, and chart alternatives.
- Add accessible text summaries for charts; do not make chart color the only source of meaning.
- Maintain readable contrast and visible focus indicators.
- Respect reduced-motion preferences.
- Test 360px, 375px, 390px, 430px, tablet, and desktop layouts.

## 4. Frontend architecture improvements

### 4.1 Incremental feature-based organization

Keep vanilla ES2022 modules. Do not introduce a framework migration as part of this work.

Gradually organize frontend code by domain responsibility:
- `core/`: app state, API client, formatting, shared utilities, event helpers.
- `auth/`: login, signup, OTP, account settings, onboarding.
- `dashboard/`: Home dashboard, KPIs, charts, recent activity.
- `expenses/`: expense forms, split UI, expense list, refunds.
- `groups/`: group list, group details, member management, settings.
- `settlements/`: balances, suggested transfers, payment and confirmation flows.
- `admin/`: user list/details, groups, feedback, system settings.
- `shared/`: modal, toast, form, badge, loading, empty-state components/helpers.

This is a target organization, not a demand for a one-shot rewrite. Map current functions to the new structure and move one domain at a time.

### 4.2 Module boundaries

- Keep pure calculations separate from DOM manipulation.
- Keep API calls in domain service modules rather than scattering fetch logic through event handlers.
- Keep rendering functions focused on one view or component.
- Avoid multiple modules independently mutating the same global state without a documented contract.
- Prefer explicit exported functions and named imports over implicit global function dependencies.
- Centralize repeated modal, toast, formatting, and validation behavior.
- Preserve current public function behavior during migration or update all call sites in the same change.

### 4.3 State and event lifecycle

- Document the authoritative source for each major state object.
- Separate server-persisted state from temporary UI state (open modal, selected tab, form draft, filters).
- Ensure event listeners are registered once and cleaned up when views are recreated.
- Prevent duplicate submissions while a request is in flight.
- Avoid stale async responses overwriting a newer selected group, user, or modal.
- Keep local draft state separate from saved server state.
- Add explicit loading and error state to asynchronous workflows.

### 4.4 Refactoring strategy

For each domain:
1. Inventory current functions, globals, DOM IDs, and API calls.
2. Define the target module interface.
3. Move code without changing behavior.
4. Add or update tests around the domain.
5. Verify mobile and desktop behavior.
6. Remove obsolete code only after confirming no remaining references.
7. Record the migration in the implementation checklist.

Do not combine a large visual redesign, a state-management rewrite, and a financial algorithm change in one pull request.

## 5. Automated testing and regression coverage

Maintain the existing QA runner while adding repeatable browser-level tests.

### 5.1 Test layers

- **Unit tests:** split allocation, rounding, debt simplification, currency formatting, validation helpers.
- **API integration tests:** authentication flows, group lifecycle, expense CRUD, refunds, settlements, admin actions.
- **Browser E2E tests:** real user workflows across multiple users and groups.
- **Responsive UI tests:** key flows at supported mobile widths and desktop.

### 5.2 Critical end-to-end scenarios

1. Sign up, verify email, log in, and persist session after reload.
2. Create a group and invite one or multiple users.
3. Accept an invitation and verify group membership.
4. Create an equal split expense.
5. Create Exact, Percentage, and Ratio/Shares expenses.
6. Create an expense with multiple payers and verify payer allocation totals.
7. Edit an expense and verify balances recalculate.
8. Delete an expense and restore it using Undo.
9. Create a refund linked to its parent expense and verify net spend.
10. Calculate simplified debts for a multi-member group.
11. Record a settlement and verify it remains pending until confirmation.
12. Confirm a full settlement and verify balances update.
13. Confirm a partial settlement and verify the remaining amount.
14. Reject a settlement and verify balances remain unchanged.
15. Verify UPI actions are shown only when a recipient has a configured UPI ID.
16. Verify Group Details sections and member actions.
17. Verify admin user list, user details modal, and credential reveal behavior.
18. Verify account suspension and reactivation.
19. Verify admin feedback triage.
20. Verify navigation and core workflows at 360px, 390px, 430px, tablet, and desktop.

### 5.3 Stable selectors

Use stable `data-testid` attributes for critical controls and assertions. Prefer semantic selectors where possible; use test IDs for dynamic or otherwise ambiguous controls. Avoid selectors coupled to Tailwind class strings or DOM nesting.

### 5.4 Test data and repeatability

- Use isolated test users and groups.
- Ensure tests do not depend on execution order.
- Reset or uniquely namespace generated data.
- Cover at least two users for creditor/debtor confirmation flows.
- Keep test accounts out of ordinary user-facing lists where current behavior requires that.
- Capture screenshots or traces for failed browser tests where supported.

**Acceptance criteria**
- Critical financial workflows have automated regression coverage.
- Tests verify persisted server state, not only visible UI text.
- Tests are repeatable and do not rely on manually preloaded browser state.
- Failures identify the workflow and assertion that failed.

## 6. Performance and perceived responsiveness

- Avoid rerendering unrelated dashboard sections after a local form change.
- Lazy-load or defer non-critical charts and admin-only sections where practical.
- Minimize repeated API calls when switching tabs or reopening a modal.
- Use loading placeholders for network-backed views rather than freezing the interface.
- Keep chart datasets and DOM rendering proportional to the visible data.
- Measure before optimizing; avoid speculative complexity.

## 7. Delivery phases and suggested order

### Phase 1 — UX foundations
- [ ] Define shared design tokens and reusable controls.
- [ ] Standardize navigation, headings, buttons, forms, badges, and modal patterns.
- [ ] Standardize loading, empty, error, and success states.
- [ ] Verify the 360px–430px mobile baseline.

### Phase 2 — Core user journeys
- [ ] Simplify Home hierarchy.
- [ ] Streamline Add Expense for the common equal-split case.
- [ ] Organize Group Details into clear sections.
- [ ] Improve settlement status hierarchy and next-action clarity.
- [ ] Improve Admin Console layout and user details entry point.

### Phase 3 — Frontend maintainability
- [ ] Inventory current frontend modules and global dependencies.
- [ ] Define module boundaries and shared helpers.
- [ ] Migrate one feature domain at a time.
- [ ] Separate pure financial calculations from DOM code.
- [ ] Remove obsolete code after regression checks.

### Phase 4 — Quality and performance
- [ ] Expand unit and API integration tests.
- [ ] Add multi-user browser E2E flows.
- [ ] Add responsive viewport coverage.
- [ ] Add stable selectors to critical workflows.
- [ ] Measure and address actual performance bottlenecks.

## 8. Definition of done

A work item is complete only when:
- Its intended user flow works end to end.
- Existing financial calculations and stored data remain correct.
- Loading, empty, error, and success states are handled.
- Mobile and desktop layouts are verified.
- Keyboard and accessible interaction behavior is covered where relevant.
- Automated tests are added or updated.
- Documentation reflects the shipped behavior.
- No unrelated feature or financial rule has regressed.

## 9. Explicitly out of scope for this document

- Security remediation and authentication hardening; track these separately.
- Changing debt algorithms, split mathematics, or settlement accounting semantics.
- A framework rewrite or a one-shot frontend rewrite.
- Removing existing product capabilities merely to simplify the UI.
