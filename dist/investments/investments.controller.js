"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteInvestment = exports.updateInvestmentConfig = exports.createInvestment = exports.listInvestments = void 0;
const prisma_1 = require("../lib/prisma");
function parseType(v) {
    const s = String(v ?? "").trim().toUpperCase();
    if (s === "PORTFOLIO")
        return "PORTFOLIO";
    if (s === "ACCOUNT")
        return "ACCOUNT";
    return null;
}
function parseMonth(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 12)
        return null;
    return n;
}
const listInvestments = async (req, res) => {
    const userId = req.userId;
    const list = await prisma_1.prisma.investment.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
    });
    res.json(list);
};
exports.listInvestments = listInvestments;
const createInvestment = async (req, res) => {
    const userId = req.userId;
    const { name, type, currencyId, targetAnnualReturn, yieldStartYear, yieldStartMonth } = req.body ?? {};
    const nm = String(name ?? "").trim();
    if (!nm)
        return res.status(400).json({ error: "name is required" });
    const tp = parseType(type);
    if (!tp)
        return res.status(400).json({ error: "type must be PORTFOLIO or ACCOUNT" });
    if (!currencyId || typeof currencyId !== "string") {
        return res.status(400).json({ error: "currencyId is required (USD/UYU)" });
    }
    const currency = await prisma_1.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency)
        return res.status(400).json({ error: "Invalid currencyId" });
    const tar = targetAnnualReturn == null ? 0 : Number(targetAnnualReturn);
    if (!Number.isFinite(tar) || tar < 0) {
        return res.status(400).json({ error: "targetAnnualReturn must be >= 0" });
    }
    const now = new Date();
    const y = Number.isInteger(yieldStartYear) ? Number(yieldStartYear) : now.getUTCFullYear();
    const m = yieldStartMonth === undefined || yieldStartMonth === null
        ? 1
        : parseMonth(yieldStartMonth);
    if (m == null)
        return res.status(400).json({ error: "yieldStartMonth must be 1..12" });
    const inv = await prisma_1.prisma.investment.create({
        data: {
            userId,
            name: nm,
            type: tp,
            currencyId,
            targetAnnualReturn: tar,
            yieldStartYear: y,
            yieldStartMonth: m,
        },
    });
    res.status(201).json(inv);
};
exports.createInvestment = createInvestment;
const updateInvestmentConfig = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    const existing = await prisma_1.prisma.investment.findFirst({ where: { id, userId } });
    if (!existing)
        return res.status(404).json({ error: "Investment not found" });
    const { currencyId, targetAnnualReturn, yieldStartYear, yieldStartMonth, name, type } = req.body ?? {};
    const data = {};
    if (name !== undefined) {
        const nm = String(name ?? "").trim();
        if (!nm)
            return res.status(400).json({ error: "name must be non-empty" });
        data.name = nm;
    }
    if (type !== undefined) {
        const tp = parseType(type);
        if (!tp)
            return res.status(400).json({ error: "type must be PORTFOLIO or ACCOUNT" });
        data.type = tp;
    }
    if (currencyId !== undefined) {
        if (typeof currencyId !== "string" || !currencyId.trim()) {
            return res.status(400).json({ error: "currencyId must be a non-empty string" });
        }
        const currency = await prisma_1.prisma.currency.findUnique({ where: { id: currencyId } });
        if (!currency)
            return res.status(400).json({ error: "Invalid currencyId" });
        data.currencyId = currencyId;
    }
    if (targetAnnualReturn !== undefined) {
        const tar = Number(targetAnnualReturn);
        if (!Number.isFinite(tar) || tar < 0) {
            return res.status(400).json({ error: "targetAnnualReturn must be >= 0" });
        }
        data.targetAnnualReturn = tar;
    }
    if (yieldStartYear !== undefined) {
        if (!Number.isInteger(yieldStartYear)) {
            return res.status(400).json({ error: "yieldStartYear must be an integer" });
        }
        data.yieldStartYear = yieldStartYear;
    }
    if (yieldStartMonth !== undefined) {
        const m = parseMonth(yieldStartMonth);
        if (m == null)
            return res.status(400).json({ error: "yieldStartMonth must be 1..12" });
        data.yieldStartMonth = m;
    }
    const updated = await prisma_1.prisma.investment.update({ where: { id }, data });
    res.json(updated);
};
exports.updateInvestmentConfig = updateInvestmentConfig;
const deleteInvestment = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    const investment = await prisma_1.prisma.investment.findFirst({ where: { id, userId } });
    if (!investment)
        return res.status(404).json({ error: "Investment not found" });
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.investmentMovement.deleteMany({ where: { investmentId: id } });
        await tx.investmentSnapshot.deleteMany({ where: { investmentId: id } });
        await tx.investment.delete({ where: { id } });
    });
    return res.status(204).send();
};
exports.deleteInvestment = deleteInvestment;
