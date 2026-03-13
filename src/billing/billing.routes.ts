import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  cancelCurrentSubscription,
  getBillingSummary,
  handleDLocalCallback,
  handleDLocalNotification,
  runRenewalsNow,
  subscribeMonthlyPlan,
  startProEarlyCheckout,
} from "./billing.controller";

const router = Router();

router.get("/summary", requireAuth, getBillingSummary);
router.post("/checkout", requireAuth, startProEarlyCheckout);
router.post("/checkout/pro-early", requireAuth, startProEarlyCheckout);
router.post("/subscribe", requireAuth, subscribeMonthlyPlan);
router.post("/cancel", requireAuth, cancelCurrentSubscription);
router.post("/renewals/run", requireAuth, runRenewalsNow);
router.post("/dlocal/notifications", handleDLocalNotification);
router.post("/dlocal/callback", handleDLocalCallback);

export default router;
