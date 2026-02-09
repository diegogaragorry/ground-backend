"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reopenMonth = exports.closeMonth = exports.listMonthCloses = exports.previewMonthClose = void 0;
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
/** Devuelve si la funcionalidad de cierre con balance real está habilitada (solo localhost o env). */
function isRealBalanceCloseEnabled(req) {
    return req.hostname === "localhost" || process.env.ENABLE_REAL_BALANCE_CLOSE === "true";
}
// Preview de cierre: balance real vs calculado y ajuste propuesto a "Otros gastos" (solo localhost)
const previewMonthClose = async (req, res) => {
    if (!isRealBalanceCloseEnabled(req)) {
        return res.status(403).json({ error: "Preview de cierre solo disponible en localhost" });
    }
    const userId = req.userId;
    const parsed = parseYearMonth(req.body ?? req.query ?? {});
    if (!parsed)
        return res.status(400).json({ error: "year and month (1-12) are required" });
    const { year, month } = parsed;
    const income = await prisma_1.prisma.income.findUnique({
        where: { userId_year_month: { userId, year, month } },
        select: { amountUsd: true },
    });
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
    const baseExpensesUsd = actualExpenses > 0 ? actualExpenses : (plan?.amountUsd ?? 0);
    const monthlyBudget = await prisma_1.prisma.monthlyBudget.findUnique({
        where: { userId_year_month: { userId, year, month } },
        select: { otherExpensesUsd: true },
    });
    const otherExpensesCurrent = monthlyBudget?.otherExpensesUsd ?? 0;
    const { totalNW, portfolioVariation } = await computeNetWorthSeriesUsd(userId, year);
    const netWorthStartUsd = totalNW[month - 1] ?? 0;
    let netWorthEndUsd;
    if (month < 12) {
        netWorthEndUsd = totalNW[month] ?? 0;
    }
    else {
        const nextYear = await computeNetWorthSeriesUsd(userId, year + 1);
        netWorthEndUsd = nextYear.totalNW[0] ?? 0;
    }
    const realBalanceUsd = netWorthEndUsd - netWorthStartUsd;
    const mvRows = await prisma_1.prisma.investmentMovement.findMany({
        where: {
            investment: { userId, type: "PORTFOLIO" },
            date: { gte: start, lt: end },
        },
        select: { type: true, amount: true, currencyId: true },
    });
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
    const budgetBalanceUsd = incomeUsd - baseExpensesUsd - otherExpensesCurrent + investmentEarningsUsd;
    const otherExpensesProposed = incomeUsd + investmentEarningsUsd - realBalanceUsd - baseExpensesUsd;
    const diff = Math.abs(realBalanceUsd - budgetBalanceUsd);
    const message = diff < 0.01
        ? "El balance real y el calculado coinciden. No se ajustará Otros gastos."
        : `Balance real: ${realBalanceUsd.toFixed(2)} USD. Balance calculado (presupuesto): ${budgetBalanceUsd.toFixed(2)} USD. Se ajustará "Otros gastos" de ${otherExpensesCurrent.toFixed(2)} a ${otherExpensesProposed.toFixed(2)} USD para que cierre. ¿Confirmar cierre?`;
    res.json({
        realBalanceUsd,
        budgetBalanceUsd,
        otherExpensesCurrent,
        otherExpensesProposed,
        netWorthStartUsd,
        netWorthEndUsd,
        message,
    });
};
exports.previewMonthClose = previewMonthClose;
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
// En localhost (o ENABLE_REAL_BALANCE_CLOSE): ajusta Otros gastos al balance real y congela snapshots del mes siguiente
const closeMonth = async (req, res) => {
    try {
        const userId = req.userId;
        const parsed = parseYearMonth(req.body ?? {});
        if (!parsed)
            return res.status(400).json({ error: "year and month (1-12) are required" });
        const { year, month } = parsed;
        const income = await prisma_1.prisma.income.findUnique({
            where: { userId_year_month: { userId, year, month } },
            select: { amountUsd: true },
        });
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
        const baseExpensesUsd = actualExpenses > 0 ? actualExpenses : (plan?.amountUsd ?? 0);
        const { totalNW, portfolioVariation } = await computeNetWorthSeriesUsd(userId, year);
        const netWorthStartUsd = totalNW[month - 1] ?? 0;
        let netWorthEndUsd = null;
        if (month < 12) {
            netWorthEndUsd = totalNW[month] ?? 0;
        }
        else {
            const nextYear = await computeNetWorthSeriesUsd(userId, year + 1);
            netWorthEndUsd = nextYear.totalNW[0] ?? 0;
        }
        const mvRows = await prisma_1.prisma.investmentMovement.findMany({
            where: {
                investment: { userId, type: "PORTFOLIO" },
                date: { gte: start, lt: end },
            },
            select: { type: true, amount: true, currencyId: true },
        });
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
        let expensesUsd;
        let balanceUsd;
        if (isRealBalanceCloseEnabled(req) && netWorthEndUsd != null) {
            const realBalanceUsd = netWorthEndUsd - netWorthStartUsd;
            let otherExpensesProposed = incomeUsd + investmentEarningsUsd - realBalanceUsd - baseExpensesUsd;
            if (!Number.isFinite(otherExpensesProposed))
                otherExpensesProposed = 0;
            await prisma_1.prisma.monthlyBudget.upsert({
                where: { userId_year_month: { userId, year, month } },
                update: { otherExpensesUsd: otherExpensesProposed },
                create: { userId, year, month, otherExpensesUsd: otherExpensesProposed },
            });
            expensesUsd = baseExpensesUsd + otherExpensesProposed;
            balanceUsd = realBalanceUsd;
            const nextYear = month === 12 ? year + 1 : year;
            const nextMonth = month === 12 ? 1 : month + 1;
            const investmentIds = await prisma_1.prisma.investment.findMany({
                where: { userId },
                select: { id: true },
            });
            if (investmentIds.length > 0) {
                await prisma_1.prisma.investmentSnapshot.updateMany({
                    where: {
                        investmentId: { in: investmentIds.map((i) => i.id) },
                        year: nextYear,
                        month: nextMonth,
                    },
                    data: { isClosed: true },
                });
            }
        }
        else {
            expensesUsd = plan?.amountUsd ?? actualExpenses;
            balanceUsd = incomeUsd - expensesUsd + investmentEarningsUsd;
        }
        const row = await prisma_1.prisma.monthClose.upsert({
            where: { userId_year_month: { userId, year, month } },
            update: {
                incomeUsd,
                expensesUsd,
                investmentEarningsUsd,
                balanceUsd,
                netWorthStartUsd,
                ...(netWorthEndUsd != null && { netWorthEndUsd }),
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
                ...(netWorthEndUsd != null && { netWorthEndUsd }),
            },
        });
        res.status(201).json(row);
    }
    catch (err) {
        console.error("closeMonth error:", err);
        const message = err?.message ?? String(err);
        res.status(500).json({ error: `Error al cerrar el mes: ${message}` });
    }
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
