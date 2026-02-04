import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";

import {
  createInvestment,
  listInvestments,
  updateInvestmentConfig,
  deleteInvestment,
} from "./investments.controller";

import {
  listSnapshotsByYear,
  upsertSnapshotForMonth,
  closeSnapshotForMonth,
} from "./investmentSnapshots.controller";

const router = Router();
router.use(requireAuth);

// Investments CRUD
router.get("/", listInvestments);
router.post("/", createInvestment);
router.put("/:id", updateInvestmentConfig);
router.delete("/:id", deleteInvestment);

// Snapshots
router.get("/:id/snapshots", listSnapshotsByYear);
router.put("/:id/snapshots/:year/:month", upsertSnapshotForMonth);
router.post("/:id/snapshots/:year/:month/close", closeSnapshotForMonth);

export default router;