import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

function parseYear(query: any) {
  const y = Number(query.year);
  if (!Number.isInteger(y)) return null;
  return y;
}

const months12 = Array.from({ length: 12 }, (_, i) => i + 1);

function monthlyFactor(targetAnnualReturn?: number) {
  return 1 + (Number(targetAnnualReturn ?? 0) / 12);
}

type Inv = {
  id: string;
  type: string;
  targetAnnualReturn: number;
  yieldStartYear: number | null;
  yieldStartMonth: number | null;
};

type Snap = { month: number; capitalUsd: number | null };

function yieldStartMonthForYear(inv: Inv, year: number) {
  if (inv.yieldStartYear != null && inv.yieldStartYear > year) return 13;
  if (inv.yieldStartYear != null && inv.yieldStartYear === year) return inv.yieldStartMonth ?? 1;
  return 1;
}

function capitalUsdForMonth(inv: Inv, snaps: Snap[], m: number, year: number) {
  const byM = new Map<number, number | null>();
  for (const s of snaps) byM.set(s.month, s.capitalUsd);

  const direct = byM.get(m);
  if (direct != null) return direct;

  // base anterior
  let baseMonth: number | null = null;
  let baseValue: number | null = null;

  for (let i = m - 1; i >= 1; i--) {
    const v = byM.get(i);
    if (v != null) {
      baseMonth = i;
      baseValue = v;
      break;
    }
  }

  if (baseMonth == null || baseValue == null) return 0;

  const start = Math.max(yieldStartMonthForYear(inv, year), baseMonth);
  const diff = m - start;
  if (diff <= 0) return baseValue;

  return baseValue * Math.pow(monthlyFactor(inv.targetAnnualReturn), diff);
}

async function buildSnapshotsByInv(userId: string, year: number) {
  const snaps = await prisma.investmentSnapshot.findMany({
    where: { investment: { userId }, year },
    select: { investmentId: true, month: true, capitalUsd: true },
  });

  const snapsByInv = new Map<string, Snap[]>();
  for (const s of snaps) {
    const arr = snapsByInv.get(s.investmentId) ?? [];
    arr.push({ month: s.month, capitalUsd: s.capitalUsd ?? null });
    snapsByInv.set(s.investmentId, arr);
  }
  return snapsByInv;
}

async function netWorthSeriesAll(userId: string, year: number) {
  const invs = await prisma.investment.findMany({
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
    for (const inv of invs as Inv[]) {
      const invSnaps = snapsByInv.get(inv.id) ?? [];
      total += capitalUsdForMonth(inv, invSnaps, m, year);
    }
    return total;
  });

  return { invs: invs as Inv[], snapsByInv, nw };
}

async function netWorthSeriesInvestmentsOnly(userId: string, year: number) {
  const invs = await prisma.investment.findMany({
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
    for (const inv of invs as Inv[]) {
      const invSnaps = snapsByInv.get(inv.id) ?? [];
      total += capitalUsdForMonth(inv, invSnaps, m, year);
    }
    return total;
  });

  return { invs: invs as Inv[], snapsByInv, nwInv };
}

async function flowsByInvestmentByMonthUsd(userId: string, year: number) {
  // Como vas a cargar manualmente en USD:
  // - asumimos currencyId = 'USD' y amount = USD
  // - deposit suma, withdrawal resta
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));

  const rows = await prisma.investmentMovement.findMany({
    where: {
      investment: { userId },
      date: { gte: start, lt: end },
      type: { in: ["deposit", "withdrawal"] },
      currencyId: "USD",
    },
    select: { investmentId: true, date: true, amount: true, type: true },
  });

  const map = new Map<string, number>(); // key = `${invId}:${month}`

  for (const r of rows) {
    const m = new Date(r.date).getUTCMonth() + 1;
    const key = `${r.investmentId}:${m}`;
    const signed = r.type === "deposit" ? (r.amount ?? 0) : -(r.amount ?? 0);
    map.set(key, (map.get(key) ?? 0) + signed);
  }

  return map;
}

export const getNetWorth = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = parseYear(req.query);
  if (!year) return res.status(400).json({ error: "year is required" });

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
  const totalMonthUsd =
    Number.isInteger(monthQ) && monthQ >= 1 && monthQ <= 12 ? (all.nw[monthQ - 1] ?? 0) : null;

  res.json({
    year,
    months: months12.map((m, i) => ({ month: m, totalUsd: all.nw[i] ?? 0 })),
    totalMonthUsd,
    investmentEarningsByMonthUsd,
    note: "investmentEarnings exclude deposits/withdrawals into investments; net worth includes accounts + investments",
  });
};