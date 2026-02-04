import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getNetWorth } from "./networth.controller";

const router = Router();

router.get("/", requireAuth, getNetWorth);

export default router;