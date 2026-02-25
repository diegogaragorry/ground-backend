import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { listMonthCloses, closeMonth, reopenMonth, previewMonthClose, patchMonthCloseEncryptedPayload } from "./monthCloses.controller";

const router = Router();

router.get("/", requireAuth, listMonthCloses);
router.patch("/:id", requireAuth, patchMonthCloseEncryptedPayload);
router.post("/preview", requireAuth, previewMonthClose);
router.get("/preview", requireAuth, previewMonthClose);
router.post("/close", requireAuth, closeMonth);
router.post("/reopen", requireAuth, reopenMonth);

export default router;