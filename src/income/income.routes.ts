import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import { upsertIncome, listIncome, patchIncomeMonth } from "./income.controller";

const router = Router();

router.post("/", requireAuth, requireBillingWriteAccess, upsertIncome);
router.patch("/", requireAuth, requireBillingWriteAccess, patchIncomeMonth);
router.get("/", requireAuth, listIncome);

export default router;
