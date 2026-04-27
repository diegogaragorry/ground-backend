// src/admin/expenseTemplates.controller.ts
import { randomUUID } from "crypto";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";
import { toUsd } from "../utils/fx";
import {
  materializeReminderForMonth,
  parseDueDayOfMonth,
  parseReminderChannel,
  parseRemindDaysBefore,
  type ReminderChannel,
} from "../reminders/reminderUtils";

const ENCRYPTED_PLACEHOLDER_PREFIX = "(encrypted-";
const ENCRYPTED_PLACEHOLDER_SUFFIX = ")";
function encryptedPlaceholder() {
  return ENCRYPTED_PLACEHOLDER_PREFIX + randomUUID().slice(0, 8) + ENCRYPTED_PLACEHOLDER_SUFFIX;
}

function parseAmountUsd(v: any) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseReminderLabel(value: any, fallback?: string | null) {
  const explicit = String(value ?? "").trim();
  if (explicit) return explicit.slice(0, 120);
  const fromFallback = String(fallback ?? "").trim();
  return fromFallback ? fromFallback.slice(0, 120) : null;
}

function parseTemplateReminderConfig(body: any): {
  reminderChannel: ReminderChannel;
  dueDayOfMonth: number | null;
  remindDaysBefore: number;
} {
  const reminderChannel = parseReminderChannel(body?.reminderChannel) ?? "NONE";
  const dueDayOfMonth = parseDueDayOfMonth(body?.dueDayOfMonth);
  const remindDaysBefore = parseRemindDaysBefore(body?.remindDaysBefore, 0);

  if (reminderChannel !== "NONE" && dueDayOfMonth == null) {
    throw new Error("dueDayOfMonth is required when reminderChannel is EMAIL or SMS");
  }

  return {
    reminderChannel,
    dueDayOfMonth: reminderChannel === "NONE" ? null : dueDayOfMonth,
    remindDaysBefore,
  };
}

export function serverYear() {
  return new Date().getUTCFullYear();
}

export async function openMonthsForYear(userId: string, year: number) {
  // Mes cerrado = existe MonthClose con isClosed=true para ese year+month
  const closes = await prisma.monthClose.findMany({
    where: { userId, year, isClosed: true },
    select: { month: true },
  });
  const closed = new Set(closes.map((c) => c.month));
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (!closed.has(m)) out.push(m);
  return out;
}

function clampStartMonth(v: unknown) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) return 1;
  return n;
}

export async function ensurePlannedForTemplate(
  userId: string,
  year: number,
  template: {
    id: string;
    expenseType: any;
    categoryId: string;
    description: string;
    reminderLabel?: string | null;
    defaultAmountUsd: number | null;
    encryptedPayload?: string | null;
    reminderChannel?: ReminderChannel;
    dueDayOfMonth?: number | null;
    remindDaysBefore?: number | null;
  },
  startMonth = 1
) {
  const fromMonth = clampStartMonth(startMonth);
  const monthsOpen = (await openMonthsForYear(userId, year)).filter((m) => m >= fromMonth);

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
          reminderLabel: template.reminderLabel ?? null,
          amountUsd: template.defaultAmountUsd,
          isConfirmed: false,
          ...materializeReminderForMonth({
            year,
            month: m,
            reminderChannel: template.reminderChannel ?? "NONE",
            dueDayOfMonth: template.dueDayOfMonth ?? null,
            remindDaysBefore: Number(template.remindDaysBefore ?? 0),
          }),
          ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
        },
      })
    )
  );
}

async function syncPlannedAfterTemplateUpdate(
  userId: string,
  year: number,
  template: {
    id: string;
    expenseType: any;
    categoryId: string;
    description: string;
    reminderLabel?: string | null;
    defaultAmountUsd: number | null;
    encryptedPayload?: string | null;
    reminderChannel?: ReminderChannel;
    dueDayOfMonth?: number | null;
    remindDaysBefore?: number | null;
  },
  startMonth = 1
) {
  const fromMonth = clampStartMonth(startMonth);
  const monthsOpen = (await openMonthsForYear(userId, year)).filter((m) => m >= fromMonth);

  // a) crear los que falten
  await ensurePlannedForTemplate(userId, year, template, fromMonth);

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
      reminderLabel: template.reminderLabel ?? null,
      amountUsd: template.defaultAmountUsd,
      ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
    },
  });

  for (const month of monthsOpen) {
    await prisma.plannedExpense.updateMany({
      where: {
        userId,
        year,
        month,
        templateId: template.id,
        isConfirmed: false,
        reminderOverridden: false,
      },
      data: materializeReminderForMonth({
        year,
        month,
        reminderChannel: template.reminderChannel ?? "NONE",
        dueDayOfMonth: template.dueDayOfMonth ?? null,
        remindDaysBefore: Number(template.remindDaysBefore ?? 0),
      }),
    });
  }
}

