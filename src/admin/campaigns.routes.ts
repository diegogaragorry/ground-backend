import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { previewSpecialGuestCampaign, sendSpecialGuestCampaign } from "./campaigns.controller";

const router = Router();

router.get("/campaigns/special-guest/preview", requireAuth, requireSuperAdmin, previewSpecialGuestCampaign);
router.post("/campaigns/special-guest/send", requireAuth, requireSuperAdmin, sendSpecialGuestCampaign);

export default router;
