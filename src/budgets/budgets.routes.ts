import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import { annualBudget, pageData, updateOtherExpenses, listBudgets, upsertBudget } from "./budgets.controller";

const router = Router();

router.get("/annual", requireAuth, annualBudget);
router.get("/page-data", requireAuth, pageData);
router.get("/", requireAuth, listBudgets);
router.put("/", requireAuth, requireBillingWriteAccess, upsertBudget);

// Manual line
router.put("/other-expenses/:year/:month", requireAuth, requireBillingWriteAccess, updateOtherExpenses);

export default router;
