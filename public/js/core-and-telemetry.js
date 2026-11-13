const STORAGE_KEY = 'vasool_clean_state_v1';
    const AUTH_TOKEN_KEY = 'vasool_jwt_token';

    // Pre-auth URL Hash Sanitization: prevent premature #admin routing for unauthenticated sessions
    if (typeof window !== 'undefined' && (window.location.hash === '#admin' || window.location.hash === '#tests')) {
      try {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (!token) {
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
          } else {
            window.location.hash = '';
          }
        }
      } catch {}
    }

    // Clear any obsolete browser service workers to ensure fresh code delivery
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((r) => r.unregister());
      }).catch(() => {});
    }

    // =========================================================================
    // OPENTELEMETRY RUM (REAL USER MONITORING) & DISTRIBUTED TRACE CONTEXT
    // =========================================================================
    function generateHex(len) {
      let result = '';
      const chars = '0123456789abcdef';
      for (let i = 0; i < len; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    const sessionTraceId = generateHex(32);

    function createTraceParent() {
      const spanId = generateHex(16);
      return {
        traceId: sessionTraceId,
        spanId,
        traceparent: `00-${sessionTraceId}-${spanId}-01`
      };
    }

    function reportRumTelemetry(data = {}) {
      try {
        const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
        const target = origin ? `${origin}/api/telemetry/rum` : '/api/telemetry/rum';
        fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }).catch(() => {});
      } catch {}
    }

    function recordRumAction(name, attributes = {}, durationMs = null) {
      const { traceId, spanId } = createTraceParent();
      reportRumTelemetry({
        spans: [
          {
            name,
            traceId,
            spanId,
            durationMs,
            attributes: {
              ...attributes,
              user_email: (appState && appState.currentUser) ? appState.currentUser.email : 'unauthenticated',
              screen: (typeof window !== 'undefined' && window.innerWidth < 640) ? 'mobile' : 'desktop'
            }
          }
        ],
        metrics: [
          {
            name: `vasool_rum_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_total`,
            value: 1,
            attributes
          }
        ]
      });
    }

    // Stream uncaught client runtime errors to Grafana Cloud Loki & OTel
    function forwardLogToBackend(level, message, meta = {}) {
      try {
        fetch('/api/logs/client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, message, meta })
        }).catch(() => {});

        if (level === 'error') {
          const { traceId, spanId } = createTraceParent();
          reportRumTelemetry({
            spans: [
              {
                name: 'Client Error',
                traceId,
                spanId,
                status: 'ERROR',
                error: message,
                attributes: meta
              }
            ],
            metrics: [
              { name: 'vasool_rum_errors_total', value: 1, attributes: { error: message.slice(0, 50) } }
            ]
          });
        }
      } catch {}
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        forwardLogToBackend('error', `[Frontend Error] ${event.message}`, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        forwardLogToBackend('error', `[Unhandled Promise] ${event.reason?.message || event.reason}`, {
          stack: event.reason?.stack
        });
      });
    }

    async function apiFetch(path, options = {}) {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const { traceparent } = createTraceParent();
      const headers = {
        'Content-Type': 'application/json',
        'traceparent': traceparent,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
      };
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null')
        ? window.location.origin
        : 'https://vasool-ecru.vercel.app';
      const fullUrl = path.startsWith('http') ? path : origin + (path.startsWith('/') ? path : '/' + path);
      const res = await fetch(fullUrl, { ...options, headers });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        const err = new Error(data.message || data.error || `HTTP ${res.status}: ${res.statusText}`);
        err.data = data;
        err.status = res.status;
        throw err;
      }
      return data;
    }

    async function syncWithBackend() {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) return;
      try {
        const groupsRes = await apiFetch('/api/groups');
        if (groupsRes && Array.isArray(groupsRes.groups)) {
          appState.groups = groupsRes.groups.map((g) => ({
            id: g._id ? g._id.toString() : g.id,
            name: g.name,
            category: g.category || 'Trip',
            currency: g.currency || 'INR',
            inviteCode: g.inviteCode,
            splitsVisibility: g.splitsVisibility || 'personal_only',
            minimizeDebts: g.minimizeDebts !== false,
            adminHubSettlement: Boolean(g.adminHubSettlement),
            allowMembersToAddOthers: Boolean(g.allowMembersToAddOthers),
            isArchived: Boolean(g.isArchived),
            adminEmail: g.adminEmail || (g.members?.find((m) => m.role === 'admin' || m.role === 'owner')?.email),
            members: (g.members || []).map((m) => ({
              name: m.name,
              email: m.email,
              role: m.role === 'owner' ? 'admin' : (m.role || 'member'),
              status: m.status || (m.role === 'admin' || m.role === 'owner' ? 'active' : 'pending_acceptance'),
              invitedAt: m.invitedAt || null,
              acceptedAt: m.acceptedAt || null,
              defaultWeight: m.defaultWeight || 1,
              upiId: m.upiId || ''
            }))
          }));
        }

        const expRes = await apiFetch('/api/expenses');
        if (expRes && Array.isArray(expRes.expenses)) {
          appState.expenses = expRes.expenses.map((e) => ({
            id: e._id ? e._id.toString() : e.id,
            groupId: e.groupId ? e.groupId.toString() : e.groupId,
            description: e.description,
            amount: e.amount,
            originalAmount: e.originalAmount || e.amount,
            originalCurrency: e.originalCurrency || e.currency || 'INR',
            exchangeRate: e.exchangeRate || 1,
            type: e.type || 'expense',
            category: e.category,
            parentExpenseId: e.parentExpenseId || null,
            parentExpenseDesc: e.parentExpenseDesc || '',
            paidByEmail: e.paidByEmail,
            paidByName: e.paidByName,
            paidByAllocations: Array.isArray(e.paidByAllocations) ? e.paidByAllocations : [],
            splitType: e.splitType || 'equal',
            roundingRemainder: e.roundingRemainder || 0,
            remainderAbsorbedBy: e.remainderAbsorbedBy || '',
            date: e.expenseDate ? e.expenseDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
            splits: (e.splits || []).map((s) => ({
              memberEmail: s.memberEmail,
              memberName: s.memberName,
              amount: s.amount,
              percentage: s.percentage,
              shares: s.shares,
              roundingAdjustment: s.roundingAdjustment || 0
            }))
          }));
        }

        const stlRes = await apiFetch('/api/settlements');
        if (stlRes && Array.isArray(stlRes.settlements)) {
          appState.settlements = stlRes.settlements.map((s) => ({
            id: s._id ? s._id.toString() : s.id,
            groupId: s.groupId ? s.groupId.toString() : s.groupId,
            fromEmail: s.fromEmail,
            fromName: s.fromName,
            toEmail: s.toEmail,
            toName: s.toName,
            amount: s.amount,
            currency: s.currency || 'INR',
            method: s.method,
            referenceNote: s.referenceNote,
            status: s.status || 'pending_admin_approval',
            confirmedAt: s.confirmedAt,
            confirmedByEmail: s.confirmedByEmail,
            rejectedReason: s.rejectedReason,
            settledAt: s.settledAt ? s.settledAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
          }));
        }

        const badge = document.getElementById('dbStatusBadge');
        if (badge) {
          badge.className = 'hidden';
          badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span> Live';
        }
        saveState();
        refreshAllViews();
      } catch (err) {
        console.warn('[Sync] Backend sync warning:', err.message);
      }
    }

    let currentSplitMode = 'equal';
    let currentExpenseType = 'expense';
    let activeMainTab = 'dashboard';
    let selectedGroupId = 'ALL';
    let showingAuthPortal = typeof localStorage !== 'undefined' ? !localStorage.getItem(AUTH_TOKEN_KEY) : true;
    let activeCurrency = 'INR';
    let activePipelineTab = 'github';
    let categoryChartInstance = null;
    let balancesChartInstance = null;
    let lastTestResults = [];

    const CURRENCY_META = {
      INR: { symbol: '₹', rate: 1, locale: 'en-IN' },
      USD: { symbol: '$', rate: 0.012, locale: 'en-US' },
      EUR: { symbol: '€', rate: 0.011, locale: 'de-DE' },
      GBP: { symbol: '£', rate: 0.0095, locale: 'en-GB' }
    };

    const PIPELINE_SNIPPETS = {
      github: `# .github/workflows/ci-cd.yml — GitHub Actions CI/CD Pipeline
name: Vasool Production CI/CD Pipeline
on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  lint-and-static-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18.x'
      - run: node --check server.js && node --check lib/splitEngine.js

  unit-and-integration-tests:
    needs: lint-and-static-analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node --test tests/unit.test.js
      - run: node --test tests/integration.test.js

  ui-e2e-browser-tests:
    needs: unit-and-integration-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright test || python3 tests/run_headless_ui_tests.py

  deploy-production:
    needs: ui-e2e-browser-tests
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Vercel with Infisical Secrets
        run: npx vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"`,

      gitlab: `# .gitlab-ci.yml — GitLab CI/CD Multi-Stage Pipeline
stages:
  - quality
  - test
  - e2e
  - deploy

unit_and_integration_tests:
  stage: test
  image: node:18-alpine
  script:
    - node --test tests/unit.test.js
    - node --test tests/integration.test.js

ui_e2e_tests:
  stage: e2e
  image: mcr.microsoft.com/playwright:v1.42.0-jammy
  script:
    - npx playwright test

deploy_vercel_prod:
  stage: deploy
  image: node:18-alpine
  only:
    - main
  script:
    - npx vercel --prod --yes --token "$VERCEL_TOKEN"`,

      docker: `# Dockerfile — Production Container + Healthcheck
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache bash curl ca-certificates
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]`,

      infisical: `# scripts/start-with-infisical.sh — Zero-Plaintext Vault Proxy
#!/usr/bin/env bash
set -euo pipefail

infisical agent-vault proxy \\
  --enrollment-token avp_XMX7kOJX_sGpRChlDz5bHwHjRHsWb0z80tap-ojRGf8 \\
  --domain https://app.infisical.com &

PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null || true" EXIT
sleep 2
exec node server.js`
    };

    function createDefaultState() {
      return {
        currentUser: null,
        users: [],
        groups: [],
        expenses: [],
        settlements: []
      };
    }

    function getMockSampleState() {
      return {
        currentUser: {
          id: 'usr_zubair_01',
          name: 'Zubair Mohammed',
          email: 'mrzoromit3@gmail.com',
          authProviders: ['email'],
          upiId: 'zubair@amazonpay'
        },
        users: [
          {
            id: 'usr_zubair_01',
            name: 'Zubair Mohammed',
            email: 'mrzoromit3@gmail.com',
            passwordHash: 'Vasool#2026',
            authProviders: ['email'],
            upiId: 'zubair@amazonpay'
          },
          {
            id: 'usr_omkar_02',
            name: 'Omkar Chinnam',
            email: 'omkar.chinnam@gmail.com',
            passwordHash: 'OmkarPass#2026',
            authProviders: ['email'],
            upiId: 'omkar@okicici'
          },
          {
            id: 'usr_krutika_03',
            name: 'Krutika Morande',
            email: 'krutika.morande@gmail.com',
            passwordHash: 'Krutika#2026',
            authProviders: ['email'],
            upiId: 'krutika@ybl'
          },
          {
            id: 'usr_anshuman_04',
            name: 'Anshuman Barik',
            email: 'anshuman.barik@gmail.com',
            passwordHash: 'Anshuman#2026',
            authProviders: ['email'],
            upiId: 'anshuman@okaxis'
          }
        ],
        groups: [
          {
            id: 'grp_goa_trip',
            name: 'Goa Weekend Getaway',
            category: 'Trip',
            currency: 'INR',
            inviteCode: 'SPL-GOA92',
            splitsVisibility: 'personal_only',
            adminEmail: 'mrzoromit3@gmail.com',
            members: [
              { name: 'Zubair Mohammed', email: 'mrzoromit3@gmail.com', role: 'admin' },
              { name: 'Omkar Chinnam', email: 'omkar.chinnam@gmail.com', role: 'member' },
              { name: 'Krutika Morande', email: 'krutika.morande@gmail.com', role: 'member' },
              { name: 'Anshuman Barik', email: 'anshuman.barik@gmail.com', role: 'member' }
            ]
          },
          {
            id: 'grp_hyd_flat',
            name: 'Hyderabad Flat 402 Utilities',
            category: 'Home',
            currency: 'INR',
            inviteCode: 'SPL-HYD402',
            splitsVisibility: 'personal_only',
            adminEmail: 'mrzoromit3@gmail.com',
            members: [
              { name: 'Zubair Mohammed', email: 'mrzoromit3@gmail.com', role: 'admin' },
              { name: 'Omkar Chinnam', email: 'omkar.chinnam@gmail.com', role: 'member' },
              { name: 'Anshuman Barik', email: 'anshuman.barik@gmail.com', role: 'member' }
            ]
          },
          {
            id: 'grp_lunch_crew',
            name: 'Hitech City Team Lunches',
            category: 'Project',
            currency: 'INR',
            inviteCode: 'SPL-LUNCH7',
            splitsVisibility: 'personal_only',
            adminEmail: 'mrzoromit3@gmail.com',
            members: [
              { name: 'Zubair Mohammed', email: 'mrzoromit3@gmail.com', role: 'admin' },
              { name: 'Krutika Morande', email: 'krutika.morande@gmail.com', role: 'member' },
              { name: 'Omkar Chinnam', email: 'omkar.chinnam@gmail.com', role: 'member' }
            ]
          }
        ],
        expenses: [
          {
            id: 'exp_101',
            groupId: 'grp_goa_trip',
            description: 'Beachfront Villa Booking (3 Nights)',
            amount: 14400,
            category: 'Travel & Stay',
            paidByEmail: 'mrzoromit3@gmail.com',
            paidByName: 'Zubair Mohammed',
            splitType: 'equal',
            date: '2026-10-14',
            splits: [
              { memberEmail: 'mrzoromit3@gmail.com', memberName: 'Zubair Mohammed', amount: 3600 },
              { memberEmail: 'omkar.chinnam@gmail.com', memberName: 'Omkar Chinnam', amount: 3600 },
              { memberEmail: 'krutika.morande@gmail.com', memberName: 'Krutika Morande', amount: 3600 },
              { memberEmail: 'anshuman.barik@gmail.com', memberName: 'Anshuman Barik', amount: 3600 }
            ]
          },
          {
            id: 'exp_102',
            groupId: 'grp_goa_trip',
            description: 'Scooter Rentals & Fuel',
            amount: 3200,
            category: 'Travel & Stay',
            paidByEmail: 'omkar.chinnam@gmail.com',
            paidByName: 'Omkar Chinnam',
            splitType: 'equal',
            date: '2026-10-15',
            splits: [
              { memberEmail: 'mrzoromit3@gmail.com', memberName: 'Zubair Mohammed', amount: 800 },
              { memberEmail: 'omkar.chinnam@gmail.com', memberName: 'Omkar Chinnam', amount: 800 },
              { memberEmail: 'krutika.morande@gmail.com', memberName: 'Krutika Morande', amount: 800 },
              { memberEmail: 'anshuman.barik@gmail.com', memberName: 'Anshuman Barik', amount: 800 }
            ]
          },
          {
            id: 'exp_103',
            groupId: 'grp_hyd_flat',
            description: 'ACT Fibernet Broadband & Electricity Bill',
            amount: 2700,
            category: 'Rent & Utilities',
            paidByEmail: 'mrzoromit3@gmail.com',
            paidByName: 'Zubair Mohammed',
            splitType: 'percentage',
            date: '2026-10-16',
            splits: [
              { memberEmail: 'mrzoromit3@gmail.com', memberName: 'Zubair Mohammed', amount: 900, percentage: 33.33 },
              { memberEmail: 'omkar.chinnam@gmail.com', memberName: 'Omkar Chinnam', amount: 900, percentage: 33.33 },
              { memberEmail: 'anshuman.barik@gmail.com', memberName: 'Anshuman Barik', amount: 900, percentage: 33.34 }
            ]
          },
          {
            id: 'exp_104',
            groupId: 'grp_lunch_crew',
            description: 'Shah Ghouse Special Biryani & Irani Chai',
            amount: 1650,
            category: 'Food & Dining',
            paidByEmail: 'krutika.morande@gmail.com',
            paidByName: 'Krutika Morande',
            splitType: 'exact',
            date: '2026-10-17',
            splits: [
              { memberEmail: 'mrzoromit3@gmail.com', memberName: 'Zubair Mohammed', amount: 550 },
              { memberEmail: 'krutika.morande@gmail.com', memberName: 'Krutika Morande', amount: 550 },
              { memberEmail: 'omkar.chinnam@gmail.com', memberName: 'Omkar Chinnam', amount: 550 }
            ]
          }
        ],
        settlements: [
          {
            id: 'stl_01',
            groupId: 'grp_goa_trip',
            fromEmail: 'anshuman.barik@gmail.com',
            fromName: 'Anshuman Barik',
            toEmail: 'mrzoromit3@gmail.com',
            toName: 'Zubair Mohammed',
            amount: 1500,
            currency: 'INR',
            method: 'Amazon Pay',
            referenceNote: 'Partial villa settlement via Amazon Pay UPI',
            status: 'confirmed',
            confirmedAt: '2026-10-16',
            confirmedByEmail: 'mrzoromit3@gmail.com',
            settledAt: '2026-10-16'
          }
        ]
      };
    }

    let appState = createDefaultState();
    const SUPER_ADMIN_EMAIL = 'mdzubair7592@gmail.com';

    function isSuperAdminUser(user) {
      if (!user) return false;
      const email = (user.email || '').toLowerCase().trim();
      return Boolean(user.isSuperAdmin) || user.role === 'super_admin' || email === SUPER_ADMIN_EMAIL.toLowerCase();
    }

    if (typeof window !== 'undefined') {
      window.appState = appState;
      window.isSuperAdminUser = isSuperAdminUser;
      window.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.groups) && Array.isArray(parsed.expenses)) {
            appState = parsed;
            if (typeof window !== 'undefined') window.appState = appState;
          }
        }
      } catch (err) {
        // Fallback to in-memory default state
      }
      if (typeof localStorage !== 'undefined' && !localStorage.getItem(AUTH_TOKEN_KEY)) {
        appState.currentUser = null;
      }
    }

    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      } catch (err) {
        // Ignore storage quota errors in sandboxed iframes
      }
      updateCloudInspector();
    }

    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      if (!container) return;
      const toast = document.createElement('div');
      const colorClasses =
        type === 'error'
          ? 'bg-rose-950/95 border-rose-500/50 text-rose-200'
          : 'bg-slate-900/95 border-emerald-500/50 text-emerald-200';
      toast.className = `pointer-events-auto px-4 py-3 rounded-xl border shadow-xl text-xs font-medium flex items-center justify-between gap-3 transition-all duration-300 ${colorClasses}`;
      toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
      }, 3200);
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function handleCurrencyChange(curr) {
      if (CURRENCY_META[curr]) {
        activeCurrency = curr;
        refreshAllViews();
        showToast(`Display currency switched to ${curr}`);
      }
    }

    function formatINR(val) {
      const meta = CURRENCY_META[activeCurrency] || CURRENCY_META.INR;
      const num = (Number(val) || 0) * meta.rate;
      const sign = num < 0 ? '-' : '';
      return sign + meta.symbol + Math.abs(num).toLocaleString(meta.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Pure helper functions exposed for Unit & Integration Testing
    function calculatePureSplitAllocations(totalAmount, splitMode, participants) {
      const total = Number(totalAmount);
      if (!Number.isFinite(total) || total <= 0) {
        throw new Error('Total expense amount must be greater than zero.');
      }
      if (!Array.isArray(participants) || participants.length === 0) {
        throw new Error('At least one participant is required.');
      }
      const mode = String(splitMode || 'equal').toLowerCase();
      let allocations = [];
      if (mode === 'equal') {
        const count = participants.length;
        const rawEach = Math.floor((total / count) * 100) / 100;
        allocations = participants.map((p) => ({
          memberEmail: String(p.memberEmail || p.email).toLowerCase().trim(),
          memberName: String(p.memberName || p.name).trim(),
          amount: rawEach
        }));
      } else if (mode === 'exact') {
        allocations = participants.map((p) => ({
          memberEmail: String(p.memberEmail || p.email).toLowerCase().trim(),
          memberName: String(p.memberName || p.name).trim(),
          amount: Math.round((Number(p.amount) || 0) * 100) / 100
        }));
      } else if (mode === 'percentage') {
        const pctSum = participants.reduce((a, p) => a + (Number(p.percentage) || 0), 0);
        if (Math.abs(pctSum - 100) > 0.5) throw new Error('Percentages must sum to 100%');
        allocations = participants.map((p) => ({
          memberEmail: String(p.memberEmail || p.email).toLowerCase().trim(),
          memberName: String(p.memberName || p.name).trim(),
          amount: Math.round(((total * (Number(p.percentage) || 0)) / 100) * 100) / 100
        }));
      } else if (mode === 'shares') {
        const totalShares = participants.reduce((a, p) => a + (Number(p.shares) || 0), 0);
        if (totalShares <= 0) throw new Error('Total shares must be positive');
        allocations = participants.map((p) => ({
          memberEmail: String(p.memberEmail || p.email).toLowerCase().trim(),
          memberName: String(p.memberName || p.name).trim(),
          amount: Math.round(((total * (Number(p.shares) || 0)) / totalShares) * 100) / 100
        }));
      }
      const sum = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
      const diff = Math.round((total - sum) * 100) / 100;
      if (Math.abs(diff) > 0.15) {
        throw new Error('Split sum does not match total bill');
      }
      if (Math.abs(diff) > 0 && allocations.length > 0) {
        allocations[0].amount = Math.round((allocations[0].amount + diff) * 100) / 100;
        allocations[0].roundingAdjustment = diff;
      }
      return allocations;
    }
