# UI Visual Restoration & Split-to-Settle Workflow

**Status:** Product-owner-directed implementation specification  
**Applies to:** Current Vasool UI refresh and navigation cleanup  
**Priority:** High — resolve the recent visual regression before broader cosmetic work.

## 1. Context and product-owner direction

A recent agent-driven UI change introduced silver/grey-looking blocks and a visual treatment the product owner explicitly dislikes. The previous green-and-black theme was preferred.

The product owner also requested moving the **Split Expenses** experience away from the Home page and into the **Settle** tab because Home was becoming repetitive and overloaded. The quality of that relocation is uncertain and must be reviewed before further changes.

This document records those preferences as requirements. Do not reinterpret the silver/grey redesign as an approved direction.

## 2. Visual direction: restore the green-and-black identity

### 2.1 Desired visual identity

Use the earlier Vasool green-and-black appearance as the baseline:

- Deep black / near-black page background.
- Dark charcoal and deep green surfaces for cards and panels.
- Emerald green as the primary accent for key actions, active states, highlights, and positive financial values.
- Teal may be used sparingly as a supporting accent where it already fits the design language.
- White for primary text and muted grey for secondary text, labels, borders, and separators.
- Subtle green-tinted borders, shadows, and highlights rather than large bright or metallic surfaces.

The intent is a cohesive dark green financial-product interface: clean, calm, readable, and focused.

### 2.2 Explicitly avoid

- Large silver, metallic, chrome, or light-grey blocks as primary card surfaces.
- A grey-on-grey visual hierarchy that makes cards look flat or washed out.
- Random gradients, excessive glass effects, or decorative panels that compete with the content.
- Introducing a new palette that conflicts with the established green-and-black identity.
- Replacing the existing visual identity wholesale without explicit product-owner approval.

Grey is still appropriate for secondary text, subtle borders, disabled states, and quiet controls. The restriction is against using silver/grey as the dominant surface treatment.

### 2.3 Theme tokens

Centralize the visual tokens in the existing Aurora theme stylesheet rather than scattering one-off classes.

Suggested semantic token intent (adapt values to the current stylesheet and preserve contrast):

| Token | Intended appearance |
|---|---|
| Page background | Near-black |
| Primary surface | Deep charcoal |
| Elevated surface | Slightly lighter charcoal, optionally green-tinted |
| Accent surface | Very dark green |
| Primary accent | Emerald green |
| Secondary accent | Restrained teal |
| Primary text | Near-white |
| Secondary text | Muted cool grey |
| Border | Dark charcoal / subtle green |
| Success | Green with readable text |
| Warning | Amber |
| Danger | Muted red |

Do not apply these tokens mechanically if the existing theme already has equivalent variables. Reuse and consolidate.

### 2.4 Visual restoration workflow

1. Inspect the current branch and identify the commit/change that introduced the silver blocks or unwanted visual treatment.
2. Compare the current UI against the earlier green-and-black appearance using Git history, previous screenshots, or the known existing theme stylesheet.
3. Identify the exact components and selectors affected; do not blindly revert unrelated functional changes.
4. Restore the green-and-black surfaces and hierarchy.
5. Check contrast, focus, hover, active, disabled, and status states.
6. Review Home, Bills, Groups, Settle, QA, Admin, and all major modals for visual consistency.
7. Capture before/after screenshots at mobile and desktop widths for review.

If the exact earlier appearance cannot be recovered from Git history or screenshots, use the design direction in this document as the source of truth and avoid inventing a radically different theme.

## 3. Split Expenses: move the workflow to Settle

### 3.1 Intended information architecture

The Home page should be an overview, not a second place to perform the full split/settlement workflow.

- **Home:** personal/group financial overview, key balances, attention-needed items, concise recent activity, and clear navigation shortcuts.
- **Bills:** expense ledger — browse, search, filter, inspect, add, edit, and manage recorded expenses.
- **Settle:** the action-oriented split and settle-up workspace — understand who owes whom, review the split/settlement breakdown, and take the next payment or confirmation action.

The product-owner request is to move the **Split Expenses workflow/section** from Home into Settle. Do not confuse this with moving the entire expense ledger out of Bills.

### 3.2 Required relocation behavior

- Remove the full Split Expenses interaction/section from Home.
- Place the full workflow inside the Settle tab, with a clear heading and short explanation.
- Preserve all existing split functionality, data, permissions, and calculation behavior.
- Preserve deep links or existing entry points where feasible, redirecting them to the correct Settle section rather than leaving broken controls.
- Avoid rendering the same full split interface on both Home and Settle.
- Home may retain a compact balance summary or a single shortcut to Settle, but must not duplicate the full split workflow.
- The Home dashboard must not render the **Net Member Balances** chart/card; keep detailed member balance inspection within the Settle workflow.
- Bills remains the source for the full expense list and expense-management actions.

### 3.3 Settle tab layout

Organize the Settle tab in a clear action sequence:

1. **Your position:** compact totals for You Owe, Owed to You, and Pending Confirmation.
2. **Split breakdown / outstanding shares:** show the relevant group and member-level breakdown needed to understand the amount.
3. **Recommended transfers:** show debtor → creditor, amount, and why the transfer is recommended.
4. **Payment action:** record payment or open the configured UPI action where available.
5. **Confirmation queue:** show payments awaiting confirmation and the correct next actor.
6. **Settlement history:** show confirmed and historical payments, visually secondary to pending actions.

