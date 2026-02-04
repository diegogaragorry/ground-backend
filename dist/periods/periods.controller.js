"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openPeriod = exports.closePeriod = exports.upsertPeriod = exports.listPeriods = void 0;
const prisma_1 = require("../lib/prisma");
/**
 * Cierre mensual:
 * - si isClosed=true, el mes queda “fijo” con finales guardados
 * - si isClosed=false, todo se calcula dinámico
 */
function parseYear(query) {
    const year = Number(query.year);
    if (!Number.isInteger(year))
        return null;
    return year;
}
function parseYearMonthParams(params) {
    const year = Number(params.year);
    const month = Number(params.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
        return null;
    return { year, month };
}
function monthRangeUtc(year, month) {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    return { start, end };
}
async function computeMonthTotalsUsd(userId, year, month) {
    const { start, end } = monthRangeUtc(year, month);
    const incAgg = await prisma_1.prisma.income.aggregate({
        where: { userId, year, month },
        _sum: { amountUsd: true },
    });
    const expAgg = await prisma_1.prisma.expense.aggregate({
        where: { userId, date: { gte: start, lt: end } },
        _sum: { amountUsd: true },
    });
    // Net worth “simple”: sum snapshots capitalUsd del mes (si tu /networth proyecta, lo ideal es replicar esa lógica acá)
    // Para no romper nada, usamos snapshots reales.
    const invAgg = await prisma_1.prisma.investmentSnapshot.aggregate({
        where: {
            year,
            month,
            investment: { userId },
        },
        _sum: { capitalUsd: true },
    });
    const incomeUsd = incAgg._sum.amountUsd ?? 0;
    const expensesUsd = expAgg._sum.amountUsd ?? 0;
    const netWorthUsd = invAgg._sum.capitalUsd ?? 0;
    // earnings: delta vs mes anterior (si no hay, 0)
    let prevNetWorthUsd = 0;
    if (month > 1) {
        const prevAgg = await prisma_1.prisma.investmentSnapshot.aggregate({
            where: {
                year,
                month: month - 1,
                investment: { userId },
            },
            _sum: { capitalUsd: true },
        });
        prevNetWorthUsd = prevAgg._sum.capitalUsd ?? 0;
    }
    const investmentEarningsUsd = month > 1 ? (netWorthUsd - prevNetWorthUsd) : 0;
    const balanceUsd = incomeUsd - expensesUsd + investmentEarningsUsd;
    return { incomeUsd, expensesUsd, netWorthUsd, investmentEarningsUsd, balanceUsd };
}
const listPeriods = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query);
    if (!year)
        return res.status(400).json({ error: "Provide year (?year=2026)" });
    const list = await prisma_1.prisma.period.findMany({
        where: { userId, year },
        orderBy: { month: "asc" },
    });
    res.json({ year, periods: list });
};
exports.listPeriods = listPeriods;
const upsertPeriod = async (req, res) => {
    const userId = req.userId;
    const ym = parseYearMonthParams(req.params);
    if (!ym)
        return res.status(400).json({ error: "Invalid year/month" });
    const { isClosed } = req.body ?? {};
    const row = await prisma_1.prisma.period.upsert({
        where: { userId_year_month: { userId, year: ym.year, month: ym.month } },
        update: { isClosed: Boolean(isClosed) },
        create: { userId, year: ym.year, month: ym.month, isClosed: Boolean(isClosed) },
    });
    res.json(row);
};
exports.upsertPeriod = upsertPeriod;
const closePeriod = async (req, res) => {
    const userId = req.userId;
    const ym = parseYearMonthParams(req.params);
    if (!ym)
        return res.status(400).json({ error: "Invalid year/month" });
    const totals = await computeMonthTotalsUsd(userId, ym.year, ym.month);
    const row = await prisma_1.prisma.period.upsert({
        where: { userId_year_month: { userId, year: ym.year, month: ym.month } },
        update: {
            isClosed: true,
            closedAt: new Date(),
            finalIncomeUsd: totals.incomeUsd,
            finalExpensesUsd: totals.expensesUsd,
            finalInvEarnUsd: totals.investmentEarningsUsd,
            finalBalanceUsd: totals.balanceUsd,
        },
        create: {
            userId,
            year: ym.year,
            month: ym.month,
            isClosed: true,
            closedAt: new Date(),
            finalIncomeUsd: totals.incomeUsd,
            finalExpensesUsd: totals.expensesUsd,
            finalInvEarnUsd: totals.investmentEarningsUsd,
            finalBalanceUsd: totals.balanceUsd,
        },
    });
    res.json(row);
};
exports.closePeriod = closePeriod;
const openPeriod = async (req, res) => {
    const userId = req.userId;
    const ym = parseYearMonthParams(req.params);
    if (!ym)
        return res.status(400).json({ error: "Invalid year/month" });
    const row = await prisma_1.prisma.period.upsert({
        where: { userId_year_month: { userId, year: ym.year, month: ym.month } },
        update: {
            isClosed: false,
            closedAt: null,
            finalIncomeUsd: null,
            finalExpensesUsd: null,
            finalInvEarnUsd: null,
            finalBalanceUsd: null,
        },
        create: { userId, year: ym.year, month: ym.month, isClosed: false },
    });
    res.json(row);
};
exports.openPeriod = openPeriod;
