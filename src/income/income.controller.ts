import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

function parseYearMonth(body: any) {
  const year = Number(body.year);
  const month = Number(body.month);
  const amountUsd = body.amountUsd !== undefined ? Number(body.amountUsd) : undefined;
  const nominalUsd = body.nominalUsd !== undefined ? Number(body.nominalUsd) : undefined;
  const taxesUsd = body.taxesUsd !== undefined ? Number(body.taxesUsd) : undefined;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (nominalUsd !== undefined && (!Number.isFinite(nominalUsd) || nominalUsd < 0)) return null;
  if (taxesUsd !== undefined && (!Number.isFinite(taxesUsd) || taxesUsd < 0)) return null;
  if (amountUsd !== undefined && (!Number.isFinite(amountUsd) || amountUsd < 0)) return null;
  if (amountUsd === undefined && nominalUsd === undefined) return null;

  return { year, month, amountUsd, nominalUsd, taxesUsd };
}

/** Total income = nominal + extraordinary - taxes */
function computeTotal(nominal: number, extraordinary: number, taxes: number) {
  return nominal + extraordinary - taxes;
}

export const upsertIncome = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const body = req.body ?? {};
  const encryptedPayload = typeof body.encryptedPayload === "string" && body.encryptedPayload.length > 0 ? body.encryptedPayload : null;
  const hasEncrypted = !!encryptedPayload;

  const parsed = parseYearMonth(body);
  const usePlaceholders = hasEncrypted;
  let amountUsd: number;
  let nominalUsd: number;
  let extraordinaryUsd: number;
  let taxesUsd: number;

  if (hasEncrypted) {
    amountUsd = 0;
    nominalUsd = 0;
    extraordinaryUsd = 0;
    taxesUsd = 0;
  } else {
    if (!parsed) return res.status(400).json({ error: "year, month (1-12) and amountUsd or nominalUsd >= 0 are required" });
    const { year: _y, month: _m, amountUsd: bodyAmount, nominalUsd: bodyNominal, taxesUsd: bodyTaxes } = parsed;
    const ext = 0;
    if (bodyNominal !== undefined) {
      nominalUsd = bodyNominal;
      taxesUsd = bodyTaxes ?? 0;
      amountUsd = computeTotal(nominalUsd, ext, taxesUsd);
      extraordinaryUsd = ext;
    } else {
      nominalUsd = bodyAmount!;
      taxesUsd = 0;
      amountUsd = bodyAmount!;
      extraordinaryUsd = ext;
    }
  }

  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "year and month (1-12) are required" });
  }

  const row = await prisma.income.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { amountUsd, nominalUsd, extraordinaryUsd, taxesUsd, encryptedPayload: encryptedPayload ?? undefined },
    create: { userId, year, month, amountUsd, nominalUsd, extraordinaryUsd, taxesUsd, encryptedPayload: encryptedPayload ?? undefined },
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
      select: { id: true, month: true, amountUsd: true, nominalUsd: true, extraordinaryUsd: true, taxesUsd: true, encryptedPayload: true },
    }),
    prisma.monthClose.findMany({
      where: { userId, year },
      select: { month: true },
    }),
  ]);

  const closedMonths = closes.map((c) => c.month);

  // Backward compat: if nominalUsd is null, treat amountUsd as nominal. Include encryptedPayload for client decrypt.
  const normalized = incomeRows.map((r) => {
    const nominal = r.nominalUsd ?? r.amountUsd ?? 0;
    const extraordinary = r.extraordinaryUsd ?? 0;
    const taxes = r.taxesUsd ?? 0;
    const totalUsd = r.nominalUsd != null ? computeTotal(nominal, extraordinary, taxes) : (r.amountUsd ?? 0);
    return {
      id: r.id,
      month: r.month,
      nominalUsd: nominal,
      extraordinaryUsd: extraordinary,
      taxesUsd: taxes,
      totalUsd,
      encryptedPayload: r.encryptedPayload ?? undefined,
    };
  });

  res.json({ year, rows: normalized, closedMonths });
};

/** PATCH one month's income components (nominal, extraordinary, taxes). Recomputes total. Rejects if month is closed (except E2EE migration: encryptedPayload only). */
export const patchIncomeMonth = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const body = req.body ?? {};
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "year and month (1-12) are required" });
  }

  const encryptedPayload = typeof body.encryptedPayload === "string" && body.encryptedPayload.length > 0 ? body.encryptedPayload : undefined;
  const hasEncrypted = !!encryptedPayload;

  const closed = await prisma.monthClose.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  if (closed && !hasEncrypted) {
    return res.status(403).json({ error: "Month is closed; income cannot be edited. Reopen the month in Admin to edit." });
  }

  const nominalUsd = body.nominalUsd !== undefined ? Number(body.nominalUsd) : undefined;
  const extraordinaryUsd = body.extraordinaryUsd !== undefined ? Number(body.extraordinaryUsd) : undefined;
  const taxesUsd = body.taxesUsd !== undefined ? Number(body.taxesUsd) : undefined;
  if (!hasEncrypted && (
    (nominalUsd !== undefined && !Number.isFinite(nominalUsd)) ||
    (extraordinaryUsd !== undefined && !Number.isFinite(extraordinaryUsd)) ||
    (taxesUsd !== undefined && !Number.isFinite(taxesUsd))
  )) {
    return res.status(400).json({ error: "nominalUsd, extraordinaryUsd, taxesUsd must be finite numbers" });
  }

  const existing = await prisma.income.findUnique({
    where: { userId_year_month: { userId, year, month } },
    select: { nominalUsd: true, extraordinaryUsd: true, taxesUsd: true, amountUsd: true },
  });

  let nom: number; let ext: number; let tax: number; let amountUsd: number;
  if (hasEncrypted) {
    nom = 0; ext = 0; tax = 0; amountUsd = 0;
  } else {
    nom = nominalUsd ?? existing?.nominalUsd ?? existing?.amountUsd ?? 0;
    ext = extraordinaryUsd ?? existing?.extraordinaryUsd ?? 0;
    tax = taxesUsd ?? existing?.taxesUsd ?? 0;
    amountUsd = computeTotal(nom, ext, tax);
  }

  const updateData: Record<string, unknown> = { nominalUsd: nom, extraordinaryUsd: ext, taxesUsd: tax, amountUsd };
  if (encryptedPayload !== undefined) (updateData as any).encryptedPayload = encryptedPayload;

  const row = await prisma.income.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: updateData as any,
    create: { userId, year, month, amountUsd, nominalUsd: nom, extraordinaryUsd: ext, taxesUsd: tax, encryptedPayload: encryptedPayload ?? undefined },
  });

  res.json(row);
};