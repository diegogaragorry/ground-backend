"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeSnapshotForMonth = exports.upsertSnapshotForMonth = exports.listSnapshotsByYear = void 0;
const prisma_1 = require("../lib/prisma");
const fx_1 = require("../utils/fx");
function parseYearMonthParams(params) {
    const year = Number(params.year);
    const month = Number(params.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
        return null;
    return { year, month };
}
const listSnapshotsByYear = async (req, res) => {
    const userId = req.userId;
    const investmentId = req.params.id;
    const year = Number(req.query.year);
    if (!Number.isInteger(year)) {
        return res.status(400).json({ error: "Provide ?year=YYYY" });
    }
    const investment = await prisma_1.prisma.investment.findFirst({ where: { id: investmentId, userId } });
    if (!investment)
        return res.status(404).json({ error: "Investment not found" });
    const snaps = await prisma_1.prisma.investmentSnapshot.findMany({
        where: { investmentId, year },
        orderBy: { month: "asc" },
    });
    const map = new Map(snaps.map((s) => [s.month, s]));
    const months = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const s = map.get(m);
        return s
            ? {
                id: s.id,
                investmentId: s.investmentId,
                year: s.year,
                month: s.month,
                closingCapital: s.capital ?? null,
                closingCapitalUsd: s.capitalUsd ?? null,
                isClosed: s.isClosed,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt ?? null,
            }
            : {
                id: null,
                investmentId,
                year,
                month: m,
                closingCapital: null,
                closingCapitalUsd: null,
                isClosed: false,
                createdAt: null,
                updatedAt: null,
            };
    });
    res.json({ investment, year, months });
};
exports.listSnapshotsByYear = listSnapshotsByYear;
const upsertSnapshotForMonth = async (req, res) => {
    const userId = req.userId;
    const investmentId = req.params.id;
    const ym = parseYearMonthParams(req.params);
    const { closingCapital, usdUyuRate } = req.body ?? {};
    if (!ym)
        return res.status(400).json({ error: "Invalid year/month" });
    if (typeof closingCapital !== "number" || Number.isNaN(closingCapital) || closingCapital < 0) {
        return res.status(400).json({ error: "closingCapital must be >= 0" });
    }
    const investment = await prisma_1.prisma.investment.findFirst({ where: { id: investmentId, userId } });
    if (!investment)
        return res.status(404).json({ error: "Investment not found" });
    const existing = await prisma_1.prisma.investmentSnapshot.findUnique({
        where: {
            investmentId_year_month: {
                investmentId,
                year: ym.year,
                month: ym.month,
            },
        },
    });
    if (existing?.isClosed) {
        return res.status(409).json({ error: "Month is closed" });
    }
    let fx;
    try {
        fx = (0, fx_1.toUsd)({
            amount: closingCapital,
            currencyId: investment.currencyId,
            usdUyuRate,
        });
    }
    catch (e) {
        return res.status(400).json({ error: e?.message ?? "Invalid FX rate" });
    }
    const snap = await prisma_1.prisma.investmentSnapshot.upsert({
        where: {
            investmentId_year_month: {
                investmentId,
                year: ym.year,
                month: ym.month,
            },
        },
        create: {
            investmentId,
            year: ym.year,
            month: ym.month,
            capital: closingCapital,
            capitalUsd: fx.amountUsd,
            isClosed: false,
        },
        update: {
            capital: closingCapital,
            capitalUsd: fx.amountUsd,
        },
    });
    res.json({
        id: snap.id,
        investmentId: snap.investmentId,
        year: snap.year,
        month: snap.month,
        closingCapital: snap.capital ?? null,
        closingCapitalUsd: snap.capitalUsd ?? null,
        isClosed: snap.isClosed,
        createdAt: snap.createdAt,
        updatedAt: snap.updatedAt ?? null,
    });
};
exports.upsertSnapshotForMonth = upsertSnapshotForMonth;
const closeSnapshotForMonth = async (req, res) => {
    const userId = req.userId;
    const investmentId = req.params.id;
    const ym = parseYearMonthParams(req.params);
    if (!ym)
        return res.status(400).json({ error: "Invalid year/month" });
    const investment = await prisma_1.prisma.investment.findFirst({ where: { id: investmentId, userId } });
    if (!investment)
        return res.status(404).json({ error: "Investment not found" });
    const existing = await prisma_1.prisma.investmentSnapshot.findUnique({
        where: {
            investmentId_year_month: {
                investmentId,
                year: ym.year,
                month: ym.month,
            },
        },
    });
    if (!existing)
        return res.status(404).json({ error: "Snapshot not found" });
    if (existing.isClosed) {
        return res.json({
            id: existing.id,
            investmentId: existing.investmentId,
            year: existing.year,
            month: existing.month,
            closingCapital: existing.capital ?? null,
            closingCapitalUsd: existing.capitalUsd ?? null,
            isClosed: existing.isClosed,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt ?? null,
        });
    }
    const closed = await prisma_1.prisma.investmentSnapshot.update({
        where: { id: existing.id },
        data: { isClosed: true },
    });
    res.json({
        id: closed.id,
        investmentId: closed.investmentId,
        year: closed.year,
        month: closed.month,
        closingCapital: closed.capital ?? null,
        closingCapitalUsd: closed.capitalUsd ?? null,
        isClosed: closed.isClosed,
        createdAt: closed.createdAt,
        updatedAt: closed.updatedAt ?? null,
    });
};
exports.closeSnapshotForMonth = closeSnapshotForMonth;
