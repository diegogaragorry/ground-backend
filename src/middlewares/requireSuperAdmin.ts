import type { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "./requireAuth";

export async function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!me || me.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Super admin only" });
  }

  next();
}