On mobile, stack these sections in the same logical order. Keep the most urgent next action near the top. Use collapsible detail sections only for secondary information, not to hide the amount, recipient, or status.

- Render recommended transfers as a compact, single-row list: **debtor pays creditor**, amount, and one **Settle** action. Do not show email addresses or communication actions (such as reminders/email) on each transfer row. Preserve pending-confirmation states and all existing settlement actions/permissions.

### 3.4 Avoid new redundancy

- Do not show the same KPI cards in full on both Home and Settle.
- Home can show a concise snapshot with a **Go to Settle** action.
- Settle can show the detailed balances and action queue.
- Bills can show the expense ledger; Settle can show how those expenses translate into outstanding shares and transfers.
- Use one shared data source/calculation result for the same financial figures. Do not create a second UI-only calculation that can disagree with the canonical balance engine.
- Ensure a user can move from a settlement or split item to the related bill details without losing context.

### 3.5 Financial behavior must not change

This is a navigation and presentation change, not an accounting rewrite.

Preserve:
- Equal, Exact, Percentage, and Ratio/Shares split modes.
- Multi-payer expense allocation.
- Existing rounding and remainder attribution.
- Refund and income handling.
- Debt simplification algorithms.
- Pending versus confirmed settlement semantics.
- Full and partial settlement confirmation.
- Group/member permissions and split privacy behavior.

Never treat a pending payment as confirmed merely because the UI moved to another tab or a card was rearranged.

## 4. Implementation guidance

Before editing, map the current DOM and JavaScript responsibilities:

- `public/index.html`: current Home, Bills, and Settle panel markup.
- `public/css/aurora-theme.css`: theme tokens and shared component styles.
- `public/js/dashboard-and-expenses.js`: dashboard rendering, expense UI, navigation, and related event handlers.
- `public/js/groups-and-modals.js`: group and modal interactions.
- `public/js/core-and-telemetry.js`: shared state, formatting, and API synchronization.

The current page already has distinct `panelDashboard`, `panelExpenses`, and `panelSettle` containers, plus a Home-only `homeDashboardTopSection`. Treat these as the current structural baseline and inspect the actual live code before deciding where the requested Split Expenses block resides. Do not assume a component location from its visible label alone.

Implementation sequence:

1. Inventory the current Home DOM and identify the exact Split Expenses block, its render function, and event handlers.
2. Inventory the Settle DOM and identify existing balances, transfer recommendations, confirmation queue, and history.
3. Decide which existing block is being relocated and which content remains in Bills.
4. Move/recompose the block into Settle without duplicating IDs or registering duplicate event listeners.
5. Remove the old Home instance and replace it, if useful, with one concise summary/shortcut.
6. Restore the green-and-black visual tokens and remove the unwanted silver block treatment.
7. Verify all navigation, modal, and responsive behavior.
8. Run regression tests for balances, split modes, multi-payer allocation, refunds, and settlement confirmation.

Do not perform a broad HTML rewrite or framework migration for this task.

## 5. Acceptance criteria

### Visual identity
- [ ] Main application returns to a cohesive green-and-black dark theme.
- [ ] Silver/metallic/light-grey blocks are not used as dominant card or panel surfaces.
- [ ] Emerald remains the primary action and highlight color.
- [ ] Text, borders, statuses, and focus states remain readable and accessible.
- [ ] Home, Bills, Groups, Settle, QA, Admin, and major modals share the same design language.
- [ ] Mobile and desktop screenshots are reviewed before considering the redesign complete.

### Split workflow relocation
- [ ] Full Split Expenses workflow is no longer duplicated on Home.
- [ ] Full split/settle workflow is available from the Settle tab.
- [ ] Home retains only a concise overview and/or shortcut.
- [ ] Bills remains the expense ledger and retains expense-management capabilities.
- [ ] No duplicate DOM IDs or duplicate event handlers are introduced.
- [ ] Existing navigation and links point to the correct destination.
- [ ] All existing split and settlement behaviors remain unchanged.
- [ ] Figures shown on Home and Settle reconcile with the same underlying balance data.
- [ ] The Settle tab is usable at 360px, 375px, 390px, 430px, tablet, and desktop widths.

## 6. Manual review checklist

- [ ] Compare the current UI with the previous green-and-black version.
- [ ] Review Home with no groups, one group, and multiple groups.
- [ ] Review Settle with no outstanding balances, debts owed, debts receivable, and pending confirmations.
- [ ] Verify a multi-payer bill with each split mode.
- [ ] Verify full and partial settlement confirmation.
- [ ] Verify the Bills ledger still supports search, filtering, and expense actions.
- [ ] Verify tab switching does not leave stale overlays, duplicate content, or stale selected-group state.
- [ ] Verify no horizontal overflow on mobile.

## 7. Product-owner approval boundary

The green-and-black theme and the relocation of the Split Expenses workflow to Settle are explicit product-owner preferences. Do not reverse either decision or introduce a silver/grey redesign without asking for approval.
