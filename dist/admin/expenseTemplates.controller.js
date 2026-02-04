"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteExpenseTemplate = exports.updateExpenseTemplate = exports.createExpenseTemplate = exports.listExpenseTemplates = void 0;
const prisma_1 = require("../lib/prisma");
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
    // Mes cerrado = existe MonthClose para ese year+month
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
async function ensurePlannedForTemplate(userId, year, template) {
    const monthsOpen = await openMonthsForYear(userId, year);
    // crea los que faltan (no pisa ediciones manuales)
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
        },
    })));
}
async function syncPlannedAfterTemplateUpdate(userId, year, template) {
    const monthsOpen = await openMonthsForYear(userId, year);
    // a) crear los que falten
    await ensurePlannedForTemplate(userId, year, template);
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
// POST /admin/expenseTemplates
// Opción A: expenseType lo define Category.expenseType
const createExpenseTemplate = async (req, res) => {
    const userId = req.userId;
    const categoryId = String(req.body?.categoryId ?? "");
    const description = String(req.body?.description ?? "").trim();
    const defaultAmountUsd = parseAmountUsd(req.body?.defaultAmountUsd);
    if (!categoryId)
        return res.status(400).json({ error: "categoryId is required" });
    if (!description)
        return res.status(400).json({ error: "description is required" });
    // category debe ser del user (y de ahí viene el type)
    const cat = await prisma_1.prisma.category.findFirst({
        where: { id: categoryId, userId },
        select: { id: true, expenseType: true },
    });
    if (!cat)
        return res.status(403).json({ error: "Invalid categoryId for this user" });
    const year = serverYear();
    try {
        const created = await prisma_1.prisma.expenseTemplate.create({
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
    }
    catch (e) {
        const msg = String(e?.message ?? "");
        if (msg.toLowerCase().includes("unique")) {
            return res.status(409).json({ error: "Template already exists (unique constraint)" });
        }
        return res.status(500).json({ error: "Error creating template" });
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
        select: { id: true, categoryId: true, expenseType: true },
    });
    if (!existing)
        return res.status(404).json({ error: "Template not found" });
    const patch = {};
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
        patch.expenseType = cat.expenseType; // ✅ keep in sync with category
    }
    // description
    if (req.body?.description != null) {
        const d = String(req.body.description ?? "").trim();
        if (!d)
            return res.status(400).json({ error: "description is required" });
        patch.description = d;
    }
    // defaultAmountUsd (nullable)
    if (req.body?.defaultAmountUsd !== undefined) {
        patch.defaultAmountUsd = parseAmountUsd(req.body.defaultAmountUsd);
    }
    const year = serverYear();
    try {
        const updated = await prisma_1.prisma.expenseTemplate.update({
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
