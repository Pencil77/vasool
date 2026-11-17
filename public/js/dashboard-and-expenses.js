// =========================================================================
    // MINIMUM-CASH-FLOW DEBT SIMPLIFICATION ENGINE
    // =========================================================================
    function getClientExpensePayerAllocations(exp) {
      if (Array.isArray(exp.paidByAllocations) && exp.paidByAllocations.length > 0) {
        const valid = exp.paidByAllocations
          .map((p) => ({
            memberEmail: String(p.memberEmail || p.email || '').toLowerCase().trim(),
            memberName: String(p.memberName || p.name || p.memberEmail || 'Member').trim(),
            amount: Math.round((Number(p.amount) || 0) * 100) / 100
          }))
          .filter((p) => p.memberEmail && p.amount > 0);
        if (valid.length > 0) return valid;
      }
      return [
        {
          memberEmail: String(exp.paidByEmail || '').toLowerCase().trim(),
          memberName: String(exp.paidByName || exp.paidByEmail || 'Member').trim(),
          amount: Math.round((Number(exp.amount) || 0) * 100) / 100
        }
      ];
    }

    /**
     * Builds an evidence-based settlement ledger for a single group.
     *
     * A split participant's share on a bill may only be considered settled when a
     * settlement recorded by the payer has been confirmed (acknowledged) by a
     * receiver. Confirmed settlements are allocated oldest-bill-first to that
     * payer's outstanding shares (same creditor first, then remaining shares).
     * Pending settlements (recorded but not yet acknowledged) are tracked
     * separately so the UI can show them as unconfirmed.
     *
     * Returns: { "expenseId|debtorEmail": { owed, confirmed, pending } }
     */
    function buildGroupSplitSettlementLedger(groupId, expenses = [], settlements = []) {
      const ledger = {};
      if (!groupId) return ledger;

      const orderedExpenses = (expenses || [])
        .map((e, idx) => ({ e, idx }))
        .filter(({ e }) => String(e.groupId) === String(groupId))
        .sort((a, b) => {
          const ta = new Date(a.e.expenseDate || a.e.createdAt || 0).getTime();
          const tb = new Date(b.e.expenseDate || b.e.createdAt || 0).getTime();
          const va = Number.isFinite(ta) && ta > 0 ? ta : a.idx;
          const vb = Number.isFinite(tb) && tb > 0 ? tb : b.idx;
          return va - vb || a.idx - b.idx;
        });

      const obligationsByDebtor = {};
      const bucketFor = (debtorEmail, debtorName) => {
        if (!obligationsByDebtor[debtorEmail]) {
          obligationsByDebtor[debtorEmail] = { name: debtorName, obligations: [] };
        }
        return obligationsByDebtor[debtorEmail];
      };

      orderedExpenses.forEach(({ e }) => {
        const expenseId = String(e.id || e._id || '');
        if (!expenseId) return;
        const payers = getClientExpensePayerAllocations(e);
        const totalPaid = payers.reduce((sum, p) => sum + p.amount, 0) || Number(e.amount) || 1;
        const isIncome = e.type === 'income';

        (e.splits || []).forEach((s) => {
          const splitEmail = String(s.memberEmail || '').toLowerCase().trim();
          const splitAmount = Number(s.amount) || 0;
          if (!splitEmail || splitAmount <= 0) return;

          payers.forEach((p) => {
            const payerEmail = String(p.memberEmail || '').toLowerCase().trim();
            if (!payerEmail || payerEmail === splitEmail) return;
            const portion = Math.round(splitAmount * (p.amount / totalPaid) * 100) / 100;
            if (portion <= 0) return;

            if (isIncome) {
              bucketFor(payerEmail, p.memberName).obligations.push({
                expenseId,
                debtorEmail: payerEmail,
                creditorEmail: splitEmail,
                creditorName: s.memberName,
                amount: portion,
                confirmed: 0,
                pending: 0
              });
            } else {
              bucketFor(splitEmail, s.memberName).obligations.push({
                expenseId,
                debtorEmail: splitEmail,
                creditorEmail: payerEmail,
                creditorName: p.memberName,
                amount: portion,
                confirmed: 0,
                pending: 0
              });
            }
          });
        });
      });

      const applyAmount = (entry, creditorEmail, amount, field) => {
        if (!entry) return;
        let remaining = Math.round((Number(amount) || 0) * 100) / 100;
        if (remaining <= 0.01) return;

        const roomFor = (ob) => Math.max(0, Math.round((ob.amount - ob.confirmed - ob.pending) * 100) / 100);

        // Prefer obligations owed to the actual receiver of the payment.
        for (const ob of entry.obligations) {
          if (remaining <= 0.01) break;
          if (ob.creditorEmail !== creditorEmail) continue;
          const room = field === 'confirmed' ? Math.max(0, Math.round((ob.amount - ob.confirmed) * 100) / 100) : roomFor(ob);
          const take = Math.min(remaining, room);
          if (take <= 0.01) continue;
          ob[field] = Math.round((ob[field] + take) * 100) / 100;
          remaining = Math.round((remaining - take) * 100) / 100;
        }

        // Any remainder spills over to the debtor's other oldest outstanding shares
        // (covers netted/admin-hub payments routed through a different receiver).
        for (const ob of entry.obligations) {
          if (remaining <= 0.01) break;
          const room = field === 'confirmed' ? Math.max(0, Math.round((ob.amount - ob.confirmed) * 100) / 100) : roomFor(ob);
          const take = Math.min(remaining, room);
          if (take <= 0.01) continue;
          ob[field] = Math.round((ob[field] + take) * 100) / 100;
          remaining = Math.round((remaining - take) * 100) / 100;
        }
      };

      const confirmedByDebtor = {};
      const pendingByDebtor = {};

      (settlements || []).forEach((st) => {
        if (String(st.groupId) !== String(groupId)) return;
        const fromEmail = String(st.fromEmail || '').toLowerCase().trim();
        const toEmail = String(st.toEmail || '').toLowerCase().trim();
        const amount = Number(st.amount) || 0;
        if (!fromEmail || !toEmail || amount <= 0) return;

        const isConfirmed = st.status === 'confirmed' || (!st.status && !st.isPending);
        const isPending = st.status === 'pending_admin_approval' || st.status === 'pending_confirmation' || st.status === 'pending';
        if (!isConfirmed && !isPending) return;

        const target = isConfirmed ? confirmedByDebtor : pendingByDebtor;
        if (!target[fromEmail]) target[fromEmail] = [];
        target[fromEmail].push({
          creditorEmail: toEmail,
          amount,
          at: new Date(st.settledAt || st.updatedAt || st.createdAt || 0).getTime() || 0
        });
      });

      const applyAll = (bucket, field) => {
        Object.keys(bucket).forEach((debtorEmail) => {
          const entry = obligationsByDebtor[debtorEmail];
          if (!entry) return;
          bucket[debtorEmail]
            .sort((a, b) => a.at - b.at)
            .forEach((st) => applyAmount(entry, st.creditorEmail, st.amount, field));
        });
      };

      applyAll(confirmedByDebtor, 'confirmed');
      applyAll(pendingByDebtor, 'pending');

      Object.keys(obligationsByDebtor).forEach((debtorEmail) => {
        obligationsByDebtor[debtorEmail].obligations.forEach((ob) => {
          const key = `${ob.expenseId}|${debtorEmail}`;
          if (!ledger[key]) ledger[key] = { owed: 0, confirmed: 0, pending: 0 };
          ledger[key].owed = Math.round((ledger[key].owed + ob.amount) * 100) / 100;
          ledger[key].confirmed = Math.round((ledger[key].confirmed + ob.confirmed) * 100) / 100;
          ledger[key].pending = Math.round((ledger[key].pending + ob.pending) * 100) / 100;
        });
      });

      return ledger;
    }
    if (typeof window !== 'undefined') {
      window.buildGroupSplitSettlementLedger = buildGroupSplitSettlementLedger;
    }

    function computeBalancesAndSimplifications(groupFilterId = 'ALL', customState = null) {
      const stateRef = customState || appState;
      const activeGroups =
        groupFilterId === 'ALL'
          ? stateRef.groups
          : stateRef.groups.filter((g) => g.id === groupFilterId);
      const activeGroupIds = new Set(activeGroups.map((g) => g.id));

      const balanceMap = {};
      const simplified = [];
      const settlementLedger = {};
      let totalSpend = 0;

      const filteredExpenses = stateRef.expenses.filter((e) => activeGroupIds.has(e.groupId));
      const filteredSettlements = stateRef.settlements.filter((s) => activeGroupIds.has(s.groupId));

      activeGroups.forEach((g) => {
        const grpExpenses = stateRef.expenses.filter((e) => e.groupId === g.id);
        const grpSettlements = stateRef.settlements.filter((s) => s.groupId === g.id);

        const grpBalanceMap = {};
        const ensureGrpPerson = (email, name) => {
          const key = String(email || '').toLowerCase().trim();
          if (!key) return null;
          if (!grpBalanceMap[key]) {
            grpBalanceMap[key] = {
              email: key,
              name: name || key,
              paid: 0,
              owed: 0,
              net: 0,
              paidExpenses: 0,
              owedSplits: 0,
              settledPaid: 0,
              settledReceived: 0,
              pendingPaid: 0,
              pendingReceived: 0,
              unconfirmedNet: 0
            };
          }
          return grpBalanceMap[key];
        };

        (g.members || []).forEach((m) => ensureGrpPerson(m.email, m.name));

        let grpSpend = 0;
        grpExpenses.forEach((exp) => {
          const isIncome = exp.type === 'income';
          const amt = Number(exp.amount) || 0;
          const payers = getClientExpensePayerAllocations(exp);

          if (isIncome) {
            grpSpend -= amt;
            payers.forEach((p) => {
              const payer = ensureGrpPerson(p.memberEmail, p.memberName);
              if (payer) {
                payer.paid -= p.amount;
                payer.paidExpenses -= p.amount;
                payer.net -= p.amount;
              }
            });
            (exp.splits || []).forEach((s) => {
              const part = ensureGrpPerson(s.memberEmail, s.memberName);
              if (part) {
                part.owed -= Number(s.amount);
                part.owedSplits -= Number(s.amount);
                part.net += Number(s.amount);
              }
            });
          } else {
            grpSpend += amt;
            payers.forEach((p) => {
              const payer = ensureGrpPerson(p.memberEmail, p.memberName);
              if (payer) {
                payer.paid += p.amount;
                payer.paidExpenses += p.amount;
                payer.net += p.amount;
              }
            });
            (exp.splits || []).forEach((s) => {
              const part = ensureGrpPerson(s.memberEmail, s.memberName);
              if (part) {
                part.owed += Number(s.amount);
                part.owedSplits += Number(s.amount);
                part.net -= Number(s.amount);
              }
            });
          }
        });

        grpSettlements.forEach((st) => {
          if (st.status === 'confirmed' || (!st.status && !st.isPending)) {
            const fromP = ensureGrpPerson(st.fromEmail, st.fromName);
            const toP = ensureGrpPerson(st.toEmail, st.toName);
            if (fromP) {
              fromP.net += Number(st.amount);
              fromP.settledPaid = (fromP.settledPaid || 0) + Number(st.amount);
            }
            if (toP) {
              toP.net -= Number(st.amount);
              toP.settledReceived = (toP.settledReceived || 0) + Number(st.amount);
            }
          } else if (st.status === 'pending_admin_approval' || st.status === 'pending_confirmation' || st.status === 'pending') {
            const fromP = ensureGrpPerson(st.fromEmail, st.fromName);
            const toP = ensureGrpPerson(st.toEmail, st.toName);
            if (fromP) {
              fromP.pendingPaid = (fromP.pendingPaid || 0) + Number(st.amount);
            }
            if (toP) {
              toP.pendingReceived = (toP.pendingReceived || 0) + Number(st.amount);
            }
          }
        });

        Object.values(grpBalanceMap).forEach((b) => {
          b.paid = Math.round(b.paid * 100) / 100;
          b.owed = Math.round(b.owed * 100) / 100;
          b.net = Math.round(b.net * 100) / 100;
          b.paidExpenses = Math.round((b.paidExpenses || 0) * 100) / 100;
          b.owedSplits = Math.round((b.owedSplits || 0) * 100) / 100;
          b.settledPaid = Math.round((b.settledPaid || 0) * 100) / 100;
          b.settledReceived = Math.round((b.settledReceived || 0) * 100) / 100;
          b.pendingPaid = Math.round((b.pendingPaid || 0) * 100) / 100;
          b.pendingReceived = Math.round((b.pendingReceived || 0) * 100) / 100;
          b.unconfirmedNet = Math.round((b.net + (b.pendingPaid || 0) - (b.pendingReceived || 0)) * 100) / 100;
        });

        totalSpend += grpSpend;

        // Group Debt Simplification
        const isMinimized = g.minimizeDebts !== false;
        const grpSimplified = [];

        if (!isMinimized) {
          // Direct Pair-Wise Mode
          const netPairMap = {};
          grpExpenses.forEach((exp) => {
            const payers = getClientExpensePayerAllocations(exp);
            const totalExpAmt = payers.reduce((acc, p) => acc + p.amount, 0) || Number(exp.amount) || 1;
            const isIncome = exp.type === 'income';

            (exp.splits || []).forEach((s) => {
              const debtorEmail = String(s.memberEmail).toLowerCase().trim();
              const debtorName = s.memberName;

              payers.forEach((p) => {
                const payerEmail = p.memberEmail;
                const payerName = p.memberName;
                if (debtorEmail === payerEmail) return;
                const sharePortion = Number(s.amount) * (p.amount / totalExpAmt);
                if (sharePortion <= 0) return;

                const key = isIncome ? `${payerEmail}->${debtorEmail}` : `${debtorEmail}->${payerEmail}`;
                if (!netPairMap[key]) {
                  netPairMap[key] = {
                    fromEmail: isIncome ? payerEmail : debtorEmail,
                    fromName: isIncome ? payerName : debtorName,
                    toEmail: isIncome ? debtorEmail : payerEmail,
                    toName: isIncome ? debtorName : payerName,
                    amount: 0,
                    isAdminTransfer: false,
                    type: 'direct_pairwise'
                  };
                }
                netPairMap[key].amount += sharePortion;
              });
            });
          });

          grpSettlements.forEach((st) => {
            if (st.status === 'confirmed' || (!st.status && !st.isPending)) {
              const fromKey = String(st.fromEmail).toLowerCase().trim();
              const toKey = String(st.toEmail).toLowerCase().trim();
              const key = `${fromKey}->${toKey}`;
              if (!netPairMap[key]) {
                netPairMap[key] = {
                  fromEmail: fromKey,
                  fromName: st.fromName || fromKey,
                  toEmail: toKey,
                  toName: st.toName || toKey,
                  amount: 0,
                  isAdminTransfer: false,
                  type: 'direct_pairwise'
                };
              }
              netPairMap[key].amount -= Number(st.amount);
            }
          });

          const processed = new Set();
          Object.keys(netPairMap).forEach((key) => {
            if (processed.has(key)) return;
            const [from, to] = key.split('->');
            const revKey = `${to}->${from}`;
            const direct = netPairMap[key]?.amount || 0;
            const reverse = netPairMap[revKey]?.amount || 0;
            const net = Math.round((direct - reverse) * 100) / 100;

            processed.add(key);
            processed.add(revKey);

            if (net > 0.01) {
              grpSimplified.push({
                groupId: g.id,
                groupName: g.name,
                fromEmail: from,
                fromName: netPairMap[key]?.fromName || from,
                toEmail: to,
                toName: netPairMap[key]?.toName || to,
                amount: net,
                isAdminTransfer: false,
                type: 'direct_pairwise'
              });
            } else if (net < -0.01) {
              grpSimplified.push({
                groupId: g.id,
                groupName: g.name,
                fromEmail: to,
                fromName: netPairMap[revKey]?.fromName || netPairMap[key]?.toName || to,
                toEmail: from,
                toName: netPairMap[revKey]?.toName || netPairMap[key]?.fromName || from,
                amount: Math.abs(net),
                isAdminTransfer: false,
                type: 'direct_pairwise'
              });
            }
          });

          grpSimplified.sort((a, b) => b.amount - a.amount);
        } else if (g.adminHubSettlement === true) {
          // Admin Hub Mode
          const activeAdmin = g.members?.find((m) => m.role === 'admin' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase())) || g.members?.[0];
          if (activeAdmin && activeAdmin.email) {
            const adminEmail = String(activeAdmin.email).toLowerCase().trim();
            const adminName = activeAdmin.name || 'Admin';

            Object.values(grpBalanceMap).forEach((p) => {
              const pEmail = String(p.email).toLowerCase().trim();
              if (pEmail === adminEmail) return;

              const rounded = Math.round(p.net * 100) / 100;
              if (rounded < -0.01) {
                grpSimplified.push({
                  groupId: g.id,
                  groupName: g.name,
                  fromEmail: p.email,
                  fromName: p.name,
                  toEmail: adminEmail,
                  toName: adminName,
                  amount: Math.round(Math.abs(rounded) * 100) / 100,
                  isAdminTransfer: true,
                  type: 'pay_to_admin'
                });
              } else if (rounded > 0.01) {
                grpSimplified.push({
                  groupId: g.id,
                  groupName: g.name,
                  fromEmail: adminEmail,
                  fromName: adminName,
                  toEmail: p.email,
                  toName: p.name,
                  amount: Math.round(rounded * 100) / 100,
                  isAdminTransfer: true,
                  type: 'admin_payout'
                });
              }
            });

            grpSimplified.sort((a, b) => {
              if (a.toEmail === adminEmail && b.toEmail !== adminEmail) return -1;
              if (a.toEmail !== adminEmail && b.toEmail === adminEmail) return 1;
              return b.amount - a.amount;
            });
          }
        } else {
          // Standard Greedy Mode
          const debtors = [];
          const creditors = [];
          Object.values(grpBalanceMap).forEach((p) => {
            const rounded = Math.round(p.net * 100) / 100;
            if (rounded < -0.01) debtors.push({ ...p, amount: Math.abs(rounded) });
            else if (rounded > 0.01) creditors.push({ ...p, amount: rounded });
          });

          debtors.sort((a, b) => b.amount - a.amount);
          creditors.sort((a, b) => b.amount - a.amount);

          let i = 0;
          let j = 0;
          while (i < debtors.length && j < creditors.length) {
            const d = debtors[i];
            const c = creditors[j];
            const amt = Math.round(Math.min(d.amount, c.amount) * 100) / 100;
            if (amt > 0) {
              grpSimplified.push({
                groupId: g.id,
                groupName: g.name,
                fromEmail: d.email,
                fromName: d.name,
                toEmail: c.email,
                toName: c.name,
                amount: amt,
                isAdminTransfer: false,
                type: 'standard_greedy'
              });
            }
            d.amount = Math.round((d.amount - amt) * 100) / 100;
            c.amount = Math.round((c.amount - amt) * 100) / 100;
            if (d.amount <= 0.01) i++;
            if (c.amount <= 0.01) j++;
          }
        }

        simplified.push(...grpSimplified);
        settlementLedger[g.id] = buildGroupSplitSettlementLedger(g.id, stateRef.expenses, stateRef.settlements);

        // Merge grpBalanceMap into overall balanceMap
        Object.values(grpBalanceMap).forEach((b) => {
          if (!balanceMap[b.email]) {
            balanceMap[b.email] = { ...b };
          } else {
            balanceMap[b.email].paid = Math.round((balanceMap[b.email].paid + b.paid) * 100) / 100;
            balanceMap[b.email].owed = Math.round((balanceMap[b.email].owed + b.owed) * 100) / 100;
            balanceMap[b.email].net = Math.round((balanceMap[b.email].net + b.net) * 100) / 100;
            balanceMap[b.email].paidExpenses = Math.round(((balanceMap[b.email].paidExpenses || 0) + (b.paidExpenses || 0)) * 100) / 100;
            balanceMap[b.email].owedSplits = Math.round(((balanceMap[b.email].owedSplits || 0) + (b.owedSplits || 0)) * 100) / 100;
            balanceMap[b.email].settledPaid = Math.round(((balanceMap[b.email].settledPaid || 0) + (b.settledPaid || 0)) * 100) / 100;
            balanceMap[b.email].settledReceived = Math.round(((balanceMap[b.email].settledReceived || 0) + (b.settledReceived || 0)) * 100) / 100;
            balanceMap[b.email].pendingPaid = Math.round(((balanceMap[b.email].pendingPaid || 0) + (b.pendingPaid || 0)) * 100) / 100;
            balanceMap[b.email].pendingReceived = Math.round(((balanceMap[b.email].pendingReceived || 0) + (b.pendingReceived || 0)) * 100) / 100;
            balanceMap[b.email].unconfirmedNet = Math.round((balanceMap[b.email].net + (balanceMap[b.email].pendingPaid || 0) - (balanceMap[b.email].pendingReceived || 0)) * 100) / 100;
          }
        });
      });

      // Calculate pending settlement amounts awaiting admin approval
      const pendingSettlements = filteredSettlements.filter(
        (s) => s.status === 'pending_admin_approval' || s.status === 'pending_confirmation' || s.status === 'pending'
      );
      const pendingMap = {};
      pendingSettlements.forEach((s) => {
        const groupSpecificKey = `${s.groupId || ''}:${String(s.fromEmail).toLowerCase().trim()}->${String(s.toEmail).toLowerCase().trim()}`;
        const pairKey = `${String(s.fromEmail).toLowerCase().trim()}->${String(s.toEmail).toLowerCase().trim()}`;
        pendingMap[groupSpecificKey] = (pendingMap[groupSpecificKey] || 0) + Number(s.amount);
        pendingMap[pairKey] = (pendingMap[pairKey] || 0) + Number(s.amount);
      });

      simplified.forEach((t) => {
        const groupSpecificKey = `${t.groupId || ''}:${String(t.fromEmail).toLowerCase().trim()}->${String(t.toEmail).toLowerCase().trim()}`;
        const pairKey = `${String(t.fromEmail).toLowerCase().trim()}->${String(t.toEmail).toLowerCase().trim()}`;
        t.pendingApprovalAmount = Math.round((pendingMap[groupSpecificKey] || pendingMap[pairKey] || 0) * 100) / 100;
        t.isPendingApproval = t.pendingApprovalAmount > 0;
        t.remainingDue = Math.max(0, Math.round((t.amount - t.pendingApprovalAmount) * 100) / 100);
      });

      const currentEmail = (stateRef.currentUser?.email || '').toLowerCase().trim();
      const isViewerAdmin = Boolean(
        stateRef.currentUser?.isSuperAdmin ||
        stateRef.currentUser?.role === 'super_admin' ||
        ['mdzubair7592@gmail.com', 'mrzoromit3@gmail.com'].includes(currentEmail) ||
        activeGroups.some((g) => {
          const adm = g.members?.find((m) => m.role === 'admin' || m.role === 'owner' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase())) || g.members?.[0];
          return (adm && adm.email && adm.email.toLowerCase().trim() === currentEmail) ||
            (g.adminEmail && g.adminEmail.toLowerCase().trim() === currentEmail) ||
            (g.createdByEmail && g.createdByEmail.toLowerCase().trim() === currentEmail);
        })
      );

      let finalSimplified = simplified;
      let finalBalanceList = Object.values(balanceMap);

      // Privacy rule: the settlement plan / simplified split list only shows the
      // viewer's own transactions to non-admins. Others' amounts remain visible
      // on bills/events (controlled by group Split Visibility).
      if (!isViewerAdmin && currentEmail) {
        finalSimplified = simplified.filter(
          (t) => t.fromEmail.toLowerCase() === currentEmail || t.toEmail.toLowerCase() === currentEmail
        );
        const adminEmails = new Set(
          activeGroups.map((g) => {
            const adm = g.members?.find((m) => m.role === 'admin' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase())) || g.members?.[0];
            return adm ? adm.email.toLowerCase().trim() : '';
          })
        );
        finalBalanceList = finalBalanceList.filter(
          (b) => b.email.toLowerCase() === currentEmail || adminEmails.has(b.email.toLowerCase())
        );
      }

      // Closure status must reflect the full group picture, never the privacy
      // filtered (viewer-only) transaction list. Otherwise a viewer with no
      // personal transfers would make every bill look settled.
      const isFullyClosed = simplified.length === 0 && pendingSettlements.length === 0;

      // Recommendation banner removed per user preference
      const whoShouldPay = null;

      // Dictionary of net balances for quick lookup (balances[email])
      const balances = {};
      Object.values(balanceMap).forEach((b) => {
        balances[b.email] = b.net;
      });

      const myEntry = balanceMap[currentEmail] || { email: currentEmail, name: stateRef.currentUser?.name || 'Me', paid: 0, owed: 0, net: 0 };
      const myNet = myEntry.net;
      const myPaid = myEntry.paid;
      const myOwed = myEntry.owed;

      return {
        balances,
        balanceMap,
        balanceList: finalBalanceList,
        simplified: finalSimplified,
        myNet,
        myEntry,
        myPaid,
        myOwed,
        filteredExpenses,
        filteredSettlements,
        pendingSettlements,
        isFullyClosed,
        settlementLedger,
        totalSpend: Math.round(totalSpend * 100) / 100,
        whoShouldPay
      };
    }
    // =========================================================================
    // UI RENDERING & CHARTS
    // =========================================================================
    function switchMainTab(tab) {
      const isSuper = (typeof isSuperAdminUser === 'function')
        ? isSuperAdminUser(appState.currentUser)
        : Boolean(appState.currentUser && (appState.currentUser.isSuperAdmin || appState.currentUser.role === 'super_admin' || (appState.currentUser.email && ['mdzubair7592@gmail.com', 'mrzoromit3@gmail.com'].includes(appState.currentUser.email.toLowerCase().trim()))));

      // Strict Security Gate: Non-super-admins cannot navigate to admin tab
      if (tab === 'admin' && !isSuper) {
        console.warn('[Security] Super Admin tab access denied for non-admin user. Diverting to dashboard.');
        tab = 'dashboard';
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        } else {
          window.location.hash = '';
        }
      }

      activeMainTab = tab;
      try {
        // Never persist 'admin' or 'tests' in localStorage to prevent sticky admin routing across sessions
        if (tab !== 'admin' && tab !== 'tests') {
          localStorage.setItem('vasool_active_tab', tab);
        } else {
          localStorage.removeItem('vasool_active_tab');
        }

        if (tab === 'admin') {
          if (isSuper) {
            if (window.history && window.history.replaceState) {
              window.history.replaceState(null, '', '#admin');
            } else {
              window.location.hash = '#admin';
            }
          }
        } else if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + tab);
        } else {
          window.location.hash = '#' + tab;
        }
      } catch {}
      const tabs = ['dashboard', 'expenses', 'groups', 'settle', 'tests', 'admin'];
      tabs.forEach((t) => {
        const cap = t.charAt(0).toUpperCase() + t.slice(1);
        const panel = document.getElementById('panel' + cap);
        const btn = document.getElementById('navTab' + cap);
        const mobileBtn = document.getElementById('mobileNav' + cap);

        if (panel) {
          if (t === 'admin') {
            if (tab === 'admin' && isSuper) {
              panel.classList.remove('hidden');
            } else {
              panel.classList.add('hidden');
            }
          } else if (t === tab) {
            panel.classList.remove('hidden');
          } else {
            panel.classList.add('hidden');
          }
        }
        if (btn) {
          if (t === 'tests') {
            btn.className = 'hidden';
          } else if (t === 'admin') {
            if (!isSuper) {
              btn.className = 'hidden';
            } else if (tab === 'admin') {
              btn.className = 'whitespace-nowrap px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-amber-500 text-slate-950 transition flex items-center gap-1.5 shadow-md shadow-amber-500/25';
            } else {
              btn.className = 'whitespace-nowrap px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 transition flex items-center gap-1.5';
            }
          } else if (t === tab) {
            btn.className = 'whitespace-nowrap px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5';
          } else {
            btn.className = 'whitespace-nowrap px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:bg-slate-800/80 transition flex items-center gap-1.5';
          }
        }
        if (mobileBtn) {
          if (t === 'tests') {
            mobileBtn.className = 'hidden';
          } else if (t === 'admin') {
            if (!isSuper) {
              mobileBtn.className = 'hidden';
            } else if (tab === 'admin') {
              mobileBtn.className = 'flex flex-col items-center justify-center py-1.5 px-1 text-amber-400 font-bold transition-all';
            } else {
              mobileBtn.className = 'flex flex-col items-center justify-center py-1.5 px-1 text-amber-400/60 hover:text-amber-300 transition-all';
            }
          } else if (t === tab) {
            mobileBtn.className = 'flex flex-col items-center justify-center py-1.5 px-1 text-emerald-400 font-bold transition-all';
          } else {
            mobileBtn.className = 'flex flex-col items-center justify-center py-1.5 px-1 text-slate-400 hover:text-slate-200 transition-all';
          }
        }
      });
      refreshAllViews();
      // Show Top Welcome Hero & 4 KPI tiles ONLY on the Home (dashboard) tab
      const homeTopSection = document.getElementById('homeDashboardTopSection');
      if (homeTopSection) {
        if (tab === 'dashboard') {
          homeTopSection.classList.remove('hidden');
        } else {
          homeTopSection.classList.add('hidden');
        }
      }

      // Hide Group Filter Bar when on Admin or QA tabs to reduce visual redundancy
      const cmdBar = document.getElementById('workspaceCommandBar');
      if (cmdBar) {
        if (tab === 'admin' || tab === 'tests') {
          cmdBar.classList.add('hidden');
        } else {
          cmdBar.classList.remove('hidden');
        }
      }

      if (tab === 'tests') {
        runAutomatedTestSuite(false);
        switchPipelineViewer(activePipelineTab);
      }
      if (tab === 'admin' && isSuper) {
        fetchAdminUsers();
        if (typeof fetchAdminGroups === 'function') fetchAdminGroups(true);
      }
    }

    function handleGroupFilterChange(val) {
      selectedGroupId = val;
      try {
        localStorage.setItem('vasool_selected_group_id', val);
      } catch {}
      const groupObj = appState.groups.find((g) => g.id === val);
      const pill = document.getElementById('activeGroupPill');
      if (pill) pill.textContent = groupObj ? groupObj.name : 'All Groups';
      refreshAllViews();
    }

    function populateGroupFilterDropdown() {
      const sel = document.getElementById('groupFilterSelect');
      if (!sel) return;
      const savedGroup = localStorage.getItem('vasool_selected_group_id');
      if (savedGroup && appState.groups.some((g) => g.id === savedGroup)) {
        selectedGroupId = savedGroup;
      }
      const currentVal = selectedGroupId;
      sel.innerHTML = `<option value="ALL">All Groups (${appState.groups.length})</option>`;
      appState.groups.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.members.length})`;
        sel.appendChild(opt);
      });
      sel.value = appState.groups.some((g) => g.id === currentVal) ? currentVal : 'ALL';
      const groupObj = appState.groups.find((g) => g.id === sel.value);
      const pill = document.getElementById('activeGroupPill');
      if (pill) pill.textContent = groupObj ? groupObj.name : 'All Groups';
    }

    function refreshAllViews() {
      renderTopLevelView();
      populateGroupFilterDropdown();

      const { balanceList, simplified, filteredExpenses, filteredSettlements, totalSpend } =
        computeBalancesAndSimplifications(selectedGroupId);

      const myEmail = (appState.currentUser?.email || '').toLowerCase();
      const myEntry = balanceList.find((b) => b.email === myEmail) || {
        net: 0,
        pendingPaid: 0,
        pendingReceived: 0,
        unconfirmedNet: 0
      };

      let owedToMe = 0;
      let iOwe = 0;
      simplified.forEach((t) => {
        if (t.toEmail === myEmail) owedToMe += t.amount;
        if (t.fromEmail === myEmail) iOwe += t.amount;
      });

      const myPendingPaid = myEntry.pendingPaid || 0;
      const myPendingReceived = myEntry.pendingReceived || 0;
      const myUnconfirmedNet = typeof myEntry.unconfirmedNet === 'number'
        ? myEntry.unconfirmedNet
        : Math.round((myEntry.net + myPendingPaid - myPendingReceived) * 100) / 100;
      const remOwe = Math.max(0, Math.round((iOwe - myPendingPaid) * 100) / 100);
      const remOwed = Math.max(0, Math.round((owedToMe - myPendingReceived) * 100) / 100);

      // 1. Your Net Balance
      const netEl = document.getElementById('kpiNetBalance');
      const netPendingRow = document.getElementById('kpiNetPendingRow');
      const netSub = document.getElementById('kpiNetSubtext');
      if (netEl) {
        const netSign = myEntry.net > 0 ? '+' : '';
        netEl.textContent = `${netSign}${formatINR(myEntry.net)}`;
        netEl.className = `font-display text-lg sm:text-2xl lg:text-3xl font-extrabold tracking-tight tabular-nums break-words leading-tight ${myEntry.net > 0 ? 'text-emerald-400' : (myEntry.net < 0 ? 'text-rose-400' : 'text-slate-200')}`;

        if (netPendingRow) {
          if (myPendingPaid > 0 || myPendingReceived > 0) {
            const unconfirmedSign = myUnconfirmedNet > 0 ? '+' : '';
            netPendingRow.innerHTML = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[10px] sm:text-xs font-semibold text-amber-300">⏳ Pending: <strong class="text-amber-200 font-bold">${unconfirmedSign}${formatINR(myUnconfirmedNet)}</strong></span>`;
          } else {
            netPendingRow.innerHTML = `<span class="text-[10px] sm:text-xs text-slate-400 font-medium">Across active groups</span>`;
          }
        }
        if (netSub) {
          if (myPendingPaid > 0 || myPendingReceived > 0) {
            netSub.innerHTML = `<span>⏳ ${formatINR(myPendingPaid > 0 ? myPendingPaid : myPendingReceived)} in verification</span>`;
          } else {
            netSub.textContent = myEntry.net === 0 ? 'All settled up' : '100% Confirmed';
          }
        }
      }

      // 2. You Are Owed
      const owedEl = document.getElementById('kpiYouAreOwed');
      const owedPendingRow = document.getElementById('kpiOwedPendingRow');
      const owedSub = document.getElementById('kpiOwedByCount');
      if (owedEl) {
        owedEl.textContent = formatINR(owedToMe);
        owedEl.className = 'font-display text-lg sm:text-2xl lg:text-3xl font-extrabold tracking-tight tabular-nums break-words leading-tight text-emerald-400';
        if (owedPendingRow) {
          if (myPendingReceived > 0) {
            owedPendingRow.innerHTML = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[10px] sm:text-xs font-semibold text-amber-300">⏳ Due after pending: <strong class="text-amber-200 font-bold">${formatINR(remOwed)}</strong></span>`;
          } else {
            owedPendingRow.innerHTML = `<span class="text-[10px] sm:text-xs text-slate-400 font-medium">${owedToMe > 0 ? 'Receivables confirmed' : 'No receivables'}</span>`;
          }
        }
        if (owedSub) {
          if (myPendingReceived > 0) {
            owedSub.innerHTML = `<span>⏳ ${formatINR(myPendingReceived)} pending confirmation</span>`;
          } else {
            owedSub.textContent = 'Incoming receivables';
          }
        }
      }

      // 3. You Owe
      const oweEl = document.getElementById('kpiYouOwe');
      const owePendingRow = document.getElementById('kpiOwePendingRow');
      const oweSub = document.getElementById('kpiOweToCount');
      if (oweEl) {
        oweEl.textContent = formatINR(iOwe);
        oweEl.className = 'font-display text-lg sm:text-2xl lg:text-3xl font-extrabold tracking-tight tabular-nums break-words leading-tight text-rose-400';
        if (owePendingRow) {
          if (myPendingPaid > 0) {
            owePendingRow.innerHTML = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[10px] sm:text-xs font-semibold text-amber-300">⏳ Due after pending: <strong class="text-amber-200 font-bold">${formatINR(remOwe)}</strong></span>`;
          } else {
            owePendingRow.innerHTML = `<span class="text-[10px] sm:text-xs text-slate-400 font-medium">${iOwe > 0 ? 'Splits pending payment' : 'No debts'}</span>`;
          }
        }
        if (oweSub) {
          if (myPendingPaid > 0) {
            oweSub.innerHTML = `<span>⏳ ${formatINR(myPendingPaid)} paid, awaiting approval</span>`;
          } else {
            oweSub.textContent = 'Pending splits';
          }
        }
      }

      // 4. Group Spend
      const spendEl = document.getElementById('kpiTotalSpend');
      const spendPendingRow = document.getElementById('kpiSpendPendingRow');
      const spendSub = document.getElementById('kpiSimplifiedCount');
      if (spendEl) {
        spendEl.textContent = formatINR(totalSpend);
        spendEl.className = 'font-display text-lg sm:text-2xl lg:text-3xl font-extrabold tracking-tight tabular-nums break-words leading-tight text-white';
      }
      if (spendPendingRow) {
        spendPendingRow.innerHTML = `<span class="text-[10px] sm:text-xs text-cyan-300/80 font-medium">Total volume</span>`;
      }
      const userInvolvedTotal = filteredExpenses.filter((e) => (typeof isUserInvolvedInExpense === 'function' ? isUserInvolvedInExpense(e, myEmail) : true));
      const countBadge = document.getElementById('kpiExpenseCountBadge');
      if (countBadge) {
        countBadge.textContent = `${userInvolvedTotal.length} bill${userInvolvedTotal.length === 1 ? '' : 's'}`;
      }
      const activeGroups = selectedGroupId === 'ALL'
        ? appState.groups
        : appState.groups.filter((g) => g.id === selectedGroupId);
      const isMinimizedMode = selectedGroupId === 'ALL'
        ? activeGroups.every((g) => g.minimizeDebts !== false)
        : (activeGroups[0]?.minimizeDebts !== false);
      if (spendSub) {
        spendSub.textContent = `${simplified.length} ${isMinimizedMode ? 'simplified transfer(s)' : 'direct debt(s)'}`;
      }


      renderDashboardWidgets(filteredExpenses, simplified, balanceList);
      renderExpensesList();
      renderGroupsGrid();
      renderSettleView(simplified, filteredSettlements);
      if (typeof updateCloudInspector === 'function') {
        updateCloudInspector();
      }
    }

    function renderDashboardWidgets(filteredExpenses, simplified, balanceList) {
      const recentContainer = document.getElementById('dashboardRecentExpenses');
      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const userInvolvedExpenses = filteredExpenses.filter((e) => (typeof isUserInvolvedInExpense === 'function' ? isUserInvolvedInExpense(e, currentEmail) : true));

      if (!userInvolvedExpenses.length) {
        recentContainer.innerHTML = `<div class="text-xs text-slate-500 py-6 text-center">No bills where you are involved logged yet. Click "+ Add Bill" to start.</div>`;
      } else {
        recentContainer.innerHTML = userInvolvedExpenses
          .slice(0, 4)
          .map((e) => {
            const grp = appState.groups.find((g) => g.id === e.groupId);
            return `
              <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 flex items-center justify-between gap-3 transition">
                <div class="min-w-0">
                  <div class="text-xs sm:text-sm font-semibold text-white truncate">${escapeHtml(e.description)}</div>
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    Paid by <span class="text-emerald-300 font-medium">${escapeHtml(e.paidByName)}</span> · ${escapeHtml(grp ? grp.name : 'Group')} · <span class="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">${escapeHtml(e.splitType)}</span> · 👤 Added by <span class="text-slate-300 font-medium">${escapeHtml(e.createdByName || e.createdByEmail || e.paidByName)}</span>
                  </div>
                </div>
                <div class="text-right flex-shrink-0">
                  <div class="text-sm font-bold text-white">${formatINR(e.amount)}</div>
                  <div class="text-[10px] text-slate-400">${escapeHtml(e.category)}</div>
                </div>
              </div>
            `;
          })
          .join('');
      }

      const simpContainer = document.getElementById('dashboardSimplifiedList');
      if (!simplified.length) {
        simpContainer.innerHTML = `<div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 text-center">All balances are settled! Everyone is square.</div>`;
      } else {
        simpContainer.innerHTML = simplified
          .map(
            (t, idx) => {
              const hasPending = (t.pendingApprovalAmount || 0) > 0;
              const remDue = typeof t.remainingDue === 'number' ? t.remainingDue : Math.max(0, t.amount - (t.pendingApprovalAmount || 0));
              const pendingSubtext = hasPending
                ? `<span class="text-[11px] font-normal text-amber-300/90 ml-1.5">(⏳ ${formatINR(t.pendingApprovalAmount)} unconfirmed · Due: ${formatINR(remDue)})</span>`
                : '';
              const settleBtn = (hasPending && remDue <= 0.01)
                ? `<span class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold text-[11px] flex items-center gap-1">
                     <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                     Awaiting Confirmation
                   </span>`
                : `<button data-testid="btn-dashboard-settle-${idx}" onclick="openSettleConfirm('${escapeHtml(t.fromEmail)}', '${escapeHtml(t.fromName)}', '${escapeHtml(t.toEmail)}', '${escapeHtml(t.toName)}', ${remDue > 0 ? remDue : t.amount})" class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition">
                     Settle${hasPending && remDue > 0 ? ` (${formatINR(remDue)})` : ''}
                   </button>`;

              return `
          <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
            <div class="text-xs">
              <span class="font-semibold text-rose-300">${escapeHtml(t.fromName)}</span>
              <span class="text-slate-400 mx-1">owes</span>
              <span class="font-semibold text-emerald-300">${escapeHtml(t.toName)}</span>
              <div class="text-sm font-bold text-white mt-0.5 flex flex-wrap items-center">
                ${formatINR(t.amount)}
                ${pendingSubtext}
              </div>
            </div>
            ${settleBtn}
          </div>
        `;
            }
          )
          .join('');
      }

      if (typeof Chart !== 'undefined') {
        const catTotals = {};
        filteredExpenses.forEach((e) => {
          catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount);
        });
        const catLabels = Object.keys(catTotals);
        const catData = Object.values(catTotals);

        const catCtx = document.getElementById('categoryChartCanvas');
        if (catCtx) {
          if (categoryChartInstance) categoryChartInstance.destroy();
          categoryChartInstance = new Chart(catCtx, {
            type: 'doughnut',
            data: {
              labels: catLabels.length ? catLabels : ['No Spend'],
              datasets: [
                {
                  data: catData.length ? catData : [1],
                  backgroundColor: ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b', '#f43f5e'],
                  borderWidth: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              onClick: (evt, elements) => {
                if (elements && elements.length > 0 && catLabels.length > 0) {
                  const idx = elements[0].index;
                  const chosenCat = catLabels[idx];
                  if (chosenCat && chosenCat !== 'No Spend') {
                    drillDownExpensesByCategory(chosenCat);
                  }
                }
              },
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: { color: '#cbd5e1', font: { size: 11 } }
                }
              }
            }
          });
        }

        const balCtx = document.getElementById('balancesChartCanvas');
        if (balCtx) {
          if (balancesChartInstance) balancesChartInstance.destroy();
          const labels = balanceList.map((b) => b.name.split(' ')[0]);
          const values = balanceList.map((b) => Math.round(b.net * 100) / 100);
          balancesChartInstance = new Chart(balCtx, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                {
                  label: 'Net Balance',
                  data: values,
                  backgroundColor: values.map((v) => (v >= 0 ? 'rgba(16, 185, 129, 0.82)' : 'rgba(244, 63, 94, 0.82)')),
                  borderRadius: 6
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              onClick: (evt, elements) => {
                if (elements && elements.length > 0 && balanceList.length > 0) {
                  const idx = elements[0].index;
                  const memberObj = balanceList[idx];
                  if (memberObj && memberObj.name) {
                    drillDownExpensesByMember(memberObj.name);
                  }
                }
              },
              scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51, 65, 85, 0.35)' } }
              },
              plugins: {
                legend: { display: false }
              }
            }
          });
        }
      }
    }

    let expensesScopeFilter = 'involved';
    function setExpensesScopeFilter(scope) {
      expensesScopeFilter = scope;
      renderExpensesList();
    }
    if (typeof window !== 'undefined') {
      window.setExpensesScopeFilter = setExpensesScopeFilter;
    }

    /**
     * Resolves how a single person's share on a single bill should be displayed.
     *
     * A share is only "Settled" when the payer recorded a payment AND the receiver
     * acknowledged it (i.e. a confirmed settlement covers the share). Net-zero
     * balancing across unrelated bills never marks a share as settled.
     *
     * The per-bill evidence comes from `ledger` (see buildGroupSplitSettlementLedger).
     */
    function getSplitSettlementStatus({
      expense,
      split,
      payerEmails = new Set(),
      ledger = null
    }) {
      const sEmail = String(split.memberEmail || '').toLowerCase().trim();
      const isPayer = payerEmails.has(sEmail);

      if (isPayer) {
        return {
          isPayer: true,
          isSettled: false,
          hasPending: false,
          tag: '<span class="text-[9px] font-bold text-teal-300 uppercase">(Payer)</span>',
          tagSmall: '<span class="text-[8px] font-bold text-teal-300 uppercase ml-1">(Payer)</span>',
          pillClass: 'border-teal-500/30 bg-teal-950/30 text-teal-200'
        };
      }

      const expenseId = String(expense?.id || expense?._id || '');
      const entry = (ledger && expenseId) ? ledger[`${expenseId}|${sEmail}`] : null;

      // Conservative fallback: without ledger evidence we never claim a share is
      // settled. The person's assigned split remains outstanding.
      const splitOwed = Math.max(0, Math.round((Number(split.amount) || 0) * 100) / 100);
      const owed = entry ? Math.max(0, Math.round((Number(entry.owed) || 0) * 100) / 100) : splitOwed;
      const confirmed = entry
        ? Math.min(owed, Math.max(0, Math.round((Number(entry.confirmed) || 0) * 100) / 100))
        : 0;
      const remaining = Math.max(0, Math.round((owed - confirmed) * 100) / 100);
      const pending = entry
        ? Math.min(remaining, Math.max(0, Math.round((Number(entry.pending) || 0) * 100) / 100))
        : 0;

      const settled = {
        isPayer: false,
        isSettled: true,
        hasPending: false,
        debtAmount: 0,
        pendingAmount: 0,
        confirmedAmount: confirmed,
        tag: '<span class="text-[9px] font-bold text-emerald-400 uppercase">✓ Settled</span>',
        tagSmall: '<span class="text-[8px] font-bold text-emerald-400 uppercase ml-1">✓ Settled</span>',
        pillClass: 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
      };

      if (owed <= 0.01 || remaining <= 0.01) {
        return settled;
      }

      if (pending > 0.01) {
        const afterPending = Math.max(0, Math.round((remaining - pending) * 100) / 100);
        const label = afterPending <= 0.01
          ? `⏳ Unconfirmed (⏳ ${formatINR(pending)} paid)`
          : `⏳ Left to Pay (${formatINR(afterPending)} left · ⏳ ${formatINR(pending)} unconfirmed)`;
        return {
          isPayer: false,
          isSettled: false,
          hasPending: true,
          debtAmount: remaining,
          pendingAmount: pending,
          confirmedAmount: confirmed,
          tag: `<span class="text-[9px] font-bold text-amber-300 uppercase">${label}</span>`,
          tagSmall: `<span class="text-[8px] font-bold text-amber-300 uppercase ml-1">${label}</span>`,
          pillClass: 'border-amber-500/40 bg-amber-950/30 text-amber-200'
        };
      }

      const leftLabel = confirmed > 0.01
        ? `⏳ Left to Pay (${formatINR(remaining)} left)`
        : '⏳ Left to Pay';
      return {
        isPayer: false,
        isSettled: false,
        hasPending: false,
        debtAmount: remaining,
        pendingAmount: 0,
        confirmedAmount: confirmed,
        tag: `<span class="text-[9px] font-bold text-rose-300 uppercase">${leftLabel}</span>`,
        tagSmall: `<span class="text-[8px] font-bold text-rose-300 uppercase ml-1">${leftLabel}</span>`,
        pillClass: 'border-slate-700/80 bg-slate-800 text-slate-300'
      };
    }
    if (typeof window !== 'undefined') {
      window.getSplitSettlementStatus = getSplitSettlementStatus;
    }

    function formatEventDisplayDate(dateVal) {
      if (!dateVal) return 'Today';
      try {
        const dStr = typeof dateVal === 'string' ? dateVal : new Date(dateVal).toISOString();
        const clean = dStr.slice(0, 10);
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (clean === todayLocal || clean === now.toISOString().slice(0, 10)) return 'Today';
        const parts = clean.split('-');
        if (parts.length === 3) {
          const [y, m, d] = parts;
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const mName = months[parseInt(m, 10) - 1] || m;
          return `${parseInt(d, 10)} ${mName} ${y}`;
        }
        return clean;
      } catch (_) {
        return String(dateVal);
      }
    }
    if (typeof window !== 'undefined') {
      window.formatEventDisplayDate = formatEventDisplayDate;
    }

    function renderExpensesList() {
      const container = document.getElementById('expensesFullList');
      if (!container) return;
      const searchQ = (document.getElementById('expenseSearchInput')?.value || '').toLowerCase().trim();
      const catFilter = document.getElementById('expenseCategoryFilter')?.value || 'ALL';

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();
      const activeGroups = selectedGroupId === 'ALL'
        ? appState.groups
        : appState.groups.filter((g) => g.id === selectedGroupId);

      const isViewerAdmin = activeGroups.some((g) => {
        const adm = g.members?.find((m) => m.role === 'admin' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase())) || g.members?.[0];
        return adm && adm.email.toLowerCase().trim() === currentEmail;
      }) || (typeof isSuperAdminUser === 'function' && isSuperAdminUser(appState.currentUser));

      const baseList = appState.expenses.filter((e) => {
        if (selectedGroupId !== 'ALL' && e.groupId !== selectedGroupId) return false;
        if (catFilter !== 'ALL' && e.category !== catFilter) return false;
        if (
          searchQ &&
          !e.description.toLowerCase().includes(searchQ) &&
          !e.paidByName.toLowerCase().includes(searchQ) &&
          !e.category.toLowerCase().includes(searchQ)
        ) {
          return false;
        }
        return true;
      });

      const involvedList = baseList.filter((e) => (typeof isUserInvolvedInExpense === 'function' ? isUserInvolvedInExpense(e, currentEmail) : true));
      const list = (!isViewerAdmin || expensesScopeFilter === 'involved') ? involvedList : baseList;

      // Update Scope Toggle Container
      const scopeToggleContainer = document.getElementById('expensesScopeToggleContainer');
      if (scopeToggleContainer) {
        if (isViewerAdmin) {
          scopeToggleContainer.classList.remove('hidden');
          scopeToggleContainer.innerHTML = `
            <div class="flex items-center gap-1.5 text-xs text-slate-300">
              <span class="text-base">👑</span>
              <span><strong>Admin Filter:</strong> View bills you are part of, or audit all group bills.</span>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" data-testid="btn-scope-involved" onclick="setExpensesScopeFilter('involved')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition ${expensesScopeFilter === 'involved' ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white'}">
                📌 Involved (${involvedList.length})
              </button>
              <button type="button" data-testid="btn-scope-all" onclick="setExpensesScopeFilter('all')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition ${expensesScopeFilter === 'all' ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white'}">
                🌐 All Group Bills (${baseList.length})
              </button>
            </div>
          `;
        } else {
          scopeToggleContainer.classList.add('hidden');
        }
      }

      if (!list.length) {
        container.innerHTML = `
          <div class="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400 space-y-1.5">
            <div class="text-2xl">🧾</div>
            <div class="font-bold text-slate-200">No matching bills found.</div>
            <div class="text-slate-500">${(!isViewerAdmin || expensesScopeFilter === 'involved') ? 'You only see bills in which you are directly involved as a payer, split participant, or creator.' : 'No bills found matching your current filter criteria.'}</div>
          </div>
        `;
        return;
      }

      const { settlementLedger } = computeBalancesAndSimplifications(selectedGroupId);

      container.innerHTML = list
        .map((e) => {
          const grp = appState.groups.find((g) => g.id === e.groupId);
          const isGroupMinimized = grp ? (grp.minimizeDebts !== false) : false;
          const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();

          const isSuperAdmin = Boolean(
            appState.currentUser?.isSuperAdmin ||
            appState.currentUser?.role === 'super_admin' ||
            ['mdzubair7592@gmail.com', 'mrzoromit3@gmail.com'].includes(currentEmail)
          );

          const isGroupAdmin = isSuperAdmin || Boolean(
            grp && (
              (grp.adminEmail && grp.adminEmail.toLowerCase() === currentEmail) ||
              (grp.createdByEmail && grp.createdByEmail.toLowerCase() === currentEmail) ||
              (Array.isArray(grp.members) && grp.members.some((m) => (m.email || '').toLowerCase().trim() === currentEmail && (m.role === 'admin' || m.role === 'owner'))) ||
              ((grp.members?.[0]?.email || '').toLowerCase().trim() === currentEmail)
            )
          );

          const payerEmails = new Set(
            (Array.isArray(e.paidByAllocations) && e.paidByAllocations.length > 0
              ? e.paidByAllocations
              : [{ memberEmail: e.paidByEmail }]
            ).map((p) => String(p.memberEmail || '').toLowerCase().trim())
          );

          const isPayerOrCreator = payerEmails.has(currentEmail) ||
            (e.createdByEmail && e.createdByEmail.toLowerCase().trim() === currentEmail) ||
            (e.paidByEmail && e.paidByEmail.toLowerCase().trim() === currentEmail);

          const isPersonalOnly = grp && (grp.splitsVisibility || 'personal_only') === 'personal_only' && !isGroupAdmin && !isPayerOrCreator;

          let visibleSplits = e.splits || [];
          if (isPersonalOnly) {
            visibleSplits = visibleSplits.filter((s) => s.memberEmail.toLowerCase() === currentEmail);
          }

          let splitsPills = '';
          if (isPersonalOnly) {
            if (visibleSplits.length > 0) {
              splitsPills = visibleSplits
                .map((s) => {
                  const sStatus = getSplitSettlementStatus({
                    expense: e,
                    split: s,
                    payerEmails,
                    ledger: settlementLedger[e.groupId]
                  });
                  return `<span class="px-2 py-0.5 rounded bg-purple-900/40 text-purple-200 border border-purple-500/30 font-semibold text-[11px] inline-flex items-center">Your Share: ${formatINR(s.amount)} ${sStatus.tag}</span>`;
                })
                .join(' ') + ` <span class="px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 text-[10px] italic border border-slate-700/50">🔒 Other member shares kept private by Admin</span>`;
            } else {
              splitsPills = `<span class="px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 text-[10px] italic">No share assigned to you · 🔒 Other member shares private</span>`;
            }
          } else {
            splitsPills = visibleSplits
              .map((s) => {
                const sStatus = getSplitSettlementStatus({
                  expense: e,
                  split: s,
                  payerEmails,
                  ledger: settlementLedger[e.groupId]
                });
                return `<span class="px-2 py-0.5 rounded text-[11px] border ${sStatus.pillClass} inline-flex items-center gap-1.5">${escapeHtml((s.memberName || s.memberEmail).split(' ')[0])}: ${formatINR(s.amount)} ${sStatus.tag}</span>`;
              })
              .join(' ');
          }

          let billSettlementBadge = '';
          if (e.type !== 'income') {
            const allSplits = e.splits || [];
            const nonPayerSplits = allSplits.filter((s) => !payerEmails.has(String(s.memberEmail || '').toLowerCase().trim()));
            if (nonPayerSplits.length === 0) {
              billSettlementBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">✓ All Settled</span>';
            } else {
              const splitStatuses = nonPayerSplits.map((s) => ({
                split: s,
                status: getSplitSettlementStatus({
                  expense: e,
                  split: s,
                  payerEmails,
                  ledger: settlementLedger[e.groupId]
                })
              }));
              const unsettled = splitStatuses.filter((x) => !x.status.isSettled);
              if (unsettled.length === 0) {
                billSettlementBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">✓ All Settled</span>';
              } else {
                const allPending = unsettled.every((x) => x.status.hasPending);
                if (allPending) {
                  const pendingNames = unsettled.map((x) => escapeHtml((x.split.memberName || x.split.memberEmail).split(' ')[0])).join(', ');
                  billSettlementBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">⏳ Paid · Awaiting Confirmation (${pendingNames})</span>`;
                } else {
                  const leftNames = unsettled.map((x) => escapeHtml((x.split.memberName || x.split.memberEmail).split(' ')[0])).join(', ');
                  billSettlementBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">⏳ Left to Pay: ${leftNames}</span>`;
                }
              }
            }
          }

          const fxBadge = (e.originalCurrency && e.originalCurrency !== 'INR' && e.originalAmount)
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">🌐 ${e.originalAmount} ${escapeHtml(e.originalCurrency)} @ ₹${e.exchangeRate || 1}</span>`
            : '';
          const parentRefundBadge = e.parentExpenseDesc
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-200 border border-cyan-500/30">🔗 Refund for: ${escapeHtml(e.parentExpenseDesc)}</span>`
            : '';

          // Authorization check: Only creator or group admin / super admin can edit/delete
          const creatorEmail = String(e.createdByEmail || e.paidByEmail || '').toLowerCase().trim();
          const isCreator = Boolean(currentEmail && creatorEmail === currentEmail);
          const canModify = isCreator || isGroupAdmin || isSuperAdmin;

          const actionButtons = canModify
            ? `
              <button data-testid="btn-edit-expense-${escapeHtml(e.id)}" onclick="openEditExpenseModal('${escapeHtml(e.id)}')" class="text-xs text-emerald-300 hover:text-emerald-200 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 transition">
                Edit
              </button>
              <button data-testid="btn-delete-expense-${escapeHtml(e.id)}" onclick="deleteExpenseById('${escapeHtml(e.id)}')" class="text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 transition">
                Delete
              </button>
            `
            : '';

          return `
            <div data-testid="expense-card-${escapeHtml(e.id)}" class="glass-panel glass-card-hover rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-sm text-white">${escapeHtml(e.description)}</span>
                  ${e.type === 'income' ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">💵 Income / Refund</span>' : ''}
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">${escapeHtml(e.category)}</span>
                  <span class="px-2 py-0.5 rounded text-[10px] uppercase bg-slate-800 text-slate-300">${escapeHtml(e.splitType)} split</span>
                  ${billSettlementBadge}
                  ${fxBadge}
                  ${parentRefundBadge}
                </div>
                <div class="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                  <span>${e.type === 'income' ? 'Received by' : 'Paid by'} <strong class="text-emerald-300">${
                    Array.isArray(e.paidByAllocations) && e.paidByAllocations.length > 1
                      ? e.paidByAllocations.map((p) => `${escapeHtml(p.memberName.split(' ')[0])} (${formatINR(p.amount)})`).join(' + ')
                      : escapeHtml(e.paidByName)
                  }</strong> in <span class="text-teal-300">${escapeHtml(grp ? grp.name : 'Group')}</span> · 📅 ${escapeHtml(formatEventDisplayDate(e.date || e.expenseDate))} · 👤 Added by <strong class="text-slate-200">${escapeHtml(e.createdByName || e.createdByEmail || e.paidByName)}</strong></span>
                  ${Array.isArray(e.paidByAllocations) && e.paidByAllocations.length > 1 ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30">👥 ${e.paidByAllocations.length} Payers</span>` : ''}
                </div>
                <div class="flex flex-wrap gap-1.5 pt-1">${splitsPills}</div>
              </div>
              <div class="flex sm:flex-col items-center sm:items-end justify-between gap-2">
                <div class="text-lg font-extrabold ${e.type === 'income' ? 'text-cyan-400' : 'text-white'}">${e.type === 'income' ? '+' : ''}${formatINR(e.amount)}</div>
                <div class="flex items-center gap-1.5">
                  ${actionButtons}
                </div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    function triggerFileDownload(filename, content, mimeType) {
      const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    function exportExpensesCsv() {
      const rows = [['ID', 'Date', 'Group', 'Description', 'Category', 'Type', 'Amount (INR)', 'Paid By', 'Created By', 'Split Mode']];
      appState.expenses.forEach((e) => {
        const grp = appState.groups.find((g) => g.id === e.groupId);
        rows.push([
          e.id,
          e.date || '',
          grp ? grp.name : e.groupId,
          `"${String(e.description).replace(/"/g, '""')}"`,
          e.category,
          e.type || 'expense',
          e.amount,
          e.paidByName,
          e.createdByName || e.createdByEmail || e.paidByName,
          e.splitType
        ]);
      });
      const csvContent = rows.map((r) => r.join(',')).join('\n');
      triggerFileDownload('vasool_expenses.csv', csvContent, 'text/csv');
      copyTextToClipboard(csvContent, 'Expenses CSV copied to clipboard and downloaded!');
    }

    function exportGroupStatement() {
      const activeGroups = selectedGroupId === 'ALL'
        ? appState.groups
        : appState.groups.filter((g) => g.id === selectedGroupId);

      const targetGroup = activeGroups[0] || appState.groups[0];
      if (!targetGroup) {
        showToast('No active group to export.', 'error');
        return;
      }

      const { totalSpend, balances, simplified } = computeBalancesAndSimplifications(targetGroup.id);
      const groupExpenses = appState.expenses.filter((e) => e.groupId === targetGroup.id);
      const groupSettlements = appState.settlements.filter((s) => s.groupId === targetGroup.id);

      let report = `================================================================================\n`;
      report += `                  VASOOL OFFICIAL GROUP TRIP STATEMENT & AUDIT LEDGER          \n`;
      report += `================================================================================\n\n`;
      report += `Group Name:       ${targetGroup.name}\n`;
      report += `Invite Code:      ${targetGroup.inviteCode}\n`;
      report += `Category:         ${targetGroup.category}\n`;
      report += `Active Currency:  INR (₹)\n`;
      report += `Generated On:     ${new Date().toISOString()}\n`;
      report += `Total Spend:      ${formatINR(totalSpend)}\n`;
      report += `Debt Algorithm:   ${targetGroup.minimizeDebts !== false ? 'Fewest Transfers (Min-Cash-Flow)' : 'Direct Debts'}\n\n`;

      report += `--------------------------------------------------------------------------------\n`;
      report += `1. MEMBER ROLES & WEIGHT DIRECTORY\n`;
      report += `--------------------------------------------------------------------------------\n`;
      targetGroup.members.forEach((m) => {
        const netBal = balances[m.email] || 0;
        const balStr = netBal > 0.01
          ? `+${formatINR(netBal)} (to receive)`
          : netBal < -0.01
          ? `-${formatINR(Math.abs(netBal))} (owes)`
          : `Settled (₹0.00)`;
        report += `• ${m.name.padEnd(26)} [${m.email.padEnd(30)}] Role: ${(m.role || 'member').toUpperCase().padEnd(7)} Weight: ${m.defaultWeight || 1}x | Net: ${balStr}\n`;
      });

      report += `\n--------------------------------------------------------------------------------\n`;
      report += `2. ITEMIZED BILLS & REFUNDS (${groupExpenses.length})\n`;
      report += `--------------------------------------------------------------------------------\n`;
      groupExpenses.forEach((e, idx) => {
        report += `#${idx + 1} [${e.date || 'Recent'}] ${e.description} (${e.category})\n`;
        report += `   Amount: ${e.type === 'income' ? '+' : ''}${formatINR(e.amount)} | Paid By: ${e.paidByName} | Created By: ${e.createdByName || e.createdByEmail || e.paidByName} | Split: ${e.splitType.toUpperCase()}\n`;
        if (e.splits && e.splits.length) {
          const splitsStr = e.splits.map((s) => `${s.memberName}: ${formatINR(s.amount)}`).join(', ');
          report += `   Shares: ${splitsStr}\n`;
        }
        report += `\n`;
      });

      report += `--------------------------------------------------------------------------------\n`;
      report += `3. VERIFIED SETTLEMENTS & AUDIT LOG (${groupSettlements.length})\n`;
      report += `--------------------------------------------------------------------------------\n`;
      if (!groupSettlements.length) {
        report += `No settlements recorded yet for this group.\n`;
      } else {
        groupSettlements.forEach((s, idx) => {
          report += `#${idx + 1} [${s.settledAt || 'Recent'}] ${s.fromName} -> ${s.toName} : ${formatINR(s.amount)} (${s.method})\n`;
          report += `   Status: ${(s.status || 'confirmed').toUpperCase()}`;
          if (s.utrNumber) report += ` | UTR: ${s.utrNumber}`;
          if (s.confirmedRole) report += ` | Confirmed by: ${s.confirmedRole.toUpperCase()}`;
          if (s.referenceNote) report += ` | Note: "${s.referenceNote}"`;
          report += `\n`;
        });
      }

      report += `\n--------------------------------------------------------------------------------\n`;
      report += `4. OPEN SETTLEMENT RECOMMENDATIONS (${simplified.length})\n`;
      report += `--------------------------------------------------------------------------------\n`;
      if (!simplified.length) {
        report += `All member balances are fully settled! No pending transfers required.\n`;
      } else {
        simplified.forEach((t, idx) => {
          const rem = typeof t.remainingDue === 'number' ? t.remainingDue : t.amount;
          report += `(${idx + 1}) ${t.fromName} owes ${t.toName} : ${formatINR(rem)} (${t.type || 'direct'})\n`;
        });
      }

      report += `\n================================================================================\n`;
      report += `                       END OF VASOOL TRIP STATEMENT                            \n`;
      report += `================================================================================\n`;

      const safeName = targetGroup.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      triggerFileDownload(`vasool_statement_${safeName}.txt`, report, 'text/plain');
      copyTextToClipboard(report, `Full statement for "${targetGroup.name}" copied to clipboard and downloaded!`);
    }

    let lastDeletedExpenseSnapshot = null;
    let lastGeneratedStatementHtml = '';
    let lastGeneratedStatementGroupName = 'group';

    function recordLocalGroupAudit(groupId, action, summary, details = '') {
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;
      if (!Array.isArray(grp.auditLog)) grp.auditLog = [];
      grp.auditLog.unshift({
        action,
        actorEmail: appState.currentUser?.email || 'demo@vasool.test',
        actorName: appState.currentUser?.name || 'Member',
        summary,
        details,
        createdAt: new Date().toISOString()
      });
      if (grp.auditLog.length > 100) grp.auditLog = grp.auditLog.slice(0, 100);
    }

    function drillDownExpensesByCategory(categoryName) {
      const catEl = document.getElementById('expenseCategoryFilter');
      if (catEl) {
        catEl.value = categoryName;
      }
      switchMainTab('expenses');
      renderExpensesList();
      showToast(`🔍 Filtered bills by category: ${categoryName}`);
    }

    function drillDownExpensesByMember(memberName) {
      const searchEl = document.getElementById('expenseSearchInput');
      if (searchEl) {
        searchEl.value = memberName.split(' ')[0];
      }
      switchMainTab('expenses');
      renderExpensesList();
      showToast(`🔍 Filtered bills involving: ${memberName}`);
    }

    async function deleteExpenseById(expId) {
      const target = appState.expenses.find((e) => e.id === expId || e._id === expId);
      if (target) {
        lastDeletedExpenseSnapshot = JSON.parse(JSON.stringify(target));
      }
      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          await apiFetch(`/api/expenses/${expId}`, { method: 'DELETE' });
        } catch (err) {
          console.warn('[Delete Expense] Server notice:', err.message);
        }
      }
      appState.expenses = appState.expenses.filter((e) => e.id !== expId && e._id !== expId);
      if (target) {
        recordLocalGroupAudit(
          target.groupId,
          'expense_deleted',
          `${appState.currentUser?.name || 'Member'} deleted bill "${target.description}" (${formatINR(target.amount)})`,
          `Originally paid by ${target.paidByName}`
        );
        const banner = document.getElementById('undoDeleteExpenseBanner');
        const txt = document.getElementById('undoDeleteExpenseText');
        if (banner && txt) {
          txt.textContent = `Deleted "${target.description}" (${formatINR(target.amount)}).`;
          banner.classList.remove('hidden');
        }
      }
      saveState();
      refreshAllViews();
      if (activeDetailsGroupId) {
        const g = appState.groups.find((gr) => gr.id === activeDetailsGroupId);
        if (g) renderGroupDetailsData(g);
      }
      showToast('Expense removed. Click "Undo Delete" to restore.');
    }

    function dismissUndoDeleteBanner() {
      const banner = document.getElementById('undoDeleteExpenseBanner');
      if (banner) banner.classList.add('hidden');
    }

    async function undoLastDeletedExpense() {
      if (!lastDeletedExpenseSnapshot) {
        showToast('Nothing to undo.', 'error');
        return;
      }
      const restored = { ...lastDeletedExpenseSnapshot };
      lastDeletedExpenseSnapshot = null;
      dismissUndoDeleteBanner();

      if (localStorage.getItem(AUTH_TOKEN_KEY)) {
        try {
          const res = await apiFetch('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(restored)
          });
          if (res && res.expense && res.expense._id) {
            restored.id = res.expense._id.toString();
          }
        } catch (err) {
          console.warn('[Undo Delete] Server notice:', err.message);
        }
      }

      appState.expenses.unshift(restored);
      recordLocalGroupAudit(
        restored.groupId,
        'expense_restored',
        `${appState.currentUser?.name || 'Member'} restored deleted bill "${restored.description}" (${formatINR(restored.amount)})`,
        'Restored via 1-Click Undo'
      );
      saveState();
      refreshAllViews();
      showToast(`↩️ Restored "${restored.description}" (${formatINR(restored.amount)})!`);
    }

    function exportGroupPdfSummary(groupIdOverride = null) {
      const targetGroupId = groupIdOverride || (selectedGroupId === 'ALL' ? appState.groups[0]?.id : selectedGroupId);
      const targetGroup = appState.groups.find((g) => g.id === targetGroupId) || appState.groups[0];
      if (!targetGroup) {
        showToast('No active group to export.', 'error');
        return;
      }

      const { totalSpend, balances, simplified } = computeBalancesAndSimplifications(targetGroup.id);
      const groupExpenses = appState.expenses.filter((e) => e.groupId === targetGroup.id);
      const groupSettlements = appState.settlements.filter((s) => s.groupId === targetGroup.id);
      const generatedDate = new Date().toLocaleString();
      lastGeneratedStatementGroupName = targetGroup.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

      const previewHtml = `
        <div class="space-y-4">
          <div class="p-4 rounded-2xl bg-slate-950 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Vasool Official Group Trip &amp; Settlement Statement</div>
              <h4 class="text-base font-extrabold text-white mt-0.5">${escapeHtml(targetGroup.name)} (${escapeHtml(targetGroup.category || 'Trip')})</h4>
              <div class="text-[11px] text-slate-400">Invite Code: <span class="font-mono-code text-slate-200">${escapeHtml(targetGroup.inviteCode)}</span> · Generated: ${escapeHtml(generatedDate)}</div>
            </div>
            <div class="text-right">
              <div class="text-[10px] uppercase text-slate-400 font-semibold">Net Group Spend</div>
              <div class="text-lg font-extrabold text-emerald-400">${formatINR(totalSpend)}</div>
              <div class="text-[10px] text-slate-400">${groupExpenses.length} Bills · ${groupSettlements.length} Settlements</div>
            </div>
          </div>

          <div>
            <h5 class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">1. Member Net Balances &amp; Share Weights</h5>
            <div class="overflow-x-auto rounded-xl border border-slate-800">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <th class="p-2.5">Member</th>
                    <th class="p-2.5">Role</th>
                    <th class="p-2.5">Weight</th>
                    <th class="p-2.5 text-right">Net Balance</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/70">
                  ${targetGroup.members.map((m) => {
                    const net = balances[m.email] || 0;
                    const cls = net > 0.01 ? 'text-emerald-400 font-bold' : net < -0.01 ? 'text-rose-400 font-bold' : 'text-slate-400';
                    const label = net > 0.01 ? `+${formatINR(net)} (Owed)` : net < -0.01 ? `-${formatINR(Math.abs(net))} (Owes)` : 'Settled (₹0.00)';
                    return `
                      <tr>
                        <td class="p-2.5 font-semibold text-white">${escapeHtml(m.name)} <span class="text-[10px] text-slate-400">(${escapeHtml(m.email)})</span></td>
                        <td class="p-2.5 uppercase text-[10px] text-slate-300">${escapeHtml(m.role || 'member')}</td>
                        <td class="p-2.5 font-mono-code text-teal-300">${m.defaultWeight || 1}x</td>
                        <td class="p-2.5 text-right ${cls}">${label}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h5 class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">2. Itemized Bills &amp; Linked Refunds (${groupExpenses.length})</h5>
            <div class="space-y-1.5">
              ${groupExpenses.map((e, i) => `
                <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between gap-2">
                  <div>
                    <div class="font-semibold text-white">#${i + 1} ${escapeHtml(e.description)} <span class="text-[10px] text-emerald-300">(${escapeHtml(e.category)})</span></div>
                    <div class="text-[11px] text-slate-400">
                      ${e.type === 'income' ? 'Refund received by' : 'Paid by'} <strong>${escapeHtml(e.paidByName)}</strong> · ${escapeHtml(e.splitType.toUpperCase())} split · 👤 Added by <strong>${escapeHtml(e.createdByName || e.createdByEmail || e.paidByName)}</strong>
                      ${e.originalCurrency && e.originalCurrency !== 'INR' ? ` · FX: ${e.originalAmount} ${escapeHtml(e.originalCurrency)} @ ₹${e.exchangeRate}` : ''}
                      ${e.parentExpenseDesc ? ` · Linked to: ${escapeHtml(e.parentExpenseDesc)}` : ''}
                    </div>
                  </div>
                  <div class="font-bold ${e.type === 'income' ? 'text-cyan-400' : 'text-white'}">${e.type === 'income' ? '+' : ''}${formatINR(e.amount)}</div>
                </div>
              `).join('') || '<div class="text-slate-500 italic">No bills logged yet.</div>'}
            </div>
          </div>

          <div>
            <h5 class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">3. Settlement Handshake History (${groupSettlements.length}) &amp; Remaining Transfers (${simplified.length})</h5>
            <div class="space-y-1.5">
              ${groupSettlements.map((s) => `
                <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between gap-2">
                  <div>
                    <span class="font-semibold text-emerald-300">${escapeHtml(s.fromName)}</span> &rarr; <span class="font-semibold text-white">${escapeHtml(s.toName)}</span>
                    <span class="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 ml-1">${escapeHtml(s.status)}</span>
                    ${s.utrNumber ? `<span class="text-[10px] font-mono-code text-teal-300 ml-1">UTR: ${escapeHtml(s.utrNumber)}</span>` : ''}
                    ${s.originalClaimedAmount ? `<span class="text-[10px] text-amber-300 ml-1">(Partial of ${formatINR(s.originalClaimedAmount)})</span>` : ''}
                  </div>
                  <div class="font-bold text-emerald-400">${formatINR(s.amount)}</div>
                </div>
              `).join('')}
              ${simplified.map((t) => {
                const rem = typeof t.remainingDue === 'number' ? t.remainingDue : t.amount;
                return `
                  <div class="p-2.5 rounded-xl bg-rose-950/20 border border-rose-500/30 flex items-center justify-between gap-2">
                    <div>
                      <span class="text-[10px] uppercase font-bold text-rose-300 mr-1">[OPEN DUE]</span>
                      <strong>${escapeHtml(t.fromName)}</strong> owes <strong>${escapeHtml(t.toName)}</strong>
                    </div>
                    <div class="font-bold text-rose-300">${formatINR(rem)}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;

      lastGeneratedStatementHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vasool Statement - ${escapeHtml(targetGroup.name)}</title><style>body{font-family:Inter,system-ui,sans-serif;padding:28px;color:#0f172a;background:#fff}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:8px 10px;font-size:12px;text-align:left}h4,h5{margin:14px 0 6px}</style></head><body>${previewHtml}</body></html>`;

      const contentEl = document.getElementById('pdfStatementPreviewContent');
      if (contentEl) contentEl.innerHTML = previewHtml;
      openModal('pdfStatementPreviewModal');
      recordRumAction('Export PDF Statement Preview', { group: targetGroup.name });
    }

    function downloadActiveHtmlStatement() {
      if (!lastGeneratedStatementHtml) {
        exportGroupPdfSummary();
      }
      triggerFileDownload(`vasool_statement_${lastGeneratedStatementGroupName}.html`, lastGeneratedStatementHtml, 'text/html');
      showToast('📄 Group HTML/Print Statement downloaded!');
    }

    function triggerPrintStatementWindow() {
      if (!lastGeneratedStatementHtml) {
        exportGroupPdfSummary();
      }
      try {
        const w = window.open('', '_blank', 'width=900,height=700');
        if (w && w.document) {
          w.document.open();
          w.document.write(lastGeneratedStatementHtml);
          w.document.close();
          w.focus();
          w.print();
          return;
        }
      } catch (e) {
        // Fallback to current window print or download
      }
      downloadActiveHtmlStatement();
    }

    function renderGroupsGrid() {
      const container = document.getElementById('groupsGridContainer');
      if (!container) return;

      if (typeof renderPendingInvitesBanner === 'function') {
        renderPendingInvitesBanner();
      }

      if (!appState.groups || !appState.groups.length) {
        container.innerHTML = '<div class="col-span-full glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">No groups created yet. Click "+ New Group" above to start.</div>';
        return;
      }

      const currentEmail = (appState.currentUser?.email || '').toLowerCase().trim();

      container.innerHTML = appState.groups
        .map((g) => {
          const { totalSpend, simplified } = computeBalancesAndSimplifications(g.id);
          const currentAdmin = g.members.find((m) => m.role === 'admin' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase())) || g.members[0];
          const isCurrentUserAdmin = currentAdmin && currentAdmin.email.toLowerCase().trim() === currentEmail;
          const isPersonalOnly = (g.splitsVisibility || 'personal_only') === 'personal_only';
          const canAddMember = isCurrentUserAdmin || Boolean(g.allowMembersToAddOthers);

          const membersBadges = g.members
            .map((m) => {
              const isAdmin = m.role === 'admin' || (g.adminEmail && g.adminEmail.toLowerCase() === m.email.toLowerCase());
              const isPending = m.status === 'pending_acceptance';
              const ini = m.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();

              const canTransfer = isCurrentUserAdmin && !isAdmin && !isPending;

              return `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl ${isAdmin ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : isPending ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-slate-900/90 border-slate-800 text-slate-200'} border text-xs shadow-sm">
                  <span class="w-4 h-4 rounded-full ${isAdmin ? 'bg-amber-400 text-slate-950 font-bold' : isPending ? 'bg-amber-500/30 text-amber-300 font-bold' : 'bg-emerald-500/20 text-emerald-300 font-bold'} text-[9px] flex items-center justify-center">
                    ${isAdmin ? '👑' : isPending ? '⏳' : escapeHtml(ini)}
                  </span>
                  <span class="font-medium">${escapeHtml(m.name)}</span>
                  ${isAdmin ? '<span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/25 text-amber-300 border border-amber-400/30">👑 Admin</span>' : ''}
                  ${isPending ? '<span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-500/35" title="Invitation pending user acceptance">⏳ Pending Acceptance</span>' : '<span class="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded text-emerald-400">✓ Active</span>'}
                  ${(m.defaultWeight && m.defaultWeight !== 1) ? `<span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-teal-400/20 text-teal-300 border border-teal-400/30">⚖️ ${m.defaultWeight}x Weight</span>` : ''}
                  ${canTransfer ? `
                    <button data-testid="btn-transfer-admin-${escapeHtml(m.email)}" onclick="promptTransferAdmin('${escapeHtml(g.id)}', '${escapeHtml(m.email)}', '${escapeHtml(m.name)}')" title="Transfer Adminship to ${escapeHtml(m.name)}" class="ml-1 text-[10px] text-amber-300/80 hover:text-amber-200 underline font-semibold">
                      Make Admin
                    </button>
                  ` : ''}
                </span>
              `;
            })
            .join('');

          return `
            <div data-testid="group-card-${escapeHtml(g.id)}" class="glass-panel glass-card-hover rounded-3xl p-5 flex flex-col justify-between space-y-4 border border-slate-800/80 shadow-xl">
              <div>
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30 shadow-sm shadow-teal-500/10">${escapeHtml(g.category)}</span>
                    <button onclick="copyTextToClipboard('${escapeHtml(g.inviteCode)}', 'Invite code ${escapeHtml(g.inviteCode)} copied!')" class="text-[11px] font-mono-code text-slate-400 hover:text-emerald-300">
                      Code: ${escapeHtml(g.inviteCode)} 📋
                    </button>
                    <button onclick="copyInviteLink('${escapeHtml(g.inviteCode)}', '${escapeHtml(g.name)}')" title="Copy Direct Invite Link" class="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 transition">
                      🔗 Share Link
                    </button>
                  </div>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    ${isCurrentUserAdmin ? `
                      <button data-testid="btn-group-settings-${escapeHtml(g.id)}" onclick="openGroupSettingsModal('${escapeHtml(g.id)}')" title="Group Admin Settings" class="text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1">
                        ⚙️ Settings
                      </button>
                      <button data-testid="btn-toggle-adminhub-${escapeHtml(g.id)}" onclick="toggleGroupAdminHub('${escapeHtml(g.id)}')" title="Admin control: Toggle Admin-Hub routing vs Direct Peer-to-Peer" class="text-[10px] font-semibold px-2 py-0.5 rounded-lg border transition ${g.adminHubSettlement === true ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
                        ${g.adminHubSettlement === true ? '👑 Admin-Hub' : '⚡ Direct P2P'}
                      </button>
                      <button data-testid="btn-toggle-minimize-${escapeHtml(g.id)}" onclick="toggleGroupMinimizeDebts('${escapeHtml(g.id)}')" title="Toggle Settle Up Debt Minimization mode across all unsettled bills" class="text-[10px] font-semibold px-2 py-0.5 rounded-lg border transition ${g.minimizeDebts !== false ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' : 'bg-teal-500/20 text-teal-300 border-teal-500/40 hover:bg-teal-500/30'}">
                        ${g.minimizeDebts !== false ? '⚡ Fewest Transfers' : '🤝 Direct Pair-Wise'}
                      </button>
                      <button data-testid="btn-toggle-visibility-${escapeHtml(g.id)}" onclick="toggleGroupSplitVisibility('${escapeHtml(g.id)}')" title="Admin control: Toggle member split visibility" class="text-[10px] font-semibold px-2 py-0.5 rounded-lg border transition ${isPersonalOnly ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
                        ${isPersonalOnly ? '🔒 Personal' : '🌐 All'}
                      </button>
                    ` : `
                      <span class="text-[10px] font-medium px-2 py-0.5 rounded-lg border ${g.adminHubSettlement === true ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-slate-800/80 text-slate-400 border-slate-700/50'}">
                        ${g.adminHubSettlement === true ? '👑 Admin-Hub' : '⚡ Direct P2P'}
                      </span>
                      <span class="text-[10px] font-medium px-2 py-0.5 rounded-lg border ${g.minimizeDebts !== false ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-teal-500/15 text-teal-300 border-teal-500/30'}">
                        ${g.minimizeDebts !== false ? '⚡ Fewest Transfers' : '🤝 Direct Pair-Wise'}
                      </span>
                      <span class="text-[10px] font-medium px-2 py-0.5 rounded-lg border ${isPersonalOnly ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' : 'bg-slate-800/80 text-slate-400 border-slate-700/50'}">
                        ${isPersonalOnly ? '🔒 Personal' : '🌐 All'}
                      </span>
                      ${g.allowMembersToAddOthers ? '<span class="text-[10px] font-medium px-2 py-0.5 rounded-lg border bg-teal-500/15 text-teal-300 border-teal-500/30">👥 Can Invite</span>' : ''}
                    `}
                  </div>
                </div>
                <div class="cursor-pointer group/cardtitle" onclick="openGroupDetailsModal('${escapeHtml(g.id)}')" title="Click to view Group Details, Members, Bills &amp; Exit Option">
                  <div class="flex items-center justify-between gap-2 mt-2">
                    <h4 class="text-base font-bold text-white group-hover/cardtitle:text-teal-300 transition flex items-center gap-1.5">
                      <span>${escapeHtml(g.name)}</span>
                      <span class="text-xs text-teal-400 opacity-70 group-hover/cardtitle:opacity-100">↗</span>
                    </h4>
                    <span class="text-[11px] font-semibold text-teal-400 group-hover/cardtitle:underline">Details &amp; Bills →</span>
                  </div>
                  <div class="text-xs text-slate-400 mt-1">
                    Total Spend: <strong class="text-white">${formatINR(totalSpend)}</strong> · ${simplified.length} open settlement(s)
                  </div>
                </div>
                <div class="mt-3">
                  <div class="text-[11px] text-slate-400 mb-1.5 flex items-center justify-between">
                    <span>Members (${g.members.length}):</span>
                    ${currentAdmin ? `<span class="text-[10px] text-amber-300 font-semibold">Admin: ${escapeHtml(currentAdmin.name)} 👑</span>` : ''}
                  </div>
                  <div class="flex flex-wrap gap-1.5">${membersBadges}</div>
                </div>
              </div>

              <div class="flex items-center gap-2 pt-3 border-t border-slate-800/80">
                <button data-testid="btn-group-details-${escapeHtml(g.id)}" onclick="openGroupDetailsModal('${escapeHtml(g.id)}')" class="flex-1 py-2 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-xs font-bold text-teal-300 border border-teal-500/30 shadow-sm shadow-teal-500/10 transition flex items-center justify-center gap-1.5">
                  📋 Details &amp; Bills
                </button>
                ${canAddMember ? `
                  <button data-testid="btn-add-member-${escapeHtml(g.id)}" onclick="openAddMemberModal('${escapeHtml(g.id)}')" class="py-2 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700/60 shadow-sm transition">
                    + Member
                  </button>
                ` : ''}
                <button data-testid="btn-view-bills-${escapeHtml(g.id)}" onclick="selectGroupAndOpenExpenses('${escapeHtml(g.id)}')" class="py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700/60 shadow-sm transition">
                  Bills Tab
                </button>
              </div>
            </div>
          `;
        })
        .join('');
    }

    async function toggleGroupSplitVisibility(groupId) {
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;
      const current = grp.splitsVisibility || 'personal_only';
      const next = current === 'personal_only' ? 'show_all' : 'personal_only';
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/visibility`, {
            method: 'PATCH',
            body: JSON.stringify({ splitsVisibility: next })
          });
          if (res && res.error) {
            showToast('Failed to update split visibility: ' + res.error, 'error');
            return;
          }
        }
        grp.splitsVisibility = next;
        saveState();
        refreshAllViews();
        showToast(
          next === 'personal_only'
            ? '🔒 Split Privacy ON: Non-admin members will only see their own shares.'
            : '🌐 Split Privacy OFF: All group members can view everyone\'s splits.'
        );
      } catch (err) {
        showToast('Error updating split visibility: ' + err.message, 'error');
      }
    }

    async function toggleGroupAdminHub(groupId) {
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;
      const next = !grp.adminHubSettlement;
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/settings`, {
            method: 'PATCH',
            body: JSON.stringify({ adminHubSettlement: next })
          });
          if (res && res.error) {
            showToast('Failed to update settlement routing: ' + res.error, 'error');
            return;
          }
        }
        grp.adminHubSettlement = next;
        saveState();
        refreshAllViews();
        showToast(
          next
            ? '👑 Admin-Hub Routing ON: Debts route through Group Admin.'
            : '⚡ Direct Peer-to-Peer ON: Members settle directly with each other.'
        );
      } catch (err) {
        showToast('Error updating settlement routing: ' + err.message, 'error');
      }
    }

    async function toggleGroupMinimizeDebts(groupId) {
      const grp = appState.groups.find((g) => g.id === groupId);
      if (!grp) return;
      const current = grp.minimizeDebts !== false;
      const next = !current;
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/minimize-debts`, {
            method: 'PATCH',
            body: JSON.stringify({ minimizeDebts: next })
          });
          if (res && res.error) {
            showToast('Failed to update debt mode: ' + res.error, 'error');
            return;
          }
        }
        grp.minimizeDebts = next;
        saveState();
        refreshAllViews();
        showToast(
          next
            ? '⚡ Fewest Transfers ON: All unsettled group bills simplified to minimum cash-flow transfers.'
            : '🤝 Direct Pair-Wise ON: All unsettled group bills calculated as exact person-to-person debts.'
        );
      } catch (err) {
        showToast('Error updating debt mode: ' + err.message, 'error');
      }
    }

    async function promptTransferAdmin(groupId, targetEmail, targetName) {
      // Direct admin transfer execution with toast notification
      await handleTransferAdmin(groupId, targetEmail, targetName);
    }

    async function handleTransferAdmin(groupId, targetEmail, targetName) {
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/groups/${groupId}/transfer-admin`, {
            method: 'POST',
            body: JSON.stringify({ newAdminEmail: targetEmail })
          });
          if (res && res.error) {
            showToast('Failed to transfer admin: ' + res.error, 'error');
            return;
          }
        }

        // Update local appState.groups
        const grp = appState.groups.find((g) => g.id === groupId);
        if (grp) {
          grp.members.forEach((m) => {
            if (m.email.toLowerCase() === targetEmail.toLowerCase()) {
              m.role = 'admin';
            } else {
              m.role = 'member';
            }
          });
          grp.adminEmail = targetEmail.toLowerCase();
        }

        saveState();
        refreshAllViews();
        showToast(`👑 Admin privileges successfully transferred to ${targetName}!`);
      } catch (err) {
        showToast('Error transferring admin: ' + err.message, 'error');
      }
    }

    const activeSettlementActionSet = new Set();

    async function handleConfirmSettlement(settlementId, customReceivedAmount = null, customAdminNote = '') {
      if (activeSettlementActionSet.has(settlementId)) {
        console.warn(`[Settlement] Action on ${settlementId} already in progress. Ignoring duplicate click.`);
        return;
      }
      activeSettlementActionSet.add(settlementId);
      try {
        const payload = {};
        if (customReceivedAmount !== null && Number(customReceivedAmount) > 0) {
          payload.receivedAmount = Number(customReceivedAmount);
        }
        if (customAdminNote) {
          payload.adminNote = customAdminNote;
        }
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/settlements/${settlementId}/confirm`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.error) {
            showToast('Failed to confirm settlement: ' + res.error, 'error');
            return;
          }
        }
        const stl = appState.settlements.find((s) => s.id === settlementId);
        if (stl) {
          const origAmt = Number(stl.amount);
          if (customReceivedAmount !== null && Number(customReceivedAmount) > 0 && Number(customReceivedAmount) < origAmt) {
            stl.originalClaimedAmount = origAmt;
            stl.amount = Math.round(Number(customReceivedAmount) * 100) / 100;
          }
          if (customAdminNote) stl.adminNote = customAdminNote;
          stl.status = 'confirmed';
          stl.confirmedAt = new Date().toISOString();
          stl.confirmedByEmail = appState.currentUser?.email || '';
          recordLocalGroupAudit(
            stl.groupId,
            stl.originalClaimedAmount ? 'settlement_partial_confirmed' : 'settlement_confirmed',
            stl.originalClaimedAmount
              ? `Confirmed partial payment of ${formatINR(stl.amount)} (of ${formatINR(stl.originalClaimedAmount)} claimed) from ${stl.fromName}`
              : `Confirmed ${formatINR(stl.amount)} settlement from ${stl.fromName} to ${stl.toName}`,
            customAdminNote || stl.method
          );
        }
        saveState();
        refreshAllViews();
        showToast(
          customReceivedAmount !== null
            ? `⚖️ Partial payment (${formatINR(customReceivedAmount)}) confirmed! Remainder stays open.`
            : '✅ Payment confirmed received! Transaction officially settled.'
        );
      } catch (err) {
        showToast('Error confirming settlement: ' + err.message, 'error');
      } finally {
        activeSettlementActionSet.delete(settlementId);
      }
    }

    function handlePartialConfirmSettlement(settlementId, claimedAmount) {
      const idEl = document.getElementById('partialSettleIdInput');
      const clEl = document.getElementById('partialSettleClaimedInput');
      const amtEl = document.getElementById('partialSettleAmountInput');
      const noteEl = document.getElementById('partialSettleNoteInput');
      const hintEl = document.getElementById('partialSettleHintText');
      if (idEl) idEl.value = settlementId;
      if (clEl) clEl.value = String(claimedAmount);
      if (amtEl) {
        amtEl.max = String(claimedAmount);
        amtEl.value = String(Math.max(1, Math.round(Number(claimedAmount) * 0.8)));
      }
      if (noteEl) noteEl.value = 'Partial UPI transfer received';
      if (hintEl) hintEl.textContent = `Claimed by payer: ${formatINR(claimedAmount)}. Remaining difference will stay open.`;
      openModal('partialSettleModal');
    }

    async function submitPartialSettleModal(e) {
      e.preventDefault();
      const settlementId = document.getElementById('partialSettleIdInput')?.value;
      const claimedAmount = Number(document.getElementById('partialSettleClaimedInput')?.value) || 0;
      const parsed = Number(document.getElementById('partialSettleAmountInput')?.value) || 0;
      const note = document.getElementById('partialSettleNoteInput')?.value || 'Partial transfer received';
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > claimedAmount) {
        showToast('Enter a valid amount between ₹1 and the claimed amount.', 'error');
        return;
      }
      closeModal('partialSettleModal');
      await handleConfirmSettlement(settlementId, parsed, note);
    }

    function handleRejectSettlement(settlementId) {
      const idEl = document.getElementById('rejectSettleIdInput');
      const rEl = document.getElementById('rejectSettleReasonInput');
      if (idEl) idEl.value = settlementId;
      if (rEl) rEl.value = 'Payment not received in bank/UPI account';
      openModal('rejectSettleModal');
    }

    async function submitRejectSettleModal(e) {
      e.preventDefault();
      const settlementId = document.getElementById('rejectSettleIdInput')?.value;
      if (!settlementId) return;
      if (activeSettlementActionSet.has(settlementId)) {
        console.warn(`[Settlement] Action on ${settlementId} already in progress. Ignoring duplicate click.`);
        return;
      }
      activeSettlementActionSet.add(settlementId);
      const reason = (document.getElementById('rejectSettleReasonInput')?.value || 'Payment not received').trim();
      closeModal('rejectSettleModal');
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/settlements/${settlementId}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
          });
          if (res && res.error) {
            showToast('Failed to reject settlement: ' + res.error, 'error');
            return;
          }
        }
        const stl = appState.settlements.find((s) => s.id === settlementId);
        if (stl) {
          stl.status = 'rejected';
          stl.rejectedReason = reason;
          recordLocalGroupAudit(stl.groupId, 'settlement_rejected', `Rejected settlement claim from ${stl.fromName}`, reason);
        }
        saveState();
        refreshAllViews();
        showToast('❌ Settlement claim rejected.');
      } catch (err) {
        showToast('Error rejecting settlement: ' + err.message, 'error');
      } finally {
        activeSettlementActionSet.delete(settlementId);
      }
    }

    async function handleRevertSettlement(settlementId) {
      if (activeSettlementActionSet.has(settlementId)) {
        console.warn(`[Settlement] Action on ${settlementId} already in progress. Ignoring duplicate click.`);
        return;
      }
      const stlPreview = appState.settlements.find((s) => String(s.id || s._id) === String(settlementId));
      const amountLabel = stlPreview ? formatINR(stlPreview.amount) : 'this settlement';
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' &&
        !window.confirm(`Revert ${amountLabel} settlement? The amount will become due again.`)) {
        return;
      }
      activeSettlementActionSet.add(settlementId);
      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch(`/api/settlements/${settlementId}/revert`, {
            method: 'POST',
            body: JSON.stringify({})
          });
          if (res && res.error) {
            showToast('Failed to revert settlement: ' + res.error, 'error');
            return;
          }
        }
        const stl = appState.settlements.find((s) => String(s.id || s._id) === String(settlementId));
        if (stl) {
          stl.status = 'reverted';
          stl.revertedAt = new Date().toISOString();
          stl.revertedByEmail = appState.currentUser?.email || '';
          recordLocalGroupAudit(stl.groupId, 'settlement_reverted', `Reverted ${formatINR(stl.amount)} settlement from ${stl.fromName} to ${stl.toName}`, stl.method);
        }
        saveState();
        refreshAllViews();
        showToast('↩️ Settlement reverted. The amount is due again.');
      } catch (err) {
        showToast('Error reverting settlement: ' + err.message, 'error');
      } finally {
        activeSettlementActionSet.delete(settlementId);
      }
    }

    function selectGroupAndOpenExpenses(groupId) {
      selectedGroupId = groupId;
      document.getElementById('groupFilterSelect').value = groupId;
      handleGroupFilterChange(groupId);
      switchMainTab('expenses');
    }
