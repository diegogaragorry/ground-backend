import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

function parseYearMonth(body: any) {
  const year = Number(body.year);
  const month = Number(body.month);
  const amountUsd = Number(body.amountUsd);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(amountUsd) || amountUsd < 0) return null;

  return { year, month, amountUsd };
}

export const upsertIncome = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const parsed = parseYearMonth(req.body ?? {});
  if (!parsed) return res.status(400).json({ error: "year, month (1-12) and amountUsd >= 0 are required" });

  const { year, month, amountUsd } = parsed;

  const row = await prisma.income.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { amountUsd },
    create: { userId, year, month, amountUsd },
  });

  res.json(row);
};

export const listIncome = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = Number(req.query.year);
  if (!Number.isInteger(year)) return res.status(400).json({ error: "year is required" });

  const rows = await prisma.income.findMany({
    where: { userId, year },
    orderBy: { month: "asc" },
  });

  res.json({ year, rows });
};