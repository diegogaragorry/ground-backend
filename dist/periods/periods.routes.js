"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const periods_controller_1 = require("./periods.controller");
const router = (0, express_1.Router)();
router.get("/", requireAuth_1.requireAuth, periods_controller_1.listPeriods);
// opcional: setear metadata / crear si no existe
router.put("/:year/:month", requireAuth_1.requireAuth, periods_controller_1.upsertPeriod);
router.post("/:year/:month/close", requireAuth_1.requireAuth, periods_controller_1.closePeriod);
router.post("/:year/:month/open", requireAuth_1.requireAuth, periods_controller_1.openPeriod);
exports.default = router;
