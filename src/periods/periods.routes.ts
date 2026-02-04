import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { listPeriods, upsertPeriod, closePeriod, openPeriod } from "./periods.controller";

const router = Router();

router.get("/", requireAuth, listPeriods);
// opcional: setear metadata / crear si no existe
router.put("/:year/:month", requireAuth, upsertPeriod);

router.post("/:year/:month/close", requireAuth, closePeriod);
router.post("/:year/:month/open", requireAuth, openPeriod);

export default router;