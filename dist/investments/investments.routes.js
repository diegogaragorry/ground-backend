"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const investments_controller_1 = require("./investments.controller");
const investmentSnapshots_controller_1 = require("./investmentSnapshots.controller");
const router = (0, express_1.Router)();
router.use(requireAuth_1.requireAuth);
// Investments CRUD
router.get("/", investments_controller_1.listInvestments);
router.post("/", investments_controller_1.createInvestment);
router.put("/:id", investments_controller_1.updateInvestmentConfig);
router.delete("/:id", investments_controller_1.deleteInvestment);
// Snapshots
router.get("/:id/snapshots", investmentSnapshots_controller_1.listSnapshotsByYear);
router.put("/:id/snapshots/:year/:month", investmentSnapshots_controller_1.upsertSnapshotForMonth);
router.post("/:id/snapshots/:year/:month/close", investmentSnapshots_controller_1.closeSnapshotForMonth);
exports.default = router;
