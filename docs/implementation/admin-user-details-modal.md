# Admin User Details & Credential Reveal Modal

**Status:** Required implementation specification  
**Product requirement:** This feature is mandatory unless the product owner explicitly changes it. It is not a temporary/testing-only feature.

## 1. Goal

Give the Super Admin a complete, focused view of an individual registered user's account details without cluttering the main user table or exposing credentials inline.

The user list remains a summary. Every user row has a **View Details** action that opens a modal for that specific user. The modal is the only place where the selected user's password may be revealed.

## 2. Required user experience

### 2.1 Admin user list

- Keep the existing registered-user list and account-management actions.
- Show useful summary fields such as name, email, role, verification state, account status, group count, and account creation date where space permits.
- Do not render username/password credentials directly in the table, cards, row attributes, tooltips, or hidden expanded content.
- Add a clearly labelled **View Details** button/action to every user row.
- Keep existing suspend/unsuspend, password-update, and delete actions available; do not make the details modal a replacement for them.
- On narrow screens, use a stacked card layout with the action reachable without horizontal scrolling.

### 2.2 Opening the modal

When the Super Admin selects **View Details** for a user:

1. Open a modal titled **User Details** with the selected user's name and email.
2. Fetch the selected user's detail payload for the modal; do not depend on credential values embedded in the user-list response.
3. Display account/profile details in clearly labelled sections.
4. Display the username/email and a password row. The password is masked by default.
5. Provide an explicit **Reveal Password** control. Clicking it reveals the password for the currently selected user only.
6. Provide a **Copy** action only where it improves the admin workflow; show clear feedback after a successful copy.
7. The modal must make it obvious when a password is unavailable, for example for Google-only accounts or accounts without a recoverable password. Never display a password hash as if it were the user's password.

### 2.3 Closing and switching users

- Close via the close button, Escape, and backdrop click where appropriate.
- Closing the modal immediately clears the selected user's detail and password values from modal state and the rendered DOM.
- Opening another user's details must replace the previous user's data; never briefly show the previous user's password.
- Reopening a modal requires a fresh authorized detail request. Do not persist revealed credentials in localStorage, sessionStorage, URL parameters, or browser history.
- Do not leave credentials in the user list after the modal closes.

## 3. User details to display

Use the current `User` model as the source of truth. Display fields when present:

### Profile
- Display name
- Email / username
- Avatar URL (render as an image only when valid; otherwise use initials)
- UPI ID
- Default currency

### Account
- Role (User / Super Admin)
- Email verification status
- Authentication provider(s), such as email or Google
- Account creation timestamp
- Last updated timestamp
- Last login timestamp

### Account status
- Active or suspended state
- Suspension reason
- Suspension start timestamp
- Suspension expiry timestamp, or **Indefinite** when no expiry is set
- Group membership count

### Credentials
- Username/email
- Password value only when a recoverable password is available and the Super Admin explicitly reveals it
- A clear **Not available / Not set** state when the account has no recoverable password

Do not expose password hashes, Google provider identifiers, OTPs, password-reset tokens, verification tokens, or token expiry secrets in this UI. These are not user-facing account details.

## 4. API contract

Keep `GET /api/admin/users` as a summary/list endpoint. Its response must not contain password values, hashes, or other credential material.

Add a dedicated detail endpoint:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/users/:userId/details` | Return the selected user's non-credential account/profile details |
| `GET` | `/api/admin/users/:userId/credentials` | Return the selected user's username and recoverable password for the explicit reveal action |

### 4.1 Details response

Return only the fields required by section 3, excluding credential material and internal authentication tokens. Include a stable user ID and explicit null/empty values where useful so the UI can render unavailable fields consistently.

### 4.2 Credentials response

The credentials endpoint is called only after the Super Admin clicks **Reveal Password**. Return a minimal payload:

- `userId`
- `username` (the account email)
- `password` (the recoverable password, or null when unavailable)
- `passwordAvailable` (boolean)

Never include credentials in the default list or general details response. Do not return a password hash as a substitute for a password.

### 4.3 Authorization and failure states

- Reuse the existing authentication and Super Admin authorization middleware.
- Return 401 for unauthenticated requests, 403 for non-Super-Admin requests, 404 for an unknown user, and a clear server error for retrieval failures.
- Prevent requests for the Super Admin account from being modified or deleted as already specified by the existing admin behavior.
- The UI must handle loading, unavailable password, expired session, not-found, and server-error states without leaving stale details visible.

## 5. Frontend behavior and implementation notes

- Implement the modal in the existing Admin Console flow in `public/js/auth-and-admin.js`, with modal markup in `public/index.html` if the current modal structure requires it.
- Keep the selected user ID as the modal's single source of truth.
- Fetch details when opening the modal; fetch credentials only on explicit reveal.
- Use `textContent` for user-supplied text. Do not interpolate names, emails, or other user data into HTML strings.
- Mask the password by default and use a dedicated reveal/hide control.
- Clear sensitive values on close, user switch, logout, request failure, and modal teardown.
- Keep the modal usable at 360px–430px widths and on desktop.
- Add stable `data-testid` selectors for the open button, modal, reveal button, password value, close button, loading state, and unavailable state.

## 6. Acceptance criteria

- [ ] Every user row has a View Details action.
- [ ] The list endpoint and rendered list contain no password values or hashes.
- [ ] The modal shows the selected user's available profile, account, and status details.
- [ ] Password is masked until Reveal Password is explicitly selected.
- [ ] Password is shown only for the selected user and only when recoverable.
- [ ] A password hash is never displayed as a password.
- [ ] Closing the modal clears the detail and credential state.
- [ ] Switching users cannot display stale details or credentials.
- [ ] OTPs, reset tokens, verification tokens, and provider secrets are never displayed.
- [ ] Non-Super-Admin access is rejected by the server, not merely hidden in the UI.
- [ ] Loading, empty, unavailable, and error states are covered.
- [ ] Modal layout works at 360px, 390px, 430px, tablet, and desktop widths.
- [ ] Existing account suspension, password update, and delete workflows continue to work.

## 7. Out of scope

- Changing the overall authentication provider model.
- Replacing the requested reveal interaction with password reset-only functionality.
- Redesigning the entire Admin Console.
- Removing this feature automatically at a future release milestone.

## 8. Implementation sequence

1. Separate the user-list response from detail and credential responses.
2. Add the two dedicated endpoints and verify response field allowlists.
3. Add the User Details modal and per-row View Details action.
4. Add explicit password reveal/hide behavior and state clearing.
5. Add responsive styling and accessibility behavior.
6. Add API and browser tests for the acceptance criteria.
7. Update `docs/requirements.md` and `docs/Specs.md` if the implementation contract changes.
