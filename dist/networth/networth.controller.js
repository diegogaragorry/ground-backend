"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetWorth = void 0;
const prisma_1 = require("../lib/prisma");
function parseYear(query) {
    const y = Number(query.year);
    if (!Number.isInteger(y))
        return null;
    return y;
}
const months12 = Array.from({ length: 12 }, (_, i) => i + 1);
function monthlyFactor(targetAnnualReturn) {
    return 1 + (Number(targetAnnualReturn ?? 0) / 12);
}
function yieldStartMonthForYear(inv, year) {
    if (inv.yieldStartYear != null && inv.yieldStartYear > year)
        return 13;
    if (inv.yieldStartYear != null && inv.yieldStartYear === year)
        return inv.yieldStartMonth ?? 1;
    return 1;
}
function capitalUsdForMonth(inv, snaps, m, year) {
    const byM = new Map();
    for (const s of snaps)
        byM.set(s.month, s.capitalUsd);
    const direct = byM.get(m);
    if (direct != null)
        return direct;
    // base anterior
    let baseMonth = null;
    let baseValue = null;
    for (let i = m - 1; i >= 1; i--) {
        const v = byM.get(i);
        if (v != null) {
            baseMonth = i;
            baseValue = v;
            break;
        }
    }
    if (baseMonth == null || baseValue == null)
        return 0;
    const start = Math.max(yieldStartMonthForYear(inv, year), baseMonth);
    const diff = m - start;
    if (diff <= 0)
        return baseValue;
    return baseValue * Math.pow(monthlyFactor(inv.targetAnnualReturn), diff);
}
async function buildSnapshotsByInv(userId, year) {
    const snaps = await prisma_1.prisma.investmentSnapshot.findMany({
        where: { investment: { userId }, year },
        select: { investmentId: true, month: true, capitalUsd: true },
    });
    const snapsByInv = new Map();
    for (const s of snaps) {
        const arr = snapsByInv.get(s.investmentId) ?? [];
        arr.push({ month: s.month, capitalUsd: s.capitalUsd ?? null });
        snapsByInv.set(s.investmentId, arr);
    }
    return snapsByInv;
}
async function netWorthSeriesAll(userId, year) {
    const invs = await prisma_1.prisma.investment.findMany({
        where: { userId },
        select: {
            id: true,
            type: true,
            targetAnnualReturn: true,
            yieldStartYear: true,
            yieldStartMonth: true,
        },
    });
    const snapsByInv = await buildSnapshotsByInv(userId, year);
    const nw = months12.map((m) => {
        let total = 0;
        for (const inv of invs) {
            const invSnaps = snapsByInv.get(inv.id) ?? [];
            total += capitalUsdForMonth(inv, invSnaps, m, year);
        }
        return total;
    });
    return { invs: invs, snapsByInv, nw };
}
async function netWorthSeriesInvestmentsOnly(userId, year) {
    const invs = await prisma_1.prisma.investment.findMany({
        where: { userId, NOT: { type: "ACCOUNT" } },
        select: {
            id: true,
            type: true,
            targetAnnualReturn: true,
            yieldStartYear: true,
            yieldStartMonth: true,
        },
    });
    const snapsByInv = await buildSnapshotsByInv(userId, year);
    const nwInv = months12.map((m) => {
        let total = 0;
        for (const inv of invs) {
            const invSnaps = snapsByInv.get(inv.id) ?? [];
            total += capitalUsdForMonth(inv, invSnaps, m, year);
        }
        return total;
    });
    return { invs: invs, snapsByInv, nwInv };
}
async function flowsByInvestmentByMonthUsd(userId, year) {
    // Como vas a cargar manualmente en USD:
    // - asumimos currencyId = 'USD' y amount = USD
    // - deposit suma, withdrawal resta
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
    const rows = await prisma_1.prisma.investmentMovement.findMany({
        where: {
            investment: { userId },
            date: { gte: start, lt: end },
            type: { in: ["deposit", "withdrawal"] },
            currencyId: "USD",
        },
        select: { investmentId: true, date: true, amount: true, type: true },
    });
    const map = new Map(); // key = `${invId}:${month}`
    for (const r of rows) {
        const m = new Date(r.date).getUTCMonth() + 1;
        const key = `${r.investmentId}:${m}`;
        const signed = r.type === "deposit" ? (r.amount ?? 0) : -(r.amount ?? 0);
        map.set(key, (map.get(key) ?? 0) + signed);
    }
    return map;
}
const getNetWorth = async (req, res) => {
    const userId = req.userId;
    const year = parseYear(req.query);
    if (!year)
        return res.status(400).json({ error: "year is required" });
    // 1) Net worth total (cuentas + inversiones)
    const all = await netWorthSeriesAll(userId, year);
    // 2) Net worth solo inversiones (para calcular earnings reales)
    const invOnly = await netWorthSeriesInvestmentsOnly(userId, year);
    // 3) Prev Dec (solo inversiones) para enero
    const prevDecInvOnly = (await netWorthSeriesInvestmentsOnly(userId, year - 1)).nwInv[11] ?? 0;
    // 4) Flujos del año (USD)
    const flows = await flowsByInvestmentByMonthUsd(userId, year);
    // 5) Earnings reales por mes (solo inversiones)
    const investmentEarningsByMonthUsd = months12.map((m, idx) => {
        const end = invOnly.nwInv[idx] ?? 0;
        const start = m === 1 ? prevDecInvOnly : (invOnly.nwInv[idx - 1] ?? 0);
        // flow total del mes para inversiones reales
        let flowTotal = 0;
        for (const inv of invOnly.invs) {
            flowTotal += flows.get(`${inv.id}:${m}`) ?? 0;
        }
        return (end - start) - flowTotal;
    });
    // totalMonthUsd opcional (si mandan month)
    const monthQ = Number(req.query.month);
    const totalMonthUsd = Number.isInteger(monthQ) && monthQ >= 1 && monthQ <= 12 ? (all.nw[monthQ - 1] ?? 0) : null;
    res.json({
        year,
        months: months12.map((m, i) => ({ month: m, totalUsd: all.nw[i] ?? 0 })),
        totalMonthUsd,
        investmentEarningsByMonthUsd,
        note: "investmentEarnings exclude deposits/withdrawals into investments; net worth includes accounts + investments",
    });
};
exports.getNetWorth = getNetWorth;
