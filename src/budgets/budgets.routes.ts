import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { annualBudget, pageData, updateOtherExpenses, listBudgets, upsertBudget } from "./budgets.controller";

const router = Router();

router.get("/annual", requireAuth, annualBudget);
router.get("/page-data", requireAuth, pageData);
router.get("/", requireAuth, listBudgets);
router.put("/", requireAuth, upsertBudget);

// Manual line
router.put("/other-expenses/:year/:month", requireAuth, updateOtherExpenses);

export default router;