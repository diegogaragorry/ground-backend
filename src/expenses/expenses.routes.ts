import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import {
  createExpense,
  expensesPageData,
  listExpensesByMonth,
  listExpensesByYear,
  expensesSummary,
  updateExpense,
  deleteExpense,
} from "./expenses.controller";

const router = Router();

router.post("/", requireAuth, requireBillingWriteAccess, createExpense);
router.get("/page-data", requireAuth, expensesPageData);
router.get("/", requireAuth, (req, res, next) => {
  if (req.query?.year != null && req.query?.month == null) {
    return listExpensesByYear(req as any, res);
  }
  return listExpensesByMonth(req as any, res);
});
router.get("/summary", requireAuth, expensesSummary);
router.put("/:id", requireAuth, requireBillingWriteAccess, updateExpense);
router.delete("/:id", requireAuth, requireBillingWriteAccess, deleteExpense);

export default router;
