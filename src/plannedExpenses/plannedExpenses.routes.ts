import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  listPlannedExpenses,
  updatePlannedExpense,
  confirmPlannedExpense,
  ensureYearPlanned,
} from "./plannedExpenses.controller";

const router = Router();

router.get("/", requireAuth, listPlannedExpenses);
router.put("/:id", requireAuth, updatePlannedExpense);
router.post("/:id/confirm", requireAuth, confirmPlannedExpense);

// opcional / recomendado: generar planned para el año
router.post("/ensure-year", requireAuth, ensureYearPlanned);

export default router;