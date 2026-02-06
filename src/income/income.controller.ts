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

/** Total income = nominal + extraordinary - taxes */
function computeTotal(nominal: number, extraordinary: number, taxes: number) {
  return nominal + extraordinary - taxes;
}

export const upsertIncome = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const parsed = parseYearMonth(req.body ?? {});
  if (!parsed) return res.status(400).json({ error: "year, month (1-12) and amountUsd >= 0 are required" });

  const { year, month, amountUsd } = parsed;
  // When only amountUsd is sent (e.g. onboarding), store as nominal for the new Ingresos tab
  const nominalUsd = amountUsd;
  const extraordinaryUsd = 0;
  const taxesUsd = 0;

  const row = await prisma.income.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { amountUsd, nominalUsd, extraordinaryUsd, taxesUsd },
    create: { userId, year, month, amountUsd, nominalUsd, extraordinaryUsd, taxesUsd },
  });

  res.json(row);
};

export const listIncome = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = Number(req.query.year);
  if (!Number.isInteger(year)) return res.status(400).json({ error: "year is required" });

  const [incomeRows, closes] = await Promise.all([
    prisma.income.findMany({
      where: { userId, year },
      orderBy: { month: "asc" },
      select: { month: true, amountUsd: true, nominalUsd: true, extraordinaryUsd: true, taxesUsd: true },
    }),
    prisma.monthClose.findMany({
      where: { userId, year },
      select: { month: true },
    }),
  ]);

  const closedMonths = closes.map((c) => c.month);

  // Backward compat: if nominalUsd is null, treat amountUsd as nominal
  const normalized = incomeRows.map((r) => {
    const nominal = r.nominalUsd ?? r.amountUsd ?? 0;
    const extraordinary = r.extraordinaryUsd ?? 0;
    const taxes = r.taxesUsd ?? 0;
    const totalUsd = r.nominalUsd != null ? computeTotal(nominal, extraordinary, taxes) : (r.amountUsd ?? 0);
    return {
      month: r.month,
      nominalUsd: nominal,
      extraordinaryUsd: extraordinary,
      taxesUsd: taxes,
      totalUsd,
    };
  });

  res.json({ year, rows: normalized, closedMonths });
};

/** PATCH one month's income components (nominal, extraordinary, taxes). Recomputes total. Rejects if month is closed. */
export const patchIncomeMonth = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const body = req.body ?? {};
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "year and month (1-12) are required" });
  }

  const closed = await prisma.monthClose.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  if (closed) {
    return res.status(403).json({ error: "Month is closed; income cannot be edited. Reopen the month in Admin to edit." });
  }

  const nominalUsd = body.nominalUsd !== undefined ? Number(body.nominalUsd) : undefined;
  const extraordinaryUsd = body.extraordinaryUsd !== undefined ? Number(body.extraordinaryUsd) : undefined;
  const taxesUsd = body.taxesUsd !== undefined ? Number(body.taxesUsd) : undefined;
  if (
    (nominalUsd !== undefined && !Number.isFinite(nominalUsd)) ||
    (extraordinaryUsd !== undefined && !Number.isFinite(extraordinaryUsd)) ||
    (taxesUsd !== undefined && !Number.isFinite(taxesUsd))
  ) {
    return res.status(400).json({ error: "nominalUsd, extraordinaryUsd, taxesUsd must be finite numbers" });
  }

  const existing = await prisma.income.findUnique({
    where: { userId_year_month: { userId, year, month } },
    select: { nominalUsd: true, extraordinaryUsd: true, taxesUsd: true, amountUsd: true },
  });

  const nom = nominalUsd ?? existing?.nominalUsd ?? existing?.amountUsd ?? 0;
  const ext = extraordinaryUsd ?? existing?.extraordinaryUsd ?? 0;
  const tax = taxesUsd ?? existing?.taxesUsd ?? 0;
  const amountUsd = computeTotal(nom, ext, tax);

  const row = await prisma.income.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { nominalUsd: nom, extraordinaryUsd: ext, taxesUsd: tax, amountUsd },
    create: { userId, year, month, amountUsd, nominalUsd: nom, extraordinaryUsd: ext, taxesUsd: tax },
  });

  res.json(row);
};