import { Response } from "express";
import type { AuthRequest } from "../middlewares/requireAuth";
import { prisma } from "../lib/prisma";
import { toUsd } from "../utils/fx";

function parseType(v: any) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "PORTFOLIO") return "PORTFOLIO";
  if (s === "ACCOUNT") return "ACCOUNT";
  return null;
}

function parseMonth(v: any) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

async function getUsdUyuRateForMonth(userId: string, year: number, month: number): Promise<number> {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const last = await prisma.expense.findFirst({
    where: { userId, date: { gte: start, lt: end }, usdUyuRate: { not: null } },
    orderBy: { date: "desc" },
    select: { usdUyuRate: true },
  });
  const fallback = Number(process.env.DEFAULT_USD_UYU_RATE ?? 38);
  const v = Number(last?.usdUyuRate ?? fallback);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const listInvestments = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const list = await prisma.investment.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  res.json(list);
};

export const createInvestment = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { name, type, currencyId, targetAnnualReturn, yieldStartYear, yieldStartMonth } = req.body ?? {};

  const nm = String(name ?? "").trim();
  if (!nm) return res.status(400).json({ error: "name is required" });

  const tp = parseType(type);
  if (!tp) return res.status(400).json({ error: "type must be PORTFOLIO or ACCOUNT" });

  if (!currencyId || typeof currencyId !== "string") {
    return res.status(400).json({ error: "currencyId is required (USD/UYU)" });
  }

  const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
  if (!currency) return res.status(400).json({ error: "Invalid currencyId" });

  const tar = targetAnnualReturn == null ? 0 : Number(targetAnnualReturn);
  if (!Number.isFinite(tar) || tar < 0) {
    return res.status(400).json({ error: "targetAnnualReturn must be >= 0" });
  }

  const now = new Date();
  const y = Number.isInteger(yieldStartYear) ? Number(yieldStartYear) : now.getUTCFullYear();

  const m =
    yieldStartMonth === undefined || yieldStartMonth === null
      ? 1
      : parseMonth(yieldStartMonth);

  if (m == null) return res.status(400).json({ error: "yieldStartMonth must be 1..12" });

  const inv = await prisma.investment.create({
    data: {
      userId,
      name: nm,
      type: tp,
      currencyId,
      targetAnnualReturn: tar,
      yieldStartYear: y,
      yieldStartMonth: m,
    },
  });

  res.status(201).json(inv);
};

export const updateInvestmentConfig = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = String(req.params.id ?? "");

  const existing = await prisma.investment.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ error: "Investment not found" });

  const { currencyId, targetAnnualReturn, yieldStartYear, yieldStartMonth, name, type } = req.body ?? {};
  const data: any = {};

  if (name !== undefined) {
    const nm = String(name ?? "").trim();
    if (!nm) return res.status(400).json({ error: "name must be non-empty" });
    data.name = nm;
  }

  if (type !== undefined) {
    const tp = parseType(type);
    if (!tp) return res.status(400).json({ error: "type must be PORTFOLIO or ACCOUNT" });
    data.type = tp;
  }

  if (currencyId !== undefined) {
    if (typeof currencyId !== "string" || !currencyId.trim()) {
      return res.status(400).json({ error: "currencyId must be a non-empty string" });
    }
    const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) return res.status(400).json({ error: "Invalid currencyId" });
    data.currencyId = currencyId;
  }

  if (targetAnnualReturn !== undefined) {
    const tar = Number(targetAnnualReturn);
    if (!Number.isFinite(tar) || tar < 0) {
      return res.status(400).json({ error: "targetAnnualReturn must be >= 0" });
    }
    data.targetAnnualReturn = tar;
  }

  if (yieldStartYear !== undefined) {
    if (!Number.isInteger(yieldStartYear)) {
      return res.status(400).json({ error: "yieldStartYear must be an integer" });
    }
    data.yieldStartYear = yieldStartYear;
  }

  if (yieldStartMonth !== undefined) {
    const m = parseMonth(yieldStartMonth);
    if (m == null) return res.status(400).json({ error: "yieldStartMonth must be 1..12" });
    data.yieldStartMonth = m;
  }

  const currencyChanged = data.currencyId !== undefined && data.currencyId !== existing.currencyId;
  const newCurrencyId = data.currencyId ?? existing.currencyId;

  const updated = await prisma.investment.update({ where: { id }, data });

  if (currencyChanged) {
    const snaps = await prisma.investmentSnapshot.findMany({
      where: { investmentId: id },
    });
    for (const snap of snaps) {
      const cap = snap.capital;
      if (cap == null || Number.isNaN(cap) || cap < 0) continue;
      const year = snap.year;
      const month = snap.month;
      let capitalUsd: number;
      if (newCurrencyId === "USD") {
        capitalUsd = cap;
      } else {
        const rate = await getUsdUyuRateForMonth(userId, year, month);
        capitalUsd = toUsd({ amount: cap, currencyId: newCurrencyId, usdUyuRate: rate }).amountUsd;
      }
      await prisma.investmentSnapshot.update({
        where: {
          investmentId_year_month: { investmentId: id, year, month },
        },
        data: { capitalUsd },
      });
    }
  }

  res.json(updated);
};

export const deleteInvestment = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = String(req.params.id ?? "");

  const investment = await prisma.investment.findFirst({ where: { id, userId } });
  if (!investment) return res.status(404).json({ error: "Investment not found" });

  const closedWithAmount = await prisma.investmentSnapshot.findFirst({
    where: {
      investmentId: id,
      isClosed: true,
      OR: [
        { capital: { not: 0 } },
        { capitalUsd: { not: 0 } },
      ],
    },
  });
  if (closedWithAmount) {
    return res.status(409).json({
      error: "Cannot delete: this investment has amounts in closed months. Reopen those months in Admin, move the funds elsewhere, then try deleting again.",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.investmentMovement.deleteMany({ where: { investmentId: id } });
    await tx.investmentSnapshot.deleteMany({ where: { investmentId: id } });
    await tx.investment.delete({ where: { id } });
  });

  return res.status(204).send();
};