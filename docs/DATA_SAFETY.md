# Vasool — Data Safety & MongoDB Protection Guide

> This document ensures all code changes (from IMPROVEMENTS.md and UI_UX_REDESIGN.md) are
> implemented without any risk to existing MongoDB Atlas data — user accounts, group splits,
> expense records, and settlement histories.

---

## ⚠️ What Must Never Be Touched

The following MongoDB collections contain live production data that must be preserved:

| Collection | Contains | Risk if corrupted |
|---|---|---|
| `users` | Account credentials, emails, UPI IDs, roles | Login failure, identity loss |
| `groups` | Group metadata, member lists, invite codes, audit logs | All split history breaks |
| `expenses` | Every bill ever logged, split allocations, amounts | Financial records lost |
| `settlements` | Payment history, confirmed/rejected status, UTRs | Debt resolution history lost |
| `feedbacks` | User feedback submissions | Low risk, but still avoid |
| `systemconfigs` | Session token duration, global settings | Auth disruption |

---

## 🟢 Safe-to-Implement Changes (Zero Data Risk)

All items in `UI_UX_REDESIGN.md` and most items in `IMPROVEMENTS.md` are **frontend-only**:

- Editing CSS classes in `public/index.html`
- Editing styles in `public/css/aurora-theme.css`
- Editing JS display logic in `public/js/*.js` (no API writes)
- Adding UI filters, search bars, copy buttons — these never POST/PUT/DELETE to the API

**These changes do not touch the database in any way.**

---

## 🟡 Low-Risk Backend Changes (Additive Only)

These changes ADD new optional fields to existing schemas. MongoDB is schemaless — adding new optional fields with defaults never corrupts existing documents.

### 1. Group Emoji/Icon Field
**File:** `models/Group.js`
```javascript
// ADD this line inside GroupSchema - it is optional with a default
emoji: { type: String, default: '👥', trim: true },
```
**Risk:** Zero. Existing groups will get `emoji: '👥'` automatically when first read. No migration needed.

### 2. Expense Tags Field (future enhancement)
**File:** `models/Expense.js`
```javascript
// ADD this line — optional array with default
tags: { type: [String], default: [] },
```
**Risk:** Zero. Existing expenses will simply have `tags: []`.

---

## 🟠 Medium-Risk Changes (Test on Staging First)

### 3. Password Hashing Toggle
The `ENABLE_PASSWORD_HASHING` environment variable in `routes/auth.js` currently defaults to `false` (passwords stored as plaintext in `passwordRaw`).

**DO NOT** flip this to `true` on production without first running a migration script, because:
- Existing users have plaintext passwords in DB
- If hashing is turned on, `verifyPassword()` checks bcrypt first, then falls back to plaintext — so existing logins will STILL WORK
- BUT new registrations will get hashed passwords while old ones stay plaintext

**Safe approach:** Leave `ENABLE_PASSWORD_HASHING=false` for now. This is an existing design decision.

### 4. `syncWithBackend()` Parallelization
Current code makes 3 serial `apiFetch` calls:
1. `/api/groups`
2. `/api/expenses`
3. `/api/settlements`

The improvement wraps them in `Promise.all()`. This is safe because:
- All 3 are GET requests — read-only
- No write operations involved
- If one fails, the existing error handler will catch it

**Risk:** Minimal. Test that all 3 responses are still correctly merged into `appState`.

---

## 🔴 High-Risk Changes (Do NOT implement without backup)

### 5. Settlement Status Updates
Any change to settlement confirmation/rejection logic in `routes/settlements.js` must be tested carefully because:
- Settlement status changes are permanent record updates
- A bug here could mark pending settlements as confirmed without admin approval
- **Always test on demo accounts first**

### 6. Group Member Removal
Changes to `DELETE /api/groups/:id/members` must preserve:
- The member's historical expense contributions (never delete Expense records)
- The member's settlement records

**Rule:** Removing a member from a group should ONLY update `group.members` — never delete Expense or Settlement documents.

---

## 🛡️ Before Making Any Code Change

### Recommended Pre-Implementation Checklist

