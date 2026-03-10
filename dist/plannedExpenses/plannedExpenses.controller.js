"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureYearPlanned = exports.confirmPlannedExpense = exports.updatePlannedExpense = exports.listPlannedExpenses = void 0;
// src/plannedExpenses/plannedExpenses.controller.ts
const crypto_1 = require("crypto");
const prisma_1 = require("../lib/prisma");
const ENCRYPTED_PLACEHOLDER_PREFIX = "(encrypted-";
const ENCRYPTED_PLACEHOLDER_SUFFIX = ")";
function encryptedPlaceholder() {
    return ENCRYPTED_PLACEHOLDER_PREFIX + (0, crypto_1.randomUUID)().slice(0, 8) + ENCRYPTED_PLACEHOLDER_SUFFIX;
}
/* =========================================================
   Helpers
========================================================= */
function parseYearMonth(q) {
    const year = Number(q.year);
    const month = Number(q.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
        return null;
    return { year, month };
}
function parseYear(q) {
    const year = Number(q.year);
    if (!Number.isInteger(year))
        return null;
    return year;
}
function parseExpenseType(v) {
    if (v === "FIXED")
        return "FIXED";
    if (v === "VARIABLE")
        return "VARIABLE";
    return null;
}
function parseAmountUsd(v) {
    if (v == null || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function parseAmount(v) {
    if (v == null || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function parseUsdUyuRate(v) {
    if (v == null || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
async function openMonthsForYear(userId, year) {
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
/**
 * Ensures planned expenses exist for all OPEN months of the given year,
 * based on current templates. Does NOT overwrite existing planned rows.
 */
async function ensurePlannedForYear(userId, year) {
    const templates = await prisma_1.prisma.expenseTemplate.findMany({
        where: { userId, showInExpenses: true },
        select: {
            id: true,
            expenseType: true,
            categoryId: true,
            description: true,
            defaultAmountUsd: true,
            encryptedPayload: true,
        },
    });
    if (templates.length === 0)
        return { attempted: 0 };
    const monthsOpen = await openMonthsForYear(userId, year);
    const attempted = monthsOpen.length * templates.length;
    if (monthsOpen.length === 0)
        return { attempted };
    const templateIds = templates.map((t) => t.id);
    const existing = await prisma_1.prisma.plannedExpense.findMany({
        where: {
            userId,
            year,
            month: { in: monthsOpen },
            templateId: { in: templateIds },
        },
        select: { month: true, templateId: true },
    });
    const existingKeys = new Set(existing.map((row) => `${row.month}:${row.templateId}`));
    const missingRows = monthsOpen.flatMap((month) => templates
        .filter((template) => !existingKeys.has(`${month}:${template.id}`))
        .map((template) => ({
        userId,
        year,
        month,
        templateId: template.id,
        expenseType: template.expenseType,
        categoryId: template.categoryId,
        description: template.description,
        amountUsd: template.defaultAmountUsd,
        isConfirmed: false,
        ...(template.encryptedPayload ? { encryptedPayload: template.encryptedPayload } : {}),
    })));
    if (missingRows.length > 0) {
        await prisma_1.prisma.plannedExpense.createMany({
            data: missingRows,
            skipDuplicates: true,
        });
    }
    return { attempted, created: missingRows.length };
}
/* =========================================================
   Controllers
========================================================= */
/**
 * GET /plannedExpenses?year=YYYY&month=M  — list for one month (for Gastos page).
 * GET /plannedExpenses?year=YYYY         — list all rows for the year (for projection; client decrypts amountUsd).
 */
const listPlannedExpenses = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query);
    const monthQ = req.query.month;
    const month = monthQ != null && monthQ !== "" ? Number(monthQ) : null;
    if (!year) {
        return res
            .status(400)
            .json({ error: "Provide year query param (?year=2026). Optionally month=1..12 for single month." });
    }
    const whereMonth = month != null && Number.isInteger(month) && month >= 1 && month <= 12
        ? { month }
        : {};
    const rows = await prisma_1.prisma.plannedExpense.findMany({
        where: {
            userId,
            year,
            ...whereMonth,
            OR: [{ templateId: null }, { template: { showInExpenses: true } }],
        },
        orderBy: [{ month: "asc" }, { expenseType: "asc" }, { category: { name: "asc" } }, { description: "asc" }],
        include: {
            category: true,
            template: { select: { defaultCurrencyId: true } },
        },
    });
    if (month != null) {
        res.json({ year, month, rows });
    }
    else {
        res.json({ year, rows });
    }
};
exports.listPlannedExpenses = listPlannedExpenses;
/**
 * PUT /plannedExpenses/:id
 * Option A: expenseType follows Category
 */
const updatePlannedExpense = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    const pe = await prisma_1.prisma.plannedExpense.findFirst({
        where: { id, userId },
        include: { template: { select: { defaultCurrencyId: true } } },
    });
    if (!pe)
        return res.status(404).json({ error: "PlannedExpense not found" });
    const patch = {};
    const hasEncrypted = typeof req.body?.encryptedPayload === "string" && req.body.encryptedPayload.length > 0;
    if (!hasEncrypted && pe.isConfirmed) {
        return res.status(409).json({ error: "PlannedExpense is confirmed and cannot be edited" });
    }
    if (!hasEncrypted) {
        const close = await prisma_1.prisma.monthClose.findFirst({
            where: { userId, year: pe.year, month: pe.month, isClosed: true },
            select: { id: true },
        });
        if (close) {
            return res.status(409).json({ error: "Month is closed. Planned expenses cannot be edited." });
        }
    }
    if (hasEncrypted) {
        patch.encryptedPayload = req.body.encryptedPayload;
        patch.description = encryptedPlaceholder();
        patch.amountUsd = 0;
        patch.amount = 0;
    }
    else {
        const isUyu = pe.template?.defaultCurrencyId === "UYU";
        if (req.body?.amountUsd !== undefined) {
            patch.amountUsd = parseAmountUsd(req.body.amountUsd);
        }
        // UYU: lock amount + rate to avoid display drift when FX changes
        if (isUyu) {
            const amountVal = parseAmount(req.body?.amount);
            const rateVal = parseUsdUyuRate(req.body?.usdUyuRate);
            if (amountVal != null && rateVal != null) {
                patch.amount = amountVal;
                patch.usdUyuRate = rateVal;
                patch.amountUsd = Math.round((amountVal / rateVal) * 100) / 100;
            }
            else if (amountVal != null || rateVal != null) {
                return res.status(400).json({ error: "For UYU, provide both amount and usdUyuRate together" });
            }
        }
        if (req.body?.description != null) {
            const d = String(req.body.description ?? "").trim();
            if (!d)
                return res.status(400).json({ error: "description is required" });
            patch.description = d;
        }
    }
    if (req.body?.categoryId != null) {
        const categoryId = String(req.body.categoryId ?? "");
        if (!categoryId)
            return res.status(400).json({ error: "categoryId is required" });
        const cat = await prisma_1.prisma.category.findFirst({
            where: { id: categoryId, userId },
            select: { expenseType: true },
        });
        if (!cat)
            return res.status(403).json({ error: "Invalid categoryId for this user" });
        patch.categoryId = categoryId;
        patch.expenseType = cat.expenseType;
    }
    const updated = await prisma_1.prisma.plannedExpense.update({
        where: { id },
        data: patch,
        include: { category: true },
    });
    res.json(updated);
};
exports.updatePlannedExpense = updatePlannedExpense;
/**
 * POST /plannedExpenses/:id/confirm
 * Creates Expense and links via Expense.plannedExpenseId
 * Fully idempotent
 */
const confirmPlannedExpense = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    const pe = await prisma_1.prisma.plannedExpense.findFirst({
        where: { id, userId },
        include: { category: true, expense: true, template: { select: { defaultCurrencyId: true } } },
    });
    if (!pe)
        return res.status(404).json({ error: "PlannedExpense not found" });
    const close = await prisma_1.prisma.monthClose.findFirst({
        where: { userId, year: pe.year, month: pe.month, isClosed: true },
        select: { id: true },
    });
    if (close) {
        return res.status(409).json({ error: "Month is closed. Planned expenses cannot be confirmed." });
    }
    // ✅ Idempotent
    if (pe.isConfirmed && pe.expense) {
        return res.status(200).json({ expenseId: pe.expense.id });
    }
    const hasEncrypted = typeof pe.encryptedPayload === "string" && pe.encryptedPayload.length > 0;
    let amountUsd = Number(pe.amountUsd ?? 0);
    if (!hasEncrypted && (!Number.isFinite(amountUsd) || amountUsd <= 0)) {
        return res.status(400).json({ error: "amountUsd must be > 0 to confirm" });
    }
    const isUyu = pe.template?.defaultCurrencyId === "UYU";
    let currencyId = "USD";
    let amount = amountUsd;
    let usdUyuRate = null;
    if (hasEncrypted) {
        currencyId = isUyu ? "UYU" : "USD";
        amount = Number.isFinite(pe.amount) && Number(pe.amount) > 0 ? Math.round(Number(pe.amount)) : 0;
        amountUsd = Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0;
        const bodyRate = Number(req.body?.usdUyuRate);
        const peRate = Number(pe.usdUyuRate);
        usdUyuRate =
            currencyId === "UYU" && Number.isFinite(peRate) && peRate > 0
                ? peRate
                : currencyId === "UYU" && Number.isFinite(bodyRate) && bodyRate > 0
                    ? bodyRate
                    : null;
    }
    else if (isUyu) {
        const peAmount = pe.amount;
        const peRate = pe.usdUyuRate;
        const bodyRate = Number(req.body?.usdUyuRate);
        const rate = peAmount != null && peRate != null && Number.isFinite(peAmount) && Number.isFinite(peRate) && peRate > 0
            ? peRate
            : Number.isFinite(bodyRate) && bodyRate > 0
                ? bodyRate
                : NaN;
        if (!Number.isFinite(rate) || rate <= 0) {
            return res.status(400).json({ error: "usdUyuRate is required and must be > 0 when the template is in UYU" });
        }
        currencyId = "UYU";
        amount = peAmount != null && Number.isFinite(peAmount) && peAmount > 0 ? Math.round(peAmount) : Math.round(amountUsd * rate);
        usdUyuRate = rate;
        if (peAmount != null && Number.isFinite(peAmount) && peAmount > 0) {
            amountUsd = Math.round((peAmount / rate) * 100) / 100;
        }
    }
    const date = new Date(Date.UTC(pe.year, pe.month, 0, 12, 0, 0));
    const expenseId = await prisma_1.prisma.$transaction(async (tx) => {
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
                currencyId,
                description: pe.description,
                amount,
                amountUsd,
                usdUyuRate,
                date,
                expenseType: pe.expenseType,
                plannedExpenseId: pe.id,
                ...(hasEncrypted ? { encryptedPayload: pe.encryptedPayload } : {}),
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
exports.confirmPlannedExpense = confirmPlannedExpense;
/**
 * POST /plannedExpenses/ensure-year
 */
const ensureYearPlanned = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query) ?? parseYear(req.body ?? {});
    if (!year) {
        return res.status(400).json({ error: "Provide year (?year=2026) or body { year }" });
    }
    const r = await ensurePlannedForYear(userId, year);
    res.json({ year, ...r });
};
exports.ensureYearPlanned = ensureYearPlanned;
