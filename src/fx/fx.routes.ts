import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getUsdUyuRate } from "./fx.controller";

const router = Router();

router.get("/rate", requireAuth, getUsdUyuRate);

export default router;
