import { Router } from "express";
import {
  login,
  me,
  patchMe,
  registerRequestCode,
  registerVerify,
  forgotPasswordRequestCode,
  forgotPasswordVerify,
} from "./auth.controller";
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

// (Opcional) si querés que /auth/register no exista para obligar al nuevo flujo:
// router.post("/register", (_, res) => res.status(404).json({ error: "Registration disabled. Use /auth/register/request-code and /auth/register/verify." }));

export default router;