"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listIncome = exports.upsertIncome = void 0;
const prisma_1 = require("../lib/prisma");
function parseYearMonth(body) {
    const year = Number(body.year);
    const month = Number(body.month);
    const amountUsd = Number(body.amountUsd);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
        return null;
    if (!Number.isFinite(amountUsd) || amountUsd < 0)
        return null;
    return { year, month, amountUsd };
}
const upsertIncome = async (req, res) => {
    const userId = req.userId;
    const parsed = parseYearMonth(req.body ?? {});
    if (!parsed)
        return res.status(400).json({ error: "year, month (1-12) and amountUsd >= 0 are required" });
    const { year, month, amountUsd } = parsed;
    const row = await prisma_1.prisma.income.upsert({
        where: { userId_year_month: { userId, year, month } },
        update: { amountUsd },
        create: { userId, year, month, amountUsd },
    });
    res.json(row);
};
exports.upsertIncome = upsertIncome;
const listIncome = async (req, res) => {
    const userId = req.userId;
    const year = Number(req.query.year);
    if (!Number.isInteger(year))
        return res.status(400).json({ error: "year is required" });
    const rows = await prisma_1.prisma.income.findMany({
        where: { userId, year },
        orderBy: { month: "asc" },
    });
    res.json({ year, rows });
};
exports.listIncome = listIncome;
