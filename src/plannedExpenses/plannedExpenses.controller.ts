// src/plannedExpenses/plannedExpenses.controller.ts
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

/* =========================================================
   Helpers
========================================================= */

function parseYearMonth(q: any) {
  const year = Number(q.year);
  const month = Number(q.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function parseYear(q: any) {
  const year = Number(q.year);
  if (!Number.isInteger(year)) return null;
  return year;
}

function parseExpenseType(v: any) {
  if (v === "FIXED") return "FIXED";
  if (v === "VARIABLE") return "VARIABLE";
  return null;
}

function parseAmountUsd(v: any) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function openMonthsForYear(userId: string, year: number) {
  const closes = await prisma.monthClose.findMany({
    where: { userId, year },
    select: { month: true },
  });
  const closed = new Set(closes.map((c) => c.month));
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (!closed.has(m)) out.push(m);
  return out;
}

/**
 * Ensures planned expenses exist for all OPEN months of the given year,
 * based on current templates. Does NOT overwrite existing planned rows.
 */
async function ensurePlannedForYear(userId: string, year: number) {
  const templates = await prisma.expenseTemplate.findMany({
    where: { userId, showInExpenses: true },
    select: {
      id: true,
      expenseType: true,
      categoryId: true,
      description: true,
      defaultAmountUsd: true,
    },
  });

  if (templates.length === 0) return { attempted: 0 };

  const monthsOpen = await openMonthsForYear(userId, year);
  const attempted = monthsOpen.length * templates.length;

  await prisma.$transaction(
    monthsOpen.flatMap((m) =>
      templates.map((t) =>
        prisma.plannedExpense.upsert({
          where: {
            userId_year_month_templateId: {
              userId,
              year,
              month: m,
              templateId: t.id,
            },
          },
          update: {},
          create: {
            userId,
            year,
            month: m,
            templateId: t.id,
            expenseType: t.expenseType,
            categoryId: t.categoryId,
            description: t.description,
            amountUsd: t.defaultAmountUsd,
            isConfirmed: false,
          },
        })
      )
    )
  );

  return { attempted };
}

/* =========================================================
   Controllers
========================================================= */

/**
 * GET /plannedExpenses?year=YYYY&month=M
 */
export const listPlannedExpenses = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const ym = parseYearMonth(req.query);
  if (!ym) {
    return res
      .status(400)
      .json({ error: "Provide year and month query params (?year=2026&month=1)" });
  }

  const rows = await prisma.plannedExpense.findMany({
    where: { userId, year: ym.year, month: ym.month },
    orderBy: [{ expenseType: "asc" }, { categoryId: "asc" }, { description: "asc" }],
    include: {
      category: true,
      template: { select: { defaultCurrencyId: true } },
    },
  });

  // Ocultar borradores de plantillas con showInExpenses = false
  const templateIds = [...new Set(rows.map((r) => r.templateId).filter(Boolean))] as string[];
  const hiddenTemplateIds =
    templateIds.length === 0
      ? new Set<string>()
      : new Set(
          (await prisma.expenseTemplate.findMany({
            where: { id: { in: templateIds }, showInExpenses: false },
            select: { id: true },
          })).map((t) => t.id)
        );

  const filtered = rows.filter((r) => !r.templateId || !hiddenTemplateIds.has(r.templateId!));

  res.json({ year: ym.year, month: ym.month, rows: filtered });
};

/**
 * PUT /plannedExpenses/:id
 * Option A: expenseType follows Category
 */
export const updatePlannedExpense = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const pe = await prisma.plannedExpense.findFirst({
    where: { id, userId },
    select: { id: true, isConfirmed: true, year: true, month: true, categoryId: true },
  });
  if (!pe) return res.status(404).json({ error: "PlannedExpense not found" });
  if (pe.isConfirmed) {
    return res.status(409).json({ error: "PlannedExpense is confirmed and cannot be edited" });
  }

  const close = await prisma.monthClose.findFirst({
    where: { userId, year: pe.year, month: pe.month },
    select: { id: true },
  });
  if (close) {
    return res.status(409).json({ error: "Month is closed. Planned expenses cannot be edited." });
  }

  const patch: any = {};

  if (req.body?.amountUsd !== undefined) {
    patch.amountUsd = parseAmountUsd(req.body.amountUsd);
  }

  if (req.body?.description != null) {
    const d = String(req.body.description ?? "").trim();
    if (!d) return res.status(400).json({ error: "description is required" });
    patch.description = d;
  }

  if (req.body?.categoryId != null) {
    const categoryId = String(req.body.categoryId ?? "");
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });

    const cat = await prisma.category.findFirst({
      where: { id: categoryId, userId },
      select: { expenseType: true },
    });
    if (!cat) return res.status(403).json({ error: "Invalid categoryId for this user" });

    patch.categoryId = categoryId;
    patch.expenseType = cat.expenseType;
  }

  const updated = await prisma.plannedExpense.update({
    where: { id },
    data: patch,
    include: { category: true },
  });

  res.json(updated);
};

/**
 * POST /plannedExpenses/:id/confirm
 * Creates Expense and links via Expense.plannedExpenseId
 * Fully idempotent
 */
export const confirmPlannedExpense = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const pe = await prisma.plannedExpense.findFirst({
    where: { id, userId },
    include: { category: true, expense: true },
  });
  if (!pe) return res.status(404).json({ error: "PlannedExpense not found" });

  const close = await prisma.monthClose.findFirst({
    where: { userId, year: pe.year, month: pe.month },
    select: { id: true },
  });
  if (close) {
    return res.status(409).json({ error: "Month is closed. Planned expenses cannot be confirmed." });
  }

  // ✅ Idempotent
  if (pe.isConfirmed && pe.expense) {
    return res.status(200).json({ expenseId: pe.expense.id });
  }

  const amountUsd = Number(pe.amountUsd ?? 0);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return res.status(400).json({ error: "amountUsd must be > 0 to confirm" });
  }

  const date = new Date(Date.UTC(pe.year, pe.month, 0, 12, 0, 0));

  const expenseId = await prisma.$transaction(async (tx) => {
    const fresh = await tx.plannedExpense.findUnique({
      where: { id: pe.id },
      select: {
        isConfirmed: true,
        expense: { select: { id: true } },
      },
    });

    if (fresh?.isConfirmed && fresh.expense) {
      return fresh.expense.id;
    }

    const exp = await tx.expense.create({
      data: {
        userId,
        categoryId: pe.categoryId,
        currencyId: "USD",
        description: pe.description,
        amount: amountUsd,
        amountUsd,
        usdUyuRate: null,
        date,
        expenseType: pe.expenseType,
        plannedExpenseId: pe.id,
      },
    });

    await tx.plannedExpense.update({
      where: { id: pe.id },
      data: { isConfirmed: true },
    });

    return exp.id;
  });

  res.status(201).json({ expenseId });
};

/**
 * POST /plannedExpenses/ensure-year
 */
export const ensureYearPlanned = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = parseYear(req.query) ?? parseYear(req.body ?? {});
  if (!year) {
    return res.status(400).json({ error: "Provide year (?year=2026) or body { year }" });
  }

  const r = await ensurePlannedForYear(userId, year);
  res.json({ year, ...r });
};