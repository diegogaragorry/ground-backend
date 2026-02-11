"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteExpense = exports.updateExpense = exports.expensesSummary = exports.listExpensesByMonth = exports.createExpense = void 0;
const prisma_1 = require("../lib/prisma");
const fx_1 = require("../utils/fx");
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
const createExpense = async (req, res) => {
    const userId = req.userId;
    const { description, amount, date, categoryId, currencyId, usdUyuRate, expenseType: bodyExpenseType } = req.body ?? {};
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
    const category = await prisma_1.prisma.category.findFirst({
        where: { id: categoryId, userId },
    });
    if (!category)
        return res.status(403).json({ error: "Invalid categoryId for this user" });
    // Validar moneda existe
    const currency = await prisma_1.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency)
        return res.status(400).json({ error: "Invalid currencyId" });
    // FX
    let fx;
    try {
        fx = (0, fx_1.toUsd)({ amount, currencyId, usdUyuRate });
    }
    catch (e) {
        return res.status(400).json({ error: e?.message ?? "Invalid FX rate" });
    }
    const expenseType = bodyExpenseType === "FIXED" || bodyExpenseType === "VARIABLE"
        ? bodyExpenseType
        : (category?.expenseType ?? "VARIABLE");
    const expense = await prisma_1.prisma.expense.create({
        data: {
            userId,
            categoryId,
            currencyId,
            description,
            amount,
            amountUsd: fx.amountUsd,
            usdUyuRate: fx.usdUyuRate,
            date: monthDate,
            expenseType,
        },
        include: { category: true, currency: true },
    });
    return res.status(201).json(expense);
};
exports.createExpense = createExpense;
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
        orderBy: { date: "desc" },
        include: {
            category: { select: { id: true, name: true, nameKey: true, expenseType: true } },
            currency: true,
        },
    });
    res.json(expenses);
};
exports.listExpensesByMonth = listExpensesByMonth;
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
    const { description, amount, date, categoryId, currencyId, usdUyuRate } = req.body ?? {};
    const data = {};
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
    // Recalcular amountUsd si cambia amount o currency o usdUyuRate
    if (amount !== undefined || currencyId !== undefined || usdUyuRate !== undefined) {
        const finalAmount = amount !== undefined ? amount : existing.amount;
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
