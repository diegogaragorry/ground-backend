"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVisibilityToSelected = exports.deleteExpenseTemplate = exports.updateExpenseTemplate = exports.createExpenseTemplate = exports.listExpenseTemplates = void 0;
exports.serverYear = serverYear;
exports.openMonthsForYear = openMonthsForYear;
exports.ensurePlannedForTemplate = ensurePlannedForTemplate;
// src/admin/expenseTemplates.controller.ts
const crypto_1 = require("crypto");
const prisma_1 = require("../lib/prisma");
const fx_1 = require("../utils/fx");
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
            amountUsd: template.defaultAmountUsd,
            isConfirmed: false,
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
            amountUsd: template.defaultAmountUsd,
            ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
        },
    });
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
    let description;
    let defaultAmountUsd;
    let defaultCurrencyId;
    if (hasEncrypted) {
        description = encryptedPlaceholder();
        defaultAmountUsd = 0;
        defaultCurrencyId = String(req.body?.defaultCurrencyId ?? "USD").toUpperCase() || "USD";
    }
    else {
        description = String(req.body?.description ?? "").trim();
        if (!description)
            return res.status(400).json({ error: "description is required" });
        try {
            const parsed = parseTemplateAmount(req.body);
            defaultAmountUsd = parsed.defaultAmountUsd;
            defaultCurrencyId = parsed.defaultCurrencyId;
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid amount/currency" });
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
                defaultAmountUsd,
                defaultCurrencyId: defaultCurrencyId || "USD",
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
            defaultAmountUsd: created.defaultAmountUsd ?? null,
            encryptedPayload: created.encryptedPayload ?? undefined,
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
                    defaultAmountUsd: defaultAmountUsd ?? existing.defaultAmountUsd ?? null,
                    encryptedPayload: existing.encryptedPayload ?? undefined,
                };
                if (defaultAmountUsd !== undefined && defaultAmountUsd !== null || defaultCurrencyId) {
                    await prisma_1.prisma.expenseTemplate.update({
                        where: { id: existing.id },
                        data: {
                            ...(defaultAmountUsd !== undefined && defaultAmountUsd !== null ? { defaultAmountUsd } : {}),
                            ...(defaultCurrencyId ? { defaultCurrencyId } : {}),
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
// PUT /admin/expenseTemplates/:id
// Opción A: si cambia categoryId => expenseType se setea al de esa category
const updateExpenseTemplate = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma_1.prisma.expenseTemplate.findFirst({
        where: { id, userId },
        select: { id: true, categoryId: true, expenseType: true, defaultCurrencyId: true, defaultAmountUsd: true },
    });
    if (!existing)
        return res.status(404).json({ error: "Template not found" });
    const patch = {};
    const hasEncrypted = typeof req.body?.encryptedPayload === "string" && req.body.encryptedPayload.length > 0;
    if (hasEncrypted) {
        patch.encryptedPayload = req.body.encryptedPayload;
        patch.description = encryptedPlaceholder();
        // Preserve the numeric default already stored in DB so a stale encryption snapshot
        // cannot erase amounts that the onboarding just saved milliseconds earlier.
        patch.defaultAmountUsd = existing.defaultAmountUsd ?? null;
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
    }
    if (req.body?.showInExpenses !== undefined) {
        patch.showInExpenses = Boolean(req.body.showInExpenses);
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
                defaultAmountUsd: updated.defaultAmountUsd ?? null,
                encryptedPayload: updated.encryptedPayload ?? undefined,
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
