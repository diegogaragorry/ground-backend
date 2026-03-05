"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverySetPassword = exports.recoveryVerify = exports.recoveryRequest = exports.recoverySetup = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const recoveryCrypto_1 = require("../lib/recoveryCrypto");
const mailer_1 = require("../lib/mailer");
const sms_1 = require("../lib/sms");
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
function hashRecoveryPhone(phone, code) {
    const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
    return crypto_1.default.createHash("sha256").update(`${pepper}:recovery_phone:${phone}:${code}`).digest("hex");
}
/**
 * POST /auth/recovery/setup
 * Body: { recoveryPackage } (base64 of 32-byte key K)
 * Requires auth; requires User.phoneVerifiedAt. Encrypts K and stores in User.encryptedRecoveryPackage.
 */
const recoverySetup = async (req, res) => {
    const userId = req.userId;
    const recoveryPackage = typeof req.body?.recoveryPackage === "string" ? req.body.recoveryPackage.trim() : "";
    if (!recoveryPackage)
        return res.status(400).json({ error: "recoveryPackage is required" });
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { phoneVerifiedAt: true },
    });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    if (!user.phoneVerifiedAt) {
        return res.status(400).json({ error: "Verify your phone first before enabling recovery" });
    }
    try {
        const encrypted = (0, recoveryCrypto_1.encryptRecoveryPackage)(recoveryPackage);
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { encryptedRecoveryPackage: encrypted },
        });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("SERVER_RECOVERY_KEY") || message.includes("32 bytes")) {
            return res.status(500).json({ error: "Recovery not configured" });
        }
        return res.status(400).json({ error: "Invalid recovery package" });
    }
};
exports.recoverySetup = recoverySetup;
function getClientIp(req) {
    const xf = req.headers["x-forwarded-for"] || "";
    const first = xf.split(",")[0]?.trim();
    return first || (req.socket.remoteAddress ?? undefined);
}
function getUserAgent(req) {
    const ua = req.headers["user-agent"];
    return ua ? String(ua).slice(0, 500) : undefined;
}
/**
 * POST /auth/recovery/request
 * Body: { email }
 * If user has recovery (phone + package): creates RecoverySession, sends email + SMS.
 * If user exists but no recovery: sends email-only code (same as forgot-password) so they can reset.
 */
const recoveryRequest = async (req, res) => {
    const email = normalizeEmail(req.body?.email ?? "");
    if (!email)
        return res.status(400).json({ error: "email is required" });
    const user = await prisma_1.prisma.user.findUnique({
        where: { email },
        select: { id: true, phone: true, encryptedRecoveryPackage: true, phoneVerifiedAt: true },
    });
    // User doesn't exist: generic response to avoid leaking
    if (!user)
        return res.status(200).json({ ok: true });
    // User exists but no recovery set up: fallback to email-only code so they get at least the email
    if (!user.phone || !user.encryptedRecoveryPackage || !user.phoneVerifiedAt) {
        const purpose = "password_reset";
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentCount = await prisma_1.prisma.emailVerificationCode.count({
            where: { email, purpose, createdAt: { gte: tenMinAgo } },
        });
        if (recentCount >= 3) {
            return res.status(429).json({ error: "Too many requests. Try again later." });
        }
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const latestSent = await prisma_1.prisma.emailVerificationCode.findFirst({
            where: { email, purpose, createdAt: { gte: twoMinAgo } },
            orderBy: { createdAt: "desc" },
        });
        if (latestSent) {
            return res.status(200).json({ ok: true, emailOnly: true });
        }
        const code = gen6();
        const codeHash = hashCode(email, code);
        const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
        await prisma_1.prisma.emailVerificationCode.create({
            data: {
                email,
                codeHash,
                purpose,
                expiresAt,
                ip: getClientIp(req),
                userAgent: getUserAgent(req),
            },
        });
        // Respond immediately as in other auth flows; email is sent in background.
        (0, mailer_1.sendPasswordResetCodeEmail)(email, code).catch((err) => {
            console.error("recovery fallback sendPasswordResetCodeEmail error", err);
        });
        return res.status(200).json({ ok: true, emailOnly: true });
    }
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recent = await prisma_1.prisma.recoverySession.findFirst({
        where: { userId: user.id, createdAt: { gte: fiveMinAgo } },
    });
    if (recent)
        return res.status(200).json({ ok: true });
    const emailCode = gen6();
    const phoneCode = gen6();
    const emailCodeHash = hashCode(email, emailCode);
    const phoneCodeHash = hashRecoveryPhone(user.phone, phoneCode);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await prisma_1.prisma.recoverySession.create({
        data: {
            userId: user.id,
            emailCodeHash,
            phoneCodeHash,
            expiresAt,
            ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined,
            userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
        },
    });
    (0, mailer_1.sendPasswordResetCodeEmail)(email, emailCode).catch(() => console.error("recovery email error"));
    (0, sms_1.sendSms)(user.phone, `Your Ground recovery code is: ${phoneCode}. It expires in 15 minutes.`).catch(() => console.error("recovery sms error"));
    return res.status(200).json({ ok: true });
};
exports.recoveryRequest = recoveryRequest;
/**
 * POST /auth/recovery/verify
 * Body: { email, emailCode, phoneCode }
 * Verifies both codes, returns { recoveryToken, encryptionKey }.
 */
