"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reopenMonth = exports.closeMonth = exports.listMonthCloses = void 0;
const prisma_1 = require("../lib/prisma");
// helpers
function parseYear(q) {
    const y = Number(q.year);
    return Number.isInteger(y) ? y : null;
}
function parseYearMonth(body) {
    const year = Number(body.year);
    const month = Number(body.month);
    if (!Number.isInteger(year))
        return null;
    if (!Number.isInteger(month) || month < 1 || month > 12)
        return null;
    return { year, month };
}
const months12 = Array.from({ length: 12 }, (_, i) => i + 1);
function monthlyFactor(tar) {
    return 1 + Number(tar ?? 0) / 12;
}
function yieldStartMonthForYear(inv, y) {
    if (inv.yieldStartYear != null && inv.yieldStartYear > y)
        return 13;
    if (inv.yieldStartYear != null && inv.yieldStartYear === y)
        return inv.yieldStartMonth ?? 1;
    return 1;
}
async function getUsdUyuRateForMonthOrDefault(userId, year, month) {
    // buscamos algún usdUyuRate de gastos del mes (último por fecha). Si no hay, fallback.
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const last = await prisma_1.prisma.expense.findFirst({
        where: { userId, date: { gte: start, lt: end }, usdUyuRate: { not: null } },
        orderBy: { date: "desc" },
        select: { usdUyuRate: true },
    });
    const fallback = Number(process.env.DEFAULT_USD_UYU_RATE ?? 38);
    const v = Number(last?.usdUyuRate ?? fallback);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}
