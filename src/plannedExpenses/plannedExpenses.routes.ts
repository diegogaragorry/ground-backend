import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import {
  listPlannedExpenses,
  updatePlannedExpense,
  confirmPlannedExpense,
  ensureYearPlanned,
} from "./plannedExpenses.controller";

const router = Router();

router.get("/", requireAuth, listPlannedExpenses);
router.put("/:id", requireAuth, requireBillingWriteAccess, updatePlannedExpense);
router.post("/:id/confirm", requireAuth, requireBillingWriteAccess, confirmPlannedExpense);

// opcional / recomendado: generar planned para el año
router.post("/ensure-year", requireAuth, requireBillingWriteAccess, ensureYearPlanned);

export default router;
