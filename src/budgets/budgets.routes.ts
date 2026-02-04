import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { annualBudget, updateOtherExpenses } from "./budgets.controller";

const router = Router();

router.get("/annual", requireAuth, annualBudget);

// Manual line
router.put("/other-expenses/:year/:month", requireAuth, updateOtherExpenses);

export default router;