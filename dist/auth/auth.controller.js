"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchMe = exports.me = exports.login = exports.forgotPasswordVerify = exports.forgotPasswordRequestCode = exports.registerVerify = exports.registerRequestCode = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const bootstrapUserData_1 = require("./bootstrapUserData");
const mailer_1 = require("../lib/mailer");
function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}
function gen6() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
function hashCode(email, code) {
    const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
    return crypto_1.default.createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}
function getClientIp(req) {
    const xf = req.headers["x-forwarded-for"] || "";
    const first = xf.split(",")[0]?.trim();
    return first || req.socket.remoteAddress || null;
}
function getUserAgent(req) {
    return String(req.headers["user-agent"] || "").slice(0, 400);
}
/**
 * POST /auth/register/request-code
 * Body: { email }
 */
const registerRequestCode = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email)
            return res.status(400).json({ error: "email is required" });
        const existingUser = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (existingUser)
            return res.status(409).json({ error: "User already exists" });
        const purpose = "signup";
        const ip = getClientIp(req);
        const userAgent = getUserAgent(req);
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentCount = await prisma_1.prisma.emailVerificationCode.count({
            where: { email, purpose, createdAt: { gte: tenMinAgo } },
        });
        if (recentCount >= 3) {
            return res.status(429).json({ error: "Too many requests. Try again later." });
        }
        // No crear ni enviar otro código si ya se envió uno hace menos de 2 min (evita duplicados cuando el mail tarda o falla)
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const latestSent = await prisma_1.prisma.emailVerificationCode.findFirst({
            where: { email, purpose, createdAt: { gte: twoMinAgo } },
            orderBy: { createdAt: "desc" },
        });
        if (latestSent) {
            return res.status(200).json({ ok: true, alreadySent: true });
        }
        const code = gen6();
        const codeHash = hashCode(email, code);
        const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 min
        await prisma_1.prisma.emailVerificationCode.create({
            data: {
                email,
                codeHash,
                purpose,
                expiresAt,
                ip: ip ?? undefined,
                userAgent,
            },
        });
        // Responder al instante; enviar email en segundo plano (evita 1–2 min de "Sending...")
        (0, mailer_1.sendSignupCodeEmail)(email, code).catch((err) => {
            console.error("sendSignupCodeEmail background error:", err);
        });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("registerRequestCode error:", err);
        return res.status(500).json({
            error: "Could not send verification code",
            detail: message, // incluir siempre para depurar (quitar en prod si no querés exponer)
        });
    }
};
exports.registerRequestCode = registerRequestCode;
/**
 * POST /auth/register/verify
 * Body: { email, code, password }
 */
const registerVerify = async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    const password = String(req.body?.password || "");
    if (!email || !code || !password) {
        return res.status(400).json({ error: "email, code and password are required" });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    const existingUser = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (existingUser)
        return res.status(409).json({ error: "User already exists" });
    const purpose = "signup";
    const now = new Date();
    const latest = await prisma_1.prisma.emailVerificationCode.findFirst({
        where: { email, purpose },
        orderBy: { createdAt: "desc" },
    });
    if (!latest || latest.usedAt || latest.expiresAt <= now) {
        return res.status(400).json({ error: "Invalid or expired code" });
    }
    if ((latest.attempts ?? 0) >= 5) {
        return res.status(429).json({ error: "Too many attempts. Request a new code." });
    }
    const expectedHash = hashCode(email, code);
    // timingSafeEqual requiere mismos tamaños
    const a = Buffer.from(expectedHash);
    const b = Buffer.from(latest.codeHash);
    const ok = a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
    if (!ok) {
        await prisma_1.prisma.emailVerificationCode.update({
            where: { id: latest.id },
            data: { attempts: { increment: 1 } },
        });
        return res.status(400).json({ error: "Invalid or expired code" });
    }
    await prisma_1.prisma.emailVerificationCode.update({
        where: { id: latest.id },
        data: { usedAt: now },
    });
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    try {
        const user = await prisma_1.prisma.user.create({
            data: { email, password: hashedPassword, role: "USER" },
        });
        await (0, bootstrapUserData_1.bootstrapUserData)(user.id);
        await prisma_1.prisma.investment.create({
            data: {
                userId: user.id,
                name: "Bank Account",
                type: "ACCOUNT",
                currencyId: "USD",
                targetAnnualReturn: 0,
                yieldStartYear: new Date().getUTCFullYear(),
                yieldStartMonth: 1,
            },
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });
        return res.status(201).json({
            token,
            user: { id: user.id, email: user.email, role: user.role },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Register verify error:", err);
        return res.status(500).json({
            error: "Error creating user",
            detail: message,
        });
    }
};
exports.registerVerify = registerVerify;
/**
 * POST /auth/forgot-password/request-code
 * Body: { email }
 */
const forgotPasswordRequestCode = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email)
            return res.status(400).json({ error: "email is required" });
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user)
            return res.status(404).json({ error: "No account found with this email" });
        const purpose = "password_reset";
        const ip = getClientIp(req);
        const userAgent = getUserAgent(req);
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentCount = await prisma_1.prisma.emailVerificationCode.count({
            where: { email, purpose, createdAt: { gte: tenMinAgo } },
        });
        if (recentCount >= 3) {
            return res.status(429).json({ error: "Too many requests. Try again later." });
        }
        // No crear ni enviar otro código si ya se envió uno hace menos de 2 min
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const latestSent = await prisma_1.prisma.emailVerificationCode.findFirst({
            where: { email, purpose, createdAt: { gte: twoMinAgo } },
            orderBy: { createdAt: "desc" },
        });
        if (latestSent) {
            return res.status(200).json({ ok: true, alreadySent: true });
        }
        const code = gen6();
        const codeHash = hashCode(email, code);
        const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 min
        await prisma_1.prisma.emailVerificationCode.create({
            data: { email, codeHash, purpose, expiresAt, ip: ip ?? undefined, userAgent },
        });
        // Responder al instante; enviar email en segundo plano
        (0, mailer_1.sendPasswordResetCodeEmail)(email, code).catch((err) => {
            console.error("sendPasswordResetCodeEmail background error:", err);
        });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("forgotPasswordRequestCode error:", err);
        return res.status(500).json({ error: "Could not send reset code", detail: message });
    }
};
exports.forgotPasswordRequestCode = forgotPasswordRequestCode;
/**
 * POST /auth/forgot-password/verify
 * Body: { email, code, newPassword }
 */
