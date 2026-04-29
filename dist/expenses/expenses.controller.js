"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteExpense = exports.updateExpense = exports.expensesSummary = exports.expensesPageData = exports.listExpensesByMonth = exports.listExpensesByYear = exports.upsertMerchantMappingRule = exports.listMerchantMappingRules = exports.importExpensesBatch = exports.createExpense = void 0;
const prisma_1 = require("../lib/prisma");
const fx_1 = require("../utils/fx");
const plannedVisibility_1 = require("../lib/plannedVisibility");
function paramId(params) {
    const v = params.id;
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
function parseYearMonth(query) {
    const year = Number(query.year);
    const month = Number(query.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
        return null;
    return { year, month };
}
function normalizeToMonthStartUTC(dateStr) {
    if (typeof dateStr !== "string" || !dateStr.trim())
        return null;
    // "YYYY-MM"
    const ym = /^(\d{4})-(\d{2})$/.exec(dateStr);
    if (ym) {
        const y = Number(ym[1]);
        const m = Number(ym[2]);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12)
            return null;
        return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    }
    // "YYYY-MM-DD" or ISO
    const t = Date.parse(dateStr);
    if (Number.isNaN(t))
        return null;
    const d = new Date(t);
    // normalizar a 1er día de ese mes en UTC
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
}
function parseBatchAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function parseLearnedRuleInput(raw, index) {
    const merchantFingerprint = typeof raw?.merchantFingerprint === "string" ? raw.merchantFingerprint.trim() : "";
    if (!merchantFingerprint)
        throw new Error(`Rule ${index + 1}: merchantFingerprint is required`);
    const categoryId = typeof raw?.categoryId === "string" ? raw.categoryId.trim() : "";
    if (!categoryId)
        throw new Error(`Rule ${index + 1}: categoryId is required`);
    const encryptedPayload = typeof raw?.encryptedPayload === "string" ? raw.encryptedPayload.trim() : "";
    if (!encryptedPayload)
        throw new Error(`Rule ${index + 1}: encryptedPayload is required`);
    const expenseType = raw?.expenseType === "FIXED" || raw?.expenseType === "VARIABLE"
        ? raw.expenseType
        : null;
    return {
        merchantFingerprint,
        categoryId,
        encryptedPayload,
        expenseType,
    };
}
const createExpense = async (req, res) => {
    const userId = req.userId;
    const { description, amount, date, categoryId, currencyId, usdUyuRate, expenseType: bodyExpenseType, encryptedPayload } = req.body ?? {};
    const hasEncrypted = typeof encryptedPayload === "string" && encryptedPayload.length > 0;
    const desc = hasEncrypted ? (description ?? "") : description;
    const descStr = typeof desc === "string" ? desc : "";
    if (!hasEncrypted && !descStr.trim()) {
        return res.status(400).json({ error: "description is required" });
    }
    // When E2EE: client sends amount 0 and real value is in encryptedPayload
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
        return res.status(400).json({ error: "amount must be a number" });
    }
    if (!hasEncrypted && amount === 0) {
        return res.status(400).json({ error: "amount must be a non-zero number" });
    }
    const amt = hasEncrypted ? 0 : amount;
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
    const category = await prisma_1.prisma.category.findFirst({
        where: { id: categoryId, userId },
    });
    if (!category)
        return res.status(403).json({ error: "Invalid categoryId for this user" });
    // Validar moneda existe
    const currency = await prisma_1.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency)
        return res.status(400).json({ error: "Invalid currencyId" });
    // FX: when E2EE we store 0; client sends amountUsd in payload or we use 0
    let fx;
    if (hasEncrypted) {
        fx = { amountUsd: 0, usdUyuRate: typeof usdUyuRate === "number" && usdUyuRate > 0 ? usdUyuRate : null };
    }
    else {
        try {
            fx = (0, fx_1.toUsd)({ amount: amt, currencyId, usdUyuRate });
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid FX rate" });
        }
    }
    const expenseType = bodyExpenseType === "FIXED" || bodyExpenseType === "VARIABLE"
        ? bodyExpenseType
        : (category?.expenseType ?? "VARIABLE");
    const expense = await prisma_1.prisma.expense.create({
        data: {
            userId,
            categoryId,
            currencyId,
            description: descStr.trim() || "(encrypted)",
            amount: amt,
            amountUsd: fx.amountUsd,
            usdUyuRate: fx.usdUyuRate,
            date: monthDate,
            expenseType,
            encryptedPayload: hasEncrypted ? encryptedPayload : undefined,
        },
        include: { category: true, currency: true },
    });
    return res.status(201).json(expense);
};
exports.createExpense = createExpense;
const importExpensesBatch = async (req, res) => {
    const userId = req.userId;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const rawLearnedRules = Array.isArray(req.body?.learnedRules) ? req.body.learnedRules : [];
    if (rawItems.length === 0) {
        return res.status(400).json({ error: "items must be a non-empty array" });
    }
    if (rawItems.length > 500) {
        return res.status(400).json({ error: "Too many items. Limit is 500 per import." });
    }
    const normalizedItems = rawItems.map((raw, index) => {
        const hasEncrypted = typeof raw?.encryptedPayload === "string" && raw.encryptedPayload.length > 0;
        const description = typeof raw?.description === "string" ? raw.description.trim() : "";
        if (!hasEncrypted && !description) {
            throw new Error(`Row ${index + 1}: description is required`);
        }
        const amount = parseBatchAmount(raw?.amount);
        if (amount == null) {
            throw new Error(`Row ${index + 1}: amount must be a number`);
        }
        if (!hasEncrypted && amount === 0) {
            throw new Error(`Row ${index + 1}: amount must be non-zero`);
        }
        const date = normalizeToMonthStartUTC(raw?.date);
        if (!date) {
            throw new Error(`Row ${index + 1}: date must be YYYY-MM or an ISO date string`);
        }
        const categoryId = typeof raw?.categoryId === "string" ? raw.categoryId : "";
        if (!categoryId)
            throw new Error(`Row ${index + 1}: categoryId is required`);
        const currencyId = typeof raw?.currencyId === "string" ? raw.currencyId : "";
        if (!currencyId)
            throw new Error(`Row ${index + 1}: currencyId is required`);
        const amountUsd = raw?.amountUsd == null ? null : parseBatchAmount(raw.amountUsd);
        if (hasEncrypted && amountUsd == null) {
            throw new Error(`Row ${index + 1}: amountUsd is required for encrypted imports`);
        }
        const expenseType = raw?.expenseType === "FIXED" || raw?.expenseType === "VARIABLE"
            ? raw.expenseType
            : null;
        const usdUyuRate = raw?.usdUyuRate == null
            ? null
            : typeof raw.usdUyuRate === "number" && raw.usdUyuRate > 0
                ? raw.usdUyuRate
                : null;
        return {
            hasEncrypted,
            description,
            amount,
            amountUsd,
            date,
            categoryId,
            currencyId,
            usdUyuRate,
            expenseType,
            encryptedPayload: hasEncrypted ? raw.encryptedPayload : null,
        };
    });
    const normalizedLearnedRules = rawLearnedRules.map((raw, index) => parseLearnedRuleInput(raw, index));
    const categoryIds = [...new Set(normalizedItems.map((item) => item.categoryId))];
    for (const rule of normalizedLearnedRules) {
        categoryIds.push(rule.categoryId);
    }
    const currencyIds = [...new Set(normalizedItems.map((item) => item.currencyId))];
    const years = [...new Set(normalizedItems.map((item) => item.date.getUTCFullYear()))];
    const [categories, currencies, monthCloses] = await Promise.all([
        prisma_1.prisma.category.findMany({
            where: { userId, id: { in: categoryIds } },
            select: { id: true, expenseType: true },
        }),
        prisma_1.prisma.currency.findMany({
            where: { id: { in: currencyIds } },
            select: { id: true },
        }),
        prisma_1.prisma.monthClose.findMany({
            where: {
                userId,
                year: { in: years },
                isClosed: true,
            },
            select: { year: true, month: true },
        }),
    ]);
    const categoryMap = new Map(categories.map((item) => [item.id, item]));
    const currencySet = new Set(currencies.map((item) => item.id));
    const closedSet = new Set(monthCloses.map((item) => `${item.year}-${item.month}`));
    const createRows = normalizedItems.map((item, index) => {
        const category = categoryMap.get(item.categoryId);
        if (!category) {
            throw new Error(`Row ${index + 1}: invalid categoryId for this user`);
        }
        if (!currencySet.has(item.currencyId)) {
            throw new Error(`Row ${index + 1}: invalid currencyId`);
        }
        const year = item.date.getUTCFullYear();
        const month = item.date.getUTCMonth() + 1;
        if (closedSet.has(`${year}-${month}`)) {
            throw new Error(`Row ${index + 1}: target month is closed`);
        }
        let amountUsd = 0;
        let usdUyuRate = item.usdUyuRate;
        if (item.hasEncrypted) {
            amountUsd = item.amountUsd ?? 0;
        }
        else {
            const fx = (0, fx_1.toUsd)({
                amount: item.amount,
                currencyId: item.currencyId,
                usdUyuRate: item.usdUyuRate ?? undefined,
            });
            amountUsd = fx.amountUsd;
            usdUyuRate = fx.usdUyuRate;
        }
        return {
            userId,
            categoryId: item.categoryId,
            currencyId: item.currencyId,
            description: item.hasEncrypted ? item.description || "(encrypted)" : item.description,
            amount: item.hasEncrypted ? 0 : item.amount,
            amountUsd,
            usdUyuRate,
            date: item.date,
            expenseType: item.expenseType ?? category.expenseType,
            ...(item.encryptedPayload ? { encryptedPayload: item.encryptedPayload } : {}),
        };
    });
    const dedupedLearnedRules = new Map();
    for (const rule of normalizedLearnedRules) {
        const category = categoryMap.get(rule.categoryId);
        if (!category) {
            throw new Error(`Rule for ${rule.merchantFingerprint.slice(0, 8)}: invalid categoryId for this user`);
        }
        dedupedLearnedRules.set(rule.merchantFingerprint, {
            ...rule,
            expenseType: rule.expenseType ?? category.expenseType,
        });
    }
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const created = await tx.expense.createMany({
            data: createRows,
        });
        for (const rule of dedupedLearnedRules.values()) {
            await tx.merchantMappingRule.upsert({
                where: {
                    userId_merchantFingerprint: {
                        userId,
                        merchantFingerprint: rule.merchantFingerprint,
                    },
                },
                create: {
                    userId,
                    categoryId: rule.categoryId,
                    merchantFingerprint: rule.merchantFingerprint,
                    encryptedPayload: rule.encryptedPayload,
                    expenseType: rule.expenseType,
                    useCount: 1,
                    lastLearnedAt: new Date(),
                },
                update: {
                    categoryId: rule.categoryId,
                    encryptedPayload: rule.encryptedPayload,
                    expenseType: rule.expenseType,
                    useCount: { increment: 1 },
                    lastLearnedAt: new Date(),
                },
            });
        }
        return created;
    });
    return res.status(201).json({ count: result.count });
};
exports.importExpensesBatch = importExpensesBatch;
const listMerchantMappingRules = async (req, res) => {
    const userId = req.userId;
    const rows = await prisma_1.prisma.merchantMappingRule.findMany({
        where: { userId },
        orderBy: [{ useCount: "desc" }, { updatedAt: "desc" }],
        include: {
            category: {
                select: { id: true, name: true, nameKey: true, expenseType: true },
            },
        },
    });
    res.json({
        rows: rows.map((row) => ({
            id: row.id,
            merchantFingerprint: row.merchantFingerprint,
            categoryId: row.categoryId,
            encryptedPayload: row.encryptedPayload,
            expenseType: row.expenseType,
            useCount: row.useCount,
            lastLearnedAt: row.lastLearnedAt,
            category: row.category,
        })),
    });
};
exports.listMerchantMappingRules = listMerchantMappingRules;
const upsertMerchantMappingRule = async (req, res) => {
    const userId = req.userId;
    let rule;
    try {
        rule = parseLearnedRuleInput(req.body, 0);
    }
    catch (err) {
        return res.status(400).json({ error: err?.message ?? "Invalid rule" });
    }
    const category = await prisma_1.prisma.category.findFirst({
        where: { id: rule.categoryId, userId },
        select: { id: true, name: true, nameKey: true, expenseType: true },
    });
    if (!category)
        return res.status(403).json({ error: "Invalid categoryId for this user" });
    const row = await prisma_1.prisma.merchantMappingRule.upsert({
        where: {
            userId_merchantFingerprint: {
                userId,
                merchantFingerprint: rule.merchantFingerprint,
            },
        },
        create: {
            userId,
            categoryId: rule.categoryId,
            merchantFingerprint: rule.merchantFingerprint,
            encryptedPayload: rule.encryptedPayload,
            expenseType: rule.expenseType ?? category.expenseType,
            useCount: 1,
            lastLearnedAt: new Date(),
        },
        update: {
            categoryId: rule.categoryId,
            encryptedPayload: rule.encryptedPayload,
            expenseType: rule.expenseType ?? category.expenseType,
            useCount: { increment: 1 },
            lastLearnedAt: new Date(),
        },
        include: {
            category: {
                select: { id: true, name: true, nameKey: true, expenseType: true },
            },
        },
    });
    res.json({
        id: row.id,
        merchantFingerprint: row.merchantFingerprint,
        categoryId: row.categoryId,
        encryptedPayload: row.encryptedPayload,
        expenseType: row.expenseType,
        useCount: row.useCount,
        lastLearnedAt: row.lastLearnedAt,
        category: row.category,
    });
};
exports.upsertMerchantMappingRule = upsertMerchantMappingRule;
function parseYear(query) {
    const year = Number(query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
        return null;
    return year;
}
/** GET /expenses?year=YYYY - returns all expenses for the year, grouped by month (byMonth[0]=Jan, .. byMonth[11]=Dec). */
const listExpensesByYear = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query);
    if (year == null) {
        return res.status(400).json({ error: "Provide ?year=YYYY" });
    }
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, 12, 1, 0, 0, 0));
    const expenses = await prisma_1.prisma.expense.findMany({
        where: { userId, date: { gte: start, lt: end } },
        orderBy: [
            { expenseType: "asc" },
            { category: { name: "asc" } },
            { description: "asc" },
        ],
        include: {
            category: { select: { id: true, name: true, nameKey: true, expenseType: true } },
            currency: true,
        },
    });
    const byMonth = Array.from({ length: 12 }, () => []);
    for (const e of expenses) {
        const m = e.date.getUTCMonth();
        if (m >= 0 && m < 12)
            byMonth[m].push(e);
    }
    res.json({ byMonth });
};
exports.listExpensesByYear = listExpensesByYear;
const listExpensesByMonth = async (req, res) => {
    const userId = req.userId;
    const ym = parseYearMonth(req.query);
    if (!ym) {
        return res.status(400).json({ error: "Provide ?year=YYYY&month=M" });
    }
    const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));
    const expenses = await prisma_1.prisma.expense.findMany({
        where: { userId, date: { gte: start, lt: end } },
        orderBy: [
            { expenseType: "asc" },
            { category: { name: "asc" } },
            { description: "asc" },
        ],
        include: {
            category: { select: { id: true, name: true, nameKey: true, expenseType: true } },
            currency: true,
        },
    });
    res.json(expenses);
};
exports.listExpensesByMonth = listExpensesByMonth;
const expensesPageData = async (req, res) => {
    const userId = req.userId;
    const ym = parseYearMonth(req.query);
    if (!ym) {
        return res.status(400).json({ error: "Provide ?year=YYYY&month=M" });
    }
    const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));
    const [categories, expenses, rawPlannedRows, monthCloses] = await Promise.all([
        prisma_1.prisma.category.findMany({
            where: { userId },
            orderBy: { name: "asc" },
            select: { id: true, name: true, expenseType: true, nameKey: true },
        }),
        prisma_1.prisma.expense.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: [
                { expenseType: "asc" },
                { category: { name: "asc" } },
                { description: "asc" },
            ],
            include: {
                category: { select: { id: true, name: true, nameKey: true, expenseType: true } },
                currency: true,
            },
        }),
        prisma_1.prisma.plannedExpense.findMany({
            where: {
                userId,
                year: ym.year,
                month: ym.month,
                OR: [{ templateId: null }, { template: { showInExpenses: true } }],
            },
            orderBy: [
                { expenseType: "asc" },
                { category: { name: "asc" } },
                { description: "asc" },
            ],
            include: {
                category: { select: { id: true, name: true, nameKey: true, expenseType: true } },
                template: { select: { defaultCurrencyId: true } },
            },
        }),
        prisma_1.prisma.monthClose.findMany({
            where: { userId, year: ym.year },
            orderBy: { month: "asc" },
            select: { year: true, month: true, isClosed: true },
        }),
    ]);
    const plannedRows = await (0, plannedVisibility_1.filterVisiblePlannedRows)(userId, rawPlannedRows);
    res.json({
        year: ym.year,
        month: ym.month,
        categories,
        expenses,
        planned: { rows: plannedRows },
        monthCloses: { year: ym.year, rows: monthCloses },
    });
};
exports.expensesPageData = expensesPageData;
const expensesSummary = async (req, res) => {
    const userId = req.userId;
    const ym = parseYearMonth(req.query);
    if (!ym) {
        return res.status(400).json({ error: "Provide ?year=YYYY&month=M" });
    }
    const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));
    const grouped = await prisma_1.prisma.expense.groupBy({
        by: ["categoryId"],
        where: { userId, date: { gte: start, lt: end } },
        _sum: { amountUsd: true },
    });
    const categoryIds = [...new Set(grouped.map((g) => g.categoryId))];
    const categories = await prisma_1.prisma.category.findMany({
        where: { id: { in: categoryIds }, userId },
        select: { id: true, name: true, nameKey: true, expenseType: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const result = grouped.map((g) => {
        const cat = categoryMap.get(g.categoryId);
        return {
            categoryId: g.categoryId,
            categoryName: cat?.name ?? "(unknown)",
            nameKey: cat?.nameKey ?? null,
            expenseType: cat?.expenseType ?? null,
            currencyId: "USD",
            total: g._sum.amountUsd ?? 0,
        };
    });
    res.json({
        year: ym.year,
        month: ym.month,
        totalsByCategoryAndCurrency: result,
    });
};
exports.expensesSummary = expensesSummary;
const updateExpense = async (req, res) => {
    const userId = req.userId;
    const id = paramId(req.params);
    const existing = await prisma_1.prisma.expense.findFirst({ where: { id, userId } });
    if (!existing)
        return res.status(404).json({ error: "Expense not found" });
    const { description, amount, date, categoryId, currencyId, usdUyuRate, encryptedPayload } = req.body ?? {};
    const data = {};
    const hasEncryptedPayload = typeof encryptedPayload === "string" && encryptedPayload.length > 0;
    if (description !== undefined) {
        if (typeof description !== "string") {
            return res.status(400).json({ error: "description must be a string" });
        }
        const trimmed = description.trim();
        if (!hasEncryptedPayload && !trimmed) {
            return res.status(400).json({ error: "description must be a non-empty string" });
        }
        data.description = trimmed || "(encrypted)";
    }
    if (amount !== undefined) {
        if (typeof amount !== "number" || !Number.isFinite(amount)) {
            return res.status(400).json({ error: "amount must be a number" });
        }
        if (!hasEncryptedPayload && amount === 0) {
            return res.status(400).json({ error: "amount must be a non-zero number" });
        }
        data.amount = hasEncryptedPayload ? 0 : amount;
    }
    if (date !== undefined) {
        const monthDate = normalizeToMonthStartUTC(date);
        if (!monthDate)
            return res.status(400).json({ error: "date must be YYYY-MM or an ISO date string" });
        data.date = monthDate;
    }
    if (categoryId !== undefined) {
        if (typeof categoryId !== "string")
            return res.status(400).json({ error: "categoryId must be a string" });
        const category = await prisma_1.prisma.category.findFirst({ where: { id: categoryId, userId } });
        if (!category)
            return res.status(403).json({ error: "Invalid categoryId for this user" });
        data.categoryId = categoryId;
        data.expenseType = category.expenseType;
    }
    if (currencyId !== undefined) {
        if (typeof currencyId !== "string")
            return res.status(400).json({ error: "currencyId must be a string" });
        const currency = await prisma_1.prisma.currency.findUnique({ where: { id: currencyId } });
        if (!currency)
            return res.status(400).json({ error: "Invalid currencyId" });
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
    if (encryptedPayload !== undefined) {
        data.encryptedPayload = typeof encryptedPayload === "string" ? (encryptedPayload || null) : null;
    }
    // Recalcular amountUsd si cambia amount o currency o usdUyuRate (no cuando viene encryptedPayload con amount 0)
    const updatingWithEncrypted = hasEncryptedPayload && amount !== undefined && amount === 0;
    if (updatingWithEncrypted) {
        data.amountUsd = 0;
        if (usdUyuRate !== undefined)
            data.usdUyuRate = usdUyuRate;
    }
    else if (amount !== undefined || currencyId !== undefined || usdUyuRate !== undefined) {
        const finalAmount = amount !== undefined ? (hasEncryptedPayload ? 0 : amount) : existing.amount;
        const finalCurrencyId = currencyId !== undefined ? currencyId : existing.currencyId;
        const finalUsdUyuRate = usdUyuRate !== undefined
            ? usdUyuRate
            : (existing.usdUyuRate ?? undefined);
        try {
            const fx = (0, fx_1.toUsd)({
                amount: finalAmount,
                currencyId: finalCurrencyId,
                usdUyuRate: finalUsdUyuRate ?? undefined,
            });
            data.amountUsd = fx.amountUsd;
            data.usdUyuRate = fx.usdUyuRate;
        }
        catch (e) {
            return res.status(400).json({ error: e?.message ?? "Invalid FX rate" });
        }
    }
    const updated = await prisma_1.prisma.expense.update({
        where: { id },
        data,
        include: { category: true, currency: true },
    });
    res.json(updated);
};
exports.updateExpense = updateExpense;
const deleteExpense = async (req, res) => {
    const userId = req.userId;
    const id = paramId(req.params);
    const existing = await prisma_1.prisma.expense.findFirst({ where: { id, userId } });
    if (!existing)
        return res.status(404).json({ error: "Expense not found" });
    await prisma_1.prisma.expense.delete({ where: { id } });
    res.status(204).send();
};
exports.deleteExpense = deleteExpense;
