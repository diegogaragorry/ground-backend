"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const expensePlans_controller_1 = require("./expensePlans.controller");
const router = (0, express_1.Router)();
router.post("/", requireAuth_1.requireAuth, expensePlans_controller_1.upsertExpensePlan);
router.get("/", requireAuth_1.requireAuth, expensePlans_controller_1.listExpensePlans);
exports.default = router;
