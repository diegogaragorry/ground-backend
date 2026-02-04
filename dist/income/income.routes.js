"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const income_controller_1 = require("./income.controller");
const router = (0, express_1.Router)();
router.post("/", requireAuth_1.requireAuth, income_controller_1.upsertIncome);
router.get("/", requireAuth_1.requireAuth, income_controller_1.listIncome);
exports.default = router;
