"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const requireBillingWriteAccess_1 = require("../middlewares/requireBillingWriteAccess");
const budgets_controller_1 = require("./budgets.controller");
const router = (0, express_1.Router)();
router.get("/annual", requireAuth_1.requireAuth, budgets_controller_1.annualBudget);
router.get("/page-data", requireAuth_1.requireAuth, budgets_controller_1.pageData);
router.get("/", requireAuth_1.requireAuth, budgets_controller_1.listBudgets);
router.put("/", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, budgets_controller_1.upsertBudget);
// Manual line
router.put("/other-expenses/:year/:month", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, budgets_controller_1.updateOtherExpenses);
exports.default = router;