type TemplateSyncShape = {
  id: string;
  expenseType: any;
  categoryId: string;
  description: string;
  reminderLabel?: string | null;
  defaultAmountUsd: number | null;
  encryptedPayload?: string | null;
  reminderChannel?: ReminderChannel;
  dueDayOfMonth?: number | null;
  remindDaysBefore?: number | null;
};

async function syncPlannedForTemplatesBatch(
  db: { plannedExpense: Prisma.TransactionClient["plannedExpense"] },
  userId: string,
  year: number,
  templates: TemplateSyncShape[],
  monthsOpen: number[]
) {
  if (!templates.length || !monthsOpen.length) return;

  const createRows: Array<{
    userId: string;
    year: number;
    month: number;
    templateId: string;
    expenseType: any;
    categoryId: string;
    description: string;
    reminderLabel?: string | null;
    amountUsd: number | null;
    isConfirmed: boolean;
    encryptedPayload?: string;
  }> = [];

  for (const template of templates) {
    for (const month of monthsOpen) {
      createRows.push({
        userId,
        year,
        month,
        templateId: template.id,
        expenseType: template.expenseType,
        categoryId: template.categoryId,
        description: template.description,
        reminderLabel: template.reminderLabel ?? null,
        amountUsd: template.defaultAmountUsd ?? null,
        isConfirmed: false,
        ...materializeReminderForMonth({
          year,
          month,
          reminderChannel: template.reminderChannel ?? "NONE",
          dueDayOfMonth: template.dueDayOfMonth ?? null,
          remindDaysBefore: Number(template.remindDaysBefore ?? 0),
        }),
        ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
      });
    }
  }

  await db.plannedExpense.createMany({
    data: createRows,
    skipDuplicates: true,
  });

  for (const template of templates) {
    await db.plannedExpense.updateMany({
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
        reminderLabel: template.reminderLabel ?? null,
        amountUsd: template.defaultAmountUsd ?? null,
        ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
      },
    });

    for (const month of monthsOpen) {
      await db.plannedExpense.updateMany({
        where: {
          userId,
          year,
          month,
          templateId: template.id,
          isConfirmed: false,
          reminderOverridden: false,
        },
        data: materializeReminderForMonth({
          year,
          month,
          reminderChannel: template.reminderChannel ?? "NONE",
          dueDayOfMonth: template.dueDayOfMonth ?? null,
          remindDaysBefore: Number(template.remindDaysBefore ?? 0),
        }),
      });
    }
  }
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

function parseTemplateAmount(
  body: any
): { defaultAmountUsd: number | null; defaultCurrencyId: string } {
  const currencyId = String(body?.defaultCurrencyId ?? "USD").toUpperCase();
  const sentUsd = parseAmountUsd(body?.defaultAmountUsd);
  if (sentUsd !== undefined && sentUsd !== null) {
    return { defaultAmountUsd: sentUsd, defaultCurrencyId: currencyId || "USD" };
  }
  const amount = body?.defaultAmount != null ? Number(body.defaultAmount) : null;
  if (amount == null || !Number.isFinite(amount)) {
    return { defaultAmountUsd: null, defaultCurrencyId: currencyId || "USD" };
  }
  if (currencyId === "USD") {
    return { defaultAmountUsd: amount, defaultCurrencyId: "USD" };
  }
  if (currencyId === "UYU") {
    const rate = Number(body?.usdUyuRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("usdUyuRate is required and must be > 0 when defaultCurrencyId is UYU");
    }
    const { amountUsd } = toUsd({ amount, currencyId: "UYU", usdUyuRate: rate });
    return { defaultAmountUsd: amountUsd, defaultCurrencyId: "UYU" };
  }
  return { defaultAmountUsd: null, defaultCurrencyId: currencyId || "USD" };
}

