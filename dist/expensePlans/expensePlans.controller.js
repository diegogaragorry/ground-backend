"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listExpensePlans = exports.upsertExpensePlan = void 0;
const prisma_1 = require("../lib/prisma");
function parseYearMonthAmount(body) {
    const year = Number(body.year);
    const month = Number(body.month);
    const amountUsd = Number(body.amountUsd);
    if (!Number.isInteger(year))
        return null;
    if (!Number.isInteger(month) || month < 1 || month > 12)
        return null;
    if (!Number.isFinite(amountUsd) || amountUsd < 0)
        return null;
    return { year, month, amountUsd };
}
const upsertExpensePlan = async (req, res) => {
    const userId = req.userId;
    const parsed = parseYearMonthAmount(req.body ?? {});
    if (!parsed) {
        return res.status(400).json({ error: "year, month (1-12) and amountUsd >= 0 are required" });
    }
    const { year, month, amountUsd } = parsed;
    const row = await prisma_1.prisma.expensePlan.upsert({
        where: { userId_year_month: { userId, year, month } },
        update: { amountUsd },
        create: { userId, year, month, amountUsd },
    });
    res.json(row);
};
exports.upsertExpensePlan = upsertExpensePlan;
const listExpensePlans = async (req, res) => {
    const userId = req.userId;
    const year = Number(req.query.year);
    if (!Number.isInteger(year)) {
        return res.status(400).json({ error: "year is required" });
    }
    const rows = await prisma_1.prisma.expensePlan.findMany({
        where: { userId, year },
        orderBy: { month: "asc" },
    });
    res.json({ year, rows });
};
exports.listExpensePlans = listExpensePlans;