function buildInvMonthMap(invId, rows) {
    const m = new Map();
    for (const r of rows) {
        if (r.investmentId !== invId)
            continue;
        m.set(r.month, { capital: r.capital ?? null, capitalUsd: r.capitalUsd ?? null });
    }
    return m;
}
async function computeNetWorthSeriesUsd(userId, year) {
    // Traemos TODO: portfolio + accounts (para total net worth)
    const invs = await prisma_1.prisma.investment.findMany({
        where: { userId },
        select: {
            id: true,
            type: true, // PORTFOLIO | ACCOUNT
            currencyId: true, // USD | UYU | null
            targetAnnualReturn: true,
            yieldStartYear: true,
            yieldStartMonth: true,
        },
    });
    const snaps = await prisma_1.prisma.investmentSnapshot.findMany({
        where: { investment: { userId }, year },
        select: { investmentId: true, month: true, capital: true, capitalUsd: true },
    });
    // Para convertir UYU->USD cuando capitalUsd falte
    const fxByMonth = new Map();
    for (const m of months12) {
        // eslint-disable-next-line no-await-in-loop
        fxByMonth.set(m, await getUsdUyuRateForMonthOrDefault(userId, year, m));
    }
    function snapUsdFor(inv, snap, m) {
        if (snap.capitalUsd != null)
            return snap.capitalUsd;
        if (snap.capital == null)
            return null;
        const cur = (inv.currencyId ?? "USD").toUpperCase();
        if (cur === "USD")
            return snap.capital;
        if (cur === "UYU") {
            const fx = fxByMonth.get(m) ?? 38;
            return fx > 0 ? snap.capital / fx : 0;
        }
        // moneda desconocida: asumimos USD (mejor que 0 silencioso)
        return snap.capital;
    }
    function capitalUsdPortfolio(inv, byM, m) {
        const directSnap = byM.get(m);
        if (directSnap) {
            const directUsd = snapUsdFor(inv, directSnap, m);
            if (directUsd != null)
                return directUsd;
        }
        // buscar base anterior con valor en USD
        let baseMonth = null;
        let baseUsd = null;
        for (let i = m - 1; i >= 1; i--) {
            const s = byM.get(i);
            if (!s)
                continue;
            const usd = snapUsdFor(inv, s, i);
            if (usd != null) {
                baseMonth = i;
                baseUsd = usd;
                break;
            }
        }
        if (baseMonth == null || baseUsd == null)
            return 0;
        const startM = Math.max(yieldStartMonthForYear(inv, year), baseMonth);
        const diff = m - startM;
        if (diff <= 0)
            return baseUsd;
        return baseUsd * Math.pow(monthlyFactor(inv.targetAnnualReturn ?? 0), diff);
    }
    function capitalUsdAccount(inv, byM, m) {
        const directSnap = byM.get(m);
        if (directSnap) {
            const directUsd = snapUsdFor(inv, directSnap, m);
            if (directUsd != null)
                return directUsd;
        }
        for (let i = m - 1; i >= 1; i--) {
            const s = byM.get(i);
            if (!s)
                continue;
            const usd = snapUsdFor(inv, s, i);
            if (usd != null)
                return usd;
        }
        return 0;
    }
    const portfolio = invs.filter((x) => x.type === "PORTFOLIO");
    const accounts = invs.filter((x) => x.type === "ACCOUNT");
    const portfolioNW = months12.map((m) => portfolio.reduce((acc, inv) => {
        const byM = buildInvMonthMap(inv.id, snaps);
        return acc + capitalUsdPortfolio(inv, byM, m);
    }, 0));
    const accountsNW = months12.map((m) => accounts.reduce((acc, inv) => {
        const byM = buildInvMonthMap(inv.id, snaps);
        return acc + capitalUsdAccount(inv, byM, m);
    }, 0));
    const totalNW = months12.map((_, i) => (portfolioNW[i] ?? 0) + (accountsNW[i] ?? 0));
    // Proyección para variación de Diciembre (solo portfolio, igual que en UI)
    const projectedNextJanPortfolio = portfolio.reduce((acc, inv) => {
        const byM = buildInvMonthMap(inv.id, snaps);
        const dec = capitalUsdPortfolio(inv, byM, 12);
        return acc + dec * monthlyFactor(inv.targetAnnualReturn ?? 0);
    }, 0);
    const portfolioVariation = months12.map((m, i) => {
        if (m < 12)
            return (portfolioNW[i + 1] ?? 0) - (portfolioNW[i] ?? 0);
        return projectedNextJanPortfolio - (portfolioNW[11] ?? 0);
    });
    return { totalNW, portfolioNW, portfolioVariation };
}
const listMonthCloses = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query);
    if (!year)
        return res.status(400).json({ error: "year is required (e.g. ?year=2026)" });
    const rows = await prisma_1.prisma.monthClose.findMany({
        where: { userId, year },
        orderBy: { month: "asc" },
    });
    res.json({ year, rows });
};
exports.listMonthCloses = listMonthCloses;
// cierra un mes: guarda snapshot "lockeado" del budget para ese mes
const closeMonth = async (req, res) => {
    const userId = req.userId;
    const parsed = parseYearMonth(req.body ?? {});
    if (!parsed)
        return res.status(400).json({ error: "year and month (1-12) are required" });
    const { year, month } = parsed;
    // A) income
    const income = await prisma_1.prisma.income.findUnique({
        where: { userId_year_month: { userId, year, month } },
        select: { amountUsd: true },
    });
    // B) expenses plan override o actual
    const plan = await prisma_1.prisma.expensePlan.findUnique({
        where: { userId_year_month: { userId, year, month } },
        select: { amountUsd: true },
    });
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const expenseRows = await prisma_1.prisma.expense.findMany({
        where: { userId, date: { gte: start, lt: end } },
        select: { amountUsd: true },
    });
    const actualExpenses = expenseRows.reduce((acc, e) => acc + (e.amountUsd ?? 0), 0);
    const incomeUsd = income?.amountUsd ?? 0;
    const expensesUsd = plan?.amountUsd ?? actualExpenses;
    // C) investmentEarningsUsd = REAL RETURNS del PORTFOLIO
    //    netWorthStartUsd = TOTAL (portfolio + accounts) start of month
    const { totalNW, portfolioVariation } = await computeNetWorthSeriesUsd(userId, year);
    const mvRows = await prisma_1.prisma.investmentMovement.findMany({
        where: {
            investment: { userId, type: "PORTFOLIO" },
            date: { gte: start, lt: end },
        },
        select: { type: true, amount: true, currencyId: true },
    });
    // USD only (como tu UI)
    const flowsUsd = mvRows.reduce((acc, r) => {
        if ((r.currencyId ?? "") !== "USD")
            return acc;
        const amt = Number(r.amount ?? 0);
        if (r.type === "deposit")
            return acc + amt;
        if (r.type === "withdrawal")
            return acc - amt;
        return acc;
    }, 0);
    const variation = portfolioVariation[month - 1] ?? 0;
    const investmentEarningsUsd = variation - flowsUsd;
    const balanceUsd = incomeUsd - expensesUsd + investmentEarningsUsd;
    // ✅ TOTAL net worth start (portfolio + accounts)
    const netWorthStartUsd = totalNW[month - 1] ?? 0;
    const row = await prisma_1.prisma.monthClose.upsert({
        where: { userId_year_month: { userId, year, month } },
        update: {
            incomeUsd,
            expensesUsd,
            investmentEarningsUsd,
            balanceUsd,
            netWorthStartUsd,
            closedAt: new Date(),
        },
        create: {
            userId,
            year,
            month,
            incomeUsd,
            expensesUsd,
            investmentEarningsUsd,
            balanceUsd,
            netWorthStartUsd,
        },
    });
    res.status(201).json(row);
};
exports.closeMonth = closeMonth;
const reopenMonth = async (req, res) => {
    const userId = req.userId;
    const parsed = parseYearMonth(req.body ?? {});
    if (!parsed)
        return res.status(400).json({ error: "year and month (1-12) are required" });
    const { year, month } = parsed;
    await prisma_1.prisma.monthClose.deleteMany({
        where: { userId, year, month },
    });
    res.status(204).send();
};
exports.reopenMonth = reopenMonth;
