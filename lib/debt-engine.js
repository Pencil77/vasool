// Pure Debt & Balance Engine for Vasool v3.1
const SUPER_ADMIN_EMAIL = 'mdzubair7592@gmail.com';

function isSuperAdminUser(user) {
  if (!user) return false;
  return user.role === 'super_admin' || user.isSuperAdmin === true || (user.email && user.email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase());
}

/**
 * Append an immutable activity/audit entry onto a Group document (capped at latest 100 entries)
 */
function appendGroupAuditLog(group, { action, actorEmail = '', actorName = '', summary = '', details = '' }) {
  if (!group) return;
  if (!Array.isArray(group.auditLog)) {
    group.auditLog = [];
  }
  group.auditLog.unshift({
    action: String(action || 'event').trim(),
    actorEmail: String(actorEmail || '').toLowerCase().trim(),
    actorName: String(actorName || actorEmail || 'System').trim(),
    summary: String(summary || action).trim(),
    details: String(details || '').trim(),
    createdAt: new Date()
  });
  if (group.auditLog.length > 100) {
    group.auditLog = group.auditLog.slice(0, 100);
  }
}

/**
 * Greedy Minimum-Cash-Flow Fallback
 */
function simplifyDebtsGreedy(balanceMap) {
  const debtors = [];
  const creditors = [];

  Object.values(balanceMap).forEach((entry) => {
    const rounded = Math.round(entry.net * 100) / 100;
    if (rounded < -0.01) {
      debtors.push({ ...entry, amount: Math.abs(rounded) });
    } else if (rounded > 0.01) {
      creditors.push({ ...entry, amount: rounded });
    }
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settledAmount = Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100;

    if (settledAmount > 0) {
      transactions.push({
        fromEmail: debtor.email,
        fromName: debtor.name,
        toEmail: creditor.email,
        toName: creditor.name,
        amount: settledAmount,
        isAdminTransfer: false,
        type: 'standard_greedy'
      });
    }

    debtor.amount = Math.round((debtor.amount - settledAmount) * 100) / 100;
    creditor.amount = Math.round((creditor.amount - settledAmount) * 100) / 100;

    if (debtor.amount <= 0.01) i++;
    if (creditor.amount <= 0.01) j++;
  }

  return transactions;
}

/**
 * Admin-Hub Debt Calibration Algorithm:
 * All group members pay to the group Admin, and the Admin settles back to all creditors.
 * The Admin is also a normal member of the group who shares splits and may owe or be owed.
 * 
 * For every non-admin member M != Admin:
 * - If M's net balance < -0.01 (M owes): M pays Admin |M.net|
 * - If M's net balance > 0.01 (M is owed): Admin pays M M.net
 */
function simplifyDebtsAdminHub(balanceMap, adminMember) {
  if (!adminMember || !adminMember.email) {
    return simplifyDebtsGreedy(balanceMap);
  }

  const adminEmail = String(adminMember.email).toLowerCase().trim();
  const adminName = adminMember.name || 'Admin';
  const transactions = [];

  Object.values(balanceMap).forEach((entry) => {
    const memberEmail = String(entry.email).toLowerCase().trim();
    if (memberEmail === adminEmail) return;

    const rounded = Math.round(entry.net * 100) / 100;
    if (rounded < -0.01) {
      // Non-admin debtor pays the group Admin
      transactions.push({
        fromEmail: entry.email,
        fromName: entry.name,
        toEmail: adminEmail,
        toName: adminName,
        amount: Math.round(Math.abs(rounded) * 100) / 100,
        isAdminTransfer: true,
        type: 'pay_to_admin'
      });
    } else if (rounded > 0.01) {
      // Group Admin pays the non-admin creditor
      transactions.push({
        fromEmail: adminEmail,
        fromName: adminName,
        toEmail: entry.email,
        toName: entry.name,
        amount: Math.round(rounded * 100) / 100,
        isAdminTransfer: true,
        type: 'admin_payout'
      });
    }
  });

  // Sort: payments to admin first, payouts by admin second, then descending by amount
  transactions.sort((a, b) => {
    if (a.toEmail === adminEmail && b.toEmail !== adminEmail) return -1;
    if (a.toEmail !== adminEmail && b.toEmail === adminEmail) return 1;
    return b.amount - a.amount;
  });

  return transactions;
}

/**
 * Direct Pair-Wise Debts (When minimizeDebts is disabled):
 * Calculates exact debts directly between each debtor and the member who paid.
 */
/**
 * Extracts normalized payer allocations from an expense (supports single payer & multi-payer)
 */
function getExpensePayerAllocations(exp) {
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

function calculateDirectDebts(expenses, settlements) {
  const netPairMap = {};

  expenses.forEach((exp) => {
    const payers = getExpensePayerAllocations(exp);
    const totalExpAmt = payers.reduce((acc, p) => acc + p.amount, 0) || Number(exp.amount) || 1;
    const isIncome = exp.type === 'income';

    (exp.splits || []).forEach((s) => {
      const participantEmail = s.memberEmail.toLowerCase().trim();
      const participantName = s.memberName;

      payers.forEach((payer) => {
        const payerEmail = payer.memberEmail;
        const payerName = payer.memberName;
        if (participantEmail === payerEmail) return;
        const sharePortion = s.amount * (payer.amount / totalExpAmt);
        if (sharePortion <= 0) return;

        if (!isIncome) {
          const key = `${participantEmail}->${payerEmail}`;
          if (!netPairMap[key]) {
            netPairMap[key] = { fromEmail: participantEmail, fromName: participantName, toEmail: payerEmail, toName: payerName, amount: 0, type: 'direct_pairwise' };
          }
          netPairMap[key].amount += sharePortion;
        } else {
          const key = `${payerEmail}->${participantEmail}`;
          if (!netPairMap[key]) {
            netPairMap[key] = { fromEmail: payerEmail, fromName: payerName, toEmail: participantEmail, toName: participantName, amount: 0, type: 'direct_pairwise' };
          }
          netPairMap[key].amount += sharePortion;
        }
      });
    });
  });

  // Subtract confirmed settlements
  settlements.forEach((st) => {
    if (st.status === 'confirmed') {
      const from = st.fromEmail.toLowerCase().trim();
      const to = st.toEmail.toLowerCase().trim();
      const key = `${from}->${to}`;
      if (!netPairMap[key]) {
        netPairMap[key] = { fromEmail: from, fromName: st.fromName, toEmail: to, toName: st.toName, amount: 0, type: 'direct_pairwise' };
      }
      netPairMap[key].amount -= st.amount;
    }
  });

  // Consolidate bilateral debts (A->B and B->A)
  const transactions = [];
  const processed = new Set();

  Object.keys(netPairMap).forEach((key) => {
    if (processed.has(key)) return;
    const [from, to] = key.split('->');
    const revKey = `${to}->${from}`;
    const directAmt = netPairMap[key]?.amount || 0;
    const revAmt = netPairMap[revKey]?.amount || 0;
    const net = Math.round((directAmt - revAmt) * 100) / 100;

    processed.add(key);
    processed.add(revKey);

    if (net > 0.01) {
      transactions.push({
        fromEmail: from,
        fromName: netPairMap[key]?.fromName || from,
        toEmail: to,
        toName: netPairMap[key]?.toName || to,
        amount: net,
        isAdminTransfer: false,
        type: 'direct_pairwise'
      });
    } else if (net < -0.01) {
      transactions.push({
        fromEmail: to,
        fromName: netPairMap[revKey]?.fromName || to,
        toEmail: from,
        toName: netPairMap[key]?.toName || from,
        amount: Math.abs(net),
        isAdminTransfer: false,
        type: 'direct_pairwise'
      });
    }
  });

  transactions.sort((a, b) => b.amount - a.amount);
  return transactions;
}

/**
 * Computes exact balanceMap { [email]: { email, name, paid, owed, net } } for a single group.
 */
function computeGroupBalanceMap(group, expenses, settlements) {
  const balanceMap = {};
  const ensureMember = (email, name) => {
    const key = String(email || '').toLowerCase().trim();
    if (!key) return null;
    if (!balanceMap[key]) {
      balanceMap[key] = { email: key, name: name || key, paid: 0, owed: 0, net: 0 };
    }
    return balanceMap[key];
  };

  if (Array.isArray(group.members)) {
    group.members.forEach((m) => ensureMember(m.email, m.name));
  }

  expenses.forEach((exp) => {
    const isIncome = exp.type === 'income';
    const payers = getExpensePayerAllocations(exp);

    if (isIncome) {
      payers.forEach((p) => {
        const payer = ensureMember(p.memberEmail, p.memberName);
        if (payer) {
          payer.paid -= p.amount;
          payer.net -= p.amount;
        }
      });
      (exp.splits || []).forEach((s) => {
        const participant = ensureMember(s.memberEmail, s.memberName);
        if (participant) {
          participant.owed -= s.amount;
          participant.net += s.amount;
        }
      });
    } else {
      payers.forEach((p) => {
        const payer = ensureMember(p.memberEmail, p.memberName);
        if (payer) {
          payer.paid += p.amount;
          payer.net += p.amount;
        }
      });
      (exp.splits || []).forEach((s) => {
        const participant = ensureMember(s.memberEmail, s.memberName);
        if (participant) {
          participant.owed += s.amount;
          participant.net -= s.amount;
        }
      });
    }
  });

  settlements.forEach((st) => {
    if (st.status === 'confirmed') {
      const payer = ensureMember(st.fromEmail, st.fromName);
      const receiver = ensureMember(st.toEmail, st.toName);
      if (payer) payer.net += st.amount;
      if (receiver) receiver.net -= st.amount;
    }
  });

  Object.values(balanceMap).forEach((b) => {
    b.paid = Math.round(b.paid * 100) / 100;
    b.owed = Math.round(b.owed * 100) / 100;
    b.net = Math.round(b.net * 100) / 100;
  });

  return balanceMap;
}

/**
 * Computes simplified transactions for a group respecting its minimization & adminHub settings
 */
function computeGroupSimplifiedDebts(group, balanceMap, expenses, settlements) {
  let simplifiedTransactions = [];
  const isMinimized = group.minimizeDebts !== false;
  if (!isMinimized) {
    simplifiedTransactions = calculateDirectDebts(expenses, settlements);
  } else if (group.adminHubSettlement === true) {
    const adminMember = (group.members || []).find((m) => m.role === 'admin') ||
      (group.adminEmail ? (group.members || []).find((m) => m.email.toLowerCase() === group.adminEmail.toLowerCase()) : null) ||
      (group.members || [])[0];
    simplifiedTransactions = simplifyDebtsAdminHub(balanceMap, adminMember);
  } else {
    simplifiedTransactions = simplifyDebtsGreedy(balanceMap);
  }

  const pendingSettlements = settlements.filter((s) => s.status === 'pending_admin_approval');
  const pendingMap = {};
  pendingSettlements.forEach((s) => {
    const key = `${s.fromEmail}->${s.toEmail}`;
    pendingMap[key] = (pendingMap[key] || 0) + s.amount;
  });

  simplifiedTransactions.forEach((t) => {
    const key = `${t.fromEmail}->${t.toEmail}`;
    t.pendingApprovalAmount = Math.round((pendingMap[key] || 0) * 100) / 100;
    t.isPendingApproval = t.pendingApprovalAmount > 0;
    t.remainingDue = Math.max(0, Math.round((t.amount - t.pendingApprovalAmount) * 100) / 100);
  });

  return simplifiedTransactions;
}

module.exports = {
  SUPER_ADMIN_EMAIL,
  isSuperAdminUser,
  appendGroupAuditLog,
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
  getExpensePayerAllocations,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
};
