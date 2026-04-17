"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeOnboarding = exports.getOnboardingContext = exports.phoneVerify = exports.phoneRequest = exports.patchMe = exports.me = exports.login = exports.forgotPasswordVerify = exports.forgotPasswordRequestCode = exports.registerVerify = exports.registerRequestCode = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const bootstrapUserData_1 = require("./bootstrapUserData");
const recoveryCrypto_1 = require("../lib/recoveryCrypto");
const mailer_1 = require("../lib/mailer");
const authMessages_1 = require("../lib/authMessages");
const preferredLanguage_1 = require("../lib/preferredLanguage");
const sms_1 = require("../lib/sms");
const fx_1 = require("../utils/fx");
function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}
function normalizeName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}
function normalizeCountry(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}
function parseMonth(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 12)
        return null;
    return n;
}
function normalizeOnboardingSourceKey(value, prefix, index) {
    const raw = String(value ?? "").trim();
    if (/^[a-z0-9:_-]{1,120}$/i.test(raw) && raw.startsWith(prefix))
        return raw;
    return `${prefix}${index}`;
}
function sourceKeyIndex(sourceKey, prefix) {
    if (!sourceKey.startsWith(prefix))
        return Number.MAX_SAFE_INTEGER;
    const parsed = Number(sourceKey.slice(prefix.length));
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.MAX_SAFE_INTEGER;
}
function toSnapshotCapitalUsd(amount, currencyId, usdUyuRate) {
    if (currencyId === "USD")
        return amount;
    return (0, fx_1.toUsd)({
        amount,
        currencyId: "UYU",
        usdUyuRate: usdUyuRate ?? Number(process.env.DEFAULT_USD_UYU_RATE ?? 38),
    }).amountUsd;
}
function gen6() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
function hashCode(email, code) {
    const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
    return crypto_1.default.createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}
function hashPhoneCode(userId, phone, code) {
    const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
    return crypto_1.default.createHash("sha256").update(`${pepper}:phone:${userId}:${phone}:${code}`).digest("hex");
}
function hashSignupPhoneCode(email, phone, code) {
    const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
    return crypto_1.default.createHash("sha256").update(`${pepper}:signup_phone:${email}:${phone}:${code}`).digest("hex");
}
function getClientIp(req) {
    const xf = req.headers["x-forwarded-for"] || "";
    const first = xf.split(",")[0]?.trim();
    return first || req.socket.remoteAddress || null;
}
function getUserAgent(req) {
    return String(req.headers["user-agent"] || "").slice(0, 400);
}
function parseRegistrationProfile(body) {
    const firstName = normalizeName(body?.firstName);
    const lastName = normalizeName(body?.lastName);
    const country = normalizeCountry(body?.country);
    const rawPhone = String(body?.phone ?? "").trim();
    const phone = normalizePhone(rawPhone) || rawPhone.replace(/\s/g, "");
    if (!firstName || firstName.length < 2)
        return { error: "firstName is required" };
    if (!lastName || lastName.length < 2)
        return { error: "lastName is required" };
    if (!country || country.length < 2)
        return { error: "country is required" };
    if (!phone || phone.length < 10)
        return { error: "Valid phone number is required" };
    return {
        firstName: firstName.slice(0, 80),
        lastName: lastName.slice(0, 80),
        country: country.slice(0, 80),
        phone: phone.slice(0, 32),
    };
}
/**
 * POST /auth/register/request-code
 * Body: { email, firstName, lastName, phone, country }
 */
