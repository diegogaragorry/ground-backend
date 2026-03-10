import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import { upsertExpensePlan, listExpensePlans } from "./expensePlans.controller";

const router = Router();

router.post("/", requireAuth, requireBillingWriteAccess, upsertExpensePlan);
router.get("/", requireAuth, listExpensePlans);

export default router;
