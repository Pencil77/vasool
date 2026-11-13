// =========================================================================
    // GROUP DETAILS VIEW, BILLS & SPLITS ACTIVITY, AND EXIT GROUP WORKFLOW
    // =========================================================================
    let activeDetailsGroupId = null;
    let activeDetailsTab = 'members';
    let activeExitGroupId = null;

    async function openGroupDetailsModal(groupId) {
      activeDetailsGroupId = groupId;
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) {
        showToast('Group not found.', 'error');
        return;
      }

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const currentAdmin = grp.members.find((m) => m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === m.email.toLowerCase())) || grp.members[0];
      const isCurrentUserAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === currentEmail;

      // Group Header Info
      const iconMap = {
        'Trip': '🏕️',
        'Home': '🏠',
        'Couple': '❤️',
        'Project': '💼',
        'Event': '🎉',
        'Other': '👥'
      };
      document.getElementById('groupDetailsCategoryIcon').textContent = iconMap[grp.category] || '👥';
      document.getElementById('groupDetailsName').textContent = grp.name;
      document.getElementById('groupDetailsCategoryBadge').textContent = grp.category || 'Trip';
      document.getElementById('groupDetailsInviteCode').textContent = `Code: ${grp.inviteCode}`;

      // Copy & Share buttons
      document.getElementById('btnGroupDetailsCopyCode').onclick = () => {
        copyTextToClipboard(grp.inviteCode, `Invite code ${grp.inviteCode} copied!`);
      };
      document.getElementById('btnGroupDetailsShareLink').onclick = () => {
        copyInviteLink(grp.inviteCode, grp.name);
      };

      // Admin badge
      document.getElementById('groupDetailsAdminBadge').innerHTML = currentAdmin
        ? `👑 Admin: ${escapeHtml(currentAdmin.name)}`
        : '👑 Admin';

      // Settings button
      const btnSettings = document.getElementById('btnGroupDetailsSettings');
      if (btnSettings) {
        if (isCurrentUserAdmin) {
          btnSettings.classList.remove('hidden');
          btnSettings.onclick = () => {
            closeModal('groupDetailsModal');
            openGroupSettingsModal(groupId);
          };
        } else {
          btnSettings.classList.add('hidden');
        }
      }

      // Add Member button inside modal
      const btnAddMem = document.getElementById('btnGroupDetailsAddMember');
      const isSuper = Boolean(appState.currentUser && (appState.currentUser.isSuperAdmin || appState.currentUser.role === 'super_admin' || (appState.currentUser.email && appState.currentUser.email.toLowerCase() === 'mdzubair7592@gmail.com')));
      const canAddMember = isCurrentUserAdmin || isSuper || Boolean(grp.allowMembersToAddOthers);
      if (btnAddMem) {
        if (canAddMember) {
          btnAddMem.classList.remove('hidden');
          btnAddMem.onclick = () => {
            openAddMemberModal(groupId);
          };
        } else {
          btnAddMem.classList.add('hidden');
        }
      }

      // Add Expense button inside modal
      const btnAddExp = document.getElementById('btnGroupDetailsAddExpense');
      if (btnAddExp) {
        btnAddExp.onclick = () => {
          closeModal('groupDetailsModal');
          selectedGroupId = groupId;
          if (document.getElementById('groupFilterSelect')) {
            document.getElementById('groupFilterSelect').value = groupId;
          }
          openAddExpenseModal();
        };
      }

      // Exit Group button
      const btnExit = document.getElementById('btnGroupDetailsExit');
      if (btnExit) {
        btnExit.onclick = () => {
          openExitGroupConfirmModal(groupId);
        };
      }

      // Reset to default tab
      switchGroupDetailsTab(activeDetailsTab || 'members');

      // Render initial data from memory
      renderGroupDetailsData(grp);

      // Open Modal
      openModal('groupDetailsModal');

      // Fetch fresh server details if authenticated
      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch(`/api/groups/${groupId}`);
          if (res && res.group && res.members) {
            const idx = appState.groups.findIndex((g) => g.id === groupId);
            if (idx !== -1) {
              appState.groups[idx] = { ...appState.groups[idx], ...res.group, members: res.members };
            }
            if (res.expenses && Array.isArray(res.expenses)) {
              const otherExp = appState.expenses.filter((e) => e.groupId !== groupId);
              appState.expenses = [...otherExp, ...res.expenses];
            }
            renderGroupDetailsData(appState.groups[idx] || grp, res);
          }
        } catch (err) {
          console.warn('[group-details] Server sync notice:', err.message);
        }
      }
    }

    function renderGroupDetailsData(grp, serverData = null) {
      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const currentAdmin = grp.members.find((m) => m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === m.email.toLowerCase())) || grp.members[0];
      const isCurrentUserAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === currentEmail;

      const { totalSpend, simplified, filteredExpenses, filteredSettlements, balanceList } =
        serverData && serverData.simplifiedTransactions
          ? {
              totalSpend: serverData.totalSpend,
              simplified: serverData.simplifiedTransactions,
              filteredExpenses: serverData.expenses,
              filteredSettlements: serverData.settlements,
              balanceList: serverData.members
            }
          : computeBalancesAndSimplifications(grp.id);

      // Quick summary numbers
      document.getElementById('groupDetailsTotalSpend').textContent = formatINR(totalSpend);
      document.getElementById('groupDetailsMemberCount').textContent = grp.members.length;
      document.getElementById('groupDetailsBillCount').textContent = filteredExpenses.length;

      // User's own balance in this group
      const myBal = balanceList.find((b) => (b.email || '').toLowerCase().trim() === currentEmail) || { net: 0 };
      const myBalEl = document.getElementById('groupDetailsMyBalance');
      if (myBal.net > 0.01) {
        myBalEl.className = 'text-sm font-bold text-emerald-400 mt-0.5 block';
        myBalEl.textContent = `+${formatINR(myBal.net)} (Owed)`;
      } else if (myBal.net < -0.01) {
        myBalEl.className = 'text-sm font-bold text-rose-400 mt-0.5 block';
        myBalEl.textContent = `-${formatINR(Math.abs(myBal.net))} (Debt)`;
      } else {
        myBalEl.className = 'text-sm font-bold text-slate-300 mt-0.5 block';
        myBalEl.textContent = '₹0.00 (Settled)';
      }

      // Mode badges
      const hubEl = document.getElementById('groupDetailsHubBadge');
      if (hubEl) {
        hubEl.textContent = grp.adminHubSettlement === true ? '👑 Admin-Hub Routing' : '⚡ Direct P2P';
        hubEl.className = grp.adminHubSettlement === true
          ? 'px-2 py-0.5 rounded-lg border bg-amber-500/15 text-amber-300 border-amber-500/30'
          : 'px-2 py-0.5 rounded-lg border bg-slate-800 text-slate-300 border-slate-700';
      }

      const minEl = document.getElementById('groupDetailsMinimizeBadge');
      if (minEl) {
        minEl.textContent = grp.minimizeDebts !== false ? '⚡ Minimized Debts' : '🤝 Direct Pair-Wise';
        minEl.className = grp.minimizeDebts !== false
          ? 'px-2 py-0.5 rounded-lg border bg-amber-500/15 text-amber-300 border-amber-500/30'
          : 'px-2 py-0.5 rounded-lg border bg-slate-800 text-slate-300 border-slate-700';
      }

      const visEl = document.getElementById('groupDetailsVisibilityBadge');
      if (visEl) {
        const isPersonal = (grp.splitsVisibility || 'personal_only') === 'personal_only';
        visEl.textContent = isPersonal ? '🔒 Personal Only' : '🌐 All Splits Visible';
        visEl.className = isPersonal
          ? 'px-2 py-0.5 rounded-lg border bg-purple-500/15 text-purple-300 border-purple-500/30'
          : 'px-2 py-0.5 rounded-lg border bg-slate-800 text-slate-300 border-slate-700';
      }

      // Build synthesized or persisted audit log
      const rawAudit = (serverData && Array.isArray(serverData.auditLog) && serverData.auditLog.length > 0)
        ? serverData.auditLog
        : (Array.isArray(grp.auditLog) && grp.auditLog.length > 0 ? grp.auditLog : [
            ...filteredExpenses.slice(0, 6).map((e) => ({
              action: e.type === 'income' ? 'refund_recorded' : 'expense_created',
              actorName: e.paidByName || 'Member',
              summary: `${e.paidByName || 'Member'} logged ${e.type === 'income' ? 'refund' : 'bill'} "${e.description}" for ${formatINR(e.amount)}`,
              details: `${e.category} · ${(e.splitType || 'equal').toUpperCase()} split`,
              createdAt: e.date || new Date().toISOString()
            })),
            ...filteredSettlements.slice(0, 4).map((s) => ({
              action: 'settlement_' + (s.status || 'recorded'),
              actorName: s.fromName || 'Member',
              summary: `${s.fromName} → ${s.toName}: ${formatINR(s.amount)} (${s.method || 'UPI'})`,
              details: `Status: ${(s.status || 'confirmed').toUpperCase()}${s.utrNumber ? ' · UTR: ' + s.utrNumber : ''}`,
              createdAt: s.settledAt || new Date().toISOString()
            }))
          ]);

      // Tab count labels
      document.getElementById('tabCountMembers').textContent = grp.members.length;
      document.getElementById('tabCountBills').textContent = filteredExpenses.length;
      document.getElementById('tabCountSettle').textContent = simplified.length;
      const tabCountAct = document.getElementById('tabCountActivity');
      if (tabCountAct) tabCountAct.textContent = rawAudit.length;

      const activityContainer = document.getElementById('groupDetailsActivityList');
      if (activityContainer) {
        if (!rawAudit.length) {
          activityContainer.innerHTML = `<div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">No activity recorded yet.</div>`;
        } else {
          activityContainer.innerHTML = rawAudit
            .map((a) => `
              <div class="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-start justify-between gap-2.5">
                <div class="space-y-0.5">
                  <div class="text-xs font-semibold text-white">${escapeHtml(a.summary || a.action)}</div>
                  ${a.details ? `<div class="text-[11px] text-slate-400">${escapeHtml(a.details)}</div>` : ''}
                </div>
                <span class="text-[10px] font-mono-code text-slate-400 flex-shrink-0">${escapeHtml(String(a.createdAt || 'Recent').slice(0, 10))}</span>
              </div>
            `)
            .join('');
        }
      }

      // 1. Render Tab: Members
      const membersContainer = document.getElementById('groupDetailsMembersList');
      if (membersContainer) {
        membersContainer.innerHTML = grp.members
          .map((m) => {
            const mEmail = (m.email || '').toLowerCase().trim();
            const isAdmin = m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === mEmail);
            const isPending = m.status === 'pending_acceptance';
            const isMe = mEmail === currentEmail;

            const mBal = balanceList.find((b) => (b.email || '').toLowerCase().trim() === mEmail) || { net: 0, paid: 0, owed: 0 };
            const ini = (m.name || 'Member')
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();

            let balanceChip = '';
            if (mBal.net > 0.01) {
              balanceChip = `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Owed +${formatINR(mBal.net)}</span>`;
            } else if (mBal.net < -0.01) {
              balanceChip = `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">Owes -${formatINR(Math.abs(mBal.net))}</span>`;
            } else {
              balanceChip = `<span class="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">Settled (₹0)</span>`;
            }

            const canTransfer = isCurrentUserAdmin && !isAdmin && !isPending;

            return `
              <div class="p-3 rounded-2xl bg-slate-900/90 border ${isMe ? 'border-teal-500/40 bg-teal-950/20' : 'border-slate-800'} flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-9 h-9 rounded-xl ${isAdmin ? 'bg-amber-400 text-slate-950 font-black' : isPending ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30' : 'bg-slate-800 text-slate-200 font-bold border border-slate-700'} flex items-center justify-center text-xs flex-shrink-0">
                    ${isAdmin ? '👑' : isPending ? '⏳' : escapeHtml(ini)}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-xs font-bold text-white truncate">${escapeHtml(m.name)}</span>
                      ${isMe ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">You</span>' : ''}
                      ${isAdmin ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">Admin</span>' : ''}
                      ${isPending ? '<span class="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Pending</span>' : ''}
                    </div>
                    <div class="text-[11px] text-slate-400 truncate">${escapeHtml(m.email)}</div>
                  </div>
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                  ${(m.defaultWeight && m.defaultWeight !== 1) ? `<span class="text-[10px] px-2 py-0.5 rounded-lg bg-teal-400/15 text-teal-300 border border-teal-400/30">⚖️ ${m.defaultWeight}x</span>` : ''}
                  ${balanceChip}
                  ${canTransfer ? `
                    <button onclick="promptTransferAdmin('${escapeHtml(grp.id)}', '${escapeHtml(m.email)}', '${escapeHtml(m.name)}')" title="Transfer Admin privileges" class="text-[10px] text-amber-300 hover:text-amber-200 underline font-semibold px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20">
                      👑 Make Admin
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          })
          .join('');
      }

      // 2. Render Tab: Bills & Splits
      const billsContainer = document.getElementById('groupDetailsBillsList');
      if (billsContainer) {
        if (!filteredExpenses.length) {
          billsContainer.innerHTML = `
            <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
              No bills recorded for this group yet. Click "+ Add Bill" to record your first expense!
            </div>
          `;
        } else {
          billsContainer.innerHTML = filteredExpenses
            .map((exp) => {
              const payerEmail = (exp.paidByEmail || '').toLowerCase().trim();
              const isPayerMe = payerEmail === currentEmail;
              const splitsList = Array.isArray(exp.splits) ? exp.splits : [];
              const mySplit = splitsList.find((s) => (s.memberEmail || '').toLowerCase().trim() === currentEmail);

              const splitChips = splitsList
                .map((s) => {
                  const sEmail = (s.memberEmail || '').toLowerCase().trim();
                  const isThisMe = sEmail === currentEmail;
                  return `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] ${isThisMe ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30 font-bold' : 'bg-slate-800 text-slate-300 border border-slate-700'}">
                      <span>${escapeHtml(s.memberName || s.memberEmail.split('@')[0])}:</span>
                      <span>${formatINR(s.amount)}</span>
                    </span>
                  `;
                })
                .join('');

              const canDelete = isCurrentUserAdmin || isPayerMe;

              return `
                <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-start gap-2.5 min-w-0">
                      <span class="text-xl p-2 rounded-xl bg-slate-800/80 border border-slate-700/80 flex-shrink-0">${escapeHtml(exp.category?.slice(0, 2) || '🧾')}</span>
                      <div class="min-w-0">
                        <h4 class="text-xs font-bold text-white truncate">${escapeHtml(exp.description)}</h4>
                        <div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>Paid by <strong class="${isPayerMe ? 'text-teal-300' : 'text-slate-200'}">${escapeHtml(exp.paidByName || exp.paidByEmail)}</strong></span>
                          <span>·</span>
                          <span>${exp.expenseDate ? new Date(exp.expenseDate).toLocaleDateString() : ''}</span>
                          <span class="px-1.5 py-0.2 rounded text-[9px] uppercase font-bold bg-slate-800 text-slate-400 border border-slate-700">${escapeHtml(exp.splitType || 'equal')}</span>
                        </div>
                      </div>
                    </div>
                    <div class="text-right flex-shrink-0">
                      <div class="text-sm font-bold text-white">${formatINR(exp.amount)}</div>
                      ${mySplit ? `<div class="text-[10px] text-teal-400 font-semibold">Your share: ${formatINR(mySplit.amount)}</div>` : ''}
                    </div>
                  </div>

                  <div class="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex flex-wrap gap-1">${splitChips}</div>
                    <div class="flex items-center gap-1.5">
                      <button onclick="closeModal('groupDetailsModal'); openEditExpenseModal('${escapeHtml(exp.id || exp._id)}')" class="text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
                        Edit
                      </button>
                      ${canDelete ? `
                        <button onclick="deleteExpenseById('${escapeHtml(exp.id || exp._id)}')" class="text-[10px] text-rose-400 hover:text-rose-300 font-semibold px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20">
                          Delete
                        </button>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `;
            })
            .join('');
        }
      }

      // 3. Render Tab: Settle Up Transfers
      const settleContainer = document.getElementById('groupDetailsSettleList');
      if (settleContainer) {
        if (!simplified.length) {
          settleContainer.innerHTML = `
            <div class="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 text-center text-xs text-emerald-300">
              🎉 All settled up! There are no outstanding balances in this group.
            </div>
          `;
        } else {
          settleContainer.innerHTML = simplified
            .map((t) => {
              const fromEmail = (t.fromEmail || '').toLowerCase().trim();
              const toEmail = (t.toEmail || '').toLowerCase().trim();
              const isPayer = fromEmail === currentEmail;
              const isReceiver = toEmail === currentEmail;
              const dueAmount = t.remainingDue !== undefined ? t.remainingDue : t.amount;

              return `
                <div class="p-3.5 rounded-2xl bg-slate-900/90 border ${isPayer ? 'border-rose-500/30 bg-rose-950/15' : isReceiver ? 'border-emerald-500/30 bg-emerald-950/15' : 'border-slate-800'} flex items-center justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-xl ${isPayer ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'} flex items-center justify-center text-xs font-bold flex-shrink-0">
                      ₹
                    </div>
                    <div class="min-w-0">
                      <div class="text-xs text-slate-200">
                        <strong class="${isPayer ? 'text-rose-300 font-bold' : 'text-white'}">${escapeHtml(t.fromName || t.fromEmail)}</strong>
                        <span class="text-slate-400">pays</span>
                        <strong class="${isReceiver ? 'text-emerald-300 font-bold' : 'text-white'}">${escapeHtml(t.toName || t.toEmail)}</strong>
                      </div>
                      ${t.isPendingApproval ? `<div class="text-[10px] text-amber-300 font-semibold mt-0.5">⏳ Awaiting confirmation (${formatINR(t.pendingApprovalAmount)})</div>` : ''}
                    </div>
                  </div>

                  <div class="flex items-center gap-3 flex-shrink-0">
                    <div class="text-sm font-bold ${isPayer ? 'text-rose-400' : 'text-white'}">${formatINR(dueAmount)}</div>
                    ${dueAmount > 0 ? `
                      <button onclick="handleGroupDetailsSettleClick('${escapeHtml(t.fromEmail)}', '${escapeHtml(t.fromName)}', '${escapeHtml(t.toEmail)}', '${escapeHtml(t.toName)}', ${dueAmount}, '${escapeHtml(grp.id)}')" class="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg transition">
                        Settle Up
                      </button>
                    ` : ''}
                  </div>
                </div>
              `;
            })
            .join('');
        }
      }
    }

    function switchGroupDetailsTab(tab) {
      activeDetailsTab = tab;
      const tabs = ['members', 'bills', 'settle', 'activity'];
      tabs.forEach((t) => {
        const sec = document.getElementById(`groupDetailsSection${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const btn = document.getElementById(`btnGroupTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (t === tab) {
          if (sec) sec.classList.remove('hidden');
          if (btn) {
            btn.className = 'flex-1 py-1.5 text-xs font-bold rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm shadow-emerald-500/10 transition';
          }
        } else {
          if (sec) sec.classList.add('hidden');
          if (btn) {
            btn.className = 'flex-1 py-1.5 text-xs font-semibold rounded-xl text-slate-400 hover:text-slate-200 transition';
          }
        }
      });
    }

    function handleGroupDetailsSettleClick(fromEmail, fromName, toEmail, toName, amount, groupId) {
      closeModal('groupDetailsModal');
      selectedGroupId = groupId;
      if (document.getElementById('groupFilterSelect')) {
        document.getElementById('groupFilterSelect').value = groupId;
      }
      openSettleConfirm(fromEmail, fromName, toEmail, toName, amount);
    }

    function openExitGroupConfirmModal(groupId) {
      activeExitGroupId = groupId;
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const currentAdmin = grp.members.find((m) => m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === m.email.toLowerCase())) || grp.members[0];
      const isCurrentUserAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === currentEmail;

      const { balanceList } = computeBalancesAndSimplifications(grp.id);
      const myBal = balanceList.find((b) => (b.email || '').toLowerCase().trim() === currentEmail) || { net: 0 };
      const netAmount = Math.round(myBal.net * 100) / 100;

      document.getElementById('exitGroupName').textContent = `"${grp.name}"`;

      const noticeEl = document.getElementById('exitGroupBalanceNotice');
      const forfeitContainer = document.getElementById('exitGroupForfeitContainer');
      const forfeitCheckbox = document.getElementById('chkExitGroupConfirmForfeit');
      const btnConfirm = document.getElementById('btnConfirmExecuteExit');
      const adminContainer = document.getElementById('exitGroupAdminSelectorContainer');
      const successorSelect = document.getElementById('exitGroupSuccessorSelect');

      if (forfeitCheckbox) forfeitCheckbox.checked = false;

      // Balance validation:
      if (netAmount < -0.01) {
        // User owes money -> Blocked from leaving
        noticeEl.className = 'p-3.5 rounded-xl text-xs space-y-1.5 bg-rose-950/40 border border-rose-500/40 text-rose-200';
        noticeEl.innerHTML = `
          <div class="font-bold flex items-center gap-1.5 text-rose-300">
            <span>⛔</span> Cannot Exit: Unsettled Debt
          </div>
          <p class="leading-relaxed">
            You currently owe <strong class="text-white">${formatINR(Math.abs(netAmount))}</strong> in this group. You must settle all your debts before exiting.
          </p>
        `;
        if (forfeitContainer) forfeitContainer.classList.add('hidden');
        if (btnConfirm) {
          btnConfirm.disabled = true;
          btnConfirm.textContent = 'Blocked by Unsettled Debt';
        }
      } else if (netAmount > 0.01) {
        // User is owed money -> Warning about forfeiture
        noticeEl.className = 'p-3.5 rounded-xl text-xs space-y-1.5 bg-amber-950/40 border border-amber-500/40 text-amber-200';
        noticeEl.innerHTML = `
          <div class="font-bold flex items-center gap-1.5 text-amber-300">
            <span>⚠️</span> Outstanding Credit Balance
          </div>
          <p class="leading-relaxed">
            You are owed <strong class="text-white">${formatINR(netAmount)}</strong> in this group. If you leave now, you will forfeit this balance.
          </p>
        `;
        if (forfeitContainer) forfeitContainer.classList.remove('hidden');
        if (btnConfirm) {
          btnConfirm.disabled = true;
          btnConfirm.textContent = 'Confirm Forfeiture to Exit';
        }

        if (forfeitCheckbox) {
          forfeitCheckbox.onchange = () => {
            btnConfirm.disabled = !forfeitCheckbox.checked;
            btnConfirm.textContent = forfeitCheckbox.checked ? 'Exit & Forfeit Balance' : 'Confirm Forfeiture to Exit';
          };
        }
      } else {
        // Net balance == 0 -> Safe to leave
        noticeEl.className = 'p-3.5 rounded-xl text-xs space-y-1.5 bg-emerald-950/40 border border-emerald-500/30 text-emerald-200';
        noticeEl.innerHTML = `
          <div class="font-bold flex items-center gap-1.5 text-emerald-300">
            <span>✓</span> All Settled Up
          </div>
          <p class="leading-relaxed">
            Your net balance in this group is <strong>₹0.00</strong>. You have no pending debts or credits and can safely leave.
          </p>
        `;
        if (forfeitContainer) forfeitContainer.classList.add('hidden');
        if (btnConfirm) {
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Exit Group';
        }
      }

      // Admin Handover Check:
      if (isCurrentUserAdmin) {
        const remainingMembers = grp.members.filter((m) => (m.email || '').toLowerCase().trim() !== currentEmail);
        if (remainingMembers.length > 0) {
          adminContainer.classList.remove('hidden');
          successorSelect.innerHTML = remainingMembers
            .map((m) => `<option value="${escapeHtml(m.email)}">${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`)
            .join('');
        } else {
          adminContainer.classList.add('hidden');
          noticeEl.innerHTML += `
            <div class="mt-2 pt-2 border-t border-slate-700/60 text-amber-300">
              👑 You are the only member in this group. Leaving will archive and close this group.
            </div>
          `;
        }
      } else {
        adminContainer.classList.add('hidden');
      }

      openModal('exitGroupConfirmModal');
    }

    async function executeLeaveGroup() {
      if (!activeExitGroupId) return;
      const grp = appState.groups.find((g) => g.id === activeExitGroupId);
      if (!grp) return;

      const forfeitCheckbox = document.getElementById('chkExitGroupConfirmForfeit');
      const confirmForfeit = forfeitCheckbox ? forfeitCheckbox.checked : false;
      const successorSelect = document.getElementById('exitGroupSuccessorSelect');
      const successorEmail = successorSelect && !document.getElementById('exitGroupAdminSelectorContainer').classList.contains('hidden')
        ? successorSelect.value
        : undefined;

      const btnConfirm = document.getElementById('btnConfirmExecuteExit');
      if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Exiting...';
      }

      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${activeExitGroupId}/leave`, {
            method: 'POST',
            body: JSON.stringify({ confirmForfeit, successorEmail })
          });
          if (res && res.error) {
            showToast('Failed to exit group: ' + res.error, 'error');
            if (btnConfirm) {
              btnConfirm.disabled = false;
              btnConfirm.textContent = 'Exit Group';
            }
            return;
          }
        }

        // Remove from local memory
        const groupName = grp.name;
        appState.groups = appState.groups.filter((g) => g.id !== activeExitGroupId);
        appState.expenses = appState.expenses.filter((e) => e.groupId !== activeExitGroupId);
        if (selectedGroupId === activeExitGroupId) {
          selectedGroupId = 'ALL';
        }

        saveState();
        closeModal('exitGroupConfirmModal');
        closeModal('groupDetailsModal');
        refreshAllViews();
        showToast(`You have successfully exited "${groupName}".`);
      } catch (err) {
        showToast('Error exiting group: ' + err.message, 'error');
        if (btnConfirm) {
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Exit Group';
        }
      }
    }

    function renderSettleView(simplified, filteredSettlements) {
      const simpEl = document.getElementById('settleSimplifiedContainer');
      const histEl = document.getElementById('settlementHistoryContainer');
      if (!simpEl || !histEl) return;

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const activeGroups = selectedGroupId === 'ALL'
        ? appState.groups
        : appState.groups.filter((g) => g.id === selectedGroupId);

      const isViewerAdminOfAny = activeGroups.some((g) => {
        const adm = g.members?.find((m) => m.role === 'admin' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase())) || g.members?.[0];
        return adm && adm.email.toLowerCase().trim() === currentEmail;
      });

      const pendingApprovalList = filteredSettlements.filter(
        (s) => s.status === 'pending_admin_approval'
      );

      const hasRemainingDebts = simplified.some((t) => {
        const rem = typeof t.remainingDue === 'number' ? t.remainingDue : t.amount;
        return rem > 0.01;
      });

      const isFullySettledAndClosed = !hasRemainingDebts && pendingApprovalList.length === 0;

      let html = '';

      // 1. Overall Group / Event Settlement Status Banner
      if (isFullySettledAndClosed) {
        html += `
          <div data-testid="status-fully-closed-banner" class="mb-4 p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
            <span class="text-2xl">🎉</span>
            <div>
              <div class="text-sm font-bold text-emerald-300">All Group Debts Fully Settled & Closed!</div>
              <div class="text-xs text-slate-400 mt-0.5">Every member transaction has been fully verified and confirmed by the Admin. No pending dues or owing balances remain.</div>
            </div>
          </div>
        `;
      } else {
        const totalPendingDue = simplified.reduce((acc, t) => acc + (typeof t.remainingDue === 'number' ? t.remainingDue : t.amount), 0);
        const totalPendingApproval = pendingApprovalList.reduce((acc, s) => acc + s.amount, 0);

        html += `
          <div data-testid="status-pending-due-banner" class="mb-4 p-4 rounded-2xl bg-slate-900 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
              <div>
                <div class="text-xs font-bold text-amber-300 uppercase tracking-wide">Status: Pending Due or Owing</div>
                <div class="text-[11px] text-slate-400 mt-0.5">Event remains open until payees mark paid and the group Admin confirms receipt.</div>
              </div>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold">Remaining Due: ${formatINR(totalPendingDue)}</span>
              ${totalPendingApproval > 0 ? `<span class="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">Awaiting Admin: ${formatINR(totalPendingApproval)}</span>` : ''}
            </div>
          </div>
        `;
      }

      // 2. Actionable Pending Confirmation Action Inbox (for Admin OR receiving Creditor)
      const actionablePendingList = pendingApprovalList.filter((s) => {
        const isCreditor = s.toEmail && s.toEmail.toLowerCase().trim() === currentEmail;
        return isViewerAdminOfAny || isCreditor;
      });

      if (actionablePendingList.length > 0) {
        html += `
          <div data-testid="admin-approval-inbox" class="mb-5 p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 to-slate-900 border border-amber-500/40 space-y-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="text-lg">🤝</span>
                <h4 class="text-sm font-bold text-amber-200">Action Required: Pending Payment Confirmations (${actionablePendingList.length})</h4>
              </div>
              <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-400/25 text-amber-300 border border-amber-400/40">Dual Confirmation Handshake</span>
            </div>
            <p class="text-xs text-slate-300">
              Payments awaiting verification. If you are the receiving creditor or group admin, verify your bank/UPI account and confirm receipt to permanently close the debt:
            </p>
            <div class="space-y-2">
              ${actionablePendingList.map((s) => {
                const isCreditor = s.toEmail && s.toEmail.toLowerCase().trim() === currentEmail;
                return `
                <div data-testid="pending-approval-card-${escapeHtml(s.id)}" class="p-3.5 rounded-xl bg-slate-950/80 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div class="text-xs text-white flex items-center gap-1.5 flex-wrap">
                      <strong class="text-rose-300">${escapeHtml(s.fromName)}</strong> claims paid <strong class="text-emerald-300 text-sm">${formatINR(s.amount)}</strong> via <span class="text-teal-300 font-semibold">${escapeHtml(s.method)}</span>
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isCreditor ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}">
                        ${isCreditor ? 'You are Creditor 💰' : 'Group Admin 👑'}
                      </span>
                    </div>
                    <div class="text-[11px] text-slate-400 mt-1">
                      ${escapeHtml(s.fromEmail)} &rarr; ${escapeHtml(s.toEmail)} · ${escapeHtml(s.settledAt || 'Recent')}
                      ${s.utrNumber ? ` · <span class="text-emerald-300 font-mono-code font-bold">UTR: ${escapeHtml(s.utrNumber)}</span>` : ''}
                      ${s.referenceNote ? ` · Note: "<span class="text-slate-200">${escapeHtml(s.referenceNote)}</span>"` : ''}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <button data-testid="btn-confirm-settle-${escapeHtml(s.id)}" onclick="handleConfirmSettlement('${escapeHtml(s.id)}')" class="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition">
                      ✅ Confirm Full
                    </button>
                    <button data-testid="btn-partial-confirm-settle-${escapeHtml(s.id)}" onclick="handlePartialConfirmSettlement('${escapeHtml(s.id)}', ${Number(s.amount) || 0})" class="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-semibold text-xs transition">
                      ⚖️ Partial
                    </button>
                    <button data-testid="btn-reject-settle-${escapeHtml(s.id)}" onclick="handleRejectSettlement('${escapeHtml(s.id)}')" class="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-semibold text-xs transition">
                      ❌ Reject
                    </button>
                  </div>
                </div>
              `;}).join('')}
            </div>
          </div>
        `;
      }

      // 3. Routing Mode Banner
      const isHubActive = activeGroups.length > 0 && activeGroups.some((g) => g.adminHubSettlement === true);
      if (isHubActive) {
        html += `
          <div class="mb-3 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs text-amber-300">
            <span class="flex items-center gap-2">
              <span class="text-base">👑</span>
              <span><strong>Admin-Hub Routing Active:</strong> Everyone pays their share to the group Admin, and the Admin settles payouts to creditors.</span>
            </span>
          </div>
        `;
      } else {
        html += `
          <div class="mb-3 px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between text-xs text-emerald-300">
            <span class="flex items-center gap-2">
              <span class="text-base">⚡</span>
              <span><strong>Direct Peer-to-Peer Settlement (Standard):</strong> Minimized cash flow calculates the fewest direct transfers between debtors and creditors.</span>
            </span>
          </div>
        `;
      }

      // 4. Simplified Transactions List
      if (!simplified.length) {
        if (!isFullySettledAndClosed) {
          html += `<div class="p-6 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">No pending debt calculations remaining.</div>`;
        }
      } else {
        html += simplified
          .map((t, idx) => {
            const pendingAmt = t.pendingApprovalAmount || 0;
            const remDue = typeof t.remainingDue === 'number' ? t.remainingDue : Math.max(0, t.amount - pendingAmt);
            const remMsg = `Hey ${t.fromName}! Friendly reminder from Vasool: your remaining split share for the group is ${formatINR(remDue)}. Please settle via UPI or mark as paid. Link: ${window.location.origin}`;
            const waLink = `https://wa.me/?text=${encodeURIComponent(remMsg)}`;

            return `
              <div data-testid="settle-card-${idx}" class="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
                <div>
                  <div class="text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                    <strong class="text-rose-300">${escapeHtml(t.fromName)}</strong>
                    <span class="text-slate-400">pays</span>
                    <strong class="text-emerald-300">${escapeHtml(t.toName)}</strong>
                    ${t.type === 'pay_to_admin' ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">Pay to Admin 👑</span>' : ''}
                    ${t.type === 'admin_payout' ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">Admin Settlement 💸</span>' : ''}
                    ${t.type === 'standard_greedy' || (!t.isAdminTransfer && !t.type) ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Direct P2P ⚡</span>' : ''}
                  </div>
                  <div class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(t.fromEmail)} &rarr; ${escapeHtml(t.toEmail)}</div>
                  ${pendingAmt > 0 ? `
                    <div class="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-300 font-semibold">
                      <span>⏳ ${formatINR(pendingAmt)} paid</span>
                      <span class="text-slate-400">· Awaiting Admin Confirmation</span>
                    </div>
                  ` : ''}
                </div>
                <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <div class="text-right">
                    <div class="text-base font-extrabold text-white">${formatINR(t.amount)}</div>
                    ${pendingAmt > 0 ? `<div class="text-[10px] text-slate-400">Remaining Due: <strong class="text-rose-300">${formatINR(remDue)}</strong></div>` : ''}
                  </div>
                  <a href="${waLink}" target="_blank" rel="noopener noreferrer" title="Send WhatsApp reminder" class="px-2.5 py-1.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 font-semibold text-xs transition flex items-center gap-1 flex-shrink-0">
                    <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
                    <span>Remind</span>
                  </a>
                  ${remDue <= 0.01 && pendingAmt > 0 ? `
                    <span class="px-3.5 py-2 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold text-xs">
                      ⏳ Pending Approval
                    </span>
                  ` : `
                    <button data-testid="btn-record-payment-${idx}" onclick="openSettleConfirm('${escapeHtml(t.fromEmail)}', '${escapeHtml(t.fromName)}', '${escapeHtml(t.toEmail)}', '${escapeHtml(t.toName)}', ${remDue})" class="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition">
                      ${isViewerAdminOfAny ? 'Record Payment' : 'Mark as Settled'}
                    </button>
                  `}
                </div>
              </div>
            `;
          })
          .join('');
      }

      simpEl.innerHTML = html;

      // 5. Settlement History List
      if (!filteredSettlements.length) {
        histEl.innerHTML = `<div class="text-xs text-slate-500 py-6 text-center">No settlements recorded yet.</div>`;
      } else {
        histEl.innerHTML = filteredSettlements
          .map((s) => {
            const isConfirmed = s.status === 'confirmed';
            const isPending = s.status === 'pending_admin_approval';
            const isRejected = s.status === 'rejected';

            let statusBadge = '';
            if (isConfirmed) {
              const roleTitle = s.confirmedRole === 'creditor' ? 'Creditor' : 'Admin';
              statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">✅ Confirmed by ${roleTitle}</span>`;
            } else if (isPending) {
              statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">⏳ Awaiting Confirmation</span>`;
            } else if (isRejected) {
              statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">❌ Rejected: ${escapeHtml(s.rejectedReason || 'Unverified')}</span>`;
            }

            return `
              <div data-testid="settle-history-card-${escapeHtml(s.id)}" class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div class="text-xs">
                  <div class="flex items-center gap-2 flex-wrap">
                    <div><strong class="text-emerald-300">${escapeHtml(s.fromName)}</strong> paid <strong class="text-white">${escapeHtml(s.toName)}</strong></div>
                    ${statusBadge}
                  </div>
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    ${escapeHtml(s.method)} · ${escapeHtml(s.settledAt || 'Recent')}
                    ${s.utrNumber ? `· <span class="text-emerald-300 font-mono-code font-semibold">UTR: ${escapeHtml(s.utrNumber)}</span>` : ''}
                    ${s.referenceNote ? '· ' + escapeHtml(s.referenceNote) : ''}
                    ${s.confirmedByEmail ? `· Confirmed by ${escapeHtml(s.confirmedByEmail)}` : ''}
                  </div>
                </div>
                <div class="text-sm font-bold ${isConfirmed ? 'text-emerald-400' : isRejected ? 'text-rose-400 line-through' : 'text-amber-300'}">${formatINR(s.amount)}</div>
              </div>
            `;
          })
          .join('');
      }
    }

    // =========================================================================
    // ADD EXPENSE & 4-WAY SPLIT CALCULATOR
    // =========================================================================
    let editingExpenseId = null;
    const DEFAULT_FX_RATES_TO_INR = {
      INR: 1,
      USD: 84.0,
      EUR: 91.5,
      GBP: 108.0,
      AED: 22.9,
      SGD: 63.0,
      THB: 2.45
    };

    function handleBillCurrencyChange() {
      const curr = document.getElementById('expBillCurrencySelect')?.value || 'INR';
      const fxBox = document.getElementById('expFxRateContainer');
      const rateInp = document.getElementById('expExchangeRateInput');
      const origInp = document.getElementById('expOriginalAmountInput');
      const baseInp = document.getElementById('expAmountInput');
      if (curr === 'INR') {
        if (fxBox) fxBox.classList.add('hidden');
      } else {
        if (fxBox) fxBox.classList.remove('hidden');
        const rate = DEFAULT_FX_RATES_TO_INR[curr] || 84.0;
        if (rateInp) rateInp.value = String(rate);
        if (origInp && (!origInp.value || Number(origInp.value) <= 0)) {
          origInp.value = '50.00';
        }
        recalculateFxToBase();
      }
    }

    function recalculateFxToBase() {
      const curr = document.getElementById('expBillCurrencySelect')?.value || 'INR';
      if (curr === 'INR') return;
      const origAmt = Number(document.getElementById('expOriginalAmountInput')?.value) || 0;
      const rate = Number(document.getElementById('expExchangeRateInput')?.value) || 1;
      const converted = Math.round(origAmt * rate * 100) / 100;
      const badge = document.getElementById('expFxConvertedBadge');
      if (badge) {
        badge.textContent = `${origAmt.toFixed(2)} ${curr} × ₹${rate} = ₹${converted.toFixed(2)}`;
      }
      const baseInp = document.getElementById('expAmountInput');
      if (baseInp && converted > 0) {
        baseInp.value = String(converted);
        recalculateSplitPreview();
      }
    }

    function populateParentExpenseDropdown(groupId, selectedParentId = '') {
      const parentSel = document.getElementById('expParentBillSelect');
      if (!parentSel) return;
      const groupBills = appState.expenses.filter((e) => e.groupId === groupId && e.type !== 'income');
      parentSel.innerHTML = `<option value="">— General Group Income / Unlinked Refund —</option>` +
        groupBills.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.description)} (${formatINR(b.amount)})</option>`).join('');
      parentSel.value = selectedParentId || '';
    }

    function openAddExpenseModal() {
      editingExpenseId = null;
      const titleEl = document.getElementById('addExpenseModalTitle');
      const btnEl = document.getElementById('btnSaveExpenseSubmit');
      if (titleEl) titleEl.textContent = 'Add Shared Expense';
      if (btnEl) btnEl.textContent = 'Save Expense';

      const groupSel = document.getElementById('expGroupSelect');
      groupSel.innerHTML = appState.groups
        .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
        .join('');
      if (selectedGroupId !== 'ALL') {
        groupSel.value = selectedGroupId;
      }
      document.getElementById('expDescInput').value = '';
      document.getElementById('expAmountInput').value = '1200';
      if (document.getElementById('expBillCurrencySelect')) {
        document.getElementById('expBillCurrencySelect').value = 'INR';
        handleBillCurrencyChange();
      }
      setExpenseType('expense');
      currentSplitMode = 'equal';
      populateExpenseModalMembers();
      populateParentExpenseDropdown(groupSel.value);
      setSplitMode('equal');
      openModal('addExpenseModal');
    }

    function openEditExpenseModal(expId) {
      const exp = appState.expenses.find((e) => e.id === expId || e._id === expId);
      if (!exp) {
        showToast('Expense not found.', 'error');
        return;
      }
      editingExpenseId = exp.id || exp._id;
      const titleEl = document.getElementById('addExpenseModalTitle');
      const btnEl = document.getElementById('btnSaveExpenseSubmit');
      if (titleEl) titleEl.textContent = `Edit Expense: ${exp.description}`;
      if (btnEl) btnEl.textContent = 'Update Expense';

      const groupSel = document.getElementById('expGroupSelect');
      groupSel.innerHTML = appState.groups
        .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
        .join('');
      groupSel.value = exp.groupId;

      setExpenseType(exp.type || 'expense');
      document.getElementById('expCategorySelect').value = exp.category || '🍔 Food & Dining';
      document.getElementById('expDescInput').value = exp.description || '';
      document.getElementById('expAmountInput').value = String(exp.amount || 0);

      if (document.getElementById('expBillCurrencySelect')) {
        const origCurr = exp.originalCurrency || 'INR';
        document.getElementById('expBillCurrencySelect').value = origCurr;
        handleBillCurrencyChange();
        if (origCurr !== 'INR') {
          if (document.getElementById('expOriginalAmountInput')) {
            document.getElementById('expOriginalAmountInput').value = String(exp.originalAmount || exp.amount);
          }
          if (document.getElementById('expExchangeRateInput')) {
            document.getElementById('expExchangeRateInput').value = String(exp.exchangeRate || 1);
          }
        }
      }

      const existingPayers = Array.isArray(exp.paidByAllocations) && exp.paidByAllocations.length > 0
        ? exp.paidByAllocations
        : [{ memberEmail: exp.paidByEmail, memberName: exp.paidByName, amount: Number(exp.amount) || 0 }];

      populateExpenseModalMembers(existingPayers);
      populateParentExpenseDropdown(exp.groupId, exp.parentExpenseId || '');
      if (document.getElementById('expPaidBySelect') && exp.paidByEmail) {
        document.getElementById('expPaidBySelect').value = exp.paidByEmail;
      }
      setSplitMode(exp.splitType || 'equal');

      // Restore per-member amounts if exact
      if (Array.isArray(exp.splits)) {
        const splitEmails = new Set(exp.splits.map((s) => (s.memberEmail || '').toLowerCase().trim()));
        const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
        rows.forEach((r) => {
          const em = (r.dataset.memberEmail || '').toLowerCase().trim();
          const chk = r.querySelector('.exp-member-check');
          const inp = r.querySelector('.exp-member-input');
          const match = exp.splits.find((s) => (s.memberEmail || '').toLowerCase().trim() === em);
          if (chk) chk.checked = splitEmails.has(em);
          if (match && inp && exp.splitType === 'exact') {
            inp.value = String(match.amount);
          }
        });
        updateToggleAllSplitButton();
        recalculateSplitPreview();
      }

      openModal('addExpenseModal');
    }

    function openExpenseWithSuggestedPayer() {
      openAddExpenseModal();
      if (appState.suggestedPayer && appState.suggestedPayer.email) {
        const sugEmail = appState.suggestedPayer.email.toLowerCase().trim();
        const paidBySel = document.getElementById('expPaidBySelect');
        if (paidBySel) {
          const options = Array.from(paidBySel.options);
          const match = options.find((opt) => opt.value.toLowerCase() === sugEmail);
          if (match) paidBySel.value = match.value;
        }
        const payerRows = Array.from(document.querySelectorAll('#expPaidByMultiContainer > div'));
        const total = Number(document.getElementById('expAmountInput')?.value) || 0;
        payerRows.forEach((row) => {
          const em = (row.dataset.memberEmail || '').toLowerCase().trim();
          const chk = row.querySelector('.exp-payer-check');
          const amtInp = row.querySelector('.exp-payer-amount');
          if (chk) chk.checked = (em === sugEmail);
          if (amtInp) amtInp.value = (em === sugEmail) ? String(total) : '0';
        });
        handlePayerSelectionChange(false);
      }
    }

    function setExpenseType(type) {
      currentExpenseType = type;
      const btnExpense = document.getElementById('txTypeBtn_expense');
      const btnIncome = document.getElementById('txTypeBtn_income');
      const notice = document.getElementById('txTypeNotice');
      const catSelect = document.getElementById('expCategorySelect');

      const parentBox = document.getElementById('expParentBillContainer');
      if (type === 'income') {
        if (btnIncome) btnIncome.className = 'flex-1 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950 transition';
        if (btnExpense) btnExpense.className = 'flex-1 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition';
        if (notice) {
          notice.textContent = '💵 Income / Refund: Credited to all selected members and deducted from total group spend.';
          notice.classList.remove('hidden');
        }
        if (catSelect) catSelect.value = '💵 Income & Refunds';
        if (parentBox) {
          parentBox.classList.remove('hidden');
          populateParentExpenseDropdown(document.getElementById('expGroupSelect')?.value || '');
        }
      } else {
        if (btnExpense) btnExpense.className = 'flex-1 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950 transition';
        if (btnIncome) btnIncome.className = 'flex-1 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition';
        if (notice) {
          notice.textContent = '';
          notice.classList.add('hidden');
        }
        if (catSelect && catSelect.value === '💵 Income & Refunds') catSelect.value = '🍔 Food & Dining';
        if (parentBox) parentBox.classList.add('hidden');
      }
    }

    function populateExpenseModalMembers(preselectedPayers = null) {
      const groupId = document.getElementById('expGroupSelect').value;
      const group = appState.groups.find((g) => g.id === groupId) || appState.groups[0];
      if (!group) return;

      const paidBySel = document.getElementById('expPaidBySelect');
      if (paidBySel) {
        paidBySel.innerHTML = group.members
          .map((m) => `<option value="${escapeHtml(m.email)}">${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`)
          .join('');
      }

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const defaultPayerEmail = group.members.some((m) => (m.email || '').toLowerCase().trim() === currentEmail)
        ? currentEmail
        : (group.members[0]?.email || '').toLowerCase().trim();

      if (paidBySel && defaultPayerEmail) {
        const matchOpt = Array.from(paidBySel.options).find((o) => o.value.toLowerCase().trim() === defaultPayerEmail);
        if (matchOpt) paidBySel.value = matchOpt.value;
      }

      const totalBill = Number(document.getElementById('expAmountInput')?.value) || 0;
      const payerMap = {};
      if (Array.isArray(preselectedPayers) && preselectedPayers.length > 0) {
        preselectedPayers.forEach((p) => {
          const em = String(p.memberEmail || p.email || '').toLowerCase().trim();
          if (em) payerMap[em] = Number(p.amount) || 0;
        });
      } else if (defaultPayerEmail) {
        payerMap[defaultPayerEmail] = totalBill;
      }

      const multiContainer = document.getElementById('expPaidByMultiContainer');
      if (multiContainer) {
        const checkedCount = Object.keys(payerMap).length || 1;
        multiContainer.innerHTML = group.members
          .map((m) => {
            const mEmail = (m.email || '').toLowerCase().trim();
            const isChecked = Object.prototype.hasOwnProperty.call(payerMap, mEmail);
            const isMe = mEmail === currentEmail;
            const paidVal = isChecked ? payerMap[mEmail] : 0;
            return `
              <div class="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg border ${isChecked ? 'bg-emerald-950/25 border-emerald-500/35' : 'bg-slate-950/60 border-slate-800/80'} transition" data-member-email="${escapeHtml(m.email)}" data-member-name="${escapeHtml(m.name)}">
                <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer flex-1 min-w-0">
                  <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="handlePayerSelectionChange(true)" class="exp-payer-check rounded text-emerald-500 focus:ring-0" />
                  <span class="truncate font-medium">${escapeHtml(m.name)}</span>
                  ${isMe ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">You</span>' : ''}
                </label>
                <div class="flex items-center gap-1">
                  <span class="text-[10px] text-slate-400">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value="${isChecked ? paidVal : 0}"
                    oninput="handlePayerAmountInput()"
                    ${!isChecked ? 'disabled' : ''}
                    class="exp-payer-amount w-24 px-2 py-1 rounded-lg bg-slate-950 border ${isChecked ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-800 text-slate-500'} text-xs text-right font-mono-code focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>
            `;
          })
          .join('');
        updatePayerSummaryUI();
      }

      const container = document.getElementById('expMemberSplitsContainer');
      const equalPct = Math.round((100 / group.members.length) * 100) / 100;
      container.innerHTML = group.members
        .map(
          (m) => `
        <div class="flex items-center justify-between gap-2 py-1.5 border-b border-slate-800/60 last:border-none" data-member-email="${escapeHtml(m.email)}" data-member-name="${escapeHtml(m.name)}" data-default-weight="${m.defaultWeight || 1}">
          <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer flex-1 min-w-0">
            <input type="checkbox" onchange="handleMemberCheckChange()" class="exp-member-check rounded text-emerald-500 focus:ring-0" />
            <span class="truncate font-medium">${escapeHtml(m.name)}</span>
            ${m.role === 'admin' || (group.adminEmail && group.adminEmail.toLowerCase() === m.email.toLowerCase()) ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">👑 Admin</span>' : ''}
            ${(m.defaultWeight && m.defaultWeight !== 1) ? `<span class="px-1.5 py-0.5 rounded text-[10px] bg-teal-500/20 text-teal-300 font-semibold border border-teal-500/30">⚖️ ${m.defaultWeight}x Weight</span>` : ''}
          </label>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                min="0"
                value="${currentSplitMode === 'shares' ? (m.defaultWeight || 1) : currentSplitMode === 'percentage' ? equalPct : 0}"
                oninput="recalculateSplitPreview()"
                class="exp-member-input w-20 px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs text-right text-white ${currentSplitMode === 'equal' ? 'hidden' : ''}"
              />
              <span class="exp-member-unit text-[10px] text-slate-400 font-medium w-8 ${currentSplitMode === 'equal' ? 'hidden' : ''}">${currentSplitMode === 'percentage' ? '%' : currentSplitMode === 'shares' ? 'part' : '₹'}</span>
            </div>
            <span class="exp-member-computed text-xs font-mono-code font-semibold text-emerald-400 w-20 text-right">₹0.00</span>
          </div>
        </div>
      `
        )
        .join('');

      updateToggleAllSplitButton();
      recalculateSplitPreview();
    }

    function updateToggleAllSplitButton() {
      const btn = document.getElementById('btnToggleAllSplitMembers');
      if (!btn) return;
      const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
      if (!rows.length) {
        btn.textContent = 'Select All';
        return;
      }
      const checkboxes = rows.map((r) => r.querySelector('.exp-member-check')).filter(Boolean);
      const allChecked = checkboxes.length > 0 && checkboxes.every((c) => c.checked);
      btn.textContent = allChecked ? 'Unselect All' : 'Select All';
    }

    function handleMemberCheckChange() {
      updateToggleAllSplitButton();
      recalculateSplitPreview();
    }

    function toggleAllSplitMembers(forceState = null) {
      const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
      if (!rows.length) return;
      const checkboxes = rows.map((r) => r.querySelector('.exp-member-check')).filter(Boolean);
      const allChecked = checkboxes.length > 0 && checkboxes.every((c) => c.checked);
      const targetState = forceState !== null ? Boolean(forceState) : !allChecked;

      checkboxes.forEach((chk) => {
        chk.checked = targetState;
      });

      updateToggleAllSplitButton();
      recalculateSplitPreview();
    }

    function selectAllSplitMembers() {
      toggleAllSplitMembers(true);
    }

    function unselectAllSplitMembers() {
      toggleAllSplitMembers(false);
    }

    function setSplitMode(mode) {
      currentSplitMode = mode;
      ['equal', 'exact', 'percentage', 'shares'].forEach((m) => {
        const btn = document.getElementById('splitBtn_' + m);
        if (m === mode) {
          btn.className = 'py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950 transition';
        } else {
          btn.className = 'py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition';
        }
      });

      const hintEl = document.getElementById('splitModeHintText');
      if (hintEl) {
        if (mode === 'equal') hintEl.textContent = 'Split bill equally among all checked members.';
        else if (mode === 'exact') hintEl.textContent = 'Enter exact amounts per member. The sum must match the total bill.';
        else if (mode === 'percentage') hintEl.textContent = 'Enter percentages per member (e.g. 50%, 25%, 25%). Vasool computes the exact split.';
        else if (mode === 'shares') hintEl.textContent = 'Enter relative ratio / parts (e.g. 1 part, 2 parts for a couple, 0.5 for child). Proportionately calculated.';
      }

      const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
      const total = Number(document.getElementById('expAmountInput').value) || 0;
      const checkedCount = rows.filter((r) => r.querySelector('.exp-member-check').checked).length || 1;

      rows.forEach((row) => {
        const inp = row.querySelector('.exp-member-input');
        const unit = row.querySelector('.exp-member-unit');
        const checked = row.querySelector('.exp-member-check').checked;
        if (mode === 'equal') {
          inp.classList.add('hidden');
          if (unit) unit.classList.add('hidden');
        } else {
          inp.classList.remove('hidden');
          if (unit) {
            unit.classList.remove('hidden');
            unit.textContent = mode === 'percentage' ? '%' : mode === 'shares' ? 'part' : '₹';
          }
          if (!checked) {
            inp.value = '0';
          } else if (mode === 'exact') {
            inp.value = (Math.round((total / checkedCount) * 100) / 100).toFixed(2);
          } else if (mode === 'percentage') {
            inp.value = (Math.round((100 / checkedCount) * 100) / 100).toFixed(2);
          } else if (mode === 'shares') {
            inp.value = row.dataset.defaultWeight || '1';
          }
        }
      });

      recalculateSplitPreview();
    }

    function handlePayerSelectionChange(redistribute = true) {
      const rows = Array.from(document.querySelectorAll('#expPaidByMultiContainer > div'));
      if (!rows.length) return;
      const total = Number(document.getElementById('expAmountInput')?.value) || 0;
      const checkedRows = rows.filter((r) => r.querySelector('.exp-payer-check')?.checked);

      rows.forEach((r) => {
        const chk = r.querySelector('.exp-payer-check');
        const inp = r.querySelector('.exp-payer-amount');
        const isChecked = Boolean(chk && chk.checked);
        r.className = `flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg border ${isChecked ? 'bg-emerald-950/25 border-emerald-500/35' : 'bg-slate-950/60 border-slate-800/80'} transition`;
        if (inp) {
          inp.disabled = !isChecked;
          inp.className = `exp-payer-amount w-24 px-2 py-1 rounded-lg bg-slate-950 border ${isChecked ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-800 text-slate-500'} text-xs text-right font-mono-code focus:outline-none focus:border-emerald-400`;
          if (!isChecked) inp.value = '0';
        }
      });

      if (redistribute && checkedRows.length > 0) {
        if (checkedRows.length === 1) {
          const inp = checkedRows[0].querySelector('.exp-payer-amount');
          if (inp) inp.value = String(Math.round(total * 100) / 100);
        } else {
          const each = Math.floor((total / checkedRows.length) * 100) / 100;
          let sumSoFar = 0;
          checkedRows.forEach((r, idx) => {
            const inp = r.querySelector('.exp-payer-amount');
            if (!inp) return;
            if (idx === checkedRows.length - 1) {
              inp.value = String(Math.max(0, Math.round((total - sumSoFar) * 100) / 100));
            } else {
              inp.value = String(each);
              sumSoFar += each;
            }
          });
        }
      }

      // Sync hidden #expPaidBySelect to first checked payer
      const paidBySel = document.getElementById('expPaidBySelect');
      if (paidBySel && checkedRows.length > 0) {
        paidBySel.value = checkedRows[0].dataset.memberEmail || paidBySel.value;
      }

      updatePayerSummaryUI();
    }

    function handlePayerAmountInput() {
      const rows = Array.from(document.querySelectorAll('#expPaidByMultiContainer > div'));
      const checkedRows = rows.filter((r) => r.querySelector('.exp-payer-check')?.checked);
      if (checkedRows.length >= 1) {
        let sum = 0;
        checkedRows.forEach((r) => {
          const v = Number(r.querySelector('.exp-payer-amount')?.value) || 0;
          sum += Math.max(0, v);
        });
        sum = Math.round(sum * 100) / 100;
        if (checkedRows.length > 1 && sum > 0) {
          const totalInp = document.getElementById('expAmountInput');
          if (totalInp) {
            totalInp.value = String(sum);
            recalculateSplitPreview(true);
          }
        }
      }
      updatePayerSummaryUI();
    }

    function updatePayerSummaryUI() {
      const rows = Array.from(document.querySelectorAll('#expPaidByMultiContainer > div'));
      if (!rows.length) return;
      const total = Number(document.getElementById('expAmountInput')?.value) || 0;
      const checkedRows = rows.filter((r) => r.querySelector('.exp-payer-check')?.checked);
      const badge = document.getElementById('expPaidBySummaryBadge');
      const valBanner = document.getElementById('expPayerValidationBanner');

      let paidSum = 0;
      checkedRows.forEach((r) => {
        paidSum += Math.max(0, Number(r.querySelector('.exp-payer-amount')?.value) || 0);
      });
      paidSum = Math.round(paidSum * 100) / 100;

      if (badge) {
        if (checkedRows.length === 0) {
          badge.className = 'text-[11px] font-semibold text-rose-400';
          badge.textContent = 'Select at least 1 payer';
        } else if (checkedRows.length === 1) {
          const nm = (checkedRows[0].dataset.memberName || 'Member').split(' ')[0];
          badge.className = 'text-[11px] font-semibold text-emerald-400';
          badge.textContent = `Paid by ${nm} (${formatINR(paidSum)})`;
        } else {
          badge.className = 'text-[11px] font-semibold text-teal-300';
          badge.textContent = `${checkedRows.length} payers · Total ${formatINR(paidSum)}`;
        }
      }

      if (valBanner) {
        if (checkedRows.length > 1) {
          valBanner.classList.remove('hidden');
          const diff = Math.abs(total - paidSum);
          if (diff <= 0.05) {
            valBanner.className = 'text-[11px] font-medium text-emerald-400 px-1 flex items-center justify-between';
            valBanner.innerHTML = `<span>✓ Multi-payer spend matches total bill</span><span>${formatINR(paidSum)} / ${formatINR(total)}</span>`;
          } else {
            valBanner.className = 'text-[11px] font-medium text-amber-400 px-1 flex items-center justify-between';
            valBanner.innerHTML = `<span>⚠️ Payers sum (${formatINR(paidSum)}) ≠ Bill (${formatINR(total)})</span><span>Diff: ${formatINR(diff)}</span>`;
          }
        } else {
          valBanner.classList.add('hidden');
        }
      }
    }

    function recalculateSplitPreview(skipPayerSync = false) {
      const total = Number(document.getElementById('expAmountInput').value) || 0;
      if (!skipPayerSync) {
        const payerRows = Array.from(document.querySelectorAll('#expPaidByMultiContainer > div'));
        const checkedPayers = payerRows.filter((r) => r.querySelector('.exp-payer-check')?.checked);
        if (checkedPayers.length === 1) {
          const pInp = checkedPayers[0].querySelector('.exp-payer-amount');
          if (pInp) pInp.value = String(Math.round(total * 100) / 100);
        }
        updatePayerSummaryUI();
      }
      const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
      const activeRows = rows.filter((r) => r.querySelector('.exp-member-check').checked);

      let allocatedSum = 0;
      let totalShares = 0;
      let totalPercent = 0;
      if (currentSplitMode === 'shares') {
        activeRows.forEach((r) => {
          totalShares += Math.max(0, Number(r.querySelector('.exp-member-input').value) || 0);
        });
      } else if (currentSplitMode === 'percentage') {
        activeRows.forEach((r) => {
          totalPercent += Math.max(0, Number(r.querySelector('.exp-member-input').value) || 0);
        });
      }

      rows.forEach((row) => {
        const checked = row.querySelector('.exp-member-check').checked;
        const inp = row.querySelector('.exp-member-input');
        const out = row.querySelector('.exp-member-computed');
        if (!checked) {
          out.textContent = formatINR(0);
          row.dataset.computedAmount = '0';
          return;
        }

        let amt = 0;
        if (currentSplitMode === 'equal') {
          amt = activeRows.length ? total / activeRows.length : 0;
        } else if (currentSplitMode === 'exact') {
          amt = Number(inp.value) || 0;
        } else if (currentSplitMode === 'percentage') {
          const pct = Number(inp.value) || 0;
          amt = (total * pct) / 100;
        } else if (currentSplitMode === 'shares') {
          const sh = Number(inp.value) || 0;
          amt = totalShares > 0 ? (total * sh) / totalShares : 0;
        }

        amt = Math.round(amt * 100) / 100;
        allocatedSum += amt;
        row.dataset.computedAmount = String(amt);
        out.textContent = formatINR(amt);
      });

      const banner = document.getElementById('splitValidationBanner');
      const summary = document.getElementById('splitAllocationSummary');
      if (currentSplitMode === 'percentage') {
        summary.textContent = `${formatINR(allocatedSum)} / ${formatINR(total)} (${Math.round(totalPercent * 10) / 10}%)`;
      } else if (currentSplitMode === 'shares') {
        summary.textContent = `${formatINR(allocatedSum)} / ${formatINR(total)} (${Math.round(totalShares * 10) / 10} parts)`;
      } else {
        summary.textContent = `${formatINR(allocatedSum)} / ${formatINR(total)}`;
      }

      const diff = Math.abs(total - allocatedSum);
      if (diff <= 0.05 && activeRows.length > 0) {
        banner.className = 'text-xs font-medium text-emerald-400 flex items-center justify-between px-1';
      } else {
        banner.className = 'text-xs font-medium text-amber-400 flex items-center justify-between px-1';
      }
      updateToggleAllSplitButton();
    }

    async function handleSaveExpense(e) {
      e.preventDefault();
      const groupId = document.getElementById('expGroupSelect').value;
      const category = document.getElementById('expCategorySelect').value;
      const description = document.getElementById('expDescInput').value.trim();
      let amount = Number(document.getElementById('expAmountInput').value) || 0;
      const group = appState.groups.find((g) => g.id === groupId);

      // Extract multi-payer allocations from #expPaidByMultiContainer
      const payerRows = Array.from(document.querySelectorAll('#expPaidByMultiContainer > div'));
      const paidByAllocations = [];
      payerRows.forEach((r) => {
        const chk = r.querySelector('.exp-payer-check');
        const amtInp = r.querySelector('.exp-payer-amount');
        if (chk && chk.checked) {
          const pAmt = Math.round((Number(amtInp?.value) || 0) * 100) / 100;
          paidByAllocations.push({
            memberEmail: r.dataset.memberEmail,
            memberName: r.dataset.memberName,
            amount: pAmt
          });
        }
      });

      if (payerRows.length > 0 && paidByAllocations.length === 0) {
        showToast('Please select at least one person who paid for this expense.', 'error');
        return;
      }

      if (paidByAllocations.length === 1 && Math.abs(paidByAllocations[0].amount - amount) > 0.01) {
        paidByAllocations[0].amount = amount;
      } else if (paidByAllocations.length > 1) {
        const payerSum = Math.round(paidByAllocations.reduce((s, p) => s + p.amount, 0) * 100) / 100;
        if (payerSum <= 0) {
          showToast('Please enter the amount paid by each selected person.', 'error');
          return;
        }
        if (Math.abs(payerSum - amount) > 0.1) {
          showToast(`Total paid by selected payers (${formatINR(payerSum)}) must match the bill total (${formatINR(amount)}).`, 'error');
          return;
        }
      }

      let paidByEmail = document.getElementById('expPaidBySelect')?.value || (appState.currentUser?.email || '');
      let paidByName = paidByEmail;
      if (paidByAllocations.length > 0) {
        paidByEmail = paidByAllocations[0].memberEmail;
        paidByName = paidByAllocations.length > 1
          ? paidByAllocations.map((p) => `${p.memberName.split(' ')[0]} (₹${p.amount})`).join(' + ')
          : paidByAllocations[0].memberName;
      } else {
        const payerObj = group?.members.find((m) => m.email === paidByEmail);
        paidByName = payerObj ? payerObj.name : paidByEmail;
        paidByAllocations.push({ memberEmail: paidByEmail, memberName: paidByName, amount });
      }

      const rows = Array.from(document.querySelectorAll('#expMemberSplitsContainer > div'));
      const splits = [];
      let sum = 0;

      rows.forEach((r) => {
        if (r.querySelector('.exp-member-check').checked) {
          const mAmt = Number(r.dataset.computedAmount) || 0;
          sum += mAmt;
          splits.push({
            memberEmail: r.dataset.memberEmail,
            memberName: r.dataset.memberName,
            amount: mAmt
          });
        }
      });

      if (!splits.length) {
        showToast('Select at least one group member to split with.', 'error');
        return;
      }

      const roundingDiff = Math.round((amount - sum) * 100) / 100;
      let remainderAbsorbedBy = '';
      if (Math.abs(roundingDiff) <= 0.1 && splits.length > 0) {
        splits[0].amount = Math.round((splits[0].amount + roundingDiff) * 100) / 100;
        if (Math.abs(roundingDiff) > 0) {
          splits[0].roundingAdjustment = roundingDiff;
          remainderAbsorbedBy = splits[0].memberName;
        }
      } else if (Math.abs(roundingDiff) > 0.1) {
        showToast(`Split amounts (${formatINR(sum)}) must equal total bill (${formatINR(amount)}).`, 'error');
        return;
      }

      const originalCurrency = document.getElementById('expBillCurrencySelect')?.value || 'INR';
      const originalAmount = originalCurrency !== 'INR'
        ? (Number(document.getElementById('expOriginalAmountInput')?.value) || amount)
        : amount;
      const exchangeRate = originalCurrency !== 'INR'
        ? (Number(document.getElementById('expExchangeRateInput')?.value) || 1)
        : 1;

      const parentExpenseId = currentExpenseType === 'income'
        ? (document.getElementById('expParentBillSelect')?.value || null)
        : null;
      const parentExpenseObj = parentExpenseId
        ? appState.expenses.find((x) => x.id === parentExpenseId || x._id === parentExpenseId)
        : null;
      const parentExpenseDesc = parentExpenseObj ? parentExpenseObj.description : '';

      const payload = {
        groupId,
        description,
        amount,
        originalAmount,
        originalCurrency,
        exchangeRate,
        category,
        parentExpenseId,
        parentExpenseDesc,
        paidByEmail,
        paidByName,
        paidByAllocations,
        type: currentExpenseType,
        splitType: currentSplitMode,
        splits,
        roundingRemainder: roundingDiff,
        remainderAbsorbedBy
      };

      if (editingExpenseId) {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          try {
            await apiFetch(`/api/expenses/${editingExpenseId}`, {
              method: 'PUT',
              body: JSON.stringify(payload)
            });
          } catch (err) {
            console.warn('[Edit Expense] Server notice:', err.message);
          }
        }
        const idx = appState.expenses.findIndex((x) => x.id === editingExpenseId || x._id === editingExpenseId);
        if (idx !== -1) {
          appState.expenses[idx] = {
            ...appState.expenses[idx],
            ...payload,
            id: editingExpenseId
          };
        }
        recordLocalGroupAudit(
          groupId,
          'expense_updated',
          `${appState.currentUser?.name || 'Member'} edited "${description}" (${formatINR(amount)})`,
          `${currentSplitMode.toUpperCase()} split`
        );
        const editedId = editingExpenseId;
        editingExpenseId = null;
        closeModal('addExpenseModal');
        saveState();
        refreshAllViews();
        showToast(`✏️ Updated "${description}" (${formatINR(amount)}).`);
        return;
      }

      let expId = 'exp_' + Date.now();
      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.expense && res.expense._id) {
            expId = res.expense._id.toString();
          }
        } catch (err) {
          console.warn('[Save Expense] Server notice:', err.message);
        }
      }

      appState.expenses.unshift({
        id: expId,
        ...payload,
        date: new Date().toISOString().slice(0, 10)
      });

      recordLocalGroupAudit(
        groupId,
        currentExpenseType === 'income' ? 'refund_recorded' : 'expense_created',
        `${appState.currentUser?.name || 'Member'} added "${description}" (${formatINR(amount)})`,
        `${category} · ${currentSplitMode.toUpperCase()} split`
      );

      closeModal('addExpenseModal');
      saveState();
      refreshAllViews();
      recordRumAction('Save Expense', { category, split_type: currentSplitMode, amount });
      showToast(`Added "${description}" (${formatINR(amount)}) to ${group ? group.name : 'group'}.`);
    }

    // =========================================================================
    // GROUP & SETTLEMENT HANDLERS
    // =========================================================================
    async function handleCreateGroup(e) {
      e.preventDefault();
      const name = document.getElementById('newGroupName').value.trim();
      const category = document.getElementById('newGroupCategory').value;
      const rawMembers = document.getElementById('newGroupMembersInput').value;
      const adminHubSettlement = Boolean(document.getElementById('newGroupAdminHub')?.checked);

      const creator = appState.currentUser || { name: 'Guest User', email: 'guest@vasool.app' };
      const members = [{ name: creator.name, email: creator.email.toLowerCase(), role: 'admin' }];
      const seen = new Set([creator.email.toLowerCase()]);

      rawMembers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((token) => {
          const match = token.match(/^([^<]+)<([^>]+)>$/);
          let mName = token;
          let mEmail = '';
          if (match) {
            mName = match[1].trim();
            mEmail = match[2].trim().toLowerCase();
          } else if (token.includes('@')) {
            mEmail = token.trim().toLowerCase();
            const prefix = mEmail.split('@')[0];
            mName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
          } else {
            mName = token.trim();
            mEmail = mName.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@gmail.com';
          }
          if (!seen.has(mEmail)) {
            seen.add(mEmail);
            members.push({ name: mName, email: mEmail, role: 'member' });
          }
        });

      let grpId = 'grp_' + Date.now();
      let invCode = 'SPL-' + Math.random().toString(36).substring(2, 7).toUpperCase();

      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch('/api/groups', {
            method: 'POST',
            body: JSON.stringify({ name, category, currency: 'INR', members, adminHubSettlement })
          });
          if (res && res.group) {
            grpId = res.group._id ? res.group._id.toString() : grpId;
            invCode = res.group.inviteCode || invCode;
          }
        } catch (err) {
          console.warn('[Create Group] Server notice:', err.message);
        }
      }

      const newGrp = {
        id: grpId,
        name,
        category,
        currency: 'INR',
        inviteCode: invCode,
        adminHubSettlement,
        members
      };

      appState.groups.unshift(newGrp);
      document.getElementById('newGroupName').value = '';
      document.getElementById('newGroupMembersInput').value = '';
      if (document.getElementById('newGroupAdminHub')) {
        document.getElementById('newGroupAdminHub').checked = false;
      }
      closeModal('newGroupModal');
      saveState();
      refreshAllViews();
      showToast(`Created group "${name}" with ${members.length} members.`);
    }

    let pendingUnregisteredMemberData = null;
    let autocompleteDebounceTimer = null;
    let newGroupAutocompleteTimer = null;

    async function queryUserSuggestions(token) {
      const q = String(token || '').trim().toLowerCase();
      if (!q) return [];
      const seen = new Set();
      const results = [];

      const pushCandidate = (u) => {
        if (!u || !u.email) return;
        const em = String(u.email).toLowerCase().trim();
        if (seen.has(em)) return;
        seen.add(em);
        results.push({
          name: u.name || em.split('@')[0],
          email: em,
          upiId: u.upiId || ''
        });
      };

      // 1. Search local known users & group members first for instant response
      (appState.users || []).forEach((u) => {
        if ((u.name && u.name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q))) {
          pushCandidate(u);
        }
      });
      (appState.groups || []).forEach((g) => {
        (g.members || []).forEach((m) => {
          if ((m.name && m.name.toLowerCase().includes(q)) || (m.email && m.email.toLowerCase().includes(q))) {
            pushCandidate(m);
          }
        });
      });

      // 2. Also query backend /api/users/search when authenticated
      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(token.trim())}`);
          if (res && Array.isArray(res.users)) {
            res.users.forEach((u) => pushCandidate(u));
          }
        } catch (err) {
          console.warn('[Autocomplete search notice]', err.message);
        }
      }

      return results.slice(0, 8);
    }

    function handleNewGroupMembersInput(rawVal) {
      clearTimeout(newGroupAutocompleteTimer);
      const container = document.getElementById('newGroupMembersAutocomplete');
      if (!container) return;

      const parts = String(rawVal || '').split(',');
      const lastToken = (parts[parts.length - 1] || '').trim();
      if (lastToken.length < 1 || lastToken.includes('>')) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
      }

      newGroupAutocompleteTimer = setTimeout(async () => {
        const users = await queryUserSuggestions(lastToken);
        if (!users.length) {
          container.classList.add('hidden');
          container.innerHTML = '';
          return;
        }
        container.classList.remove('hidden');
        container.innerHTML = users
          .map((u) => {
            const ini = (u.name || u.email).slice(0, 2).toUpperCase();
            return `
              <div onclick="selectNewGroupMemberAutocomplete('${escapeHtml(u.name)}', '${escapeHtml(u.email)}')" class="p-2.5 hover:bg-slate-800/80 cursor-pointer flex items-center justify-between gap-2 transition">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs flex items-center justify-center flex-shrink-0">
                    ${escapeHtml(ini)}
                  </span>
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate">${escapeHtml(u.name)}</div>
                    <div class="text-[11px] text-slate-400 font-mono truncate">${escapeHtml(u.email)}</div>
                  </div>
                </div>
                <span class="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex-shrink-0">+ Add</span>
              </div>
            `;
          })
          .join('');
      }, 150);
    }

    function selectNewGroupMemberAutocomplete(name, email) {
      const inputEl = document.getElementById('newGroupMembersInput');
      const ac = document.getElementById('newGroupMembersAutocomplete');
      if (inputEl) {
        const parts = String(inputEl.value || '').split(',');
        parts.pop();
        const prefix = parts.map((p) => p.trim()).filter(Boolean);
        prefix.push(`${name} <${email}>`);
        inputEl.value = prefix.join(', ') + ', ';
        inputEl.focus();
      }
      if (ac) {
        ac.classList.add('hidden');
        ac.innerHTML = '';
      }
    }

    function openAddMemberModal(groupId) {
      document.getElementById('addMemberGroupId').value = groupId;
      document.getElementById('addMemberName').value = '';
      document.getElementById('addMemberEmail').value = '';
      const weightEl = document.getElementById('addMemberWeight');
      if (weightEl) weightEl.value = '1';
      const ac = document.getElementById('addMemberAutocomplete');
      if (ac) {
        ac.classList.add('hidden');
        ac.innerHTML = '';
      }
      const modalEl = document.getElementById('addMemberModal');
      if (modalEl) modalEl.style.zIndex = '65';
      openModal('addMemberModal');
      setTimeout(() => {
        const emInp = document.getElementById('addMemberEmail');
        if (emInp) emInp.focus();
      }, 50);
    }

    async function handleMemberEmailInput(query) {
      clearTimeout(autocompleteDebounceTimer);
      const container = document.getElementById('addMemberAutocomplete');
      if (!container) return;

      const parts = String(query || '').split(',');
      const lastToken = (parts[parts.length - 1] || '').trim();
      if (lastToken.length < 1 || lastToken.includes('>')) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
      }

      autocompleteDebounceTimer = setTimeout(async () => {
        try {
          const users = await queryUserSuggestions(lastToken);
          if (!users.length) {
            container.classList.remove('hidden');
            container.innerHTML = `
              <div class="p-3 text-xs text-slate-400 text-center">
                No registered user match for "${escapeHtml(lastToken)}". You can still invite via email or comma-separated list!
              </div>
            `;
            return;
          }

          container.classList.remove('hidden');
          container.innerHTML = users
            .map((u) => {
              const ini = (u.name || u.email).slice(0, 2).toUpperCase();
              return `
                <div onclick="selectAutocompleteUser('${escapeHtml(u.name)}', '${escapeHtml(u.email)}')" class="p-2.5 hover:bg-slate-800/80 cursor-pointer flex items-center justify-between gap-2 transition">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      ${escapeHtml(ini)}
                    </span>
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-white truncate">${escapeHtml(u.name)}</div>
                      <div class="text-[11px] text-slate-400 font-mono truncate">${escapeHtml(u.email)}</div>
                    </div>
                  </div>
                  <span class="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex-shrink-0">Select</span>
                </div>
              `;
            })
            .join('');
        } catch (err) {
          console.warn('[Autocomplete error]', err);
        }
      }, 150);
    }

    function selectAutocompleteUser(name, email) {
      const nameInput = document.getElementById('addMemberName');
      const emailInput = document.getElementById('addMemberEmail');
      if (emailInput) {
        const currentRaw = String(emailInput.value || '');
        if (currentRaw.includes(',')) {
          const parts = currentRaw.split(',');
          parts.pop();
          const prefix = parts.map((p) => p.trim()).filter(Boolean);
          prefix.push(`${name} <${email}>`);
          emailInput.value = prefix.join(', ') + ', ';
        } else {
          emailInput.value = email;
          if (nameInput) nameInput.value = name;
        }
        emailInput.focus();
      }
      const ac = document.getElementById('addMemberAutocomplete');
      if (ac) {
        ac.classList.add('hidden');
        ac.innerHTML = '';
      }
    }

    function parseMemberTokensList(rawEmailStr, fallbackSingleName = '', defaultWeight = 1) {
      const tokens = String(rawEmailStr || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const parsed = [];
      const seen = new Set();

      tokens.forEach((token) => {
        const angleMatch = token.match(/^([^<]+)<([^>]+)>$/);
        let mEmail = '';
        let mName = '';
        if (angleMatch) {
          mName = angleMatch[1].trim();
          mEmail = angleMatch[2].trim().toLowerCase();
        } else if (token.includes('@')) {
          mEmail = token.toLowerCase().trim();
          if (tokens.length === 1 && fallbackSingleName && String(fallbackSingleName).trim()) {
            mName = String(fallbackSingleName).trim();
          } else {
            const known = (appState.users || []).find((u) => (u.email || '').toLowerCase().trim() === mEmail);
            if (known && known.name) {
              mName = known.name;
            } else {
              const prefix = mEmail.split('@')[0].replace(/[._-]+/g, ' ');
              mName = prefix.replace(/\b\w/g, (c) => c.toUpperCase());
            }
          }
        } else {
          mName = token.trim();
          mEmail = mName.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@gmail.com';
        }
        if (mEmail && !seen.has(mEmail)) {
          seen.add(mEmail);
          parsed.push({
            name: mName || mEmail.split('@')[0],
            email: mEmail,
            defaultWeight: Number(defaultWeight) || 1
          });
        }
      });

      return parsed;
    }

    async function handleAddMemberSubmit(e) {
      e.preventDefault();
      const groupId = document.getElementById('addMemberGroupId').value;
      const name = document.getElementById('addMemberName').value.trim();
      const rawEmails = document.getElementById('addMemberEmail').value.trim();
      const weight = parseFloat(document.getElementById('addMemberWeight')?.value) || 1;

      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;

      const candidates = parseMemberTokensList(rawEmails, name, weight);
      if (!candidates.length) {
        showToast('Please enter at least one valid member email.', 'error');
        return;
      }

      // Check permission: admin, super admin, or if allowMembersToAddOthers is enabled
      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const isSuper = Boolean(appState.currentUser && (appState.currentUser.isSuperAdmin || appState.currentUser.role === 'super_admin' || currentEmail === 'mdzubair7592@gmail.com'));
      const currentAdmin = grp.members.find((m) => m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === m.email.toLowerCase())) || grp.members[0];
      const isCurrentUserAdmin = isSuper || (currentAdmin && currentAdmin.email.toLowerCase().trim() === currentEmail);
      if (!isCurrentUserAdmin && !grp.allowMembersToAddOthers) {
        showToast('Only the group admin can add members to this group.', 'error');
        return;
      }

      const existingSet = new Set((grp.members || []).map((m) => (m.email || '').toLowerCase().trim()));
      const newCandidates = candidates.filter((c) => !existingSet.has(c.email));
      if (!newCandidates.length) {
        showToast('All specified member(s) are already in this group.', 'error');
        return;
      }

      // If adding a single member, check if registered so we can offer multi-channel invite
      if (newCandidates.length === 1) {
        const single = newCandidates[0];
        let isRegistered = false;
        try {
          if (localStorage.getItem(AUTH_TOKEN_KEY)) {
            const checkRes = await apiFetch(`/api/users/check-email?email=${encodeURIComponent(single.email)}`);
            isRegistered = Boolean(checkRes && checkRes.exists);
            if (checkRes && checkRes.user && checkRes.user.name && (!name || name === single.email.split('@')[0])) {
              single.name = checkRes.user.name;
            }
          }
        } catch {}

        if (!isRegistered && localStorage.getItem(AUTH_TOKEN_KEY)) {
          pendingUnregisteredMemberData = { groupId, name: single.name, email: single.email, weight: single.defaultWeight, members: newCandidates };
          const h = document.getElementById('unregInviteTargetHeading');
          const s = document.getElementById('unregInviteTargetSub');
          if (h) h.textContent = `${single.email} is not on Vasool yet!`;
          if (s) {
            s.innerHTML = `<strong>${escapeHtml(single.name)}</strong> (${escapeHtml(single.email)}) doesn't have an active Vasool account yet. They will be added to <strong>${escapeHtml(grp.name)}</strong> as <span class="text-amber-300 font-semibold">⏳ Pending Acceptance</span>. Choose how you'd like to share the invite:`;
          }
          closeModal('addMemberModal');
          openModal('unregisteredInviteModal');
          return;
        }
      }

      await executeAddMember(groupId, newCandidates[0].name, rawEmails, weight, newCandidates);
      closeModal('addMemberModal');
    }

    async function executeAddMember(groupId, name, email, weight, parsedMembersArray = null) {
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;

      const membersToAdd = Array.isArray(parsedMembersArray) && parsedMembersArray.length > 0
        ? parsedMembersArray
        : parseMemberTokensList(email, name, weight);

      if (!membersToAdd.length) return;

      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch(`/api/groups/${groupId}/members`, {
            method: 'POST',
            body: JSON.stringify({
              name: membersToAdd[0].name,
              email: membersToAdd.map((m) => `${m.name} <${m.email}>`).join(', '),
              members: membersToAdd,
              defaultWeight: weight
            })
          });
          if (res && res.error) {
            showToast(res.error, 'error');
            return;
          }
          if (res && res.group && Array.isArray(res.group.members)) {
            grp.members = res.group.members;
          } else {
            const existingSet = new Set(grp.members.map((m) => (m.email || '').toLowerCase().trim()));
            membersToAdd.forEach((m) => {
              if (!existingSet.has(m.email)) {
                grp.members.push({
                  name: m.name,
                  email: m.email,
                  role: 'member',
                  status: 'pending_acceptance',
                  invitedAt: new Date().toISOString(),
                  defaultWeight: m.defaultWeight || weight || 1
                });
              }
            });
          }
        } catch (err) {
          showToast(err.message, 'error');
          return;
        }
      } else {
        const existingSet = new Set(grp.members.map((m) => (m.email || '').toLowerCase().trim()));
        membersToAdd.forEach((m) => {
          if (!existingSet.has(m.email)) {
            grp.members.push({
              name: m.name,
              email: m.email,
              role: 'member',
              status: 'pending_acceptance',
              invitedAt: new Date().toISOString(),
              defaultWeight: m.defaultWeight || weight || 1
            });
          }
        });
      }

      saveState();
      refreshAllViews();

      // Immediately refresh Group Details Modal if it is currently open for this group
      const detailsModal = document.getElementById('groupDetailsModal');
      if (activeDetailsGroupId === groupId && detailsModal && !detailsModal.classList.contains('hidden')) {
        renderGroupDetailsData(grp);
      }

      if (membersToAdd.length === 1) {
        showToast(`Invited ${membersToAdd[0].name} to ${grp.name}! Status: ⏳ Pending Acceptance.`);
      } else {
        showToast(`Invited ${membersToAdd.length} members (${membersToAdd.map((m) => m.name).join(', ')}) to ${grp.name}!`);
      }
    }

    async function confirmInviteViaChannel(channel) {
      if (!pendingUnregisteredMemberData) return;
      const { groupId, name, email, weight } = pendingUnregisteredMemberData;
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;

      const baseUrl = window.location.origin;
      const inviteLink = `${baseUrl}/?join=${encodeURIComponent(grp.inviteCode)}`;
      const shareMessage = `Hey ${name}! I've invited you to join "${grp.name}" on Vasool to split expenses. Click this link to accept and join: ${inviteLink}`;

      if (channel === 'link') {
        copyTextToClipboard(inviteLink, `Invite link for "${grp.name}" copied to clipboard!`);
      } else if (channel === 'share') {
        if (navigator.share) {
          try {
            await navigator.share({
              title: `Join ${grp.name} on Vasool`,
              text: shareMessage,
              url: inviteLink
            });
          } catch {
            window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank');
          }
        } else {
          window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank');
        }
      } else if (channel === 'email') {
        showToast(`Official invitation email queued for ${email}.`);
      }

      await executeAddMember(groupId, name, email, weight);
      closeModal('unregisteredInviteModal');
      pendingUnregisteredMemberData = null;
    }

    function openGroupSettingsModal(groupId) {
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;

      document.getElementById('settingsGroupId').value = groupId;
      document.getElementById('groupSettingsTitle').textContent = `Settings — ${grp.name}`;
      document.getElementById('settingAllowMembersAdd').checked = Boolean(grp.allowMembersToAddOthers);
      document.getElementById('settingSplitVisibility').value = grp.splitsVisibility || 'personal_only';
      document.getElementById('settingMinimizeDebts').value = grp.minimizeDebts !== false ? 'true' : 'false';
      document.getElementById('settingAdminHubSettlement').checked = Boolean(grp.adminHubSettlement);

      // Populate transfer admin dropdown
      const transferSel = document.getElementById('settingTransferAdminSelect');
      if (transferSel) {
        const currentAdmin = grp.members.find((m) => m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === m.email.toLowerCase())) || grp.members[0];
        const nonAdminActiveMembers = grp.members.filter((m) => m.email !== currentAdmin.email && m.status !== 'pending_acceptance');
        transferSel.innerHTML = '<option value="">Keep current admin (' + escapeHtml(currentAdmin.name) + ')</option>' +
          nonAdminActiveMembers.map((m) => `<option value="${escapeHtml(m.email)}">${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`).join('');
      }

      openModal('groupSettingsModal');
    }

    async function handleGroupSettingsSubmit(e) {
      e.preventDefault();
      const groupId = document.getElementById('settingsGroupId').value;
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;

      const allowMembersToAddOthers = document.getElementById('settingAllowMembersAdd').checked;
      const splitsVisibility = document.getElementById('settingSplitVisibility').value;
      const minimizeDebts = document.getElementById('settingMinimizeDebts').value === 'true';
      const adminHubSettlement = document.getElementById('settingAdminHubSettlement').checked;
      const newAdminEmail = document.getElementById('settingTransferAdminSelect').value;

      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/settings`, {
            method: 'PATCH',
            body: JSON.stringify({ allowMembersToAddOthers, splitsVisibility, minimizeDebts, adminHubSettlement })
          });
          if (res && res.error) {
            showToast(res.error, 'error');
            return;
          }
          if (newAdminEmail) {
            await apiFetch(`/api/groups/${groupId}/transfer-admin`, {
              method: 'POST',
              body: JSON.stringify({ newAdminEmail })
            });
          }
        }

        grp.allowMembersToAddOthers = allowMembersToAddOthers;
        grp.splitsVisibility = splitsVisibility;
        grp.minimizeDebts = minimizeDebts;
        grp.adminHubSettlement = adminHubSettlement;
        if (newAdminEmail) {
          grp.members.forEach((m) => {
            m.role = m.email.toLowerCase() === newAdminEmail.toLowerCase() ? 'admin' : 'member';
          });
          grp.adminEmail = newAdminEmail;
        }

        saveState();
        refreshAllViews();
        closeModal('groupSettingsModal');
        showToast(`Group settings updated successfully!`);
      } catch (err) {
        showToast('Failed to save settings: ' + err.message, 'error');
      }
    }

    async function handleAcceptInvite(groupId) {
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/accept-invite`, { method: 'POST' });
          if (res && res.error) {
            showToast(res.error, 'error');
            return;
          }
        }
        const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
        const grp = appState.groups.find((g) => g.id === groupId);
        if (grp) {
          const me = grp.members?.find((m) => m.email && m.email.toLowerCase().trim() === currentEmail);
          if (me) {
            me.status = 'active';
            me.acceptedAt = new Date().toISOString();
          }
        }
        saveState();
        refreshAllViews();
        showToast(`Joined group successfully! 🎉`);
      } catch (err) {
        showToast('Failed to accept invitation: ' + err.message, 'error');
      }
    }

    async function handleDeclineInvite(groupId) {
      // Direct execution without blocked confirm()
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/decline-invite`, { method: 'POST' });
          if (res && res.error) {
            showToast(res.error, 'error');
            return;
          }
        }
        appState.groups = appState.groups.filter((g) => g.id !== groupId);
        saveState();
        refreshAllViews();
        showToast('Invitation declined.');
      } catch (err) {
        showToast('Failed to decline invitation: ' + err.message, 'error');
      }
    }

    function renderPendingInvitesBanner() {
      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const pending = (appState.groups || []).filter((g) => {
        const me = g.members?.find((m) => m.email && m.email.toLowerCase().trim() === currentEmail);
        return me && me.status === 'pending_acceptance';
      });

      const containers = [
        document.getElementById('userPendingInvitesBannerGroups'),
        document.getElementById('userPendingInvitesBannerDashboard')
      ];

      containers.forEach((el) => {
        if (!el) return;
        if (!pending.length) {
          el.classList.add('hidden');
          el.innerHTML = '';
          return;
        }

        el.classList.remove('hidden');
        el.innerHTML = `
          <div class="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-slate-900 border border-amber-500/30 text-amber-200 shadow-xl space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-bold text-white text-sm">
                <span class="text-lg">📩</span>
                <span>You have ${pending.length} pending group invitation${pending.length > 1 ? 's' : ''}!</span>
              </div>
              <span class="text-[10px] uppercase tracking-wider font-extrabold px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">Action Required</span>
            </div>
            <p class="text-xs text-slate-300">
              You've been invited to join the following expense group${pending.length > 1 ? 's' : ''}. Accept to start viewing and splitting bills:
            </p>
            <div class="space-y-2 pt-1">
              ${pending.map((pg) => `
                <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div class="font-bold text-white text-sm">${escapeHtml(pg.name)} <span class="text-[10px] font-normal text-teal-300 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20">${escapeHtml(pg.category || 'Trip')}</span></div>
                    <div class="text-xs text-slate-400 mt-0.5">Invited by: <strong class="text-slate-300">${escapeHtml(pg.adminEmail || 'Group Admin')}</strong> · ${pg.members ? pg.members.length : 0} members</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button onclick="handleAcceptInvite('${escapeHtml(pg.id)}')" data-testid="btn-accept-invite-${escapeHtml(pg.id)}" class="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md transition">
                      ✓ Accept Invitation
                    </button>
                    <button onclick="handleDeclineInvite('${escapeHtml(pg.id)}')" data-testid="btn-decline-invite-${escapeHtml(pg.id)}" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-700 text-xs font-semibold transition">
                      ✕ Decline
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });
    }

    if (typeof window !== 'undefined') {
      window.renderPendingInvitesBanner = renderPendingInvitesBanner;
    }

    function copyInviteLink(inviteCode, groupName) {
      const baseUrl = window.location.origin;
      const link = `${baseUrl}/?join=${encodeURIComponent(inviteCode)}`;
      copyTextToClipboard(link, `Invite link for "${groupName}" copied to clipboard!`);
      recordRumAction('Share Invite Link', { group: groupName, code: inviteCode });
    }

    async function handleJoinGroupSubmit(e) {
      e.preventDefault();
      const inputEl = document.getElementById('joinGroupCodeInput');
      let raw = (inputEl ? inputEl.value : '').trim();
      if (raw.includes('join=')) {
        raw = raw.split('join=')[1].split('&')[0];
      } else if (raw.includes('/')) {
        raw = raw.split('/').pop();
      }
      const inviteCode = raw.toUpperCase().trim();
      if (!inviteCode) return;

      const btn = document.getElementById('btnJoinGroupSubmit');
      if (btn) { btn.disabled = true; btn.textContent = 'Joining...'; }

      try {
        const res = await apiFetch('/api/groups/join', {
          method: 'POST',
          body: JSON.stringify({ inviteCode })
        });

        closeModal('joinGroupModal');
        if (inputEl) inputEl.value = '';

        recordRumAction('Join Group', { code: inviteCode });
        showToast(res.message || `Joined group "${res.group?.name || inviteCode}"!`);
        await syncWithBackend();
        refreshAllViews();
        if (res.group?._id) {
          selectGroupAndOpenExpenses(res.group._id);
        }
      } catch (err) {
        showToast(err.message || 'Failed to join group. Check the invite code and try again.', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Join Group'; }
      }
    }

    async function checkAndProcessPendingJoin() {
      const code = sessionStorage.getItem('pending_join_code');
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!code || !token) return;

      try {
        const res = await apiFetch('/api/groups/join', {
          method: 'POST',
          body: JSON.stringify({ inviteCode: code })
        });
        sessionStorage.removeItem('pending_join_code');
        const banner = document.getElementById('authPendingInviteBanner');
        if (banner) banner.classList.add('hidden');

        if (window.history && window.history.replaceState) {
          const cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);
        }

        showToast(res.message || `Joined group "${res.group?.name || code}"!`);
        await syncWithBackend();
        refreshAllViews();
        if (res.group?._id) {
          selectGroupAndOpenExpenses(res.group._id);
        }
      } catch (err) {
        sessionStorage.removeItem('pending_join_code');
        showToast(err.message || 'Could not join group with invite code ' + code, 'error');
      }
    }

    function generateOfflineUpiSvgDataUri(upiId, amount) {
      // Deterministic visual QR matrix SVG so QR code renders even offline
      let hash = 0;
      const seed = `${upiId}:${amount}`;
      for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
      }
      let cells = '';
      for (let r = 0; r < 11; r++) {
        for (let c = 0; c < 11; c++) {
          const isCorner = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
          const bit = isCorner || (((Math.abs(hash + r * 17 + c * 31)) % 3) === 0);
          if (bit) {
            cells += `<rect x="${10 + c * 14}" y="${10 + r * 14}" width="12" height="12" rx="2" fill="#064e3b"/>`;
          }
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 174 174"><rect width="174" height="174" rx="12" fill="#ffffff"/>${cells}</svg>`;
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    function updateSettlementUpiData() {
      const upiInput = document.getElementById('settleUpiIdInput');
      const toName = document.getElementById('settleToName')?.value || 'Vasool Member';
      const amount = Number(document.getElementById('settleAmountInput')?.value) || 0;
      const upiId = upiInput ? upiInput.value.trim() : '';

      const upiSection = document.getElementById('settleUpiSection');
      const noUpiNotice = document.getElementById('settleNoUpiNotice');
      const noUpiNameEl = document.getElementById('settleNoUpiRecipientName');
      const linkEl = document.getElementById('settleUpiDeepLink');
      const qrImg = document.getElementById('settleQrImage');

      if (noUpiNameEl) noUpiNameEl.textContent = toName;

      // STRICT UPI RULE: If the recipient has not set a UPI ID, never fabricate one and hide the UPI app redirect section
      if (!upiId || !upiId.includes('@')) {
        if (upiSection) upiSection.classList.add('hidden');
        if (noUpiNotice) noUpiNotice.classList.remove('hidden');
        if (linkEl) linkEl.href = '#';
        if (qrImg) qrImg.src = '';
        return;
      }

      if (upiSection) upiSection.classList.remove('hidden');
      if (noUpiNotice) noUpiNotice.classList.add('hidden');

      const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(toName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Vasool Settlement')}`;
      if (linkEl) linkEl.href = upiUri;

      if (qrImg) {
        const fallbackSvg = generateOfflineUpiSvgDataUri(upiId, amount);
        qrImg.onerror = () => {
          qrImg.onerror = null;
          qrImg.src = fallbackSvg;
        };
        qrImg.src = fallbackSvg;
      }
    }

    function resolveRecipientUpiId(toEmail, groupId) {
      const targetEmail = String(toEmail || '').toLowerCase().trim();
      if (!targetEmail) return '';

      // 1. Check if recipient is currentUser
      if (appState.currentUser && (appState.currentUser.email || '').toLowerCase().trim() === targetEmail) {
        return String(appState.currentUser.upiId || '').trim();
      }

      // 2. Check target group member record
      const grp = appState.groups.find((g) => g.id === groupId);
      const grpMember = grp?.members?.find((m) => (m.email || '').toLowerCase().trim() === targetEmail);
      if (grpMember && grpMember.upiId && String(grpMember.upiId).trim()) {
        return String(grpMember.upiId).trim();
      }

      // 3. Check across any other group member record
      for (const g of (appState.groups || [])) {
        const m = (g.members || []).find((mem) => (mem.email || '').toLowerCase().trim() === targetEmail && mem.upiId);
        if (m && String(m.upiId).trim()) return String(m.upiId).trim();
      }

      // 4. Check in appState.users
      const usr = (appState.users || []).find((u) => (u.email || '').toLowerCase().trim() === targetEmail);
      if (usr && usr.upiId && String(usr.upiId).trim()) {
        return String(usr.upiId).trim();
      }

      // Never auto-generate or guess a fake UPI ID if the user hasn't set one
      return '';
    }

    async function openSettleConfirm(fromEmail, fromName, toEmail, toName, amount) {
      const targetGroupId = selectedGroupId === 'ALL' ? appState.groups[0]?.id || '' : selectedGroupId;
      document.getElementById('settleFromEmail').value = fromEmail;
      document.getElementById('settleFromName').value = fromName;
      document.getElementById('settleToEmail').value = toEmail;
      document.getElementById('settleToName').value = toName;
      document.getElementById('settleGroupId').value = targetGroupId;
      document.getElementById('settleAmountInput').value = amount;
      document.getElementById('settleNoteInput').value = '';
      if (document.getElementById('settleUtrInput')) document.getElementById('settleUtrInput').value = '';

      let verifiedUpi = resolveRecipientUpiId(toEmail, targetGroupId);
      const upiInput = document.getElementById('settleUpiIdInput');
      if (upiInput) upiInput.value = verifiedUpi;

      const methodSel = document.getElementById('settleMethodSelect');
      if (methodSel) {
        methodSel.value = verifiedUpi ? 'UPI' : 'Cash';
      }

      document.getElementById('settleModalSummaryBox').innerHTML = `
        Recording payment from <strong class="text-rose-300">${escapeHtml(fromName)}</strong> to <strong class="text-emerald-300">${escapeHtml(toName)}</strong>
      `;

      updateSettlementUpiData();
      openModal('settleConfirmModal');

      // Live check against backend User record to ensure we have the recipient's latest UPI ID
      if (localStorage.getItem(AUTH_TOKEN_KEY) && toEmail) {
        try {
          const checkRes = await apiFetch(`/api/users/check-email?email=${encodeURIComponent(toEmail)}`);
          if (checkRes && checkRes.exists && checkRes.user) {
            const liveUpi = String(checkRes.user.upiId || '').trim();
            // Cache on group member & user
            (appState.groups || []).forEach((g) => {
              (g.members || []).forEach((m) => {
                if ((m.email || '').toLowerCase().trim() === toEmail.toLowerCase().trim()) {
                  m.upiId = liveUpi;
                }
              });
            });
            if (upiInput) upiInput.value = liveUpi;
            if (methodSel) methodSel.value = liveUpi ? 'UPI' : 'Cash';
            updateSettlementUpiData();
          }
        } catch (err) {
          console.warn('[Settle UPI check notice]', err.message);
        }
      }
    }

    async function confirmSettlementSubmit(e) {
      e.preventDefault();
      const fromEmail = document.getElementById('settleFromEmail').value;
      const fromName = document.getElementById('settleFromName').value;
      const toEmail = document.getElementById('settleToEmail').value;
      const toName = document.getElementById('settleToName').value;
      const groupId = document.getElementById('settleGroupId').value;
      const amount = Number(document.getElementById('settleAmountInput').value) || 0;
      const method = document.getElementById('settleMethodSelect').value;
      const utrNumber = document.getElementById('settleUtrInput') ? document.getElementById('settleUtrInput').value.trim() : '';
      const referenceNote = document.getElementById('settleNoteInput').value.trim();

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const grp = appState.groups.find((g) => g.id === groupId) || appState.groups[0];
      const adminMember = grp ? (grp.members?.find((m) => m.role === 'admin' || (grp.adminEmail && grp.adminEmail.toLowerCase() === m.email.toLowerCase())) || grp.members?.[0]) : null;
      const isViewerAdmin = adminMember && adminMember.email.toLowerCase().trim() === currentEmail;
      const isTargetCreditor = toEmail.toLowerCase().trim() === currentEmail;
      const isDirectlyConfirmed = isViewerAdmin || isTargetCreditor;

      let stlId = 'stl_' + Date.now();
      let status = isDirectlyConfirmed ? 'confirmed' : 'pending_admin_approval';
      let confirmedAt = isDirectlyConfirmed ? new Date().toISOString() : null;
      let confirmedByEmail = isDirectlyConfirmed ? currentEmail : null;
      let confirmedRole = isTargetCreditor ? 'creditor' : (isViewerAdmin ? 'admin' : '');

      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch('/api/settlements', {
            method: 'POST',
            body: JSON.stringify({
              groupId,
              fromEmail,
              fromName,
              toEmail,
              toName,
              amount,
              method,
              referenceNote,
              utrNumber
            })
          });
          if (res && res.settlement && res.settlement._id) {
            stlId = res.settlement._id.toString();
            status = res.settlement.status || status;
            confirmedAt = res.settlement.confirmedAt || confirmedAt;
            confirmedByEmail = res.settlement.confirmedByEmail || confirmedByEmail;
            confirmedRole = res.settlement.confirmedRole || confirmedRole;
          }
        } catch (err) {
          console.warn('[Settlement] Server notice:', err.message);
        }
      }

      appState.settlements.unshift({
        id: stlId,
        groupId,
        fromEmail,
        fromName,
        toEmail,
        toName,
        amount,
        currency: 'INR',
        method,
        referenceNote,
        utrNumber,
        status,
        confirmedAt,
        confirmedByEmail,
        confirmedRole,
        settledAt: new Date().toISOString().slice(0, 10)
      });

      closeModal('settleConfirmModal');
      saveState();
      refreshAllViews();

      if (status === 'confirmed') {
        showToast(`✅ Payment of ${formatINR(amount)} confirmed and settled.`);
      } else {
        showToast(`⏳ Payment of ${formatINR(amount)} marked as paid. Awaiting creditor or admin confirmation.`);
      }
    }

    if (typeof window !== 'undefined') {
      window.toggleAllSplitMembers = toggleAllSplitMembers;
      window.selectAllSplitMembers = selectAllSplitMembers;
      window.unselectAllSplitMembers = unselectAllSplitMembers;
      window.handleMemberCheckChange = handleMemberCheckChange;
      window.updateToggleAllSplitButton = updateToggleAllSplitButton;
    }
