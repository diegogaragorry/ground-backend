import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";
import { bootstrapUserData } from "./bootstrapUserData";
import { decryptRecoveryPackage } from "../lib/recoveryCrypto";
import { sendSignupCodeEmail, sendPasswordResetCodeEmail } from "../lib/mailer";
import { sendSms } from "../lib/sms";

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function gen6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode(email: string, code: string) {
  const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
  return crypto.createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}

function hashPhoneCode(userId: string, phone: string, code: string) {
  const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
  return crypto.createHash("sha256").update(`${pepper}:phone:${userId}:${phone}:${code}`).digest("hex");
}

function getClientIp(req: Request) {
  const xf = (req.headers["x-forwarded-for"] as string) || "";
  const first = xf.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || null;
}

function getUserAgent(req: Request) {
  return String(req.headers["user-agent"] || "").slice(0, 400);
}

/**
 * POST /auth/register/request-code
 * Body: { email }
 */
export const registerRequestCode = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) return res.status(400).json({ error: "email is required" });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: "User already exists" });

    const purpose = "signup";
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await prisma.emailVerificationCode.count({
      where: { email, purpose, createdAt: { gte: tenMinAgo } },
    });
    if (recentCount >= 3) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    // No crear ni enviar otro código si ya se envió uno hace menos de 2 min (evita duplicados cuando el mail tarda o falla)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const latestSent = await prisma.emailVerificationCode.findFirst({
      where: { email, purpose, createdAt: { gte: twoMinAgo } },
      orderBy: { createdAt: "desc" },
    });
    if (latestSent) {
      return res.status(200).json({ ok: true, alreadySent: true });
    }

    const code = gen6();
    const codeHash = hashCode(email, code);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 min

    await prisma.emailVerificationCode.create({
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
    sendSignupCodeEmail(email, code).catch((err) => {
      console.error("sendSignupCodeEmail background error");
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("registerRequestCode error");
    return res.status(500).json({
      error: "Could not send verification code",
      detail: message, // incluir siempre para depurar (quitar en prod si no querés exponer)
    });
  }
};

/**
 * POST /auth/register/verify
 * Body: { email, code, password }
 */
export const registerVerify = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !code || !password) {
    return res.status(400).json({ error: "email, code and password are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return res.status(409).json({ error: "User already exists" });

  const purpose = "signup";
  const now = new Date();

  const latest = await prisma.emailVerificationCode.findFirst({
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
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    await prisma.emailVerificationCode.update({
      where: { id: latest.id },
      data: { attempts: { increment: 1 } },
    });
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  await prisma.emailVerificationCode.update({
    where: { id: latest.id },
    data: { usedAt: now },
  });

  const hashedPassword = await bcrypt.hash(password, 10);
  const encryptionSalt = typeof req.body?.encryptionSalt === "string" ? String(req.body.encryptionSalt).trim() || undefined : undefined;

  try {
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, role: "USER", encryptionSalt: encryptionSalt || undefined },
    });

    await bootstrapUserData(user.id);

    await prisma.investment.create({
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
    await prisma.loginLog.create({
      data: {
        userId: user.id,
        ip: ip ?? undefined,
        userAgent: userAgent || undefined,
      },
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "1d" });

    const created = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, role: true, encryptionSalt: true, encryptedRecoveryPackage: true, phoneVerifiedAt: true },
    });
    return res.status(201).json({
      token,
      user: {
        id: created!.id,
        email: created!.email,
        role: created!.role,
        encryptionSalt: created!.encryptionSalt ?? undefined,
        recoveryEnabled: !!(created!.encryptedRecoveryPackage && created!.phoneVerifiedAt),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Register verify error");
    return res.status(500).json({
      error: "Error creating user",
      detail: message,
    });
  }
};

/**
 * POST /auth/forgot-password/request-code
 * Body: { email }
 */
export const forgotPasswordRequestCode = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "email is required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "No account found with this email" });

    const purpose = "password_reset";
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await prisma.emailVerificationCode.count({
      where: { email, purpose, createdAt: { gte: tenMinAgo } },
    });
    if (recentCount >= 3) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    // No crear ni enviar otro código si ya se envió uno hace menos de 2 min
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const latestSent = await prisma.emailVerificationCode.findFirst({
      where: { email, purpose, createdAt: { gte: twoMinAgo } },
      orderBy: { createdAt: "desc" },
    });
    if (latestSent) {
      return res.status(200).json({ ok: true, alreadySent: true });
    }

    const code = gen6();
    const codeHash = hashCode(email, code);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 min

    await prisma.emailVerificationCode.create({
      data: { email, codeHash, purpose, expiresAt, ip: ip ?? undefined, userAgent },
    });

    // Responder al instante; enviar email en segundo plano
    sendPasswordResetCodeEmail(email, code).catch((err) => {
      console.error("sendPasswordResetCodeEmail background error");
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("forgotPasswordRequestCode error");
    return res.status(500).json({ error: "Could not send reset code", detail: message });
  }
};

/**
 * POST /auth/forgot-password/verify
 * Body: { email, code, newPassword }
 */
export const forgotPasswordVerify = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  const newPassword = String(req.body?.newPassword ?? req.body?.new_password ?? "");

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: "email, code and newPassword are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: "No account found with this email" });

  const purpose = "password_reset";
  const now = new Date();

  const latest = await prisma.emailVerificationCode.findFirst({
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
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    await prisma.emailVerificationCode.update({
      where: { id: latest.id },
      data: { attempts: { increment: 1 } },
    });
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  await prisma.emailVerificationCode.update({
    where: { id: latest.id },
    data: { usedAt: now },
  });

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  return res.status(200).json({ ok: true });
};

/**
 * POST /auth/login
 */
export const login = async (req: Request, res: Response) => {
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

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        password: true,
        encryptionSalt: true,
        encryptedRecoveryPackage: true,
        phoneVerifiedAt: true,
      },
    });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // Usuarios creados antes de E2EE: activar cifrado en el primer login con contraseña
    let encryptionSalt = user.encryptionSalt;
    if (!encryptionSalt) {
      encryptionSalt = crypto.randomBytes(16).toString("base64");
      await prisma.user.update({
        where: { id: user.id },
        data: { encryptionSalt },
      });
    }

    // Registrar ingreso a la app (para Admin → Actividad reciente)
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);
    await prisma.loginLog.create({
      data: {
        userId: user.id,
        ip: ip ?? undefined,
        userAgent: userAgent || undefined,
      },
    });

    const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: "1d" });

    const recoveryEnabled = !!(user.encryptedRecoveryPackage && user.phoneVerifiedAt);
    let encryptionKey: string | undefined;
    if (user.encryptedRecoveryPackage) {
      try {
        encryptionKey = decryptRecoveryPackage(user.encryptedRecoveryPackage);
      } catch {
        // recovery package invalid or SERVER_RECOVERY_KEY not set
      }
    }

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        encryptionSalt: encryptionSalt ?? undefined,
        recoveryEnabled,
        encryptionKey,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Login error");
    return res.status(500).json({
      error: "Internal Server Error",
      detail: message,
    });
  }
};

