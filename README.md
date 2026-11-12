# Vasool v2.9 Aurora UI — Full-Stack Smart Expense Splitting & Debt Simplification Platform

Full-stack expense splitting and debt simplification web application built with **Node.js, Express, MongoDB (Mongoose), Tailwind CSS**, and **Infisical Agent Vault** secret management.
## What's New in Vasool v2.9
- Aurora Obsidian & Emerald Luxe UI (`Plus Jakarta Sans`, Bento KPI cards, unified glass command bar, and header persona switcher)
- Prominent Sign Out controls in top header & Account Settings with live net balance preview modal
- In-place Expense Editing (`PUT /api/expenses/:id`) & 1-Click Undo Delete
- 7-Currency Per-Bill FX Conversion & Linked Refund Accounting (`parentExpenseId`)
- Partial Settlement Confirmation (`receivedAmount` & `adminNote`), Group Activity & Audit Trail (`auditLog`), Printable PDF Group Statement Summary, and Interactive Chart Drill-Downs.
## Key Features
- **Dual Authentication (`/api/auth/*`)**:
  - **Email & Password Signup/Login**: Bcrypt 12-round salted password hashing + signed 7-day JWT tokens.
  - **Google Sign-Up & Sign-In**: OAuth 2.0 ID token verification via `google-auth-library` (`OAuth2Client.verifyIdToken`) with automatic account creation and provider linking by email.
- **MongoDB Atlas Persistence (`models/*`, `lib/mongodb.js`)**:
  - Global connection pool caching (`global._mongooseConnectionCache`) optimized for both **Vercel Fluid Compute / Serverless Functions** and persistent **Render Web Services**.
  - Schemas for `User`, `Group`, `Expense` (4 split modes: `equal`, `exact`, `percentage`, `shares`), and `Settlement` (`UPI`, `Amazon Pay`, `Bank Transfer`, `Cash`).
- **Minimum-Cash-Flow Debt Simplification Engine**:
  - Automatically computes net balances across group members and minimizes the total number of settlement transfers needed.
- **Infisical Vault Integration (`infisical-agent.sh`)**:
  - Pre-configured with your enrollment token to start the Infisical Agent-Vault proxy or inject secrets directly into process memory.

## Quick Start with Infisical Vault

1. **Start the Infisical Agent-Vault Proxy**:
   ```bash
   ./infisical-agent.sh proxy
   ```
   Or run directly:
   ```bash
   infisical agent-vault proxy \
     --enrollment-token avp_XMX7kOJX_sGpRChlDz5bHwHjRHsWb0z80tap-ojRGf8 \
     --domain https://app.infisical.com
   ```

2. **Install Dependencies & Run with Injected Secrets**:
   ```bash
   npm install
   ./infisical-agent.sh dev
   ```

3. **Deploy to Vercel (Recommended) or Render**:
   - **Vercel**: Includes `vercel.json` and `api/index.js`. Sync secrets via the Infisical-Vercel integration or run `./infisical-agent.sh deploy-vercel`.
   - **Render**: Includes `render.yaml` Blueprint for zero-config deployment.
