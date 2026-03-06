import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";
import { encryptRecoveryPackage, decryptRecoveryPackage } from "../lib/recoveryCrypto";
import { sendPasswordResetCodeEmail } from "../lib/mailer";
import { buildRecoverySms } from "../lib/authMessages";
import { getRequestPreferredLanguage, resolvePreferredLanguage } from "../lib/preferredLanguage";
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

function hashRecoveryPhone(phone: string, code: string) {
  const pepper = process.env.OTP_PEPPER || "dev_pepper_change_me";
  return crypto.createHash("sha256").update(`${pepper}:recovery_phone:${phone}:${code}`).digest("hex");
}

/**
 * POST /auth/recovery/setup
 * Body: { recoveryPackage } (base64 of 32-byte key K)
 * Requires auth; requires User.phoneVerifiedAt. Encrypts K and stores in User.encryptedRecoveryPackage.
 */
export const recoverySetup = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const recoveryPackage = typeof req.body?.recoveryPackage === "string" ? req.body.recoveryPackage.trim() : "";
  if (!recoveryPackage) return res.status(400).json({ error: "recoveryPackage is required" });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phoneVerifiedAt: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.phoneVerifiedAt) {
    return res.status(400).json({ error: "Verify your phone first before enabling recovery" });
  }

  try {
    const encrypted = encryptRecoveryPackage(recoveryPackage);
    await prisma.user.update({
      where: { id: userId },
      data: { encryptedRecoveryPackage: encrypted },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("SERVER_RECOVERY_KEY") || message.includes("32 bytes")) {
      return res.status(500).json({ error: "Recovery not configured" });
    }
    return res.status(400).json({ error: "Invalid recovery package" });
  }
};

function getClientIp(req: Request): string | undefined {
  const xf = (req.headers["x-forwarded-for"] as string) || "";
  const first = xf.split(",")[0]?.trim();
  return first || (req.socket.remoteAddress ?? undefined);
}

function getUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  return ua ? String(ua).slice(0, 500) : undefined;
}

/**
 * POST /auth/recovery/request
 * Body: { email }
 * If user has recovery (phone + package): creates RecoverySession, sends email + SMS.
 * If user exists but no recovery: sends email-only code (same as forgot-password) so they can reset.
 */