const forgotPasswordVerify = async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    const newPassword = String(req.body?.newPassword ?? req.body?.new_password ?? "");
    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: "email, code and newPassword are required" });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    const user = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.status(404).json({ error: "No account found with this email" });
    const purpose = "password_reset";
    const now = new Date();
    const latest = await prisma_1.prisma.emailVerificationCode.findFirst({
        where: { email, purpose },
        orderBy: { createdAt: "desc" },
    });
    if (!latest || latest.usedAt || latest.expiresAt <= now) {
        return res.status(400).json({ error: "Invalid or expired code" });
    }
    if ((latest.attempts ?? 0) >= 5) {
        return res.status(429).json({ error: "Too many attempts. Request a new code." });
    }
    const expectedHash = hashCode(email, code);
    const a = Buffer.from(expectedHash);
    const b = Buffer.from(latest.codeHash);
    const ok = a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
    if (!ok) {
        await prisma_1.prisma.emailVerificationCode.update({
            where: { id: latest.id },
            data: { attempts: { increment: 1 } },
        });
        return res.status(400).json({ error: "Invalid or expired code" });
    }
    await prisma_1.prisma.emailVerificationCode.update({
        where: { id: latest.id },
        data: { usedAt: now },
    });
    const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
    await prisma_1.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
    });
    return res.status(200).json({ ok: true });
};
exports.forgotPasswordVerify = forgotPasswordVerify;
/**
 * POST /auth/login
 */
const login = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = String(req.body?.password || "");
        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret || jwtSecret.length < 16) {
            console.error("JWT_SECRET is missing or too short. Set it in .env");
            return res.status(500).json({
                error: "Server misconfiguration",
                detail: "JWT_SECRET missing or too short. Add JWT_SECRET=tu-secreto-largo to ground-backend/.env",
            });
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user)
            return res.status(401).json({ error: "Invalid credentials" });
        const ok = await bcrypt_1.default.compare(password, user.password);
        if (!ok)
            return res.status(401).json({ error: "Invalid credentials" });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, jwtSecret, { expiresIn: "1d" });
        return res.json({
            token,
            user: { id: user.id, email: user.email, role: user.role },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Login error:", err);
        return res.status(500).json({
            error: "Internal Server Error",
            detail: message,
        });
    }
};
exports.login = login;
/**
 * GET /auth/me
 */
const me = async (req, res) => {
    const userId = req.userId;
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, createdAt: true, forceOnboardingNextLogin: true },
    });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    return res.json(user);
};
exports.me = me;
/**
 * PATCH /auth/me — clear forceOnboardingNextLogin (used after showing onboarding)
 */
const patchMe = async (req, res) => {
    const userId = req.userId;
    const body = req.body;
    if (body?.forceOnboardingNextLogin === false) {
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { forceOnboardingNextLogin: false },
        });
    }
    return res.status(204).end();
};
exports.patchMe = patchMe;
