"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const networth_controller_1 = require("./networth.controller");
const router = (0, express_1.Router)();
router.get("/", requireAuth_1.requireAuth, networth_controller_1.getNetWorth);
exports.default = router;
