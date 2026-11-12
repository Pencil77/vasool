const express = require('express');
const { groupsRouter } = require('./groups');
const { expensesRouter } = require('./expenses');
const { settlementsRouter } = require('./settlements');
const {
  isSuperAdminUser,
  appendGroupAuditLog,
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
} = require('../lib/debt-engine');

const router = express.Router();

router.use(groupsRouter);
router.use(expensesRouter);
router.use(settlementsRouter);

module.exports = {
  splitsRouter: router,
  isSuperAdminUser,
  appendGroupAuditLog,
  simplifyDebtsGreedy,
  simplifyDebtsAdminHub,
  calculateDirectDebts,
  computeGroupBalanceMap,
  computeGroupSimplifiedDebts
};
