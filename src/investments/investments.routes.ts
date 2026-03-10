import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";

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
router.post("/", requireBillingWriteAccess, createInvestment);
router.put("/:id", requireBillingWriteAccess, updateInvestmentConfig);
router.delete("/:id", requireBillingWriteAccess, deleteInvestment);

// Snapshots
router.get("/:id/snapshots", listSnapshotsByYear);
router.put("/:id/snapshots/:year/:month", requireBillingWriteAccess, upsertSnapshotForMonth);
router.post("/:id/snapshots/:year/:month/close", requireBillingWriteAccess, closeSnapshotForMonth);

export default router;