const registerRequestCode = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const profile = parseRegistrationProfile(req.body);
        const preferredLanguage = (0, preferredLanguage_1.resolvePreferredLanguage)((0, preferredLanguage_1.getRequestPreferredLanguage)(req));
        if (!email)
            return res.status(400).json({ error: "email is required" });
        if ("error" in profile)
            return res.status(400).json({ error: profile.error });
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
        const phoneCode = gen6();
        const phoneCodeHash = hashSignupPhoneCode(email, profile.phone, phoneCode);
        const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 min
        const [emailRow, phoneRow] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.emailVerificationCode.create({
                data: {
                    email,
                    codeHash,
                    purpose,
                    expiresAt,
                    ip: ip ?? undefined,
                    userAgent,
                },
            }),
            prisma_1.prisma.emailVerificationCode.create({
                data: {
                    email,
                    codeHash: phoneCodeHash,
                    purpose: "signup_phone",
                    expiresAt,
                    ip: ip ?? undefined,
                    userAgent,
                },
            }),
        ]);
        try {
            await (0, sms_1.sendSms)(profile.phone, (0, authMessages_1.buildVerificationSms)(phoneCode, 20, preferredLanguage));
        }
        catch (smsErr) {
            await prisma_1.prisma.emailVerificationCode.deleteMany({
                where: { id: { in: [emailRow.id, phoneRow.id] } },
            });
            const message = smsErr instanceof Error ? smsErr.message : String(smsErr);
            console.error("registerRequestCode sendSms error");
            return res.status(503).json({ error: "Could not send phone verification code", detail: message });
        }
        // Email can remain async once the blocking SMS path succeeded.
        (0, mailer_1.sendSignupCodeEmail)(email, code, preferredLanguage).catch((err) => {
            console.error("sendSignupCodeEmail background error");
        });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("registerRequestCode error");
        return res.status(500).json({
            error: "Could not send verification code",
            detail: message, // incluir siempre para depurar (quitar en prod si no querés exponer)
        });
    }
};
exports.registerRequestCode = registerRequestCode;
/**
 * POST /auth/register/verify
 * Body: { email, code|emailCode, phoneCode, password, firstName, lastName, phone, country, recoveryPackage }
 */
