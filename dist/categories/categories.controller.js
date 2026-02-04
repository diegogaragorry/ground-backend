"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCategory = exports.updateCategory = exports.createCategory = exports.listCategories = void 0;
const prisma_1 = require("../lib/prisma");
function parseExpenseType(v) {
    if (v === "FIXED")
        return "FIXED";
    if (v === "VARIABLE")
        return "VARIABLE";
    return null;
}
function serverYear() {
    return new Date().getUTCFullYear();
}
function paramId(params) {
    const v = params.id;
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
async function openMonthsForYear(userId, year) {
    const closes = await prisma_1.prisma.monthClose.findMany({
        where: { userId, year },
        select: { month: true },
    });
    const closed = new Set(closes.map((c) => c.month));
    const out = [];
    for (let m = 1; m <= 12; m++)
        if (!closed.has(m))
            out.push(m);
    return out;
}
const listCategories = async (req, res) => {
    const userId = req.userId;
    const categories = await prisma_1.prisma.category.findMany({
        where: { userId },
        orderBy: { name: "asc" },
    });
    res.json(categories);
};
exports.listCategories = listCategories;
const createCategory = async (req, res) => {
    const userId = req.userId;
    const { name } = req.body ?? {};
    if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" });
    }
    const et = req.body?.expenseType != null ? parseExpenseType(req.body.expenseType) : null;
    if (req.body?.expenseType != null && !et) {
        return res.status(400).json({ error: "expenseType must be FIXED or VARIABLE" });
    }
    const category = await prisma_1.prisma.category.create({
        data: {
            name: name.trim(),
            userId,
            ...(et ? { expenseType: et } : {}),
        },
    });
    res.status(201).json(category);
};
exports.createCategory = createCategory;
const updateCategory = async (req, res) => {
    const userId = req.userId;
    const id = paramId(req.params);
    const nameRaw = req.body?.name;
    const expenseTypeRaw = req.body?.expenseType;
    if (!id)
        return res.status(400).json({ error: "Invalid category id" });
    const existing = await prisma_1.prisma.category.findFirst({ where: { id, userId } });
    if (!existing)
        return res.status(404).json({ error: "Category not found" });
    const patch = {};
    if (nameRaw != null) {
        const name = String(nameRaw ?? "").trim();
        if (!name)
            return res.status(400).json({ error: "name is required" });
        patch.name = name;
    }
    let newExpenseType = null;
    const wantsTypeChange = expenseTypeRaw != null;
    if (wantsTypeChange) {
        const et = parseExpenseType(expenseTypeRaw);
        if (!et)
            return res.status(400).json({ error: "expenseType must be FIXED or VARIABLE" });
        patch.expenseType = et;
        newExpenseType = et;
    }
    // Si no hay nada para actualizar
    if (Object.keys(patch).length === 0) {
        return res.json(existing);
    }
    const updated = await prisma_1.prisma.category.update({
        where: { id },
        data: patch,
    });
    // ✅ Sync al cambiar expenseType (Option A)
    if (wantsTypeChange && newExpenseType && newExpenseType !== existing.expenseType) {
        const year = serverYear();
        const monthsOpen = await openMonthsForYear(userId, year);
        // 1) actualizar templates que usan esta category
        await prisma_1.prisma.expenseTemplate.updateMany({
            where: { userId, categoryId: id },
            data: { expenseType: newExpenseType },
        });
        // 2) actualizar planned (meses abiertos, no confirmados)
        // 2a) los que vienen de templates asociados a esta category
        const templateIds = await prisma_1.prisma.expenseTemplate.findMany({
            where: { userId, categoryId: id },
            select: { id: true },
        });
        const ids = templateIds.map((t) => t.id);
        if (ids.length > 0) {
            await prisma_1.prisma.plannedExpense.updateMany({
                where: {
                    userId,
                    year,
                    month: { in: monthsOpen },
                    isConfirmed: false,
                    templateId: { in: ids },
                },
                data: { expenseType: newExpenseType },
            });
        }
        // 2b) (opcional recomendado) planned manuales sin template, de esa category
        await prisma_1.prisma.plannedExpense.updateMany({
            where: {
                userId,
                year,
                month: { in: monthsOpen },
                isConfirmed: false,
                templateId: null,
                categoryId: id,
            },
            data: { expenseType: newExpenseType },
        });
    }
    res.json(updated);
};
exports.updateCategory = updateCategory;
const deleteCategory = async (req, res) => {
    const userId = req.userId;
    const id = paramId(req.params);
    const category = await prisma_1.prisma.category.findFirst({ where: { id, userId } });
    if (!category)
        return res.status(404).json({ error: "Category not found" });
    try {
        await prisma_1.prisma.category.delete({ where: { id } });
        return res.status(204).send();
    }
    catch {
        return res.status(409).json({ error: "Cannot delete category with expenses linked" });
    }
};
exports.deleteCategory = deleteCategory;
