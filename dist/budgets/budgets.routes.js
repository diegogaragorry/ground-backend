"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const budgets_controller_1 = require("./budgets.controller");
const router = (0, express_1.Router)();
router.get("/annual", requireAuth_1.requireAuth, budgets_controller_1.annualBudget);
// Manual line
router.put("/other-expenses/:year/:month", requireAuth_1.requireAuth, budgets_controller_1.updateOtherExpenses);
exports.default = router;