const registerVerify = async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const emailCode = String(req.body?.emailCode ?? req.body?.code ?? "").trim();
    const phoneCode = String(req.body?.phoneCode ?? req.body?.phone_code ?? "").trim();
    const password = String(req.body?.password || "");
    const recoveryPackage = typeof req.body?.recoveryPackage === "string" ? String(req.body.recoveryPackage).trim() : "";
    const profile = parseRegistrationProfile(req.body);
    const preferredLanguage = (0, preferredLanguage_1.resolvePreferredLanguage)((0, preferredLanguage_1.getRequestPreferredLanguage)(req));
    if (!email || !emailCode || !phoneCode || !password || !recoveryPackage) {
        return res.status(400).json({ error: "email, emailCode, phoneCode, password and recoveryPackage are required" });
    }
    if ("error" in profile) {
        return res.status(400).json({ error: profile.error });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    const existingUser = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (existingUser)
        return res.status(409).json({ error: "User already exists" });
    const purpose = "signup";
    const now = new Date();
    const [latestEmail, latestPhone] = await Promise.all([
        prisma_1.prisma.emailVerificationCode.findFirst({
            where: { email, purpose },
            orderBy: { createdAt: "desc" },
        }),
        prisma_1.prisma.emailVerificationCode.findFirst({
            where: { email, purpose: "signup_phone" },
            orderBy: { createdAt: "desc" },
        }),
    ]);
    if (!latestEmail || latestEmail.usedAt || latestEmail.expiresAt <= now) {
        return res.status(400).json({ error: "Invalid or expired email code" });
    }
    if (!latestPhone || latestPhone.usedAt || latestPhone.expiresAt <= now) {
        return res.status(400).json({ error: "Invalid or expired phone code" });
    }
    if ((latestEmail.attempts ?? 0) >= 5 || (latestPhone.attempts ?? 0) >= 5) {
        return res.status(429).json({ error: "Too many attempts. Request a new code." });
    }
    const expectedEmailHash = hashCode(email, emailCode);
    const emailA = Buffer.from(expectedEmailHash);
    const emailB = Buffer.from(latestEmail.codeHash);
    const emailOk = emailA.length === emailB.length && crypto_1.default.timingSafeEqual(emailA, emailB);
    const expectedPhoneHash = hashSignupPhoneCode(email, profile.phone, phoneCode);
    const phoneA = Buffer.from(expectedPhoneHash);
    const phoneB = Buffer.from(latestPhone.codeHash);
    const phoneOk = phoneA.length === phoneB.length && crypto_1.default.timingSafeEqual(phoneA, phoneB);
    if (!emailOk || !phoneOk) {
        await prisma_1.prisma.$transaction([
            ...(!emailOk
                ? [prisma_1.prisma.emailVerificationCode.update({
                        where: { id: latestEmail.id },
                        data: { attempts: { increment: 1 } },
                    })]
                : []),
            ...(!phoneOk
                ? [prisma_1.prisma.emailVerificationCode.update({
                        where: { id: latestPhone.id },
                        data: { attempts: { increment: 1 } },
                    })]
                : []),
        ]);
        return res.status(400).json({ error: !emailOk ? "Invalid or expired email code" : "Invalid or expired phone code" });
    }
    let encryptedRecoveryPackage;
    try {
        encryptedRecoveryPackage = (0, recoveryCrypto_1.encryptRecoveryPackage)(recoveryPackage);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("SERVER_RECOVERY_KEY") || message.includes("32 bytes")) {
            return res.status(500).json({ error: "Recovery not configured" });
        }
        return res.status(400).json({ error: "Invalid recovery package" });
    }
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.emailVerificationCode.update({
            where: { id: latestEmail.id },
            data: { usedAt: now },
        }),
        prisma_1.prisma.emailVerificationCode.update({
            where: { id: latestPhone.id },
            data: { usedAt: now },
        }),
    ]);
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const encryptionSalt = typeof req.body?.encryptionSalt === "string" ? String(req.body.encryptionSalt).trim() || undefined : undefined;
    try {
        const user = await prisma_1.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName: profile.firstName,
                lastName: profile.lastName,
                country: profile.country,
                preferredLanguage,
                phone: profile.phone,
                phoneVerifiedAt: now,
                role: "USER",
                encryptionSalt: encryptionSalt || undefined,
                encryptedRecoveryPackage,
            },
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
        // Registrar primer ingreso a la app (igual que en login, para que aparezca en Admin → Últimos ingresos)
        const ip = getClientIp(req);
        const userAgent = getUserAgent(req);
        await prisma_1.prisma.loginLog.create({
            data: {
                userId: user.id,
                ip: ip ?? undefined,
                userAgent: userAgent || undefined,
            },
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });
        const created = await prisma_1.prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                country: true,
                preferredLanguage: true,
                phone: true,
                role: true,
                encryptionSalt: true,
                encryptedRecoveryPackage: true,
                phoneVerifiedAt: true,
            },
        });
        return res.status(201).json({
            token,
            user: {
                id: created.id,
                email: created.email,
                firstName: created.firstName ?? undefined,
                lastName: created.lastName ?? undefined,
                country: created.country ?? undefined,
                preferredLanguage: created.preferredLanguage ?? undefined,
                phone: created.phone ?? undefined,
                role: created.role,
                encryptionSalt: created.encryptionSalt ?? undefined,
                recoveryEnabled: !!(created.encryptedRecoveryPackage && created.phoneVerifiedAt),
            },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Register verify error");
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
        const preferredLanguage = (0, preferredLanguage_1.resolvePreferredLanguage)(user.preferredLanguage, (0, preferredLanguage_1.getRequestPreferredLanguage)(req));
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
        (0, mailer_1.sendPasswordResetCodeEmail)(email, code, preferredLanguage).catch((err) => {
            console.error("sendPasswordResetCodeEmail background error");
        });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("forgotPasswordRequestCode error");
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
        const user = await prisma_1.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                country: true,
                preferredLanguage: true,
                role: true,
                password: true,
                encryptionSalt: true,
                phone: true,
                encryptedRecoveryPackage: true,
                phoneVerifiedAt: true,
            },
        });
        if (!user)
            return res.status(401).json({ error: "Invalid credentials" });
        const ok = await bcrypt_1.default.compare(password, user.password);
        if (!ok)
            return res.status(401).json({ error: "Invalid credentials" });
        // Usuarios creados antes de E2EE: activar cifrado en el primer login con contraseña
        let encryptionSalt = user.encryptionSalt;
        if (!encryptionSalt) {
            encryptionSalt = crypto_1.default.randomBytes(16).toString("base64");
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { encryptionSalt },
            });
        }
        // Registrar ingreso a la app (para Admin → Actividad reciente)
        const ip = getClientIp(req);
        const userAgent = getUserAgent(req);
        await prisma_1.prisma.loginLog.create({
            data: {
                userId: user.id,
                ip: ip ?? undefined,
                userAgent: userAgent || undefined,
            },
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, jwtSecret, { expiresIn: "1d" });
        const recoveryEnabled = !!(user.encryptedRecoveryPackage && user.phoneVerifiedAt);
        let encryptionKey;
        if (user.encryptedRecoveryPackage) {
            try {
                encryptionKey = (0, recoveryCrypto_1.decryptRecoveryPackage)(user.encryptedRecoveryPackage);
            }
            catch {
                // recovery package invalid or SERVER_RECOVERY_KEY not set
            }
        }
        return res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName ?? undefined,
                lastName: user.lastName ?? undefined,
                country: user.country ?? undefined,
                preferredLanguage: user.preferredLanguage ?? undefined,
                phone: user.phone ?? undefined,
                role: user.role,
                encryptionSalt: encryptionSalt ?? undefined,
                recoveryEnabled,
                encryptionKey,
            },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Login error");
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
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            country: true,
            preferredLanguage: true,
            role: true,
            createdAt: true,
            forceOnboardingNextLogin: true,
            onboardingStep: true,
            mobileWarningDismissed: true,
            preferredDisplayCurrencyId: true,
            encryptionSalt: true,
            phone: true,
            phoneVerifiedAt: true,
            encryptedRecoveryPackage: true,
        },
    });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    let encryptionKey;
    if (user.encryptedRecoveryPackage) {
        try {
            encryptionKey = (0, recoveryCrypto_1.decryptRecoveryPackage)(user.encryptedRecoveryPackage);
        }
        catch {
            // recovery package invalid or SERVER_RECOVERY_KEY not set
        }
    }
    return res.json({
        ...user,
        recoveryEnabled: !!(user.encryptedRecoveryPackage && user.phoneVerifiedAt),
        encryptionKey,
    });
};
exports.me = me;
const ONBOARDING_STEPS = ["welcome", "admin", "expenses", "investments", "budget", "dashboard", "done"];
/**
 * PATCH /auth/me — update profile and preferences
 */
