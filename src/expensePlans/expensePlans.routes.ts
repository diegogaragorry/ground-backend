import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { upsertExpensePlan, listExpensePlans } from "./expensePlans.controller";

const router = Router();

router.post("/", requireAuth, upsertExpensePlan);
router.get("/", requireAuth, listExpensePlans);

export default router;