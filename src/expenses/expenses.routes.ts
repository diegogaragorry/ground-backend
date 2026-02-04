import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  createExpense,
  listExpensesByMonth,
  expensesSummary,
  updateExpense,
  deleteExpense,
} from "./expenses.controller";

const router = Router();

router.post("/", requireAuth, createExpense);
router.get("/", requireAuth, listExpensesByMonth);
router.get("/summary", requireAuth, expensesSummary);
router.put("/:id", requireAuth, updateExpense);
router.delete("/:id", requireAuth, deleteExpense);

export default router;