const patchMe = async (req, res) => {
    const userId = req.userId;
    const body = req.body;
    const data = {};
    if (body?.firstName !== undefined) {
        const v = normalizeName(body.firstName);
        if (!v || v.length < 2)
            return res.status(400).json({ error: "firstName is required" });
        data.firstName = v.slice(0, 80);
    }
    if (body?.lastName !== undefined) {
        const v = normalizeName(body.lastName);
        if (!v || v.length < 2)
            return res.status(400).json({ error: "lastName is required" });
        data.lastName = v.slice(0, 80);
    }
    if (body?.country !== undefined) {
        const v = normalizeCountry(body.country);
        if (!v || v.length < 2)
            return res.status(400).json({ error: "country is required" });
        data.country = v.slice(0, 80);
    }
    if (body?.preferredLanguage !== undefined) {
        if (body.preferredLanguage == null || String(body.preferredLanguage).trim() === "") {
            data.preferredLanguage = null;
        }
        else {
            const v = (0, preferredLanguage_1.normalizePreferredLanguage)(body.preferredLanguage);
            if (!v)
                return res.status(400).json({ error: "preferredLanguage must be es or en" });
            data.preferredLanguage = v;
        }
    }
    if (body?.forceOnboardingNextLogin === false) {
        data.forceOnboardingNextLogin = false;
    }
    if (body?.onboardingStep != null && typeof body.onboardingStep === "string") {
        const step = body.onboardingStep.trim();
        if (ONBOARDING_STEPS.includes(step))
            data.onboardingStep = step;
    }
    if (body?.mobileWarningDismissed === true) {
        data.mobileWarningDismissed = true;
    }
    if (body?.preferredDisplayCurrencyId !== undefined) {
        const v = body.preferredDisplayCurrencyId == null ? null : String(body.preferredDisplayCurrencyId).trim().toUpperCase();
        if (v === null || v === "" || v === "USD" || v === "UYU") {
            data.preferredDisplayCurrencyId = v === "" ? null : v;
        }
    }
    if (Object.keys(data).length > 0) {
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data,
        });
    }
    return res.status(204).end();
};
exports.patchMe = patchMe;
/** Normalize phone to E.164-like (digits only, optional leading +) */
function normalizePhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 10)
        return "";
    return digits.startsWith("0") ? digits : digits;
}
/**
 * POST /auth/me/phone/request
 * Body: { phone }
 * Sends OTP via SMS. Rate limit: 1 per 2 min per user.
 */
const phoneRequest = async (req, res) => {
    const userId = req.userId;
    const raw = String(req.body?.phone ?? "").trim();
    const phone = normalizePhone(raw) || raw.replace(/\s/g, "");
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { preferredLanguage: true },
    });
    if (!phone || phone.length < 10) {
        return res.status(400).json({ error: "Valid phone number is required" });
    }
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const recent = await prisma_1.prisma.phoneVerificationCode.findFirst({
        where: { userId, createdAt: { gte: twoMinAgo } },
        orderBy: { createdAt: "desc" },
    });
    if (recent) {
        return res.status(200).json({ ok: true, alreadySent: true });
    }
    const code = gen6();
    const codeHash = hashPhoneCode(userId, phone, code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await prisma_1.prisma.phoneVerificationCode.create({
        data: { userId, phone, codeHash, expiresAt },
    });
    (0, sms_1.sendSms)(phone, (0, authMessages_1.buildVerificationSms)(code, 15, user?.preferredLanguage)).catch((err) => {
        console.error("sendSms error");
    });
    return res.status(200).json({ ok: true });
};
exports.phoneRequest = phoneRequest;
/**
 * POST /auth/me/phone/verify
 * Body: { code }
 * Verifies OTP and sets User.phone + User.phoneVerifiedAt.
 */
