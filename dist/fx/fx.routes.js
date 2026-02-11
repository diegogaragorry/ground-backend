"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const fx_controller_1 = require("./fx.controller");
const router = (0, express_1.Router)();
router.get("/rate", requireAuth_1.requireAuth, fx_controller_1.getUsdUyuRate);
exports.default = router;
