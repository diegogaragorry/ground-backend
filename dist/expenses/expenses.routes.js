"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const requireBillingWriteAccess_1 = require("../middlewares/requireBillingWriteAccess");
const expenses_controller_1 = require("./expenses.controller");
const router = (0, express_1.Router)();
router.post("/", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, expenses_controller_1.createExpense);
router.post("/import/commit", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, expenses_controller_1.importExpensesBatch);
router.get("/import/rules", requireAuth_1.requireAuth, expenses_controller_1.listMerchantMappingRules);
router.get("/page-data", requireAuth_1.requireAuth, expenses_controller_1.expensesPageData);
router.get("/", requireAuth_1.requireAuth, (req, res, next) => {
    if (req.query?.year != null && req.query?.month == null) {
        return (0, expenses_controller_1.listExpensesByYear)(req, res);
    }
    return (0, expenses_controller_1.listExpensesByMonth)(req, res);
});
router.get("/summary", requireAuth_1.requireAuth, expenses_controller_1.expensesSummary);
router.put("/:id", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, expenses_controller_1.updateExpense);
router.delete("/:id", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, expenses_controller_1.deleteExpense);
exports.default = router;
