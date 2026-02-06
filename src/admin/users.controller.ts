import { Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

function cleanEmail(s: any) {
  const v = String(s ?? "").trim().toLowerCase();
  return v.includes("@") ? v : null;
}

function validatePassword(pw: any) {
  const v = String(pw ?? "");
  // ajustá la regla si querés (min 8 por ejemplo)
  if (v.length < 6) return null;
  return v;
}

// GET /admin/users (SUPER_ADMIN)
export const listUsers = async (req: AuthRequest, res: Response) => {
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  res.json({ rows });
};

const RECENT_USERS_LIMIT = 25;
const RECENT_CODES_LIMIT = 40;
const RECENT_LOGINS_LIMIT = 20;

// GET /admin/recent-activity (SUPER_ADMIN) — últimos usuarios, códigos de verificación y últimos ingresos a la app
export const getRecentActivity = async (req: AuthRequest, res: Response) => {
  const [recentUsers, recentCodes, recentLogins] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_USERS_LIMIT,
      select: { id: true, email: true, role: true, createdAt: true },
    }),
    prisma.emailVerificationCode.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_CODES_LIMIT,
      select: {
        id: true,
        email: true,
        purpose: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        attempts: true,
      },
    }),
    prisma.loginLog.findMany({
      orderBy: { loggedAt: "desc" },
      take: RECENT_LOGINS_LIMIT,
      select: {
        id: true,
        userId: true,
        loggedAt: true,
        ip: true,
        userAgent: true,
        user: { select: { email: true } },
      },
    }),
  ]);

  const now = new Date();
  const codesWithStatus = recentCodes.map((c) => ({
    ...c,
    status: c.usedAt ? "used" : c.expiresAt <= now ? "expired" : "pending",
  }));

  const recentLoginsFlat = recentLogins.map((l) => ({
    id: l.id,
    userId: l.userId,
    email: l.user.email,
    loggedAt: l.loggedAt,
    ip: l.ip,
    userAgent: l.userAgent,
  }));

  res.json({
    recentUsers,
    recentVerificationCodes: codesWithStatus,
    recentLogins: recentLoginsFlat,
    note: "Verification codes are sent in background; send errors are only logged server-side.",
  });
};

// POST /admin/users (SUPER_ADMIN)
export const createUser = async (req: AuthRequest, res: Response) => {
  const email = cleanEmail(req.body?.email);
  const password = validatePassword(req.body?.password);
  const role = req.body?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER";

  if (!email) return res.status(400).json({ error: "Invalid email" });
  if (!password) return res.status(400).json({ error: "Password min length is 6" });

  const hash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { email, password: hash, role },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.includes("Unique") || msg.includes("unique")) {
      return res.status(409).json({ error: "Email already exists" });
    }
    return res.status(500).json({ error: "Error creating user" });
  }
};

// PUT /admin/users/:id (SUPER_ADMIN)
export const updateUser = async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const email = req.body?.email != null ? cleanEmail(req.body.email) : undefined;
  const role = req.body?.role != null ? (req.body.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER") : undefined;

  const patch: any = {};
  if (email !== undefined) {
    if (!email) return res.status(400).json({ error: "Invalid email" });
    patch.email = email;
  }
  if (role !== undefined) patch.role = role;

  // password opcional
  if (req.body?.password != null) {
    const pw = validatePassword(req.body.password);
    if (!pw) return res.status(400).json({ error: "Password min length is 6" });
    patch.password = await bcrypt.hash(pw, 10);
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: patch,
      select: { id: true, email: true, role: true, createdAt: true },
    });
    res.json(user);
  } catch (e: any) {
    return res.status(500).json({ error: "Error updating user" });
  }
};

// DELETE /admin/users/:id (SUPER_ADMIN)
export const deleteUser = async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "Invalid id" });

  // (opcional) evitar que se borre a sí mismo:
  if (req.userId === id) return res.status(400).json({ error: "You can't delete yourself" });

  await prisma.user.delete({ where: { id } });
  res.status(204).send();
};

// POST /admin/me/password (USER + SUPER_ADMIN)
export const changeMyPassword = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = validatePassword(req.body?.newPassword);

  if (!newPassword) return res.status(400).json({ error: "New password min length is 6" });

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (!me) return res.status(404).json({ error: "User not found" });

  const ok = await bcrypt.compare(currentPassword, me.password);
  if (!ok) return res.status(400).json({ error: "Current password is invalid" });

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hash } });

  res.status(204).send();
};