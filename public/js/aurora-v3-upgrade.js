/**
 * public/js/aurora-v3-upgrade.js — Modular Vasool v3.0 Aurora UI & Feature Upgrade
 */
(function () {
  const DEFAULT_FX_RATES = { INR: 1, USD: 84.0, EUR: 91.5, GBP: 108.0, AED: 22.9, SGD: 63.0, THB: 2.45 };
  window.editingExpenseId = null;
  window.lastDeletedExpenseSnapshot = null;
  window.lastGeneratedStatementHtml = '';
  window.lastGeneratedStatementGroupName = 'group';

  function upgradeDomAndStyles() {
    // 1. Upgrade Header Sign Out Button to prominent labeled rose button
    const logoutBtn = document.getElementById('btnHeaderLogout');
    if (logoutBtn && !logoutBtn.textContent.includes('Sign Out')) {
      logoutBtn.className = 'px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 hover:border-rose-400/50 text-[11px] sm:text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 shadow-sm';
      logoutBtn.innerHTML = '<span>🚪</span><span>Sign Out</span>';
    }

    // 2. Add Quick Persona Switcher in Header if not present
    const currSel = document.getElementById('currencySelector');
    if (currSel && !document.getElementById('personaQuickSelect')) {
      const pSel = document.createElement('select');
      pSel.id = 'personaQuickSelect';
      pSel.setAttribute('data-testid', 'persona-quick-select');
      pSel.className = 'hidden md:block px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-900/90 text-emerald-300 border border-emerald-500/30 cursor-pointer shadow-sm transition';
      pSel.innerHTML = `
        <option value="">⚡ Switch Persona...</option>
        <option value="admin.aarav@vasool.test">👑 Aarav Sharma (Admin)</option>
        <option value="vikram.spender@vasool.test">💰 Vikram Patel (+₹19.6k)</option>
        <option value="rohan.debtor@vasool.test">💳 Rohan Gupta (-₹5.4k)</option>
        <option value="neha.couple@vasool.test">⚖️ Neha & Partner (2x)</option>
        <option value="priya.settler@vasool.test">💵 Priya Das (Settler)</option>
      `;
      pSel.onchange = function () { if (this.value && typeof quickLoginDemo === 'function') quickLoginDemo(this.value); };
      currSel.parentNode.insertBefore(pSel, currSel);
    }

    // 3. Add Sign Out button inside Account Settings Modal footer
    const accModal = document.getElementById('accountSettingsModal');
    if (accModal && !document.getElementById('btnAccountSettingsLogout')) {
      const closeBtn = accModal.querySelector('button[onclick*="closeModal(\'accountSettingsModal\')"]');
      if (closeBtn && closeBtn.parentNode) {
        closeBtn.parentNode.className = 'flex items-center justify-between gap-2 pt-3 border-t border-slate-800';
        const signOutBtn = document.createElement('button');
        signOutBtn.type = 'button';
        signOutBtn.id = 'btnAccountSettingsLogout';
        signOutBtn.setAttribute('data-testid', 'btn-settings-logout');
        signOutBtn.className = 'px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition flex items-center gap-1.5';
        signOutBtn.innerHTML = '<span>🚪</span><span>Sign Out of Account</span>';
        signOutBtn.onclick = function () {
          if (typeof closeModal === 'function') closeModal('accountSettingsModal');
          if (typeof promptLogout === 'function') promptLogout();
        };
        closeBtn.parentNode.insertBefore(signOutBtn, closeBtn);
      }
    }

    // 4. Add 1-Click Demo Persona Switcher Bar on Sign-In Card
    const signupForm = document.getElementById('signupForm');
    if (signupForm && !document.getElementById('demoPersonaQuickBar')) {
      const demoBar = document.createElement('div');
      demoBar.id = 'demoPersonaQuickBar';
      demoBar.setAttribute('data-testid', 'demo-persona-quick-bar');
      demoBar.className = 'mt-5 pt-4 border-t border-slate-800/90';
      demoBar.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-400">⚡ 1-Click Demo Persona Switcher</span>
          <span class="text-[10px] text-slate-400 font-mono-code">5 Roles Ready</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          <button type="button" onclick="quickLoginDemo('admin.aarav@vasool.test')" class="px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-semibold text-left truncate">👑 Aarav (Admin)</button>
          <button type="button" onclick="quickLoginDemo('vikram.spender@vasool.test')" class="px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold text-left truncate">💰 Vikram (+₹19.6k)</button>
          <button type="button" onclick="quickLoginDemo('rohan.debtor@vasool.test')" class="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] font-semibold text-left truncate">💳 Rohan (-₹5.4k)</button>
          <button type="button" onclick="quickLoginDemo('neha.couple@vasool.test')" class="px-2.5 py-1.5 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 text-teal-300 text-[11px] font-semibold text-left truncate">⚖️ Neha (2x)</button>
          <button type="button" onclick="quickLoginDemo('priya.settler@vasool.test')" class="px-2.5 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[11px] font-semibold text-left truncate col-span-2 sm:col-span-1">💵 Priya (Settler)</button>
        </div>
      `;
      signupForm.parentNode.appendChild(demoBar);
    }

    // 5. Add Export PDF button and Undo Delete Banner in Expenses Panel
    const expStmtBtn = document.querySelector('[data-testid="btn-export-statement"]');
    if (expStmtBtn && !document.querySelector('[data-testid="btn-export-pdf"]')) {
      const pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.setAttribute('data-testid', 'btn-export-pdf');
      pdfBtn.className = 'px-3 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-semibold text-xs sm:text-sm whitespace-nowrap transition';
      pdfBtn.innerHTML = '🖨️ Export PDF';
      pdfBtn.onclick = function () { window.exportGroupPdfSummary(); };
      expStmtBtn.parentNode.insertBefore(pdfBtn, expStmtBtn.nextSibling);
    }

    const expFullList = document.getElementById('expensesFullList');
    if (expFullList && !document.getElementById('undoDeleteExpenseBanner')) {
      const undoBanner = document.createElement('div');
      undoBanner.id = 'undoDeleteExpenseBanner';
      undoBanner.setAttribute('data-testid', 'undo-delete-expense-banner');
      undoBanner.className = 'hidden p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3';
      undoBanner.innerHTML = `
        <div class="text-xs text-amber-200 flex items-center gap-2"><span>🗑️</span><span id="undoDeleteExpenseText">Bill deleted.</span></div>
        <div class="flex items-center gap-2">
          <button type="button" onclick="window.undoLastDeletedExpense()" class="px-3 py-1 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs">↩️ Undo Delete</button>
          <button type="button" onclick="document.getElementById('undoDeleteExpenseBanner').classList.add('hidden')" class="text-xs text-slate-400 hover:text-white px-1.5">✕</button>
        </div>
      `;
      expFullList.parentNode.insertBefore(undoBanner, expFullList);
    }

    // 6. Add Per-Bill FX Currency & Linked Refund controls in Add Expense Modal
    const expAmtInput = document.getElementById('expAmountInput');
    if (expAmtInput && !document.getElementById('expBillCurrencySelect')) {
      const fxBar = document.createElement('div');
      fxBar.className = 'p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-2';
      fxBar.innerHTML = `
        <div class="grid grid-cols-3 gap-2 items-end">
          <div>
            <label class="block text-[10px] font-semibold text-indigo-300 mb-1">🌐 Bill Currency</label>
            <select id="expBillCurrencySelect" data-testid="select-expense-currency" onchange="window.handleBillCurrencyChange()" class="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white">
              <option value="INR">🇮🇳 INR (₹)</option>
              <option value="USD">🇺🇸 USD ($)</option>
              <option value="EUR">🇪🇺 EUR (€)</option>
              <option value="GBP">🇬🇧 GBP (£)</option>
              <option value="AED">🇦🇪 AED</option>
              <option value="SGD">🇸🇬 SGD</option>
              <option value="THB">🇹🇭 THB</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-semibold text-slate-300 mb-1">Foreign Amt</label>
            <input id="expOriginalAmountInput" type="number" step="0.01" oninput="window.recalculateFxToBase()" placeholder="50.00" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white" />
          </div>
          <div>
            <label class="block text-[10px] font-semibold text-slate-300 mb-1">FX Rate (to ₹)</label>
            <input id="expExchangeRateInput" type="number" step="0.01" value="1" oninput="window.recalculateFxToBase()" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono-code" />
          </div>
        </div>
      `;
      const gridRow = expAmtInput.closest('.grid');
      if (gridRow && gridRow.parentNode) {
        gridRow.parentNode.insertBefore(fxBar, gridRow.nextSibling);
      }
    }
  }

  window.handleBillCurrencyChange = function () {
    const curr = document.getElementById('expBillCurrencySelect')?.value || 'INR';
    const rateEl = document.getElementById('expExchangeRateInput');
    if (rateEl) rateEl.value = String(DEFAULT_FX_RATES[curr] || 1);
    if (curr !== 'INR') window.recalculateFxToBase();
  };

  window.recalculateFxToBase = function () {
    const curr = document.getElementById('expBillCurrencySelect')?.value || 'INR';
    if (curr === 'INR') return;
    const orig = Number(document.getElementById('expOriginalAmountInput')?.value) || 0;
    const rate = Number(document.getElementById('expExchangeRateInput')?.value) || 1;
    const conv = Math.round(orig * rate * 100) / 100;
    const amtEl = document.getElementById('expAmountInput');
    if (amtEl && conv > 0) {
      amtEl.value = String(conv);
      if (typeof recalculateSplitPreview === 'function') recalculateSplitPreview();
    }
  };

  window.exportGroupPdfSummary = function (groupIdOverride) {
    const targetId = groupIdOverride || (window.selectedGroupId === 'ALL' ? window.appState?.groups?.[0]?.id : window.selectedGroupId);
    const grp = window.appState?.groups?.find((g) => g.id === targetId) || window.appState?.groups?.[0];
    if (!grp) return;
    const calc = typeof computeBalancesAndSimplifications === 'function' ? computeBalancesAndSimplifications(grp.id) : { totalSpend: 0, balances: {}, simplified: [] };
    const exps = (window.appState?.expenses || []).filter((e) => e.groupId === grp.id);
    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vasool Statement - ${grp.name}</title><style>body{font-family:Inter,sans-serif;padding:28px;color:#0f172a}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #cbd5e1;padding:8px;font-size:12px;text-align:left}</style></head><body><h2>Vasool Official Trip Statement: ${grp.name}</h2><p>Invite Code: <strong>${grp.inviteCode}</strong> · Total Spend: <strong>₹${calc.totalSpend}</strong> · Bills: ${exps.length}</p><table><thead><tr><th>#</th><th>Description</th><th>Category</th><th>Paid By</th><th>Amount (₹)</th></tr></thead><tbody>${exps.map((e, i) => `<tr><td>${i + 1}</td><td>${e.description}</td><td>${e.category}</td><td>${e.paidByName}</td><td>₹${e.amount}</td></tr>`).join('')}</tbody></table></body></html>`;
    if (typeof triggerFileDownload === 'function') {
      triggerFileDownload(`vasool_statement_${grp.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.html`, htmlDoc, 'text/html');
    }
    if (typeof showToast === 'function') showToast('🖨️ Printable Group Statement downloaded!');
  };

  window.undoLastDeletedExpense = async function () {
    if (!window.lastDeletedExpenseSnapshot) return;
    const restored = { ...window.lastDeletedExpenseSnapshot };
    window.lastDeletedExpenseSnapshot = null;
    const banner = document.getElementById('undoDeleteExpenseBanner');
    if (banner) banner.classList.add('hidden');
    if (typeof apiFetch === 'function' && localStorage.getItem('VASOOL_AUTH_TOKEN_V1')) {
      try { await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(restored) }); } catch (_) {}
    }
    if (window.appState && Array.isArray(window.appState.expenses)) {
      window.appState.expenses.unshift(restored);
      if (typeof saveState === 'function') saveState();
      if (typeof refreshAllViews === 'function') refreshAllViews();
      if (typeof showToast === 'function') showToast(`↩️ Restored "${restored.description}"!`);
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(upgradeDomAndStyles, 150);
  });
  if (document.readyState !== 'loading') {
    setTimeout(upgradeDomAndStyles, 150);
  }
})();