const recoveryVerify = async (req, res) => {
    const email = normalizeEmail(req.body?.email ?? "");
    const emailCode = String(req.body?.emailCode ?? req.body?.email_code ?? "").trim();
    const phoneCode = String(req.body?.phoneCode ?? req.body?.phone_code ?? "").trim();
    if (!email || !emailCode || !phoneCode) {
        return res.status(400).json({ error: "email, emailCode and phoneCode are required" });
    }
    const user = await prisma_1.prisma.user.findUnique({
        where: { email },
        select: { id: true, phone: true, encryptedRecoveryPackage: true },
    });
    if (!user || !user.encryptedRecoveryPackage || !user.phone) {
        return res.status(400).json({ error: "Invalid or expired codes" });
    }
    const now = new Date();
    const session = await prisma_1.prisma.recoverySession.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
    });
    if (!session || session.usedAt || session.expiresAt <= now) {
        return res.status(400).json({ error: "Invalid or expired codes" });
    }
    const expectedEmailHash = hashCode(email, emailCode);
    const expectedPhoneHash = hashRecoveryPhone(user.phone, phoneCode);
    const emailOk = Buffer.from(expectedEmailHash).length === Buffer.from(session.emailCodeHash).length &&
        crypto_1.default.timingSafeEqual(Buffer.from(expectedEmailHash), Buffer.from(session.emailCodeHash));
    const phoneOk = Buffer.from(expectedPhoneHash).length === Buffer.from(session.phoneCodeHash).length &&
        crypto_1.default.timingSafeEqual(Buffer.from(expectedPhoneHash), Buffer.from(session.phoneCodeHash));
    if (!emailOk || !phoneOk) {
        return res.status(400).json({ error: "Invalid or expired codes" });
    }
    await prisma_1.prisma.recoverySession.update({
        where: { id: session.id },
        data: { usedAt: now },
    });
    let encryptionKeyBase64;
    try {
        encryptionKeyBase64 = (0, recoveryCrypto_1.decryptRecoveryPackage)(user.encryptedRecoveryPackage);
    }
    catch {
        return res.status(500).json({ error: "Recovery failed" });
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 16) {
        return res.status(500).json({ error: "Server misconfiguration" });
    }
    const tokenId = crypto_1.default.randomUUID();
    await prisma_1.prisma.recoveryToken.create({
        data: {
            id: tokenId,
            userId: user.id,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
    });
    const recoveryToken = jsonwebtoken_1.default.sign({ purpose: "recovery", userId: user.id, jti: tokenId }, jwtSecret, { expiresIn: "10m" });
    return res.status(200).json({
        recoveryToken,
        encryptionKey: encryptionKeyBase64,
    });
};
exports.recoveryVerify = recoveryVerify;
/**
 * POST /auth/recovery/set-password
 * Body: { recoveryToken, newPassword [, newRecoveryPackage ] }
 * Validates token, updates password and optionally encryptedRecoveryPackage, returns session JWT.
 */
const recoverySetPassword = async (req, res) => {
    const recoveryToken = String(req.body?.recoveryToken ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? req.body?.new_password ?? "").trim();
    const newRecoveryPackage = typeof req.body?.newRecoveryPackage === "string" ? req.body.newRecoveryPackage.trim() : undefined;
    if (!recoveryToken || !newPassword) {
        return res.status(400).json({ error: "recoveryToken and newPassword are required" });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 16) {
        return res.status(500).json({ error: "Server misconfiguration" });
    }
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(recoveryToken, jwtSecret);
    }
    catch {
        return res.status(400).json({ error: "Invalid or expired recovery link" });
    }
    if (payload.purpose !== "recovery" || !payload.userId || !payload.jti) {
        return res.status(400).json({ error: "Invalid or expired recovery link" });
    }
    const tokenRow = await prisma_1.prisma.recoveryToken.findUnique({
        where: { id: payload.jti },
    });
    if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date()) {
        return res.status(400).json({ error: "Invalid or expired recovery link" });
    }
    if (tokenRow.userId !== payload.userId) {
        return res.status(400).json({ error: "Invalid or expired recovery link" });
    }
    await prisma_1.prisma.recoveryToken.update({
        where: { id: payload.jti },
        data: { usedAt: new Date() },
    });
    const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
    const updateData = { password: hashedPassword };
    if (newRecoveryPackage) {
        try {
            updateData.encryptedRecoveryPackage = (0, recoveryCrypto_1.encryptRecoveryPackage)(newRecoveryPackage);
        }
        catch {
            return res.status(400).json({ error: "Invalid new recovery package" });
        }
    }
    await prisma_1.prisma.user.update({
        where: { id: payload.userId },
        data: updateData,
    });
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, role: true },
    });
    if (!user)
        return res.status(500).json({ error: "User not found" });
    const token = jsonwebtoken_1.default.sign({ userId: user.id }, jwtSecret, { expiresIn: "1d" });
    return res.status(200).json({
        token,
        user: { id: user.id, email: user.email, role: user.role },
    });
};
exports.recoverySetPassword = recoverySetPassword;