/**
 * GET /auth/me
 */
export const me = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
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

  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({
    ...user,
    recoveryEnabled: !!(user.encryptedRecoveryPackage && user.phoneVerifiedAt),
  });
};

const ONBOARDING_STEPS = ["welcome", "admin", "expenses", "investments", "budget", "dashboard", "done"] as const;

/**
 * PATCH /auth/me — update forceOnboardingNextLogin, onboardingStep, mobileWarningDismissed, preferredDisplayCurrencyId
 */
export const patchMe = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const body = req.body as {
    forceOnboardingNextLogin?: boolean;
    onboardingStep?: string;
    mobileWarningDismissed?: boolean;
    preferredDisplayCurrencyId?: string | null;
  } | undefined;
  const data: {
    forceOnboardingNextLogin?: boolean;
    onboardingStep?: string;
    mobileWarningDismissed?: boolean;
    preferredDisplayCurrencyId?: string | null;
  } = {};
  if (body?.forceOnboardingNextLogin === false) {
    data.forceOnboardingNextLogin = false;
  }
  if (body?.onboardingStep != null && typeof body.onboardingStep === "string") {
    const step = body.onboardingStep.trim();
    if (ONBOARDING_STEPS.includes(step as any)) data.onboardingStep = step;
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
    await prisma.user.update({
      where: { id: userId },
      data,
    });
  }
  return res.status(204).end();
};

/** Normalize phone to E.164-like (digits only, optional leading +) */
function normalizePhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.startsWith("0") ? digits : digits;
}

/**
 * POST /auth/me/phone/request
 * Body: { phone }
 * Sends OTP via SMS. Rate limit: 1 per 2 min per user.
 */
export const phoneRequest = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const raw = String(req.body?.phone ?? "").trim();
  const phone = normalizePhone(raw) || raw.replace(/\s/g, "");
  if (!phone || phone.length < 10) {
    return res.status(400).json({ error: "Valid phone number is required" });
  }

  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
  const recent = await prisma.phoneVerificationCode.findFirst({
    where: { userId, createdAt: { gte: twoMinAgo } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return res.status(200).json({ ok: true, alreadySent: true });
  }

  const code = gen6();
  const codeHash = hashPhoneCode(userId, phone, code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.phoneVerificationCode.create({
    data: { userId, phone, codeHash, expiresAt },
  });

  sendSms(phone, `Your Ground verification code is: ${code}. It expires in 15 minutes.`).catch((err) => {
    console.error("sendSms error");
  });

  return res.status(200).json({ ok: true });
};

/**
 * POST /auth/me/phone/verify
 * Body: { code }
 * Verifies OTP and sets User.phone + User.phoneVerifiedAt.
 */
export const phoneVerify = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "code is required" });

  const now = new Date();
  const latest = await prisma.phoneVerificationCode.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!latest || latest.usedAt || latest.expiresAt <= now) {
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  const expectedHash = hashPhoneCode(userId, latest.phone, code);
  const a = Buffer.from(expectedHash);
  const b = Buffer.from(latest.codeHash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(400).json({ error: "Invalid or expired code" });

  await prisma.phoneVerificationCode.update({
    where: { id: latest.id },
    data: { usedAt: now },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { phone: latest.phone, phoneVerifiedAt: now },
  });

  return res.status(200).json({ ok: true });
};