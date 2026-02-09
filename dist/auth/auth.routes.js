"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const requireAuth_1 = require("../middlewares/requireAuth");
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
// (Opcional) si querés que /auth/register no exista para obligar al nuevo flujo:
// router.post("/register", (_, res) => res.status(404).json({ error: "Registration disabled. Use /auth/register/request-code and /auth/register/verify." }));
exports.default = router;
