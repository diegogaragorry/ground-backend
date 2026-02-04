// src/admin/expenseTemplates.controller.ts
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

function parseAmountUsd(v: any) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function serverYear() {
  return new Date().getUTCFullYear();
}

async function openMonthsForYear(userId: string, year: number) {
  // Mes cerrado = existe MonthClose para ese year+month
  const closes = await prisma.monthClose.findMany({
    where: { userId, year },
    select: { month: true },
  });
  const closed = new Set(closes.map((c) => c.month));
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (!closed.has(m)) out.push(m);
  return out;
}

async function ensurePlannedForTemplate(userId: string, year: number, template: { id: string; expenseType: any; categoryId: string; description: string; defaultAmountUsd: number | null }) {
  const monthsOpen = await openMonthsForYear(userId, year);

  // crea los que faltan (no pisa ediciones manuales)
  await prisma.$transaction(
    monthsOpen.map((m) =>
      prisma.plannedExpense.upsert({
        where: {
          userId_year_month_templateId: {
            userId,
            year,
            month: m,
            templateId: template.id,
          },
        },
        update: {},
        create: {
          userId,
          year,
          month: m,
          templateId: template.id,
          expenseType: template.expenseType,
          categoryId: template.categoryId,
          description: template.description,
          amountUsd: template.defaultAmountUsd,
          isConfirmed: false,
        },
      })
    )
  );
}

async function syncPlannedAfterTemplateUpdate(userId: string, year: number, template: { id: string; expenseType: any; categoryId: string; description: string; defaultAmountUsd: number | null }) {
  const monthsOpen = await openMonthsForYear(userId, year);

  // a) crear los que falten
  await ensurePlannedForTemplate(userId, year, template);

  // b) actualizar SOLO los no confirmados en meses abiertos
  await prisma.plannedExpense.updateMany({
    where: {
      userId,
      year,
      month: { in: monthsOpen },
      templateId: template.id,
      isConfirmed: false,
    },
    data: {
      expenseType: template.expenseType,
      categoryId: template.categoryId,
      description: template.description,
      amountUsd: template.defaultAmountUsd,
    },
  });
}

// GET /admin/expenseTemplates
export const listExpenseTemplates = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const rows = await prisma.expenseTemplate.findMany({
    where: { userId },
    orderBy: [{ expenseType: "asc" }, { createdAt: "asc" }],
    include: { category: true },
  });
  res.json({ rows });
};

// POST /admin/expenseTemplates
// Opción A: expenseType lo define Category.expenseType
export const createExpenseTemplate = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const categoryId = String(req.body?.categoryId ?? "");
  const description = String(req.body?.description ?? "").trim();
  const defaultAmountUsd = parseAmountUsd(req.body?.defaultAmountUsd);

  if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
  if (!description) return res.status(400).json({ error: "description is required" });

  // category debe ser del user (y de ahí viene el type)
  const cat = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true, expenseType: true },
  });
  if (!cat) return res.status(403).json({ error: "Invalid categoryId for this user" });

  const year = serverYear();

  try {
    const created = await prisma.expenseTemplate.create({
      data: {
        userId,
        expenseType: cat.expenseType, // ✅ Option A: from category
        categoryId,
        description,
        defaultAmountUsd,
      },
      include: { category: true },
    });

    // generar PlannedExpense para meses abiertos del año corriente
    await ensurePlannedForTemplate(userId, year, {
      id: created.id,
      expenseType: created.expenseType,
      categoryId: created.categoryId,
      description: created.description,
      defaultAmountUsd: created.defaultAmountUsd ?? null,
    });

    res.status(201).json(created);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ error: "Template already exists (unique constraint)" });
    }
    return res.status(500).json({ error: "Error creating template" });
  }
};

// PUT /admin/expenseTemplates/:id
// Opción A: si cambia categoryId => expenseType se setea al de esa category
export const updateExpenseTemplate = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const existing = await prisma.expenseTemplate.findFirst({
    where: { id, userId },
    select: { id: true, categoryId: true, expenseType: true },
  });
  if (!existing) return res.status(404).json({ error: "Template not found" });

  const patch: any = {};

  // categoryId (and type derived from it)
  if (req.body?.categoryId != null) {
    const categoryId = String(req.body.categoryId ?? "");
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });

    const cat = await prisma.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true, expenseType: true },
    });
    if (!cat) return res.status(403).json({ error: "Invalid categoryId for this user" });

    patch.categoryId = categoryId;
    patch.expenseType = cat.expenseType; // ✅ keep in sync with category
  }

  // description
  if (req.body?.description != null) {
    const d = String(req.body.description ?? "").trim();
    if (!d) return res.status(400).json({ error: "description is required" });
    patch.description = d;
  }

  // defaultAmountUsd (nullable)
  if (req.body?.defaultAmountUsd !== undefined) {
    patch.defaultAmountUsd = parseAmountUsd(req.body.defaultAmountUsd);
  }

  const year = serverYear();

  try {
    const updated = await prisma.expenseTemplate.update({
      where: { id },
      data: patch,
      include: { category: true },
    });

    // sync planned para meses abiertos del año corriente
    await syncPlannedAfterTemplateUpdate(userId, year, {
      id: updated.id,
      expenseType: updated.expenseType,
      categoryId: updated.categoryId,
      description: updated.description,
      defaultAmountUsd: updated.defaultAmountUsd ?? null,
    });

    res.json(updated);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ error: "Template already exists (unique constraint)" });
    }
    return res.status(500).json({ error: "Error updating template" });
  }
};

// DELETE /admin/expenseTemplates/:id
export const deleteExpenseTemplate = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const existing = await prisma.expenseTemplate.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Template not found" });

  const year = serverYear();
  const monthsOpen = await openMonthsForYear(userId, year);

  await prisma.$transaction(async (tx) => {
    // borrar planned NO confirmados (solo meses abiertos del año corriente)
    await tx.plannedExpense.deleteMany({
      where: {
        userId,
        year,
        month: { in: monthsOpen },
        templateId: id,
        isConfirmed: false,
      },
    });

    // borrar template
    await tx.expenseTemplate.delete({ where: { id } });
  });

  res.status(204).send();
};