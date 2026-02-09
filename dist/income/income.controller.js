"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchIncomeMonth = exports.listIncome = exports.upsertIncome = void 0;
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
/** Total income = nominal + extraordinary - taxes */
function computeTotal(nominal, extraordinary, taxes) {
    return nominal + extraordinary - taxes;
}
const upsertIncome = async (req, res) => {
    const userId = req.userId;
    const parsed = parseYearMonth(req.body ?? {});
    if (!parsed)
        return res.status(400).json({ error: "year, month (1-12) and amountUsd >= 0 are required" });
    const { year, month, amountUsd } = parsed;
    // When only amountUsd is sent (e.g. onboarding), store as nominal for the new Ingresos tab
    const nominalUsd = amountUsd;
    const extraordinaryUsd = 0;
    const taxesUsd = 0;
    const row = await prisma_1.prisma.income.upsert({
        where: { userId_year_month: { userId, year, month } },
        update: { amountUsd, nominalUsd, extraordinaryUsd, taxesUsd },
        create: { userId, year, month, amountUsd, nominalUsd, extraordinaryUsd, taxesUsd },
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
        select: { month: true, amountUsd: true, nominalUsd: true, extraordinaryUsd: true, taxesUsd: true },
    });
    // Backward compat: if nominalUsd is null, treat amountUsd as nominal
    const normalized = rows.map((r) => {
        const nominal = r.nominalUsd ?? r.amountUsd ?? 0;
        const extraordinary = r.extraordinaryUsd ?? 0;
        const taxes = r.taxesUsd ?? 0;
        const totalUsd = r.nominalUsd != null ? computeTotal(nominal, extraordinary, taxes) : (r.amountUsd ?? 0);
        return {
            month: r.month,
            nominalUsd: nominal,
            extraordinaryUsd: extraordinary,
            taxesUsd: taxes,
            totalUsd,
        };
    });
    res.json({ year, rows: normalized });
};
exports.listIncome = listIncome;
/** PATCH one month's income components (nominal, extraordinary, taxes). Recomputes total. */
const patchIncomeMonth = async (req, res) => {
    const userId = req.userId;
    const body = req.body ?? {};
    const year = Number(body.year);
    const month = Number(body.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: "year and month (1-12) are required" });
    }
    const nominalUsd = body.nominalUsd !== undefined ? Number(body.nominalUsd) : undefined;
    const extraordinaryUsd = body.extraordinaryUsd !== undefined ? Number(body.extraordinaryUsd) : undefined;
    const taxesUsd = body.taxesUsd !== undefined ? Number(body.taxesUsd) : undefined;
    if ((nominalUsd !== undefined && !Number.isFinite(nominalUsd)) ||
        (extraordinaryUsd !== undefined && !Number.isFinite(extraordinaryUsd)) ||
        (taxesUsd !== undefined && !Number.isFinite(taxesUsd))) {
        return res.status(400).json({ error: "nominalUsd, extraordinaryUsd, taxesUsd must be finite numbers" });
    }
    const existing = await prisma_1.prisma.income.findUnique({
        where: { userId_year_month: { userId, year, month } },
        select: { nominalUsd: true, extraordinaryUsd: true, taxesUsd: true, amountUsd: true },
    });
    const nom = nominalUsd ?? existing?.nominalUsd ?? existing?.amountUsd ?? 0;
    const ext = extraordinaryUsd ?? existing?.extraordinaryUsd ?? 0;
    const tax = taxesUsd ?? existing?.taxesUsd ?? 0;
    const amountUsd = computeTotal(nom, ext, tax);
    const row = await prisma_1.prisma.income.upsert({
        where: { userId_year_month: { userId, year, month } },
        update: { nominalUsd: nom, extraordinaryUsd: ext, taxesUsd: tax, amountUsd },
        create: { userId, year, month, amountUsd, nominalUsd: nom, extraordinaryUsd: ext, taxesUsd: tax },
    });
    res.json(row);
};
exports.patchIncomeMonth = patchIncomeMonth;
