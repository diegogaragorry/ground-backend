"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const recovery_controller_1 = require("./recovery.controller");
const requireAuth_1 = require("../middlewares/requireAuth");
const requireBillingWriteAccess_1 = require("../middlewares/requireBillingWriteAccess");
const router = (0, express_1.Router)();
// ✅ Nuevo flujo de registro con código
router.post("/register/request-code", auth_controller_1.registerRequestCode);
router.post("/register/verify", auth_controller_1.registerVerify);
// ✅ Forgot password
router.post("/forgot-password/request-code", auth_controller_1.forgotPasswordRequestCode);
router.post("/forgot-password/verify", auth_controller_1.forgotPasswordVerify);
// ✅ Login / Me
router.post("/login", auth_controller_1.login);
router.get("/me", requireAuth_1.requireAuth, auth_controller_1.me);
router.patch("/me", requireAuth_1.requireAuth, auth_controller_1.patchMe);
router.get("/me/onboarding/context", requireAuth_1.requireAuth, auth_controller_1.getOnboardingContext);
router.post("/me/onboarding/finalize", requireAuth_1.requireAuth, requireBillingWriteAccess_1.requireBillingWriteAccess, auth_controller_1.finalizeOnboarding);
// Phone (for E2EE recovery)
router.post("/me/phone/request", requireAuth_1.requireAuth, auth_controller_1.phoneRequest);
router.post("/me/phone/verify", requireAuth_1.requireAuth, auth_controller_1.phoneVerify);
// E2EE recovery (setup = authed; request/verify/set-password = public)
router.post("/recovery/setup", requireAuth_1.requireAuth, recovery_controller_1.recoverySetup);
router.post("/recovery/request", recovery_controller_1.recoveryRequest);
router.post("/recovery/verify", recovery_controller_1.recoveryVerify);
router.post("/recovery/set-password", recovery_controller_1.recoverySetPassword);
// (Opcional) si querés que /auth/register no exista para obligar al nuevo flujo:
// router.post("/register", (_, res) => res.status(404).json({ error: "Registration disabled. Use /auth/register/request-code and /auth/register/verify." }));
exports.default = router;
