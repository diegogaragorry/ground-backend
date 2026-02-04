"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const expenseTemplates_controller_1 = require("./expenseTemplates.controller");
const router = (0, express_1.Router)();
// ✅ cualquier usuario autenticado puede gestionar SUS templates
router.get("/expenseTemplates", requireAuth_1.requireAuth, expenseTemplates_controller_1.listExpenseTemplates);
router.post("/expenseTemplates", requireAuth_1.requireAuth, expenseTemplates_controller_1.createExpenseTemplate);
router.put("/expenseTemplates/:id", requireAuth_1.requireAuth, expenseTemplates_controller_1.updateExpenseTemplate);
router.delete("/expenseTemplates/:id", requireAuth_1.requireAuth, expenseTemplates_controller_1.deleteExpenseTemplate);
exports.default = router;