// POST /admin/expenseTemplates
// Opción A: expenseType lo define Category.expenseType
export const createExpenseTemplate = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const categoryId = String(req.body?.categoryId ?? "");
  const encryptedPayload = typeof req.body?.encryptedPayload === "string" && req.body.encryptedPayload.length > 0 ? req.body.encryptedPayload : null;
  const hasEncrypted = !!encryptedPayload;
  let reminderConfig: { reminderChannel: ReminderChannel; dueDayOfMonth: number | null; remindDaysBefore: number } = {
    reminderChannel: "NONE",
    dueDayOfMonth: null,
    remindDaysBefore: 0,
  };

  let description: string;
  let reminderLabel: string | null;
  let defaultAmountUsd: number | null;
  let defaultCurrencyId: string;

  if (hasEncrypted) {
    description = encryptedPlaceholder();
    reminderLabel = parseReminderLabel(req.body?.reminderLabel);
    try {
      const parsed = parseTemplateAmount(req.body);
      defaultAmountUsd = parsed.defaultAmountUsd;
      defaultCurrencyId = parsed.defaultCurrencyId;
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
    }
  } else {
    description = String(req.body?.description ?? "").trim();
    if (!description) return res.status(400).json({ error: "description is required" });
    reminderLabel = parseReminderLabel(req.body?.reminderLabel, description);
    try {
      const parsed = parseTemplateAmount(req.body);
      defaultAmountUsd = parsed.defaultAmountUsd;
      defaultCurrencyId = parsed.defaultCurrencyId;
      reminderConfig = parseTemplateReminderConfig(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
    }
  }

  if (hasEncrypted) {
    try {
      reminderConfig = parseTemplateReminderConfig(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid reminder config" });
    }
  }

  if (!categoryId) return res.status(400).json({ error: "categoryId is required" });

  // category debe ser del user (y de ahí viene el type)
  const cat = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true, expenseType: true },
  });
  if (!cat) return res.status(403).json({ error: "Invalid categoryId for this user" });

  const year = serverYear();
  const startMonth = clampStartMonth(req.body?.startMonth);
  const showInExpenses = req.body?.showInExpenses === false ? false : true;

  try {
    const created = await prisma.expenseTemplate.create({
      data: {
        userId,
        expenseType: cat.expenseType,
        categoryId,
        description,
        reminderLabel,
        defaultAmountUsd,
        defaultCurrencyId: defaultCurrencyId || "USD",
        reminderChannel: reminderConfig!.reminderChannel,
        dueDayOfMonth: reminderConfig!.dueDayOfMonth,
        remindDaysBefore: reminderConfig!.remindDaysBefore,
        showInExpenses,
        ...(hasEncrypted ? { encryptedPayload } : {}),
      },
      include: { category: true },
    });

    // generar PlannedExpense para meses abiertos del año corriente
    if (created.showInExpenses !== false) {
      await ensurePlannedForTemplate(userId, year, {
        id: created.id,
        expenseType: created.expenseType,
        categoryId: created.categoryId,
        description: created.description,
        reminderLabel: created.reminderLabel,
        defaultAmountUsd: created.defaultAmountUsd ?? null,
        encryptedPayload: created.encryptedPayload ?? undefined,
        reminderChannel: created.reminderChannel,
        dueDayOfMonth: created.dueDayOfMonth,
        remindDaysBefore: created.remindDaysBefore,
      }, startMonth);
    }

    res.status(201).json(created);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.toLowerCase().includes("unique")) {
      // Template ya existe (bootstrap): actualizar monto si vino en el request y sincronizar drafts
      const existing = await prisma.expenseTemplate.findFirst({
        where: { userId, categoryId, description },
        include: { category: true },
      });
      if (existing) {
        const templatePayload = {
          id: existing.id,
          expenseType: existing.expenseType,
          categoryId: existing.categoryId,
          description: existing.description,
          reminderLabel: reminderLabel ?? existing.reminderLabel ?? parseReminderLabel(existing.description),
          defaultAmountUsd: defaultAmountUsd ?? existing.defaultAmountUsd ?? null,
          encryptedPayload: existing.encryptedPayload ?? undefined,
          reminderChannel: reminderConfig!.reminderChannel,
          dueDayOfMonth: reminderConfig!.dueDayOfMonth,
          remindDaysBefore: reminderConfig!.remindDaysBefore,
        };
        if (defaultAmountUsd !== undefined && defaultAmountUsd !== null || defaultCurrencyId || reminderConfig) {
          await prisma.expenseTemplate.update({
            where: { id: existing.id },
            data: {
              ...(defaultAmountUsd !== undefined && defaultAmountUsd !== null ? { defaultAmountUsd } : {}),
              ...(defaultCurrencyId ? { defaultCurrencyId } : {}),
              reminderLabel: reminderLabel ?? existing.reminderLabel ?? parseReminderLabel(existing.description),
              reminderChannel: reminderConfig!.reminderChannel,
              dueDayOfMonth: reminderConfig!.dueDayOfMonth,
              remindDaysBefore: reminderConfig!.remindDaysBefore,
              showInExpenses,
            },
          });
        }
        if (showInExpenses) await syncPlannedAfterTemplateUpdate(userId, year, templatePayload, startMonth);
        const updated = await prisma.expenseTemplate.findUnique({
          where: { id: existing.id },
          include: { category: true },
        });
        return res.status(200).json(updated ?? existing);
      }
      return res.status(409).json({ error: "Template already exists (unique constraint)" });
    }
    return res.status(500).json({ error: e?.message ?? "Error creating template" });
  }
};

