import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import { listPeriods, upsertPeriod, closePeriod, openPeriod } from "./periods.controller";

const router = Router();

router.get("/", requireAuth, listPeriods);
// opcional: setear metadata / crear si no existe
router.put("/:year/:month", requireAuth, requireBillingWriteAccess, upsertPeriod);

router.post("/:year/:month/close", requireAuth, requireBillingWriteAccess, closePeriod);
router.post("/:year/:month/open", requireAuth, requireBillingWriteAccess, openPeriod);

export default router;
