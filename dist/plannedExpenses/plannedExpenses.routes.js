"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const plannedExpenses_controller_1 = require("./plannedExpenses.controller");
const router = (0, express_1.Router)();
router.get("/", requireAuth_1.requireAuth, plannedExpenses_controller_1.listPlannedExpenses);
router.put("/:id", requireAuth_1.requireAuth, plannedExpenses_controller_1.updatePlannedExpense);
router.post("/:id/confirm", requireAuth_1.requireAuth, plannedExpenses_controller_1.confirmPlannedExpense);
// opcional / recomendado: generar planned para el año
router.post("/ensure-year", requireAuth_1.requireAuth, plannedExpenses_controller_1.ensureYearPlanned);
exports.default = router;
