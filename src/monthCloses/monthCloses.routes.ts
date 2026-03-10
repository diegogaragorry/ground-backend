import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import { listMonthCloses, closeMonth, reopenMonth, previewMonthClose, patchMonthCloseEncryptedPayload } from "./monthCloses.controller";

const router = Router();

router.get("/", requireAuth, listMonthCloses);
router.patch("/:id", requireAuth, requireBillingWriteAccess, patchMonthCloseEncryptedPayload);
router.post("/preview", requireAuth, previewMonthClose);
router.get("/preview", requireAuth, previewMonthClose);
router.post("/close", requireAuth, requireBillingWriteAccess, closeMonth);
router.post("/reopen", requireAuth, requireBillingWriteAccess, reopenMonth);

export default router;
