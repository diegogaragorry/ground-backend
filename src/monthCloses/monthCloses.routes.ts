import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { listMonthCloses, closeMonth, reopenMonth } from "./monthCloses.controller";

const router = Router();

router.get("/", requireAuth, listMonthCloses);
router.post("/close", requireAuth, closeMonth);
router.post("/reopen", requireAuth, reopenMonth);

export default router;