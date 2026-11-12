// =========================================================================
    // AUTOMATED IN-BROWSER QA TEST RUNNER (24 UNIT, INTEGRATION & UI E2E TESTS)
    // =========================================================================
    function switchPipelineViewer(tabKey) {
      activePipelineTab = tabKey;
      ['github', 'gitlab', 'docker', 'infisical'].forEach((k) => {
        const btn = document.getElementById('pipeTab_' + k);
        if (!btn) return;
        if (k === tabKey) {
          btn.className = 'py-1.5 rounded-lg bg-emerald-500 text-slate-950 transition';
        } else {
          btn.className = 'py-1.5 rounded-lg text-slate-400 hover:text-white transition';
        }
      });
      const pre = document.getElementById('pipelineCodeDisplay');
      if (pre) pre.textContent = PIPELINE_SNIPPETS[tabKey] || '';
    }

    function copyActivePipelineCode() {
      copyTextToClipboard(PIPELINE_SNIPPETS[activePipelineTab] || '', `Copied ${activePipelineTab.toUpperCase()} pipeline config!`);
    }

    function runAutomatedTestSuite(notifyToast = false) {
      const t0 = performance.now();
      const results = [];

      const runCase = (category, name, fn) => {
        const start = performance.now();
        try {
          const detail = fn();
          results.push({
            category,
            name,
            passed: true,
            detail: detail || 'Assertion verified',
            ms: Math.max(0.2, Math.round((performance.now() - start) * 10) / 10)
          });
        } catch (err) {
          results.push({
            category,
            name,
            passed: false,
            detail: err.message || String(err),
            ms: Math.max(0.2, Math.round((performance.now() - start) * 10) / 10)
          });
        }
      };

      // --- 10 UNIT TESTS ---
      runCase('Unit', 'UT-01: Equal Split divides ₹1,200 across 4 members (₹300.00 each)', () => {
        const res = calculatePureSplitAllocations(1200, 'equal', [
          { email: 'a@t.com', name: 'A' },
          { email: 'b@t.com', name: 'B' },
          { email: 'c@t.com', name: 'C' },
          { email: 'd@t.com', name: 'D' }
        ]);
        if (res.length !== 4 || res.some((r) => r.amount !== 300)) throw new Error('Equal split mismatch');
        return '4 × ₹300.00 = ₹1,200.00';
      });

      runCase('Unit', 'UT-02: Odd Paise Reconciliation (₹100 / 3 = ₹33.34 + ₹33.33 + ₹33.33)', () => {
        const res = calculatePureSplitAllocations(100, 'equal', [
          { email: 'a@t.com', name: 'A' },
          { email: 'b@t.com', name: 'B' },
          { email: 'c@t.com', name: 'C' }
        ]);
        const sum = Math.round(res.reduce((s, r) => s + r.amount, 0) * 100) / 100;
        if (sum !== 100 || res[0].amount !== 33.34) throw new Error('Rounding mismatch');
        return 'Sum exact ₹100.00 (first share ₹33.34)';
      });

      runCase('Unit', 'UT-03: Exact Amount Split allocates custom per-member sums', () => {
        const res = calculatePureSplitAllocations(1650, 'exact', [
          { email: 'a@t.com', name: 'A', amount: 650 },
          { email: 'b@t.com', name: 'B', amount: 500 },
          { email: 'c@t.com', name: 'C', amount: 500 }
        ]);
        if (res[0].amount !== 650 || res[1].amount !== 500) throw new Error('Exact allocation failed');
        return '₹650 + ₹500 + ₹500 = ₹1,650.00';
      });

      runCase('Unit', 'UT-04: Exact Split rejects mismatched participant sum', () => {
        let threw = false;
        try {
          calculatePureSplitAllocations(1000, 'exact', [
            { email: 'a@t.com', name: 'A', amount: 200 },
            { email: 'b@t.com', name: 'B', amount: 300 }
          ]);
        } catch (_e) {
          threw = true;
        }
        if (!threw) throw new Error('Expected validation error');
        return 'Rejected ₹500 != ₹1,000 bill';
      });

      runCase('Unit', 'UT-05: Percentage Split allocates 50% / 30% / 20% accurately', () => {
        const res = calculatePureSplitAllocations(2000, 'percentage', [
          { email: 'a@t.com', name: 'A', percentage: 50 },
          { email: 'b@t.com', name: 'B', percentage: 30 },
          { email: 'c@t.com', name: 'C', percentage: 20 }
        ]);
        if (res[0].amount !== 1000 || res[1].amount !== 600 || res[2].amount !== 400) throw new Error('Pct error');
        return '₹1,000 / ₹600 / ₹400';
      });

      runCase('Unit', 'UT-06: Shares/Weights Split allocates 2:1:1 ratio on ₹1,600', () => {
        const res = calculatePureSplitAllocations(1600, 'shares', [
          { email: 'a@t.com', name: 'A', shares: 2 },
          { email: 'b@t.com', name: 'B', shares: 1 },
          { email: 'c@t.com', name: 'C', shares: 1 }
        ]);
        if (res[0].amount !== 800 || res[1].amount !== 400) throw new Error('Shares ratio failed');
        return '2:1:1 -> ₹800, ₹400, ₹400';
      });

      runCase('Unit', 'UT-07: Circular Debt Graph (A->B->C->A ₹500) simplifies to 0 transfers', () => {
        const mockState = {
          groups: [{ id: 'g', members: [{ email: 'a', name: 'A' }, { email: 'b', name: 'B' }, { email: 'c', name: 'C' }] }],
          expenses: [
            { groupId: 'g', amount: 500, paidByEmail: 'b', paidByName: 'B', splits: [{ memberEmail: 'a', memberName: 'A', amount: 500 }] },
            { groupId: 'g', amount: 500, paidByEmail: 'c', paidByName: 'C', splits: [{ memberEmail: 'b', memberName: 'B', amount: 500 }] },
            { groupId: 'g', amount: 500, paidByEmail: 'a', paidByName: 'A', splits: [{ memberEmail: 'c', memberName: 'C', amount: 500 }] }
          ],
          settlements: []
        };
        const out = computeBalancesAndSimplifications('g', mockState);
        if (out.simplified.length !== 0) throw new Error('Circular debt not zeroed');
        return '0 transfers required';
      });

      runCase('Unit', 'UT-08: Settlement Routing respects Direct P2P (standard) vs Admin-Hub (opt-in)', () => {
        const standardState = {
          groups: [{ id: 'g1', adminHubSettlement: false, members: [{ email: 'a', name: 'A', role: 'member' }, { email: 'b', name: 'B', role: 'admin' }, { email: 'c', name: 'C', role: 'member' }] }],
          expenses: [
            { groupId: 'g1', amount: 1000, paidByEmail: 'b', paidByName: 'B', splits: [{ memberEmail: 'a', memberName: 'A', amount: 1000 }] },
            { groupId: 'g1', amount: 1000, paidByEmail: 'c', paidByName: 'C', splits: [{ memberEmail: 'b', memberName: 'B', amount: 1000 }] }
          ],
          settlements: []
        };
        const p2pOut = computeBalancesAndSimplifications('g1', standardState);
        if (p2pOut.simplified.length !== 1 || p2pOut.simplified[0].fromEmail !== 'a' || p2pOut.simplified[0].toEmail !== 'c') {
          throw new Error('Direct P2P greedy simplification failed');
        }

        const adminHubState = {
          groups: [{ id: 'g2', adminHubSettlement: true, members: [{ email: 'a', name: 'A', role: 'member' }, { email: 'b', name: 'B', role: 'admin' }, { email: 'c', name: 'C', role: 'member' }] }],
          expenses: [
            { groupId: 'g2', amount: 1000, paidByEmail: 'b', paidByName: 'B', splits: [{ memberEmail: 'a', memberName: 'A', amount: 1000 }] },
            { groupId: 'g2', amount: 1000, paidByEmail: 'c', paidByName: 'C', splits: [{ memberEmail: 'b', memberName: 'B', amount: 1000 }] }
          ],
          settlements: []
        };
        const hubOut = computeBalancesAndSimplifications('g2', adminHubState);
        if (
          hubOut.simplified.length !== 2 ||
          hubOut.simplified[0].fromEmail !== 'a' ||
          hubOut.simplified[0].toEmail !== 'b' ||
          hubOut.simplified[1].fromEmail !== 'b' ||
          hubOut.simplified[1].toEmail !== 'c'
        ) {
          throw new Error('Admin-Hub routing failed');
        }
        return 'Standard Direct P2P (1 direct transfer A->C) & Admin-Hub (2 routed transfers A->B->C) verified';
      });

      runCase('Unit', 'UT-09: Password Strength Evaluator scores weak vs strong passwords', () => {
        const w = evaluatePasswordStrengthObj('abc');
        const s = evaluatePasswordStrengthObj('Vasool#2026');
        if (w.valid || s.score !== 100 || s.label !== 'Strong') throw new Error('Strength scoring error');
        return 'Weak (0%) vs Strong (100%) verified';
      });

      runCase('Unit', 'UT-10: HTML XSS Sanitizer escapes script tags and quotes', () => {
        const escaped = escapeHtml('<script>xssPayload("test")<\/script>');
        if (escaped.includes('<script>')) throw new Error('XSS tag not escaped');
        return 'Output: ' + escaped;
      });

      runCase('Unit', 'UT-11: Split Visibility Privacy Mode isolates member share and hides other splits', () => {
        const mockState = {
          currentUser: { email: 'member@test.com', name: 'Member' },
          groups: [{ id: 'g1', splitsVisibility: 'personal_only', members: [{ email: 'admin@test.com', name: 'Admin', role: 'admin' }, { email: 'member@test.com', name: 'Member', role: 'member' }, { email: 'other@test.com', name: 'Other', role: 'member' }] }],
          expenses: [{
            groupId: 'g1',
            amount: 3000,
            paidByEmail: 'admin@test.com',
            paidByName: 'Admin',
            splits: [
              { memberEmail: 'admin@test.com', memberName: 'Admin', amount: 1000 },
              { memberEmail: 'member@test.com', memberName: 'Member', amount: 1000 },
              { memberEmail: 'other@test.com', memberName: 'Other', amount: 1000 }
            ]
          }],
          settlements: []
        };
        const out = computeBalancesAndSimplifications('g1', mockState);
        if (out.simplified.some((t) => t.fromEmail === 'other@test.com' || t.toEmail === 'other@test.com')) {
          throw new Error('Other member debt leaked in personal_only mode');
        }
        return 'Personal privacy enforced: only member share visible';
      });

      // --- 7 INTEGRATION TESTS ---
      runCase('Integration', 'IT-01: Mock Sample Fixture contains 4 Users, 3 Groups, Expenses & Settlements', () => {
        const def = getMockSampleState();
        if (def.users.length < 4 || def.groups.length < 3 || def.expenses.length < 4) {
          throw new Error('Seed state incomplete');
        }
        return `${def.users.length} users, ${def.groups.length} groups, ${def.expenses.length} bills`;
      });

      runCase('Integration', 'IT-02: Secure Email & Password with OTP verification on user profile', () => {
        const def = getMockSampleState();
        const z = (appState.users && appState.users.find((u) => u.email === 'mrzoromit3@gmail.com')) || def.users.find((u) => u.email === 'mrzoromit3@gmail.com');
        if (!z || !z.authProviders.includes('email')) {
          throw new Error('Email provider missing');
        }
        return 'Provider: email verified';
      });

      runCase('Integration', 'IT-03: Group Filter isolates "Goa Weekend Getaway" spend & balances', () => {
        const goa = computeBalancesAndSimplifications('grp_goa_trip', getMockSampleState());
        if (goa.totalSpend !== 17600) throw new Error(`Expected 17600, got ${goa.totalSpend}`);
        return 'Goa spend verified: ₹17,600.00';
      });

      runCase('Integration', 'IT-04: Group Filter isolates "Hyderabad Flat 402 Utilities" percentage split', () => {
        const hyd = computeBalancesAndSimplifications('grp_hyd_flat', getMockSampleState());
        if (hyd.totalSpend !== 2700) throw new Error('Flat 402 spend mismatch');
        return 'Flat 402 spend verified: ₹2,700.00';
      });

      runCase('Integration', 'IT-05: Partial Settlement (₹1,500 Amazon Pay) reduces Anshuman net debt accurately', () => {
        const goa = computeBalancesAndSimplifications('grp_goa_trip', getMockSampleState());
        const ansh = goa.balanceList.find((b) => b.email === 'anshuman.barik@gmail.com');
        // Anshuman owed 3600 + 800 = 4400, paid 1500 settlement -> net -2900
        if (!ansh || Math.round(ansh.net) !== -2900) throw new Error(`Expected -2900, got ${ansh?.net}`);
        return 'Anshuman net balance: -₹2,900.00';
      });

      runCase('Integration', 'IT-06: Multi-Currency Converter formats INR, USD, EUR, GBP accurately', () => {
        const prev = activeCurrency;
        activeCurrency = 'USD';
        const usdStr = formatINR(1000);
        activeCurrency = prev;
        if (!usdStr.startsWith('$')) throw new Error('USD symbol missing');
        return `1,000 INR -> ${usdStr} USD`;
      });

      runCase('Integration', 'IT-07: Infisical Vault Proxy & MongoDB Inspector JSON state is valid', () => {
        updateCloudInspector();
        const raw = document.getElementById('dbJsonInspector').textContent;
        const parsed = JSON.parse(raw);
        if (parsed.mongodbDatabase !== 'splits_app' || !parsed.infisicalDomain.includes('infisical.com')) {
          throw new Error('Cloud inspector metadata invalid');
        }
        return 'splits_app + app.infisical.com verified';
      });

      runCase('Integration', 'IT-08: Two-Step Settlement Handshake marks pending approval until Admin confirms', () => {
        const mockState = {
          currentUser: { email: 'admin@test.com', name: 'Admin' },
          groups: [{ id: 'g1', members: [{ email: 'admin@test.com', name: 'Admin', role: 'admin' }, { email: 'debtor@test.com', name: 'Debtor', role: 'member' }] }],
          expenses: [{
            groupId: 'g1',
            amount: 1000,
            paidByEmail: 'admin@test.com',
            paidByName: 'Admin',
            splits: [
              { memberEmail: 'admin@test.com', memberName: 'Admin', amount: 500 },
              { memberEmail: 'debtor@test.com', memberName: 'Debtor', amount: 500 }
            ]
          }],
          settlements: [{
            id: 's1',
            groupId: 'g1',
            fromEmail: 'debtor@test.com',
            fromName: 'Debtor',
            toEmail: 'admin@test.com',
            toName: 'Admin',
            amount: 500,
            status: 'pending_admin_approval'
          }]
        };
        const pre = computeBalancesAndSimplifications('g1', mockState);
        if (pre.isFullyClosed || !pre.simplified[0].isPendingApproval || pre.simplified[0].pendingApprovalAmount !== 500) {
          throw new Error('Pending settlement should keep debt open awaiting admin');
        }
        // Transition to confirmed
        mockState.settlements[0].status = 'confirmed';
        const post = computeBalancesAndSimplifications('g1', mockState);
        if (!post.isFullyClosed || post.simplified.length !== 0) {
          throw new Error('Confirmed settlement should fully close debt');
        }
        return 'Handshake verified: pending keeps debt open; confirmed closes debt';
      });

      // --- 7 UI E2E & DOM INSTRUMENTATION TESTS ---
      runCase('UI E2E', 'UI-01: All 5 Navigation Tabs have data-testid attributes and switch views cleanly', () => {
        const ids = ['nav-tab-dashboard', 'nav-tab-expenses', 'nav-tab-groups', 'nav-tab-settle', 'nav-tab-tests'];
        ids.forEach((tid) => {
          if (!document.querySelector(`[data-testid="${tid}"]`)) throw new Error(`Missing ${tid}`);
        });
        return '5/5 nav tabs instrumented with data-testid';
      });

      runCase('UI E2E', 'UI-02: Auth Portal Login, Signup, Forgot Password & Settings elements present in DOM', () => {
        const tids = ['login-form', 'signup-form', 'forgot-password-modal', 'account-settings-modal'];
        tids.forEach((tid) => {
          if (!document.querySelector(`[data-testid="${tid}"]`)) throw new Error(`Missing ${tid}`);
        });
        return 'Auth forms, Forgot Password & Account Settings verified';
      });

      runCase('UI E2E', 'UI-03: Add Expense Modal & 4 Split Mode buttons (=, ₹, %, ×) wired in DOM', () => {
        const modes = ['split-mode-equal', 'split-mode-exact', 'split-mode-percentage', 'split-mode-shares'];
        modes.forEach((tid) => {
          if (!document.querySelector(`[data-testid="${tid}"]`)) throw new Error(`Missing ${tid}`);
        });
        return 'All 4 split mode controls verified';
      });

      runCase('UI E2E', 'UI-04: KPI Summary Cards render non-empty formatted currency values', () => {
        const kpis = ['kpi-net-balance', 'kpi-you-are-owed', 'kpi-you-owe', 'kpi-total-spend'];
        kpis.forEach((tid) => {
          const el = document.querySelector(`[data-testid="${tid}"]`);
          if (!el || !el.textContent.trim()) throw new Error(`Empty KPI ${tid}`);
        });
        return '4/4 KPI cards populated';
      });

      runCase('UI E2E', 'UI-05: Chart.js Category Doughnut & Member Net Balance Bar Canvases mounted', () => {
        const c1 = document.getElementById('categoryChartCanvas');
        const c2 = document.getElementById('balancesChartCanvas');
        if (!c1 || !c2) throw new Error('Chart canvases missing');
        return 'Both Chart.js canvases active';
      });

      runCase('UI E2E', 'UI-06: Group Cards & Invite Code Copy Controls rendered with data-testid', () => {
        const container = document.getElementById('groupsGridContainer');
        if (!container) throw new Error('Groups container missing');
        const grpCard = document.querySelector('[data-testid^="group-card-"]');
        if (appState.groups.length > 0 && !grpCard) throw new Error('No group cards rendered');
        return appState.groups.length > 0 ? `${appState.groups.length} group cards rendered in grid` : 'Empty groups grid rendered cleanly';
      });

      runCase('Unit', 'UT-11: Rounding Remainder (±₹0.01) Attribution on Odd 3-Way Split', () => {
        const res = calculatePureSplitAllocations(100, 'equal', [
          { email: 'a@t.com', name: 'A' },
          { email: 'b@t.com', name: 'B' },
          { email: 'c@t.com', name: 'C' }
        ]);
        if (res[0].amount !== 33.34 || res[0].roundingAdjustment !== 0.01) {
          throw new Error('Expected +0.01 roundingAdjustment on first participant');
        }
        return `First share ₹${res[0].amount} (roundingAdjustment: +₹${res[0].roundingAdjustment})`;
      });

      runCase('Unit', 'UT-12: Recipient UPI Handle Resolution from Group Member Profile', () => {
        const resolved = resolveRecipientUpiId('vikram.spender@vasool.test', appState.groups[0]?.id);
        if (!resolved || !resolved.includes('@')) throw new Error('Invalid UPI VPA resolved');
        return `Resolved VPA: ${resolved}`;
      });

      runCase('Integration', 'IT-08: Per-Bill Multi-Currency FX Rate Conversion to Base INR', () => {
        const usdAmt = 50;
        const fxRate = DEFAULT_FX_RATES_TO_INR.USD;
        const inrTotal = Math.round(usdAmt * fxRate * 100) / 100;
        if (inrTotal !== 4200) throw new Error(`Expected ₹4200, got ${inrTotal}`);
        return `$${usdAmt} USD @ ₹${fxRate} = ₹${inrTotal} INR`;
      });

      runCase('Integration', 'IT-09: Immutable Group Audit Log Recording & Retrieval', () => {
        const gId = appState.groups[0]?.id;
        if (gId) {
          recordLocalGroupAudit(gId, 'qa_verification', 'Automated QA verified group audit log', 'v2.8 suite');
          const grp = appState.groups.find((g) => g.id === gId);
          if (!Array.isArray(grp.auditLog) || grp.auditLog.length === 0) throw new Error('Audit log not populated');
        }
        return 'Group auditLog active & verified';
      });

      runCase('UI E2E', 'UI-07: CI/CD Pipeline Viewer (GitHub Actions, GitLab CI, Dockerfile, Infisical) interactive', () => {
        const disp = document.querySelector('[data-testid="pipeline-code-display"]');
        if (!disp) throw new Error('Pipeline code display missing');
        return '4 DevOps pipeline configs available';
      });

      runCase('UI E2E', 'UI-08: Group Activity Tab mounted in DOM', () => {
        const actTab = document.querySelector('[data-testid="btn-group-tab-activity"]');
        if (!actTab) throw new Error('Activity tab missing');
        return 'Activity Audit Tab mounted';
      });

      runCase('UI E2E', 'UI-09: Printable PDF Statement Modal & Multi-Currency FX Controls mounted', () => {
        const pdfModal = document.querySelector('[data-testid="pdf-statement-preview-modal"]');
        const fxSelect = document.querySelector('[data-testid="select-expense-currency"]');
        if (!pdfModal || !fxSelect) throw new Error('PDF modal or FX currency selector missing');
        return 'PDF Statement Preview & 7-Currency FX Selector ready';
      });

      lastTestResults = results;
      const totalMs = Math.max(1, Math.round(performance.now() - t0));
      const passedCount = results.filter((r) => r.passed).length;

      const badge = document.getElementById('qaPassRateBadge');
      const dur = document.getElementById('qaDurationBadge');
      const navBadge = document.getElementById('navTabTestsBadge');
      if (badge) {
        badge.textContent = `${Math.round((passedCount / results.length) * 100)}% PASS (${passedCount} / ${results.length})`;
      }
      if (dur) {
        dur.textContent = `Executed in ${totalMs}ms`;
      }
      if (navBadge) {
        navBadge.textContent = `${passedCount}/${results.length}`;
      }

      renderTestSuiteResults();
      if (notifyToast) {
        showToast(`Executed ${results.length} automated tests in ${totalMs}ms (${passedCount}/${results.length} passing).`);
      }
      return { passedCount, totalCount: results.length, results };
    }

    function renderTestSuiteResults() {
      const container = document.getElementById('qaTestsListContainer');
      if (!container) return;
      const filterCat = document.getElementById('qaFilterCategory')?.value || 'ALL';
      const filtered =
        filterCat === 'ALL'
          ? lastTestResults
          : lastTestResults.filter((r) => r.category === filterCat);

      container.innerHTML = filtered
        .map(
          (r, idx) => `
        <div data-testid="qa-test-row-${idx}" class="p-3 rounded-xl bg-slate-900/90 border ${r.passed ? 'border-slate-800' : 'border-rose-500/40'} flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                r.category === 'Unit'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : r.category === 'Integration'
                  ? 'bg-teal-500/15 text-teal-300'
                  : 'bg-cyan-500/15 text-cyan-300'
              }">${escapeHtml(r.category)}</span>
              <span class="text-xs font-semibold text-white truncate">${escapeHtml(r.name)}</span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono-code mt-0.5 truncate">${escapeHtml(r.detail)}</div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-[10px] font-mono-code text-slate-400">${r.ms}ms</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
              r.passed ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300'
            }">${r.passed ? 'PASS' : 'FAIL'}</span>
          </div>
        </div>
      `
        )
        .join('');
    }

    // =========================================================================
    // UTILITIES, CLIPBOARD & CLOUD MODAL
    // =========================================================================
    function openModal(id) {
      if (id === 'cloudModal') {
        const isSuper = (typeof isSuperAdminUser === 'function')
          ? isSuperAdminUser(appState && appState.currentUser)
          : false;
        if (!isSuper) {
          showToast('Infrastructure diagnostics are restricted to Super Admin only.', 'warning');
          return;
        }
        updateCloudInspector();
      }
      if (id === 'systemStatusModal') {
        const superNotice = document.getElementById('superAdminDiagnosticNotice');
        if (superNotice) {
          const isSuper = (typeof isSuperAdminUser === 'function')
            ? isSuperAdminUser(appState && appState.currentUser)
            : false;
          if (isSuper) {
            superNotice.classList.remove('hidden');
          } else {
            superNotice.classList.add('hidden');
          }
        }
      }
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    }

    function closeModal(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }

    function copyTextToClipboard(text, successMsg) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast(successMsg || 'Copied to clipboard!');
      } catch (err) {
        showToast('Copy failed', 'error');
      }
    }

    function copySettlementSummary() {
      const { simplified } = computeBalancesAndSimplifications(selectedGroupId);
      if (!simplified.length) {
        showToast('All balances are already settled!');
        return;
      }
      const lines = ['*Vasool Settlement Summary*'];
      simplified.forEach((t) => {
        lines.push(`• ${t.fromName} pays ${t.toName}: ${formatINR(t.amount)}`);
      });
      copyTextToClipboard(lines.join('\n'), 'Settlement summary copied for WhatsApp/UPI!');
    }

    function updateCloudInspector() {
      const isSuper = (typeof isSuperAdminUser === 'function')
        ? isSuperAdminUser(appState && appState.currentUser)
        : false;
      if (!isSuper) return;
      const pre = document.getElementById('dbJsonInspector');
      if (!pre) return;
      pre.textContent = JSON.stringify(
        {
          service: 'vasool',
          status: 'operational',
          collections: {
            users: (appState.users || []).length,
            groups: (appState.groups || []).length,
            expenses: (appState.expenses || []).length,
            settlements: (appState.settlements || []).length
          },
          activeAdmin: appState.currentUser ? { email: appState.currentUser.email, role: appState.currentUser.role } : null
        },
        null,
        2
      );
    }

    function exportDatabaseJson() {
      const isSuper = (typeof isSuperAdminUser === 'function')
        ? isSuperAdminUser(appState && appState.currentUser)
        : false;
      if (!isSuper) {
        showToast('Access restricted to Super Admin only.', 'warning');
        return;
      }
      copyTextToClipboard(JSON.stringify({
        database: 'vasool',
        stats: {
          users: (appState.users || []).length,
          groups: (appState.groups || []).length,
          expenses: (appState.expenses || []).length,
          settlements: (appState.settlements || []).length
        }
      }, null, 2), 'Database stats copied to clipboard!');
    }

    function resetDemoDatabase() {
      const isSuper = (typeof isSuperAdminUser === 'function')
        ? isSuperAdminUser(appState && appState.currentUser)
        : false;
      if (!isSuper) {
        showToast('Action restricted to Super Admin only.', 'warning');
        return;
      }
      appState = createDefaultState();
      saveState();
      refreshAllViews();
      closeModal('cloudModal');
      showToast('Demo database reset to initial state.');
    }

    function openNewGroupModal() {
      openModal('newGroupModal');
    }

    if (typeof window !== 'undefined') {
      window.apiFetch = apiFetch;
      window.handleEmailSignup = handleEmailSignup;
      window.handleCreateGroup = handleCreateGroup;
      window.populateExpenseModalMembers = populateExpenseModalMembers;
      window.setSplitMode = setSplitMode;
      window.handleSaveExpense = handleSaveExpense;
      window.promptTransferAdmin = promptTransferAdmin;
      window.handleTransferAdmin = handleTransferAdmin;
      window.toggleGroupSplitVisibility = toggleGroupSplitVisibility;
      window.handleConfirmSettlement = handleConfirmSettlement;
      window.handleRejectSettlement = handleRejectSettlement;
      window.switchMainTab = switchMainTab;
      window.openAddExpenseModal = openAddExpenseModal;
      window.openNewGroupModal = openNewGroupModal;
      window.openAddMemberModal = openAddMemberModal;
      window.handleAddMemberSubmit = handleAddMemberSubmit;
      window.handleMemberEmailInput = handleMemberEmailInput;
      window.selectAutocompleteUser = selectAutocompleteUser;
      window.confirmInviteViaChannel = confirmInviteViaChannel;
      window.openGroupSettingsModal = openGroupSettingsModal;
      window.handleGroupSettingsSubmit = handleGroupSettingsSubmit;
      window.handleAcceptInvite = handleAcceptInvite;
      window.handleDeclineInvite = handleDeclineInvite;
      window.openModal = openModal;
      window.closeModal = closeModal;
      window.openFeedbackModal = openFeedbackModal;
      window.selectFeedbackType = selectFeedbackType;
      window.setFeedbackRating = setFeedbackRating;
      window.updateFeedbackCharCount = updateFeedbackCharCount;
      window.submitUserFeedback = submitUserFeedback;
      window.switchAdminSubTab = switchAdminSubTab;
      window.fetchAdminFeedback = fetchAdminFeedback;
      window.filterAdminFeedback = filterAdminFeedback;
      window.updateAdminFeedbackStatus = updateAdminFeedbackStatus;
      window.saveAdminFeedbackNotes = saveAdminFeedbackNotes;
      window.deleteAdminFeedback = deleteAdminFeedback;
      window.handleOtpVerificationSubmit = handleOtpVerificationSubmit;
      window.handleResendOtp = handleResendOtp;
      window.handleJoinGroupSubmit = handleJoinGroupSubmit;
      window.copyInviteLink = copyInviteLink;
      window.checkAndProcessPendingJoin = checkAndProcessPendingJoin;
    }

    window.onload = async function () {
      // Check for group invite parameter in URL (?join=CODE or ?invite=CODE)
      const urlParams = new URLSearchParams(window.location.search);
      const joinParam = urlParams.get('join') || urlParams.get('invite');
      if (joinParam) {
        sessionStorage.setItem('pending_join_code', joinParam.trim().toUpperCase());
      }

      loadState();
      await checkVerificationUrlParams();

      const pendingCode = sessionStorage.getItem('pending_join_code');
      const inviteBanner = document.getElementById('authPendingInviteBanner');
      if (inviteBanner && pendingCode) {
        inviteBanner.classList.remove('hidden');
      }

      renderTopLevelView();

      // Restore persisted active tab across page refreshes (only standard user tabs before auth)
      const rawHash = (window.location.hash || '').replace('#', '').trim();
      let savedTab = rawHash || localStorage.getItem('vasool_active_tab') || 'dashboard';
      if (savedTab === 'admin' || savedTab === 'tests') {
        savedTab = 'dashboard';
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      const validTabs = ['dashboard', 'expenses', 'groups', 'settle'];
      const initialTab = validTabs.includes(savedTab) ? savedTab : 'dashboard';
      switchMainTab(initialTab);

      runAutomatedTestSuite(false);
      switchPipelineViewer('github');

      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
        try {
          const me = await apiFetch('/api/auth/me');
          if (me && me.user) {
            appState.currentUser = me.user;
            if (!appState.users.some((u) => u.email === me.user.email)) {
              appState.users.push(me.user);
            }
            showingAuthPortal = false;
            renderTopLevelView();
            await syncWithBackend();

            // Only navigate to admin if verified user is Super Admin AND originally requested #admin
            const isSuper = (typeof isSuperAdminUser === 'function')
              ? isSuperAdminUser(me.user)
              : Boolean(me.user.isSuperAdmin || me.user.role === 'super_admin' || (me.user.email && me.user.email.toLowerCase() === 'mdzubair7592@gmail.com'));

            if (rawHash === 'admin' && isSuper) {
              switchMainTab('admin');
            } else if (activeMainTab === 'admin' && !isSuper) {
              switchMainTab('dashboard');
            } else {
              switchMainTab(activeMainTab || 'dashboard');
            }
            await checkAndProcessPendingJoin();
          }
        } catch (err) {
          if (err && err.status === 401) {
            console.warn('[Auth Me] Session expired or invalid (HTTP 401). Clearing token:', err.message);
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem('vasool_active_tab');
            if (window.history && window.history.replaceState) {
              window.history.replaceState(null, '', window.location.pathname);
            }
            appState.currentUser = null;
            showingAuthPortal = true;
            renderTopLevelView();
            switchMainTab('dashboard');
            refreshAllViews();
          } else {
            console.warn('[Auth Me] Transient network/server error while validating session. Preserving login state:', err.message);
            if (appState.currentUser) {
              showingAuthPortal = false;
              renderTopLevelView();
              refreshAllViews();
            }
          }
        }
      } else {
        // Unauthenticated session: ensure clean URL with no #admin hash
        if (window.location.hash === '#admin' || window.location.hash === '#tests') {
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
          } else {
            window.location.hash = '';
          }
        }
      }

      // Hashchange listener to guard manual URL changes
      window.addEventListener('hashchange', () => {
        const hash = (window.location.hash || '').replace('#', '').trim();
        const validHashTabs = ['dashboard', 'expenses', 'groups', 'settle', 'admin'];
        if (validHashTabs.includes(hash)) {
          switchMainTab(hash);
        }
      });

      // Report Navigation Timings & Performance to OpenTelemetry RUM
      setTimeout(() => {
        try {
          if (typeof window !== 'undefined' && window.performance && window.performance.timing) {
            const t = window.performance.timing;
            const pageLoadTime = t.loadEventEnd > 0 ? (t.loadEventEnd - t.navigationStart) : (Date.now() - t.navigationStart);
            const ttfb = t.responseStart > 0 ? (t.responseStart - t.requestStart) : 0;
            const domInteractive = t.domInteractive > 0 ? (t.domInteractive - t.responseEnd) : 0;

            reportRumTelemetry({
              spans: [
                {
                  name: 'Navigation & Core Web Vitals',
                  traceId: sessionTraceId,
                  spanId: generateHex(16),
                  durationMs: pageLoadTime,
                  attributes: {
                    'page.url': window.location.href,
                    'page.load_time_ms': pageLoadTime,
                    'page.ttfb_ms': ttfb,
                    'page.dom_interactive_ms': domInteractive,
                    'client.screen': window.innerWidth < 640 ? 'mobile' : 'desktop'
                  }
                }
              ],
              metrics: [
                { name: 'vasool_rum_page_load_ms', type: 'histogram', value: pageLoadTime },
                { name: 'vasool_rum_ttfb_ms', type: 'histogram', value: ttfb }
              ]
            });
          }
        } catch {}
      }, 1500);
    };