const phoneVerify = async (req, res) => {
    const userId = req.userId;
    const code = String(req.body?.code ?? "").trim();
    if (!code)
        return res.status(400).json({ error: "code is required" });
    const now = new Date();
    const latest = await prisma_1.prisma.phoneVerificationCode.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
    });
    if (!latest || latest.usedAt || latest.expiresAt <= now) {
        return res.status(400).json({ error: "Invalid or expired code" });
    }
    const expectedHash = hashPhoneCode(userId, latest.phone, code);
    const a = Buffer.from(expectedHash);
    const b = Buffer.from(latest.codeHash);
    const ok = a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
    if (!ok)
        return res.status(400).json({ error: "Invalid or expired code" });
    await prisma_1.prisma.phoneVerificationCode.update({
        where: { id: latest.id },
        data: { usedAt: now },
    });
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: { phone: latest.phone, phoneVerifiedAt: now },
    });
    return res.status(200).json({ ok: true });
};
exports.phoneVerify = phoneVerify;
/**
 * GET /auth/me/onboarding/context?year=YYYY&month=MM
 * Returns onboarding-managed accounts and portfolios so the wizard can reopen without duplicating assets.
 */
const getOnboardingContext = async (req, res) => {
    const userId = req.userId;
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const month = parseMonth(req.query.month) ?? new Date().getUTCMonth() + 1;
    const knownTemplateCategoryNames = [
        "Housing",
        "Transport",
        "Utilities",
        "Connectivity",
        "Health & Wellness",
        "Wellness",
        "Food & Grocery",
        "Dining & Leisure",
        "Sports",
        "Gifts & Social",
    ];
    const knownTemplateDescriptions = [
        "Rent",
        "Mortgage",
        "Building Fees",
        "Property Taxes",
        "Fuel",
        "Public Transport",
        "Ride Sharing / Taxis",
        "Electricity",
        "Water",
        "Gas",
        "Internet / Fiber",
        "Mobile Phone",
        "TV / Cable",
        "Streaming Services",
        "Other online (Spotify, etc.)",
        "Private Health Insurance",
        "Gym Membership",
        "Pharmacy",
        "Personal Care",
        "Psychologist",
        "Groceries",
        "Holiday Gifts",
        "Donations / Raffles",
        "Tenis, Surf, Football / Others",
        "Restaurants",
        "Coffee & Snacks",
        "Delivery",
        "Events & Concerts",
    ];
    const [investments, snapshots, incomeRow, templates] = await Promise.all([
        prisma_1.prisma.investment.findMany({
            where: { userId, type: { in: ["ACCOUNT", "PORTFOLIO"] } },
            orderBy: [{ createdAt: "asc" }],
            select: {
                id: true,
                name: true,
                type: true,
                currencyId: true,
                targetAnnualReturn: true,
                onboardingSourceKey: true,
            },
        }),
        prisma_1.prisma.investmentSnapshot.findMany({
            where: {
                investment: { userId },
                OR: [
                    { year: { lt: year } },
                    { year, month: { lte: month } },
                ],
            },
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: {
                investmentId: true,
                year: true,
                month: true,
                capital: true,
                capitalUsd: true,
                encryptedPayload: true,
            },
        }),
        prisma_1.prisma.income.findUnique({
            where: {
                userId_year_month: {
                    userId,
                    year,
                    month,
                },
            },
            select: {
                amountUsd: true,
                nominalUsd: true,
                taxesUsd: true,
                currencyId: true,
                encryptedPayload: true,
            },
        }),
        prisma_1.prisma.expenseTemplate.findMany({
            where: {
                userId,
                OR: [
                    { onboardingSourceKey: { startsWith: "onboarding:template:" } },
                    { description: { in: knownTemplateDescriptions } },
                    { category: { name: { in: knownTemplateCategoryNames } } },
                ],
            },
            orderBy: [{ createdAt: "asc" }],
            select: {
                id: true,
                description: true,
                categoryId: true,
                defaultAmountUsd: true,
                defaultCurrencyId: true,
                encryptedPayload: true,
                expenseType: true,
                showInExpenses: true,
                onboardingSourceKey: true,
            },
        }),
    ]);
    const snapByInvestmentId = new Map();
    for (const row of snapshots) {
        if (!snapByInvestmentId.has(row.investmentId)) {
            snapByInvestmentId.set(row.investmentId, row);
        }
    }
    const savingsPrefix = "onboarding:savings:";
    const investmentPrefix = "onboarding:investment:";
    const accountRows = investments.filter((row) => row.type === "ACCOUNT");
    const taggedAccounts = accountRows.filter((row) => row.onboardingSourceKey?.startsWith(savingsPrefix));
    const accountSeed = taggedAccounts.length > 0 ? taggedAccounts : accountRows;
    const portfolioRows = investments.filter((row) => row.type === "PORTFOLIO");
    const taggedPortfolios = portfolioRows.filter((row) => row.onboardingSourceKey?.startsWith(investmentPrefix));
    const portfolioSeed = taggedPortfolios.length > 0 ? taggedPortfolios : portfolioRows;
    const savingsAccounts = accountSeed
        .map((row, idx) => {
        const sourceKey = row.onboardingSourceKey ?? `${savingsPrefix}${idx}`;
        const snap = snapByInvestmentId.get(row.id);
        return {
            sourceKey,
            investmentId: row.id,
            name: row.name,
            currencyId: (row.currencyId ?? "USD").toUpperCase(),
            capital: Number.isFinite(Number(snap?.capital)) ? Number(snap?.capital) : 0,
            capitalUsd: Number.isFinite(Number(snap?.capitalUsd)) ? Number(snap?.capitalUsd) : 0,
            encryptedPayload: snap?.encryptedPayload ?? null,
            snapshotYear: snap?.year ?? null,
            snapshotMonth: snap?.month ?? null,
        };
    })
        .sort((a, b) => sourceKeyIndex(a.sourceKey, savingsPrefix) - sourceKeyIndex(b.sourceKey, savingsPrefix));
    const portfolios = portfolioSeed
        .map((row, idx) => {
        const sourceKey = row.onboardingSourceKey ?? `${investmentPrefix}${idx}`;
        const snap = snapByInvestmentId.get(row.id);
        return {
            sourceKey,
            investmentId: row.id,
            name: row.name,
            currencyId: (row.currencyId ?? "USD").toUpperCase(),
            capital: Number.isFinite(Number(snap?.capital)) ? Number(snap?.capital) : 0,
            capitalUsd: Number.isFinite(Number(snap?.capitalUsd)) ? Number(snap?.capitalUsd) : 0,
            encryptedPayload: snap?.encryptedPayload ?? null,
            snapshotYear: snap?.year ?? null,
            snapshotMonth: snap?.month ?? null,
            targetAnnualReturn: Number.isFinite(Number(row.targetAnnualReturn)) ? Number(row.targetAnnualReturn) : 0,
        };
    })
        .sort((a, b) => sourceKeyIndex(a.sourceKey, investmentPrefix) - sourceKeyIndex(b.sourceKey, investmentPrefix));
    return res.json({
        year,
        month,
        incomeWork: incomeRow
            ? {
                amountUsd: incomeRow.amountUsd,
                nominalUsd: incomeRow.nominalUsd,
                taxesUsd: incomeRow.taxesUsd,
                currencyId: incomeRow.currencyId,
                encryptedPayload: incomeRow.encryptedPayload,
            }
            : null,
        savingsAccounts,
        investments: portfolios,
        templates,
    });
};
exports.getOnboardingContext = getOnboardingContext;
/**
 * POST /auth/me/onboarding/finalize
 * Batches the wizard's final step to avoid many round-trips on first login.
 */
