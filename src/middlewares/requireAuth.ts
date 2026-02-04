import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthRequest = Request & { userId?: string };

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
