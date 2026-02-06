import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { upsertIncome, listIncome, patchIncomeMonth } from "./income.controller";

const router = Router();

router.post("/", requireAuth, upsertIncome);
router.patch("/", requireAuth, patchIncomeMonth);
router.get("/", requireAuth, listIncome);

export default router;