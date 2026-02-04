"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteInvestmentMovement = exports.updateInvestmentMovement = exports.createInvestmentMovement = exports.listInvestmentMovements = void 0;
const prisma_1 = require("../lib/prisma");
function parseYear(q) {
    const y = Number(q.year);
    return Number.isInteger(y) ? y : null;
}
function parseBody(body) {
    const investmentId = String(body.investmentId ?? "");
    const type = String(body.type ?? "");
    const currencyId = String(body.currencyId ?? "");
    const amount = Number(body.amount);
    const date = String(body.date ?? "");
    if (!investmentId)
        return null;
    if (!["deposit", "withdrawal", "yield"].includes(type))
        return null;
    if (!currencyId)
        return null;
    if (!Number.isFinite(amount) || amount < 0)
        return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime()))
        return null;
    return { investmentId, type, currencyId, amount, date: d };
}
const listInvestmentMovements = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query);
    if (!year)
        return res.status(400).json({ error: "year is required (e.g. ?year=2026)" });
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
    const rows = await prisma_1.prisma.investmentMovement.findMany({
        where: {
            investment: { userId },
            date: { gte: start, lt: end },
        },
        include: {
            investment: { select: { id: true, name: true, type: true } },
            currency: { select: { id: true, name: true } },
        },
        orderBy: [{ date: "asc" }, { investmentId: "asc" }],
    });
    res.json({ year, rows });
};
exports.listInvestmentMovements = listInvestmentMovements;
const createInvestmentMovement = async (req, res) => {
    const userId = req.userId;
    const parsed = parseBody(req.body ?? {});
    if (!parsed) {
        return res.status(400).json({
            error: "investmentId, date, type (deposit|withdrawal|yield), currencyId, amount>=0 are required",
        });
    }
    // validar que la investment sea del user
    const inv = await prisma_1.prisma.investment.findFirst({
        where: { id: parsed.investmentId, userId },
        select: { id: true },
    });
    if (!inv)
        return res.status(403).json({ error: "Invalid investmentId for this user" });
    const row = await prisma_1.prisma.investmentMovement.create({
        data: {
            investmentId: parsed.investmentId,
            date: parsed.date,
            type: parsed.type,
            currencyId: parsed.currencyId,
            amount: parsed.amount,
        },
        include: {
            investment: { select: { id: true, name: true, type: true } },
            currency: { select: { id: true, name: true } },
        },
    });
    res.status(201).json(row);
};
exports.createInvestmentMovement = createInvestmentMovement;
const updateInvestmentMovement = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "id is required" });
    const parsed = parseBody(req.body ?? {});
    if (!parsed) {
        return res.status(400).json({
            error: "investmentId, date, type (deposit|withdrawal|yield), currencyId, amount>=0 are required",
        });
    }
    // validar ownership del movimiento por la inversión
    const existing = await prisma_1.prisma.investmentMovement.findFirst({
        where: { id, investment: { userId } },
        select: { id: true },
    });
    if (!existing)
        return res.status(404).json({ error: "Movement not found" });
    // validar que la investment destino sea del user
    const inv = await prisma_1.prisma.investment.findFirst({
        where: { id: parsed.investmentId, userId },
        select: { id: true },
    });
    if (!inv)
        return res.status(403).json({ error: "Invalid investmentId for this user" });
    const row = await prisma_1.prisma.investmentMovement.update({
        where: { id },
        data: {
            investmentId: parsed.investmentId,
            date: parsed.date,
            type: parsed.type,
            currencyId: parsed.currencyId,
            amount: parsed.amount,
        },
        include: {
            investment: { select: { id: true, name: true, type: true } },
            currency: { select: { id: true, name: true } },
        },
    });
    res.json(row);
};
exports.updateInvestmentMovement = updateInvestmentMovement;
const deleteInvestmentMovement = async (req, res) => {
    const userId = req.userId;
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "id is required" });
    const existing = await prisma_1.prisma.investmentMovement.findFirst({
        where: { id, investment: { userId } },
        select: { id: true },
    });
    if (!existing)
        return res.status(404).json({ error: "Movement not found" });
    await prisma_1.prisma.investmentMovement.delete({ where: { id } });
    res.status(204).send();
};
exports.deleteInvestmentMovement = deleteInvestmentMovement;
