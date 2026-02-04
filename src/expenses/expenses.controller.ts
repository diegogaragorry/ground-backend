import { Response } from "express";
import { prisma } from "../lib/prisma";
import { toUsd } from "../utils/fx";
import type { AuthRequest } from "../middlewares/requireAuth";

function paramId(params: { id?: string | string[] }): string {
  const v = params.id;
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function parseYearMonth(query: any) {
  const year = Number(query.year);
  const month = Number(query.month);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function normalizeToMonthStartUTC(dateStr: any): Date | null {
  if (typeof dateStr !== "string" || !dateStr.trim()) return null;

  // "YYYY-MM"
  const ym = /^(\d{4})-(\d{2})$/.exec(dateStr);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
    return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  }

  // "YYYY-MM-DD" or ISO
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);

  // normalizar a 1er día de ese mes en UTC
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
}

export const createExpense = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { description, amount, date, categoryId, currencyId, usdUyuRate } = req.body ?? {};

  if (!description || typeof description !== "string") {
    return res.status(400).json({ error: "description is required" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
  return res.status(400).json({ error: "amount must be a non-zero number" });
}

  const monthDate = normalizeToMonthStartUTC(date);
  if (!monthDate) {
    return res.status(400).json({ error: "date must be YYYY-MM or an ISO date string" });
  }

  if (!categoryId || typeof categoryId !== "string") {
    return res.status(400).json({ error: "categoryId is required" });
  }
  if (!currencyId || typeof currencyId !== "string") {
    return res.status(400).json({ error: "currencyId is required (e.g., UYU, USD)" });
  }

  // Validar que la categoría sea del usuario
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
  });
  if (!category) return res.status(403).json({ error: "Invalid categoryId for this user" });

  // Validar moneda existe
  const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
  if (!currency) return res.status(400).json({ error: "Invalid currencyId" });

  // FX
  let fx: { amountUsd: number; usdUyuRate: number | null };
  try {
    fx = toUsd({ amount, currencyId, usdUyuRate });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Invalid FX rate" });
  }

  const expense = await prisma.expense.create({
    data: {
      userId,
      categoryId,
      currencyId,
      description,
      amount,
      amountUsd: fx.amountUsd,
      usdUyuRate: fx.usdUyuRate,
      date: monthDate,
    },
    include: { category: true, currency: true },
  });

  return res.status(201).json(expense);
};

export const listExpensesByMonth = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const ym = parseYearMonth(req.query);

  if (!ym) {
    return res.status(400).json({ error: "Provide ?year=YYYY&month=M" });
  }

  const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));

  const expenses = await prisma.expense.findMany({
    where: { userId, date: { gte: start, lt: end } },
    orderBy: { date: "desc" },
    include: { category: true, currency: true },
  });

  res.json(expenses);
};

export const expensesSummary = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const ym = parseYearMonth(req.query);

  if (!ym) {
    return res.status(400).json({ error: "Provide ?year=YYYY&month=M" });
  }

  const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));

  const grouped = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: { userId, date: { gte: start, lt: end } },
    _sum: { amountUsd: true },
  });

  const categoryIds = [...new Set(grouped.map((g) => g.categoryId))];
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds }, userId },
  });
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const result = grouped.map((g) => ({
    categoryId: g.categoryId,
    categoryName: categoryMap.get(g.categoryId) ?? "(unknown)",
    currencyId: "USD",
    total: g._sum.amountUsd ?? 0,
  }));

  res.json({
    year: ym.year,
    month: ym.month,
    totalsByCategoryAndCurrency: result,
  });
};

export const updateExpense = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = paramId(req.params);

  const existing = await prisma.expense.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ error: "Expense not found" });

  const { description, amount, date, categoryId, currencyId, usdUyuRate } = req.body ?? {};

  const data: any = {};

  if (description !== undefined) {
    if (typeof description !== "string" || !description.trim()) {
      return res.status(400).json({ error: "description must be a non-empty string" });
    }
    data.description = description.trim();
  }

  if (amount !== undefined) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
  return res.status(400).json({ error: "amount must be a non-zero number" });
}
    data.amount = amount;
  }

  if (date !== undefined) {
    const monthDate = normalizeToMonthStartUTC(date);
    if (!monthDate) return res.status(400).json({ error: "date must be YYYY-MM or an ISO date string" });
    data.date = monthDate;
  }

  if (categoryId !== undefined) {
    if (typeof categoryId !== "string") return res.status(400).json({ error: "categoryId must be a string" });
    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) return res.status(403).json({ error: "Invalid categoryId for this user" });
    data.categoryId = categoryId;
  }

  if (currencyId !== undefined) {
    if (typeof currencyId !== "string") return res.status(400).json({ error: "currencyId must be a string" });
    const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) return res.status(400).json({ error: "Invalid currencyId" });
    data.currencyId = currencyId;
  }

  if (usdUyuRate !== undefined) {
    // permitimos null/undefined para USD
    if (usdUyuRate !== null) {
      if (typeof usdUyuRate !== "number" || !(usdUyuRate > 0)) {
        return res.status(400).json({ error: "usdUyuRate must be a number > 0" });
      }
    }
    data.usdUyuRate = usdUyuRate;
  }

  // Recalcular amountUsd si cambia amount o currency o usdUyuRate
  if (amount !== undefined || currencyId !== undefined || usdUyuRate !== undefined) {
    const finalAmount = amount !== undefined ? amount : (existing as any).amount;
    const finalCurrencyId = currencyId !== undefined ? currencyId : (existing as any).currencyId;

    const finalUsdUyuRate =
      usdUyuRate !== undefined
        ? usdUyuRate
        : ((existing as any).usdUyuRate ?? undefined);

    try {
      const fx = toUsd({
        amount: finalAmount,
        currencyId: finalCurrencyId,
        usdUyuRate: finalUsdUyuRate ?? undefined,
      });
      data.amountUsd = fx.amountUsd;
      data.usdUyuRate = fx.usdUyuRate;
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid FX rate" });
    }
  }

  const updated = await prisma.expense.update({
    where: { id },
    data,
    include: { category: true, currency: true },
  });

  res.json(updated);
};

export const deleteExpense = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = paramId(req.params);

  const existing = await prisma.expense.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ error: "Expense not found" });

  await prisma.expense.delete({ where: { id } });
  res.status(204).send();
};