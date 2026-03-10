import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getBillingSummary,
  handleDLocalCallback,
  handleDLocalNotification,
  startProEarlyCheckout,
} from "./billing.controller";

const router = Router();

router.get("/summary", requireAuth, getBillingSummary);
router.post("/checkout", requireAuth, startProEarlyCheckout);
router.post("/checkout/pro-early", requireAuth, startProEarlyCheckout);
router.post("/dlocal/notifications", handleDLocalNotification);
router.post("/dlocal/callback", handleDLocalCallback);

export default router;
