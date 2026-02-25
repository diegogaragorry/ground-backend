import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  createExpense,
  listExpensesByMonth,
  listExpensesByYear,
  expensesSummary,
  updateExpense,
  deleteExpense,
} from "./expenses.controller";

const router = Router();

router.post("/", requireAuth, createExpense);
router.get("/", requireAuth, (req, res, next) => {
  if (req.query?.year != null && req.query?.month == null) {
    return listExpensesByYear(req as any, res);
  }
  return listExpensesByMonth(req as any, res);
});
router.get("/summary", requireAuth, expensesSummary);
router.put("/:id", requireAuth, updateExpense);
router.delete("/:id", requireAuth, deleteExpense);

export default router;