export const recoveryRequest = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email ?? "");
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, phone: true, encryptedRecoveryPackage: true, phoneVerifiedAt: true, preferredLanguage: true },
  });
  const preferredLanguage = resolvePreferredLanguage(user?.preferredLanguage, getRequestPreferredLanguage(req));

  // User doesn't exist: generic response to avoid leaking
  if (!user) return res.status(200).json({ ok: true });

  // User exists but no recovery set up: fallback to email-only code so they get at least the email
  if (!user.phone || !user.encryptedRecoveryPackage || !user.phoneVerifiedAt) {
    const purpose = "password_reset";
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await prisma.emailVerificationCode.count({
      where: { email, purpose, createdAt: { gte: tenMinAgo } },
    });
    if (recentCount >= 3) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const latestSent = await prisma.emailVerificationCode.findFirst({
      where: { email, purpose, createdAt: { gte: twoMinAgo } },
      orderBy: { createdAt: "desc" },
    });
    if (latestSent) {
      return res.status(200).json({ ok: true, emailOnly: true });
    }
    const code = gen6();
    const codeHash = hashCode(email, code);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
    await prisma.emailVerificationCode.create({
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
    sendPasswordResetCodeEmail(email, code, preferredLanguage).catch((err) => {
      console.error("recovery fallback sendPasswordResetCodeEmail error", err);
    });
    return res.status(200).json({ ok: true, emailOnly: true });
  }

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recent = await prisma.recoverySession.findFirst({
    where: { userId: user.id, createdAt: { gte: fiveMinAgo } },
  });
  if (recent) return res.status(200).json({ ok: true });

  const emailCode = gen6();
  const phoneCode = gen6();
  const emailCodeHash = hashCode(email, emailCode);
  const phoneCodeHash = hashRecoveryPhone(user.phone, phoneCode);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.recoverySession.create({
    data: {
      userId: user.id,
      emailCodeHash,
      phoneCodeHash,
      expiresAt,
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    },
  });

  sendPasswordResetCodeEmail(email, emailCode, preferredLanguage).catch(() => console.error("recovery email error"));
  sendSms(user.phone, buildRecoverySms(phoneCode, 15, preferredLanguage)).catch(() =>
    console.error("recovery sms error")
  );

  return res.status(200).json({ ok: true });
};

/**
 * POST /auth/recovery/verify
 * Body: { email, emailCode, phoneCode }
 * Verifies both codes, returns { recoveryToken, encryptionKey }.
 */
export const recoveryVerify = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email ?? "");
  const emailCode = String(req.body?.emailCode ?? req.body?.email_code ?? "").trim();
  const phoneCode = String(req.body?.phoneCode ?? req.body?.phone_code ?? "").trim();
  if (!email || !emailCode || !phoneCode) {
    return res.status(400).json({ error: "email, emailCode and phoneCode are required" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, phone: true, encryptedRecoveryPackage: true },
  });
  if (!user || !user.encryptedRecoveryPackage || !user.phone) {
    return res.status(400).json({ error: "Invalid or expired codes" });
  }

  const now = new Date();
  const session = await prisma.recoverySession.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (!session || session.usedAt || session.expiresAt <= now) {
    return res.status(400).json({ error: "Invalid or expired codes" });
  }

  const expectedEmailHash = hashCode(email, emailCode);
  const expectedPhoneHash = hashRecoveryPhone(user.phone!, phoneCode);
  const emailOk =
    Buffer.from(expectedEmailHash).length === Buffer.from(session.emailCodeHash).length &&
    crypto.timingSafeEqual(Buffer.from(expectedEmailHash), Buffer.from(session.emailCodeHash));
  const phoneOk =
    Buffer.from(expectedPhoneHash).length === Buffer.from(session.phoneCodeHash).length &&
    crypto.timingSafeEqual(Buffer.from(expectedPhoneHash), Buffer.from(session.phoneCodeHash));
  if (!emailOk || !phoneOk) {
    return res.status(400).json({ error: "Invalid or expired codes" });
  }

  await prisma.recoverySession.update({
    where: { id: session.id },
    data: { usedAt: now },
  });

  let encryptionKeyBase64: string;
  try {
    encryptionKeyBase64 = decryptRecoveryPackage(user.encryptedRecoveryPackage);
  } catch {
    return res.status(500).json({ error: "Recovery failed" });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 16) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const tokenId = crypto.randomUUID();
  await prisma.recoveryToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const recoveryToken = jwt.sign(
    { purpose: "recovery", userId: user.id, jti: tokenId },
    jwtSecret,
    { expiresIn: "10m" }
  );

  return res.status(200).json({
    recoveryToken,
    encryptionKey: encryptionKeyBase64,
  });
};

/**
 * POST /auth/recovery/set-password
 * Body: { recoveryToken, newPassword [, newRecoveryPackage ] }
 * Validates token, updates password and optionally encryptedRecoveryPackage, returns session JWT.
 */
export const recoverySetPassword = async (req: Request, res: Response) => {
  const recoveryToken = String(req.body?.recoveryToken ?? "").trim();
  const newPassword = String(req.body?.newPassword ?? req.body?.new_password ?? "").trim();
  const newRecoveryPackage =
    typeof req.body?.newRecoveryPackage === "string" ? req.body.newRecoveryPackage.trim() : undefined;

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

  let payload: { purpose?: string; userId?: string; jti?: string };
  try {
    payload = jwt.verify(recoveryToken, jwtSecret) as { purpose?: string; userId?: string; jti?: string };
  } catch {
    return res.status(400).json({ error: "Invalid or expired recovery link" });
  }
  if (payload.purpose !== "recovery" || !payload.userId || !payload.jti) {
    return res.status(400).json({ error: "Invalid or expired recovery link" });
  }

  const tokenRow = await prisma.recoveryToken.findUnique({
    where: { id: payload.jti },
  });
  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date()) {
    return res.status(400).json({ error: "Invalid or expired recovery link" });
  }
  if (tokenRow.userId !== payload.userId) {
    return res.status(400).json({ error: "Invalid or expired recovery link" });
  }

  await prisma.recoveryToken.update({
    where: { id: payload.jti },
    data: { usedAt: new Date() },
  });

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const updateData: { password: string; encryptedRecoveryPackage?: string } = { password: hashedPassword };
  if (newRecoveryPackage) {
    try {
      updateData.encryptedRecoveryPackage = encryptRecoveryPackage(newRecoveryPackage);
    } catch {
      return res.status(400).json({ error: "Invalid new recovery package" });
    }
  }

  await prisma.user.update({
    where: { id: payload.userId },
    data: updateData,
  });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return res.status(500).json({ error: "User not found" });

  const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: "1d" });
  return res.status(200).json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
}