```bash
# 1. Verify the app is running correctly before changes
cd /home/ubuntu/vasool
npm test

# 2. Check git status — make sure you're on a clean branch
git status
git log --oneline -5

# 3. Create a feature branch before any changes
git checkout -b feat/improvements-v3.2

# 4. After frontend-only changes, run tests again
npm test

# 5. For backend changes, test key API endpoints manually
# (Groups, Expenses, Settlements endpoints)
```

### MongoDB Atlas Backup Verification

Before making any backend schema changes, verify that **MongoDB Atlas automated backups** are enabled:
1. Log in to Atlas → Your Cluster → `Backup` tab
2. Confirm Point-in-Time restore is enabled
3. Note the latest restore point timestamp

The MongoDB URI is in Infisical at `$MONGO_URI`. The database name used is `vasool` (or whatever is specified in the connection string).

---

## 📋 Change-by-Change Safety Matrix

| Change | File(s) | DB Touch | Risk |
|--------|---------|----------|------|
| Simplify CSS gradients | `aurora-theme.css` | ❌ None | ✅ Safe |
| Reduce backdrop-filter blur | `aurora-theme.css` | ❌ None | ✅ Safe |
| Replace gradient text | `index.html` | ❌ None | ✅ Safe |
| Add bill notes display | `dashboard-and-expenses.js` | ❌ Read-only | ✅ Safe |
| Add invite link copy button | `index.html` | ❌ None | ✅ Safe |
| Add expense search/filter | `dashboard-and-expenses.js` | ❌ Read-only | ✅ Safe |
| Parallelize sync API calls | `core-and-telemetry.js` | ❌ Read-only | ✅ Safe |
| Group archive UI | `groups-and-modals.js` + `index.html` | ✅ PATCH groups | 🟡 Low |
| Member weight editor | `index.html` + `groups-and-modals.js` | ✅ PATCH groups | 🟡 Low |
| Add group emoji field | `models/Group.js` | ✅ Additive | 🟡 Low |
| Pending badge in nav | `core-and-telemetry.js` | ❌ Read-only | ✅ Safe |
| Sync debouncing | `core-and-telemetry.js` | ❌ Read-only | ✅ Safe |
| Font reduction (2 families) | `index.html` | ❌ None | ✅ Safe |
| OTP countdown timer | `auth-and-admin.js` | ❌ None | ✅ Safe |
| Password strength meter | `auth-and-admin.js` | ❌ None | ✅ Safe |
| Toast color simplification | `core-and-telemetry.js` | ❌ None | ✅ Safe |
| Loading skeleton screens | `index.html` + JS files | ❌ None | ✅ Safe |

---

## 🗄️ Data Export Before Starting (Recommended)

Export a snapshot of current MongoDB data before any implementation:

```bash
# Export all collections (run from hyd2)
# URI injected via Infisical — do NOT hardcode
infisical run --silent -- bash -c '
  mongodump \
    --uri="$MONGO_URI" \
    --db=vasool \
    --out=/home/ubuntu/vasool-backup-$(date +%Y%m%d-%H%M%S)
'
```

This creates a local backup in `/home/ubuntu/vasool-backup-YYYYMMDD-HHMMSS/`.

**Note:** MongoDB Atlas also provides automated cloud backups — this is just an extra local safety net.

---

## 🔄 Rollback Plan

If any backend change causes issues:

```bash
# Revert to last good commit
git log --oneline -10
git revert HEAD  # for the last commit
# or
git checkout main  # discard branch changes

# If DB state was affected (unlikely for most changes),
# use MongoDB Atlas Point-in-Time Restore from the Atlas console
```

---

## Summary: Implementation Order for Maximum Safety

1. **Start with UI_UX_REDESIGN.md** — zero data risk, pure CSS/HTML
2. **Then IMPROVEMENTS.md P0 items** — frontend-only search/filter/display
3. **Then IMPROVEMENTS.md P1 items** — includes some API calls but all GET-only
4. **Last: any SCHEMA-ADDITIVE items** — only after verifying Atlas backups

This order ensures that if anything goes wrong in later steps, the UI improvements are already deployed and working.
