"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVisibilityToSelected = exports.deleteExpenseTemplate = exports.updateExpenseTemplate = exports.upsertExpenseTemplatesBatch = exports.createExpenseTemplate = exports.listExpenseTemplates = void 0;
exports.serverYear = serverYear;
exports.openMonthsForYear = openMonthsForYear;
exports.ensurePlannedForTemplate = ensurePlannedForTemplate;
// src/admin/expenseTemplates.controller.ts
const crypto_1 = require("crypto");
const prisma_1 = require("../lib/prisma");
const fx_1 = require("../utils/fx");
const reminderUtils_1 = require("../reminders/reminderUtils");
const ENCRYPTED_PLACEHOLDER_PREFIX = "(encrypted-";
const ENCRYPTED_PLACEHOLDER_SUFFIX = ")";
function encryptedPlaceholder() {
    return ENCRYPTED_PLACEHOLDER_PREFIX + (0, crypto_1.randomUUID)().slice(0, 8) + ENCRYPTED_PLACEHOLDER_SUFFIX;
}
function parseAmountUsd(v) {
    if (v == null || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function parseReminderLabel(value, fallback) {
    const explicit = String(value ?? "").trim();
    if (explicit)
        return explicit.slice(0, 120);
    const fromFallback = String(fallback ?? "").trim();
    return fromFallback ? fromFallback.slice(0, 120) : null;
}
function parseTemplateReminderConfig(body) {
    const reminderChannel = (0, reminderUtils_1.parseReminderChannel)(body?.reminderChannel) ?? "NONE";
    const dueDayOfMonth = (0, reminderUtils_1.parseDueDayOfMonth)(body?.dueDayOfMonth);
    const remindDaysBefore = (0, reminderUtils_1.parseRemindDaysBefore)(body?.remindDaysBefore, 0);
    if (reminderChannel !== "NONE" && dueDayOfMonth == null) {
        throw new Error("dueDayOfMonth is required when reminderChannel is EMAIL or SMS");
    }
    return {
        reminderChannel,
        dueDayOfMonth: reminderChannel === "NONE" ? null : dueDayOfMonth,
        remindDaysBefore,
    };
}
function serverYear() {
    return new Date().getUTCFullYear();
}
async function openMonthsForYear(userId, year) {
    // Mes cerrado = existe MonthClose con isClosed=true para ese year+month
    const closes = await prisma_1.prisma.monthClose.findMany({
        where: { userId, year, isClosed: true },
        select: { month: true },
    });
    const closed = new Set(closes.map((c) => c.month));
    const out = [];
    for (let m = 1; m <= 12; m++)
        if (!closed.has(m))
            out.push(m);
    return out;
}
function clampStartMonth(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 12)
        return 1;
    return n;
}
async function ensurePlannedForTemplate(userId, year, template, startMonth = 1) {
    const fromMonth = clampStartMonth(startMonth);
    const monthsOpen = (await openMonthsForYear(userId, year)).filter((m) => m >= fromMonth);
    await prisma_1.prisma.$transaction(monthsOpen.map((m) => prisma_1.prisma.plannedExpense.upsert({
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
            ...(0, reminderUtils_1.materializeReminderForMonth)({
                year,
                month: m,
                reminderChannel: template.reminderChannel ?? "NONE",
                dueDayOfMonth: template.dueDayOfMonth ?? null,
                remindDaysBefore: Number(template.remindDaysBefore ?? 0),
            }),
            ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
        },
    })));
}
async function syncPlannedAfterTemplateUpdate(userId, year, template, startMonth = 1) {
    const fromMonth = clampStartMonth(startMonth);
    const monthsOpen = (await openMonthsForYear(userId, year)).filter((m) => m >= fromMonth);
    // a) crear los que falten
    await ensurePlannedForTemplate(userId, year, template, fromMonth);
    // b) actualizar SOLO los no confirmados en meses abiertos
    await prisma_1.prisma.plannedExpense.updateMany({
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
        await prisma_1.prisma.plannedExpense.updateMany({
            where: {
                userId,
                year,
                month,
                templateId: template.id,
                isConfirmed: false,
                reminderOverridden: false,
            },
            data: (0, reminderUtils_1.materializeReminderForMonth)({
                year,
                month,
                reminderChannel: template.reminderChannel ?? "NONE",
                dueDayOfMonth: template.dueDayOfMonth ?? null,
                remindDaysBefore: Number(template.remindDaysBefore ?? 0),
            }),
        });
    }
}
async function syncPlannedForTemplatesBatch(tx, userId, year, templates, monthsOpen) {
    if (!templates.length || !monthsOpen.length)
        return;
    const createRows = [];
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
                ...(0, reminderUtils_1.materializeReminderForMonth)({
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
    await tx.plannedExpense.createMany({
        data: createRows,
        skipDuplicates: true,
    });
    for (const template of templates) {
        await tx.plannedExpense.updateMany({
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
            await tx.plannedExpense.updateMany({
                where: {
                    userId,
                    year,
                    month,
                    templateId: template.id,
                    isConfirmed: false,
                    reminderOverridden: false,
                },
                data: (0, reminderUtils_1.materializeReminderForMonth)({
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
const listExpenseTemplates = async (req, res) => {
    const userId = req.userId;
    const rows = await prisma_1.prisma.expenseTemplate.findMany({
        where: { userId },
        orderBy: [{ expenseType: "asc" }, { createdAt: "asc" }],
        include: { category: true },
    });
    res.json({ rows });
};
exports.listExpenseTemplates = listExpenseTemplates;
function parseTemplateAmount(body) {
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
        const { amountUsd } = (0, fx_1.toUsd)({ amount, currencyId: "UYU", usdUyuRate: rate });
        return { defaultAmountUsd: amountUsd, defaultCurrencyId: "UYU" };
    }
    return { defaultAmountUsd: null, defaultCurrencyId: currencyId || "USD" };
}
// POST /admin/expenseTemplates
// Opción A: expenseType lo define Category.expenseType
const createExpenseTemplate = async (req, res) => {
    const userId = req.userId;
    const categoryId = String(req.body?.categoryId ?? "");
    const encryptedPayload = typeof req.body?.encryptedPayload === "string" && req.body.encryptedPayload.length > 0 ? req.body.encryptedPayload : null;
    const hasEncrypted = !!encryptedPayload;
    let reminderConfig = {
        reminderChannel: "NONE",
        dueDayOfMonth: null,
        remindDaysBefore: 0,
    };
    let description;
    let reminderLabel;
    let defaultAmountUsd;
    let defaultCurrencyId;
    if (hasEncrypted) {
        description = encryptedPlaceholder();
        reminderLabel = parseReminderLabel(req.body?.reminderLabel);
        try {
            const parsed = parseTemplateAmount(req.body);
            defaultAmountUsd = parsed.defaultAmountUsd;
            defaultCurrencyId = parsed.defaultCurrencyId;
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
        }
    }
    else {
        description = String(req.body?.description ?? "").trim();
        if (!description)
            return res.status(400).json({ error: "description is required" });
        reminderLabel = parseReminderLabel(req.body?.reminderLabel, description);
        try {
            const parsed = parseTemplateAmount(req.body);
            defaultAmountUsd = parsed.defaultAmountUsd;
            defaultCurrencyId = parsed.defaultCurrencyId;
            reminderConfig = parseTemplateReminderConfig(req.body);
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
        }
    }
    if (hasEncrypted) {
        try {
            reminderConfig = parseTemplateReminderConfig(req.body);
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid reminder config" });
        }
    }
    if (!categoryId)
        return res.status(400).json({ error: "categoryId is required" });
    // category debe ser del user (y de ahí viene el type)
    const cat = await prisma_1.prisma.category.findFirst({
        where: { id: categoryId, userId },
        select: { id: true, expenseType: true },
    });
    if (!cat)
        return res.status(403).json({ error: "Invalid categoryId for this user" });
    const year = serverYear();
    const startMonth = clampStartMonth(req.body?.startMonth);
    try {
        const created = await prisma_1.prisma.expenseTemplate.create({
            data: {
                userId,
                expenseType: cat.expenseType,
                categoryId,
                description,
                reminderLabel,
                defaultAmountUsd,
                defaultCurrencyId: defaultCurrencyId || "USD",
                reminderChannel: reminderConfig.reminderChannel,
                dueDayOfMonth: reminderConfig.dueDayOfMonth,
                remindDaysBefore: reminderConfig.remindDaysBefore,
                ...(hasEncrypted ? { encryptedPayload } : {}),
            },
            include: { category: true },
        });
        // generar PlannedExpense para meses abiertos del año corriente
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
        res.status(201).json(created);
    }
    catch (e) {
        const msg = String(e?.message ?? "");
        if (msg.toLowerCase().includes("unique")) {
            // Template ya existe (bootstrap): actualizar monto si vino en el request y sincronizar drafts
            const existing = await prisma_1.prisma.expenseTemplate.findFirst({
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
                    reminderChannel: reminderConfig.reminderChannel,
                    dueDayOfMonth: reminderConfig.dueDayOfMonth,
                    remindDaysBefore: reminderConfig.remindDaysBefore,
                };
                if (defaultAmountUsd !== undefined && defaultAmountUsd !== null || defaultCurrencyId || reminderConfig) {
                    await prisma_1.prisma.expenseTemplate.update({
                        where: { id: existing.id },
                        data: {
                            ...(defaultAmountUsd !== undefined && defaultAmountUsd !== null ? { defaultAmountUsd } : {}),
                            ...(defaultCurrencyId ? { defaultCurrencyId } : {}),
                            reminderLabel: reminderLabel ?? existing.reminderLabel ?? parseReminderLabel(existing.description),
                            reminderChannel: reminderConfig.reminderChannel,
                            dueDayOfMonth: reminderConfig.dueDayOfMonth,
                            remindDaysBefore: reminderConfig.remindDaysBefore,
                        },
                    });
                }
                await syncPlannedAfterTemplateUpdate(userId, year, templatePayload, startMonth);
                const updated = await prisma_1.prisma.expenseTemplate.findUnique({
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
exports.createExpenseTemplate = createExpenseTemplate;
// POST /admin/expenseTemplates/batch
// Body: { startMonth?: number, templates: Array<{ categoryId, description, onboardingSourceKey?, defaultAmountUsd, defaultCurrencyId?, showInExpenses? }> }
const upsertExpenseTemplatesBatch = async (req, res) => {
    const userId = req.userId;
    const rawTemplates = req.body?.templates;
    if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
        return res.status(400).json({ error: "templates array is required" });
    }
    const normalizedMap = new Map();
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
        let reminderConfig;
        try {
            reminderConfig = parseTemplateReminderConfig(raw);
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid reminder config" });
        }
        normalizedMap.set(onboardingSourceKey || `${categoryId}::${description}`, {
            categoryId,
            description,
            onboardingSourceKey,
            defaultAmountUsd,
            defaultCurrencyId,
            showInExpenses: raw?.showInExpenses !== false,
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
        prisma_1.prisma.category.findMany({
            where: { userId, id: { in: categoryIds } },
            select: { id: true, expenseType: true },
        }),
        prisma_1.prisma.expenseTemplate.findMany({
            where: {
                userId,
                OR: [
                    { categoryId: { in: categoryIds } },
                    { onboardingSourceKey: { in: normalized.map((t) => t.onboardingSourceKey).filter(Boolean) } },
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
    const existingBySourceKey = new Map(existingTemplates
        .filter((t) => t.onboardingSourceKey)
        .map((t) => [t.onboardingSourceKey, t]));
    try {
        const rows = await prisma_1.prisma.$transaction(async (tx) => {
            const touched = [];
            for (const template of normalized) {
                const cat = categoryMap.get(template.categoryId);
                const existing = (template.onboardingSourceKey ? existingBySourceKey.get(template.onboardingSourceKey) : null) ??
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
                    existingMap.set(`${template.categoryId}::${template.description}`, updated);
                    if (template.onboardingSourceKey)
                        existingBySourceKey.set(template.onboardingSourceKey, updated);
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
                existingMap.set(`${template.categoryId}::${template.description}`, created);
                if (template.onboardingSourceKey)
                    existingBySourceKey.set(template.onboardingSourceKey, created);
            }
            await syncPlannedForTemplatesBatch(tx, userId, year, touched
                .filter((template) => template.showInExpenses !== false)
                .map((template) => ({
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
            })), monthsOpen);
            return touched;
        });
        return res.json({ rows });
    }
    catch (e) {
        const msg = String(e?.message ?? "");
        if (msg.toLowerCase().includes("unique")) {
            return res.status(409).json({ error: "Template already exists (unique constraint)" });
        }
        return res.status(500).json({ error: e?.message ?? "Error upserting templates" });
    }
};
exports.upsertExpenseTemplatesBatch = upsertExpenseTemplatesBatch;
// PUT /admin/expenseTemplates/:id
// Opción A: si cambia categoryId => expenseType se setea al de esa category
const updateExpenseTemplate = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma_1.prisma.expenseTemplate.findFirst({
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
    if (!existing)
        return res.status(404).json({ error: "Template not found" });
    const patch = {};
    const hasEncrypted = typeof req.body?.encryptedPayload === "string" && req.body.encryptedPayload.length > 0;
    const reminderLabelFromRequest = req.body?.reminderLabel !== undefined ? parseReminderLabel(req.body?.reminderLabel) : undefined;
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
        if (!categoryId)
            return res.status(400).json({ error: "categoryId is required" });
        const cat = await prisma_1.prisma.category.findFirst({
            where: { id: categoryId, userId },
            select: { id: true, expenseType: true },
        });
        if (!cat)
            return res.status(403).json({ error: "Invalid categoryId for this user" });
        patch.categoryId = categoryId;
        patch.expenseType = cat.expenseType;
    }
    if (!hasEncrypted) {
        // description
        if (req.body?.description != null) {
            const d = String(req.body.description ?? "").trim();
            if (!d)
                return res.status(400).json({ error: "description is required" });
            patch.description = d;
            patch.reminderLabel = reminderLabelFromRequest ?? parseReminderLabel(d);
        }
    }
    if (!hasEncrypted && reminderLabelFromRequest !== undefined) {
        patch.reminderLabel = reminderLabelFromRequest;
    }
    // defaultAmountUsd / defaultCurrencyId
    if (req.body?.defaultAmountUsd !== undefined ||
        req.body?.defaultAmount !== undefined ||
        (req.body?.defaultCurrencyId !== undefined && req.body?.defaultAmount !== undefined)) {
        try {
            const parsed = parseTemplateAmount({
                defaultAmountUsd: req.body?.defaultAmountUsd,
                defaultAmount: req.body?.defaultAmount,
                defaultCurrencyId: req.body?.defaultCurrencyId ?? existing.defaultCurrencyId ?? "USD",
                usdUyuRate: req.body?.usdUyuRate,
            });
            patch.defaultAmountUsd = parsed.defaultAmountUsd;
            patch.defaultCurrencyId = parsed.defaultCurrencyId;
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
        }
    }
    else if (req.body?.defaultCurrencyId !== undefined) {
        patch.defaultCurrencyId = String(req.body.defaultCurrencyId || "USD").toUpperCase();
    }
    if (req.body?.showInExpenses !== undefined) {
        patch.showInExpenses = Boolean(req.body.showInExpenses);
    }
    if (req.body?.reminderChannel !== undefined ||
        req.body?.dueDayOfMonth !== undefined ||
        req.body?.remindDaysBefore !== undefined) {
        try {
            const reminderConfig = parseTemplateReminderConfig({
                reminderChannel: req.body?.reminderChannel ?? existing.reminderChannel,
                dueDayOfMonth: req.body?.dueDayOfMonth ?? existing.dueDayOfMonth,
                remindDaysBefore: req.body?.remindDaysBefore ?? existing.remindDaysBefore,
            });
            patch.reminderChannel = reminderConfig.reminderChannel;
            patch.dueDayOfMonth = reminderConfig.dueDayOfMonth;
            patch.remindDaysBefore = reminderConfig.remindDaysBefore;
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid reminder config" });
        }
    }
    const year = serverYear();
    try {
        const updated = await prisma_1.prisma.expenseTemplate.update({
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
    }
    catch (e) {
        const msg = String(e?.message ?? "");
        if (msg.toLowerCase().includes("unique")) {
            return res.status(409).json({ error: "Template already exists (unique constraint)" });
        }
        return res.status(500).json({ error: "Error updating template" });
    }
};
exports.updateExpenseTemplate = updateExpenseTemplate;
// DELETE /admin/expenseTemplates/:id
const deleteExpenseTemplate = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma_1.prisma.expenseTemplate.findFirst({
        where: { id, userId },
        select: { id: true },
    });
    if (!existing)
        return res.status(404).json({ error: "Template not found" });
    const year = serverYear();
    const monthsOpen = await openMonthsForYear(userId, year);
    await prisma_1.prisma.$transaction(async (tx) => {
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
exports.deleteExpenseTemplate = deleteExpenseTemplate;
/**
 * POST /admin/expenseTemplates/set-visibility
 * Body: { visibleTemplateIds: string[] }
 * Sets showInExpenses = true for those IDs, false for all other templates of the user.
 * Used after onboarding wizard so Admin reflects which templates the user chose.
 */
const setVisibilityToSelected = async (req, res) => {
    const userId = req.userId;
    const visibleTemplateIds = req.body?.visibleTemplateIds;
    if (!Array.isArray(visibleTemplateIds)) {
        return res.status(400).json({ error: "visibleTemplateIds array is required" });
    }
    const ids = visibleTemplateIds.filter((id) => typeof id === "string");
    if (ids.length > 0) {
        await prisma_1.prisma.expenseTemplate.updateMany({
            where: { userId, id: { in: ids } },
            data: { showInExpenses: true },
        });
    }
    await prisma_1.prisma.expenseTemplate.updateMany({
        where: { userId, ...(ids.length > 0 ? { id: { notIn: ids } } : {}) },
        data: { showInExpenses: false },
    });
    res.json({ ok: true });
};
exports.setVisibilityToSelected = setVisibilityToSelected;