const finalizeOnboarding = async (req, res) => {
    const userId = req.userId;
    const body = req.body ?? {};
    const year = Number(body.year);
    const currentMonth = parseMonth(body.currentMonth);
    if (!Number.isInteger(year) || currentMonth == null) {
        return res.status(400).json({ error: "year and currentMonth are required" });
    }
    const income = body?.incomeWork;
    const savings = body?.savings;
    const rawSavingsAccounts = Array.isArray(body?.savingsAccounts) ? body.savingsAccounts : [];
    const investments = Array.isArray(body?.investments) ? body.investments : [];
    const savingsAccounts = rawSavingsAccounts.length > 0
        ? rawSavingsAccounts
        : (savings?.enabled
            ? [{
                    sourceKey: "onboarding:savings:0",
                    investmentId: null,
                    name: savings.accountName,
                    currencyId: savings.currencyId,
                    capital: savings.capital,
                    usdUyuRate: savings.usdUyuRate,
                }]
            : []);
    const monthRange = Array.from({ length: 12 - currentMonth + 1 }, (_, idx) => currentMonth + idx);
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousMonthYear = currentMonth === 1 ? year - 1 : year;
    try {
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            if (income?.enabled) {
                if (income.amountUsd == null || income.amountUsd === "") {
                    // Keep current onboarding behavior: checked but empty amount means "skip income creation".
                }
                else {
                    const amountUsd = Number(income.amountUsd);
                    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
                        throw new Error("incomeWork.amountUsd must be >= 0");
                    }
                    const incomeType = String(income.type ?? "liquid");
                    const taxesUsd = Number(income.taxesUsd ?? 0);
                    const incomeCurrencyId = String(income.currencyId ?? "USD").trim().toUpperCase();
                    const encryptedIncomePayload = typeof income.encryptedPayload === "string" && income.encryptedPayload.length > 0
                        ? income.encryptedPayload
                        : null;
                    if (!Number.isFinite(taxesUsd) || taxesUsd < 0) {
                        throw new Error("incomeWork.taxesUsd must be >= 0");
                    }
                    if (incomeCurrencyId !== "USD" && incomeCurrencyId !== "UYU") {
                        throw new Error("incomeWork.currencyId must be USD or UYU");
                    }
                    for (const month of monthRange) {
                        const nominalUsd = amountUsd;
                        const computedTaxes = incomeType === "nominal" ? taxesUsd : 0;
                        const totalUsd = incomeType === "nominal" ? nominalUsd - computedTaxes : nominalUsd;
                        await tx.income.upsert({
                            where: { userId_year_month: { userId, year, month } },
                            update: {
                                amountUsd: totalUsd,
                                nominalUsd,
                                extraordinaryUsd: 0,
                                taxesUsd: computedTaxes,
                                currencyId: incomeCurrencyId,
                                encryptedPayload: encryptedIncomePayload,
                            },
                            create: {
                                userId,
                                year,
                                month,
                                amountUsd: totalUsd,
                                nominalUsd,
                                extraordinaryUsd: 0,
                                taxesUsd: computedTaxes,
                                currencyId: incomeCurrencyId,
                                encryptedPayload: encryptedIncomePayload ?? undefined,
                            },
                        });
                    }
                }
            }
            const bankAccountIds = [];
            for (let idx = 0; idx < savingsAccounts.length; idx += 1) {
                const rawAccount = savingsAccounts[idx];
                const sourceKey = normalizeOnboardingSourceKey(rawAccount?.sourceKey, "onboarding:savings:", idx);
                const currencyId = String(rawAccount?.currencyId ?? "USD").trim().toUpperCase();
                const capital = Number(rawAccount?.capital ?? 0);
                const usdUyuRateRaw = rawAccount?.usdUyuRate == null ? null : Number(rawAccount.usdUyuRate);
                const usdUyuRate = Number.isFinite(usdUyuRateRaw) && usdUyuRateRaw > 0 ? usdUyuRateRaw : null;
                if ((currencyId !== "USD" && currencyId !== "UYU") || !Number.isFinite(capital) || capital < 0) {
                    throw new Error("Invalid savings payload");
                }
                let account = await tx.investment.findUnique({
                    where: { userId_onboardingSourceKey: { userId, onboardingSourceKey: sourceKey } },
                });
                const requestedInvestmentId = String(rawAccount?.investmentId ?? "").trim();
                if (!account && requestedInvestmentId) {
                    const candidate = await tx.investment.findFirst({
                        where: { id: requestedInvestmentId, userId, type: "ACCOUNT" },
                    });
                    if (candidate) {
                        account = await tx.investment.update({
                            where: { id: candidate.id },
                            data: { onboardingSourceKey: sourceKey },
                        });
                    }
                }
                const accountName = String(rawAccount?.name ?? rawAccount?.accountName ?? "").trim() || `Bank account ${idx + 1}`;
                if (account) {
                    account = await tx.investment.update({
                        where: { id: account.id },
                        data: {
                            name: accountName,
                            currencyId,
                            type: "ACCOUNT",
                            targetAnnualReturn: 0,
                            onboardingSourceKey: sourceKey,
                        },
                    });
                }
                else {
                    account = await tx.investment.create({
                        data: {
                            userId,
                            name: accountName,
                            type: "ACCOUNT",
                            currencyId,
                            targetAnnualReturn: 0,
                            yieldStartYear: year,
                            yieldStartMonth: currentMonth,
                            onboardingSourceKey: sourceKey,
                        },
                    });
                }
                bankAccountIds.push(account.id);
                const capitalUsd = toSnapshotCapitalUsd(capital, currencyId, usdUyuRate);
                await tx.investmentSnapshot.upsert({
                    where: { investmentId_year_month: { investmentId: account.id, year, month: currentMonth } },
                    update: { capital, capitalUsd },
                    create: {
                        investmentId: account.id,
                        year,
                        month: currentMonth,
                        capital,
                        capitalUsd,
                        isClosed: false,
                    },
                });
            }
            const upsertedInvestments = [];
            for (let idx = 0; idx < investments.length; idx += 1) {
                const rawInvestment = investments[idx];
                const name = String(rawInvestment?.name ?? "").trim();
                if (!name)
                    continue;
                const sourceKey = normalizeOnboardingSourceKey(rawInvestment?.sourceKey, "onboarding:investment:", idx);
                const currencyId = String(rawInvestment?.currencyId ?? "USD").trim().toUpperCase();
                const capital = Number(rawInvestment?.capital ?? 0);
                const annualReturn = Number(rawInvestment?.targetAnnualReturn ?? 0);
                const usdUyuRateRaw = rawInvestment?.usdUyuRate == null ? null : Number(rawInvestment.usdUyuRate);
                const usdUyuRate = Number.isFinite(usdUyuRateRaw) && usdUyuRateRaw > 0 ? usdUyuRateRaw : null;
                if ((currencyId !== "USD" && currencyId !== "UYU") || !Number.isFinite(capital) || capital < 0 || !Number.isFinite(annualReturn) || annualReturn < 0) {
                    throw new Error("Invalid investments payload");
                }
                let investment = await tx.investment.findUnique({
                    where: { userId_onboardingSourceKey: { userId, onboardingSourceKey: sourceKey } },
                });
                const requestedInvestmentId = String(rawInvestment?.investmentId ?? "").trim();
                if (!investment && requestedInvestmentId) {
                    const candidate = await tx.investment.findFirst({
                        where: { id: requestedInvestmentId, userId, type: "PORTFOLIO" },
                    });
                    if (candidate) {
                        investment = await tx.investment.update({
                            where: { id: candidate.id },
                            data: { onboardingSourceKey: sourceKey },
                        });
                    }
                }
                if (investment) {
                    investment = await tx.investment.update({
                        where: { id: investment.id },
                        data: {
                            name,
                            type: "PORTFOLIO",
                            currencyId,
                            targetAnnualReturn: annualReturn,
                            onboardingSourceKey: sourceKey,
                        },
                    });
                }
                else {
                    investment = await tx.investment.create({
                        data: {
                            userId,
                            name,
                            type: "PORTFOLIO",
                            currencyId,
                            targetAnnualReturn: annualReturn,
                            yieldStartYear: year,
                            yieldStartMonth: currentMonth,
                            onboardingSourceKey: sourceKey,
                        },
                    });
                }
                upsertedInvestments.push(investment.id);
                const capitalUsd = toSnapshotCapitalUsd(capital, currencyId, usdUyuRate);
                await tx.investmentSnapshot.upsert({
                    where: { investmentId_year_month: { investmentId: investment.id, year, month: currentMonth } },
                    update: { capital, capitalUsd },
                    create: {
                        investmentId: investment.id,
                        year,
                        month: currentMonth,
                        capital,
                        capitalUsd,
                        isClosed: false,
                    },
                });
                const movementSourceKey = `${sourceKey}:initial-deposit`;
                if (capital > 0) {
                    await tx.investmentMovement.upsert({
                        where: {
                            investmentId_onboardingSourceKey: {
                                investmentId: investment.id,
                                onboardingSourceKey: movementSourceKey,
                            },
                        },
                        update: {
                            date: new Date(Date.UTC(previousMonthYear, previousMonth - 1, 1, 0, 0, 0)),
                            type: "deposit",
                            currencyId,
                            amount: capital,
                        },
                        create: {
                            investmentId: investment.id,
                            onboardingSourceKey: movementSourceKey,
                            date: new Date(Date.UTC(previousMonthYear, previousMonth - 1, 1, 0, 0, 0)),
                            type: "deposit",
                            currencyId,
                            amount: capital,
                        },
                    });
                }
                else {
                    await tx.investmentMovement.deleteMany({
                        where: {
                            investmentId: investment.id,
                            onboardingSourceKey: movementSourceKey,
                        },
                    });
                }
            }
            return {
                bankAccountId: bankAccountIds[0] ?? null,
                bankAccountIds,
                upsertedInvestments,
            };
        });
        return res.json({ ok: true, ...result });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(400).json({ error: message || "Error finalizing onboarding" });
    }
};
exports.finalizeOnboarding = finalizeOnboarding;