// POST /admin/expenseTemplates/batch
// Body: { startMonth?: number, templates: Array<{ categoryId, description, onboardingSourceKey?, defaultAmountUsd, defaultCurrencyId?, showInExpenses? }> }
// Onboarding-managed templates default to hidden unless the wizard explicitly marks them visible.
export const upsertExpenseTemplatesBatch = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const rawTemplates = req.body?.templates;
  if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
    return res.status(400).json({ error: "templates array is required" });
  }

  const normalizedMap = new Map<string, {
    categoryId: string;
    description: string;
    onboardingSourceKey: string | null;
    defaultAmountUsd: number | null;
    defaultCurrencyId: string;
    showInExpenses: boolean;
    reminderLabel: string | null;
    reminderChannel: ReminderChannel;
    dueDayOfMonth: number | null;
    remindDaysBefore: number;
  }>();

  for (const raw of rawTemplates) {
    const categoryId = String(raw?.categoryId ?? "").trim();
    const description = String(raw?.description ?? "").trim();
    const onboardingSourceKey = String(raw?.onboardingSourceKey ?? "").trim() || null;
    if (!categoryId || !description) {
      return res.status(400).json({ error: "categoryId and description are required for each template" });
    }
    const defaultAmountUsd = parseAmountUsd(raw?.defaultAmountUsd);
    const defaultCurrencyId = String(raw?.defaultCurrencyId ?? "USD").trim().toUpperCase() || "USD";
    const reminderLabel = parseReminderLabel(raw?.reminderLabel, description);
    if (defaultCurrencyId !== "USD" && defaultCurrencyId !== "UYU") {
      return res.status(400).json({ error: "defaultCurrencyId must be USD or UYU" });
    }
    let reminderConfig: { reminderChannel: ReminderChannel; dueDayOfMonth: number | null; remindDaysBefore: number };
    try {
      reminderConfig = parseTemplateReminderConfig(raw);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid reminder config" });
    }
    normalizedMap.set(onboardingSourceKey || `${categoryId}::${description}`, {
      categoryId,
      description,
      onboardingSourceKey,
      defaultAmountUsd,
      defaultCurrencyId,
      showInExpenses:
        typeof raw?.showInExpenses === "boolean"
          ? raw.showInExpenses
          : onboardingSourceKey
            ? false
            : true,
      reminderLabel,
      reminderChannel: reminderConfig.reminderChannel,
      dueDayOfMonth: reminderConfig.dueDayOfMonth,
      remindDaysBefore: reminderConfig.remindDaysBefore,
    });
  }

  const normalized = [...normalizedMap.values()];
  const categoryIds = [...new Set(normalized.map((t) => t.categoryId))];
  const startMonth = clampStartMonth(req.body?.startMonth);
  const year = serverYear();
  const monthsOpen = (await openMonthsForYear(userId, year)).filter((m) => m >= startMonth);

  const [cats, existingTemplates] = await Promise.all([
    prisma.category.findMany({
      where: { userId, id: { in: categoryIds } },
      select: { id: true, expenseType: true },
    }),
    prisma.expenseTemplate.findMany({
      where: {
        userId,
        OR: [
          { categoryId: { in: categoryIds } },
          { onboardingSourceKey: { in: normalized.map((t) => t.onboardingSourceKey).filter(Boolean) as string[] } },
        ],
      },
      include: { category: true },
    }),
  ]);

  if (cats.length !== categoryIds.length) {
    return res.status(403).json({ error: "Invalid categoryId for this user" });
  }

  const categoryMap = new Map(cats.map((c) => [c.id, c]));
  const existingMap = new Map(existingTemplates.map((t) => [`${t.categoryId}::${t.description}`, t]));
  const existingBySourceKey = new Map(
    existingTemplates
      .filter((t) => t.onboardingSourceKey)
      .map((t) => [t.onboardingSourceKey as string, t])
  );

  try {
    const rows = await prisma.$transaction(async (tx) => {
      const touched: any[] = [];

      for (const template of normalized) {
        const cat = categoryMap.get(template.categoryId)!;
        const existing =
          (template.onboardingSourceKey ? existingBySourceKey.get(template.onboardingSourceKey) : null) ??
          existingMap.get(`${template.categoryId}::${template.description}`);
        if (existing) {
          const updated = await tx.expenseTemplate.update({
            where: { id: existing.id },
            data: {
              categoryId: template.categoryId,
              expenseType: cat.expenseType,
              description: template.description,
              onboardingSourceKey: template.onboardingSourceKey,
              defaultAmountUsd: template.defaultAmountUsd,
              defaultCurrencyId: template.defaultCurrencyId,
              showInExpenses: template.showInExpenses,
              reminderLabel: template.reminderLabel,
              reminderChannel: template.reminderChannel,
              dueDayOfMonth: template.dueDayOfMonth,
              remindDaysBefore: template.remindDaysBefore,
            },
            include: { category: true },
          });
          touched.push(updated);
          existingMap.set(`${template.categoryId}::${template.description}`, updated as any);
          if (template.onboardingSourceKey) existingBySourceKey.set(template.onboardingSourceKey, updated as any);
          continue;
        }

        const created = await tx.expenseTemplate.create({
          data: {
            userId,
            expenseType: cat.expenseType,
            categoryId: template.categoryId,
            onboardingSourceKey: template.onboardingSourceKey,
            description: template.description,
            defaultAmountUsd: template.defaultAmountUsd,
            defaultCurrencyId: template.defaultCurrencyId,
            showInExpenses: template.showInExpenses,
            reminderLabel: template.reminderLabel,
            reminderChannel: template.reminderChannel,
            dueDayOfMonth: template.dueDayOfMonth,
            remindDaysBefore: template.remindDaysBefore,
          },
          include: { category: true },
        });
        touched.push(created);
        existingMap.set(`${template.categoryId}::${template.description}`, created as any);
        if (template.onboardingSourceKey) existingBySourceKey.set(template.onboardingSourceKey, created as any);
      }

      return touched;
    });

    await syncPlannedForTemplatesBatch(
      prisma,
      userId,
      year,
      rows
        .filter((template: any) => template.showInExpenses !== false)
        .map((template: any) => ({
          id: template.id,
          expenseType: template.expenseType,
          categoryId: template.categoryId,
          description: template.description,
          reminderLabel: template.reminderLabel,
          defaultAmountUsd: template.defaultAmountUsd ?? null,
          encryptedPayload: template.encryptedPayload ?? undefined,
          reminderChannel: template.reminderChannel,
          dueDayOfMonth: template.dueDayOfMonth,
          remindDaysBefore: template.remindDaysBefore,
        })),
      monthsOpen
    );

    return res.json({ rows });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ error: "Template already exists (unique constraint)" });
    }
    return res.status(500).json({ error: e?.message ?? "Error upserting templates" });
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
    select: {
      id: true,
      categoryId: true,
      expenseType: true,
      defaultCurrencyId: true,
      defaultAmountUsd: true,
      reminderLabel: true,
      reminderChannel: true,
      dueDayOfMonth: true,
      remindDaysBefore: true,
    },
  });
  if (!existing) return res.status(404).json({ error: "Template not found" });

  const patch: any = {};
  const hasEncrypted = typeof req.body?.encryptedPayload === "string" && req.body.encryptedPayload.length > 0;
  const reminderLabelFromRequest =
    req.body?.reminderLabel !== undefined ? parseReminderLabel(req.body?.reminderLabel) : undefined;

  if (hasEncrypted) {
    patch.encryptedPayload = req.body.encryptedPayload;
    patch.description = encryptedPlaceholder();
    // Preserve the numeric default already stored in DB so a stale encryption snapshot
    // cannot erase amounts that the onboarding just saved milliseconds earlier.
    patch.defaultAmountUsd = existing.defaultAmountUsd ?? null;
    patch.reminderLabel = reminderLabelFromRequest ?? existing.reminderLabel ?? null;
  }

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
    patch.expenseType = cat.expenseType;
  }

  if (!hasEncrypted) {
    // description
    if (req.body?.description != null) {
      const d = String(req.body.description ?? "").trim();
      if (!d) return res.status(400).json({ error: "description is required" });
      patch.description = d;
      patch.reminderLabel = reminderLabelFromRequest ?? parseReminderLabel(d);
    }
  }

  if (!hasEncrypted && reminderLabelFromRequest !== undefined) {
    patch.reminderLabel = reminderLabelFromRequest;
  }

  // defaultAmountUsd / defaultCurrencyId
  if (
    req.body?.defaultAmountUsd !== undefined ||
    req.body?.defaultAmount !== undefined ||
    (req.body?.defaultCurrencyId !== undefined && req.body?.defaultAmount !== undefined)
  ) {
    try {
      const parsed = parseTemplateAmount({
        defaultAmountUsd: req.body?.defaultAmountUsd,
        defaultAmount: req.body?.defaultAmount,
        defaultCurrencyId: req.body?.defaultCurrencyId ?? (existing as any).defaultCurrencyId ?? "USD",
        usdUyuRate: req.body?.usdUyuRate,
      });
      patch.defaultAmountUsd = parsed.defaultAmountUsd;
      patch.defaultCurrencyId = parsed.defaultCurrencyId;
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
    }
  } else if (req.body?.defaultCurrencyId !== undefined) {
    patch.defaultCurrencyId = String(req.body.defaultCurrencyId || "USD").toUpperCase();
  }

  if (req.body?.showInExpenses !== undefined) {
    patch.showInExpenses = Boolean(req.body.showInExpenses);
  }

  if (
    req.body?.reminderChannel !== undefined ||
    req.body?.dueDayOfMonth !== undefined ||
    req.body?.remindDaysBefore !== undefined
  ) {
    try {
      const reminderConfig = parseTemplateReminderConfig({
        reminderChannel: req.body?.reminderChannel ?? existing.reminderChannel,
        dueDayOfMonth: req.body?.dueDayOfMonth ?? existing.dueDayOfMonth,
        remindDaysBefore: req.body?.remindDaysBefore ?? existing.remindDaysBefore,
      });
      patch.reminderChannel = reminderConfig.reminderChannel;
      patch.dueDayOfMonth = reminderConfig.dueDayOfMonth;
      patch.remindDaysBefore = reminderConfig.remindDaysBefore;
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Invalid reminder config" });
    }
  }

  const year = serverYear();

  try {
    const updated = await prisma.expenseTemplate.update({
      where: { id },
      data: patch,
      include: { category: true },
    });

    // sync planned solo si la plantilla está visible en gastos; si pasa a true, generar borradores
    if (updated.showInExpenses !== false) {
      await syncPlannedAfterTemplateUpdate(userId, year, {
      id: updated.id,
      expenseType: updated.expenseType,
      categoryId: updated.categoryId,
      description: updated.description,
      reminderLabel: updated.reminderLabel,
      defaultAmountUsd: updated.defaultAmountUsd ?? null,
      encryptedPayload: updated.encryptedPayload ?? undefined,
      reminderChannel: updated.reminderChannel,
      dueDayOfMonth: updated.dueDayOfMonth,
      remindDaysBefore: updated.remindDaysBefore,
    });
    }
    // Si showInExpenses pasó a false, no borramos planned existentes (quedan ocultos por filtro en list)

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

/**
 * POST /admin/expenseTemplates/set-visibility
 * Body: { visibleTemplateIds: string[] }
 * Sets showInExpenses = true for those IDs, false for all other templates of the user.
 * Used after onboarding wizard so Admin reflects which templates the user chose.
 */
export const setVisibilityToSelected = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const visibleTemplateIds = req.body?.visibleTemplateIds;
  if (!Array.isArray(visibleTemplateIds)) {
    return res.status(400).json({ error: "visibleTemplateIds array is required" });
  }
  const ids = visibleTemplateIds.filter((id: unknown) => typeof id === "string") as string[];

  if (ids.length > 0) {
    await prisma.expenseTemplate.updateMany({
      where: { userId, id: { in: ids } },
      data: { showInExpenses: true },
    });
  }
  await prisma.expenseTemplate.updateMany({
    where: { userId, ...(ids.length > 0 ? { id: { notIn: ids } } : {}) },
    data: { showInExpenses: false },
  });

  res.json({ ok: true });
};
