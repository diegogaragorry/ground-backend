import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";
import { bootstrapUserData } from "./bootstrapUserData";
import { sendSignupCodeEmail } from "../lib/mailer";

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

    const code = gen6();
    const codeHash = hashCode(email, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const rec = await prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash,
        purpose,
        expiresAt,
        ip: ip ?? undefined,
        userAgent,
      },
    });

    try {
      await sendSignupCodeEmail(email, code);
    } catch (err) {
      console.error("sendSignupCodeEmail error:", err);
      try {
        await prisma.emailVerificationCode.delete({ where: { id: rec.id } });
      } catch {
        // ignore
      }
      return res.status(500).json({ error: "Failed to send email. Check SMTP config (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM)." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("registerRequestCode error:", err);
    return res.status(500).json({
      error: "Could not send verification code",
      detail: process.env.NODE_ENV === "development" ? String((err as Error).message) : undefined,
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

  try {
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, role: "USER" },
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

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "1d" });

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Register verify error:", err);
    return res.status(500).json({ error: "Error creating user" });
  }
};

/**
 * POST /auth/login
 */
export const login = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "1d" });

  return res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
};

/**
 * GET /auth/me
 */
export const me = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json(user);
};