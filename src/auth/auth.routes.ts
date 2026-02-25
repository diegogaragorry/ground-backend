import { Router } from "express";
import {
  login,
  me,
  patchMe,
  registerRequestCode,
  registerVerify,
  forgotPasswordRequestCode,
  forgotPasswordVerify,
  phoneRequest,
  phoneVerify,
} from "./auth.controller";
import {
  recoverySetup,
  recoveryRequest,
  recoveryVerify,
  recoverySetPassword,
} from "./recovery.controller";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// ✅ Nuevo flujo de registro con código
router.post("/register/request-code", registerRequestCode);
router.post("/register/verify", registerVerify);

// ✅ Forgot password
router.post("/forgot-password/request-code", forgotPasswordRequestCode);
router.post("/forgot-password/verify", forgotPasswordVerify);

// ✅ Login / Me
router.post("/login", login);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, patchMe);

// Phone (for E2EE recovery)
router.post("/me/phone/request", requireAuth, phoneRequest);
router.post("/me/phone/verify", requireAuth, phoneVerify);

// E2EE recovery (setup = authed; request/verify/set-password = public)
router.post("/recovery/setup", requireAuth, recoverySetup);
router.post("/recovery/request", recoveryRequest);
router.post("/recovery/verify", recoveryVerify);
router.post("/recovery/set-password", recoverySetPassword);

// (Opcional) si querés que /auth/register no exista para obligar al nuevo flujo:
// router.post("/register", (_, res) => res.status(404).json({ error: "Registration disabled. Use /auth/register/request-code and /auth/register/verify." }));

export default router;