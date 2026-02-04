import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { upsertIncome, listIncome } from "./income.controller";

const router = Router();

router.post("/", requireAuth, upsertIncome);
router.get("/", requireAuth, listIncome);

export default router;