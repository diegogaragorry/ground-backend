// src/budgets/budgets.controller.ts
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";

/* =========================================================
   Helpers
========================================================= */

function parseYearMonth(query: any) {
  const year = Number(query.year);
  const month = Number(query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function parseYear(query: any) {
  const year = Number(query.year);
  if (!Number.isInteger(year)) return null;
  return year;
}

const months12 = Array.from({ length: 12 }, (_, i) => i + 1);

function monthlyFactor(targetAnnualReturn: number) {
  return 1 + Number(targetAnnualReturn ?? 0) / 12;
}

function yieldStartMonthForYear(inv: { yieldStartYear: number | null; yieldStartMonth: number | null }, year: number) {
  if (inv.yieldStartYear != null && inv.yieldStartYear > year) return 13;
  if (inv.yieldStartYear != null && inv.yieldStartYear === year) return inv.yieldStartMonth ?? 1;
  return 1;
}

async function getUsdUyuRateForMonthOrDefault(userId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const last = await prisma.expense.findFirst({
    where: { userId, date: { gte: start, lt: end }, usdUyuRate: { not: null } },
    orderBy: { date: "desc" },
    select: { usdUyuRate: true },
  });

  const fallback = Number(process.env.DEFAULT_USD_UYU_RATE ?? 38);
  const v = Number(last?.usdUyuRate ?? fallback);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/* =========================================================
   Existing endpoints: upsertBudget / listBudgets / budgetReport
========================================================= */

export const upsertBudget = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { year, month, categoryId, currencyId, amount } = req.body ?? {};

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "year and month are required (month 1-12)" });
  }
  if (!categoryId || typeof categoryId !== "string") return res.status(400).json({ error: "categoryId is required" });
  if (!currencyId || typeof currencyId !== "string") return res.status(400).json({ error: "currencyId is required" });
  if (typeof amount !== "number" || amount < 0) return res.status(400).json({ error: "amount must be a number >= 0" });

  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) return res.status(403).json({ error: "Invalid categoryId for this user" });

  const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
  if (!currency) return res.status(400).json({ error: "Invalid currencyId" });

  const budget = await prisma.budget.upsert({
    where: {
      userId_year_month_categoryId_currencyId: {
        userId,
        year,
        month,
        categoryId,
        currencyId,
      },
    },
    update: { amount },
    create: { userId, year, month, categoryId, currencyId, amount },
  });

  res.status(200).json(budget);
};

export const listBudgets = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const ym = parseYearMonth(req.query);
  if (!ym) return res.status(400).json({ error: "Provide year and month query params (e.g., ?year=2026&month=1)" });

  const budgets = await prisma.budget.findMany({
    where: { userId, year: ym.year, month: ym.month },
    include: { category: true, currency: true },
    orderBy: [{ currencyId: "asc" }, { categoryId: "asc" }],
  });

  res.json(budgets);
};

export const budgetReport = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const ym = parseYearMonth(req.query);
  if (!ym) return res.status(400).json({ error: "Provide year and month query params (e.g., ?year=2026&month=1)" });

  const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));

  const budgets = await prisma.budget.findMany({
    where: { userId, year: ym.year, month: ym.month },
    include: { category: true, currency: true },
  });

  const actuals = await prisma.expense.groupBy({
    by: ["categoryId", "currencyId"],
    where: { userId, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });

  const actualMap = new Map<string, number>();
  for (const a of actuals) {
    actualMap.set(`${a.categoryId}:${a.currencyId}`, a._sum.amount ?? 0);
  }

  const rows = budgets.map((b) => {
    const actual = actualMap.get(`${b.categoryId}:${b.currencyId}`) ?? 0;
    const budget = b.amount;
    const diff = budget - actual;
    const pct = budget === 0 ? null : actual / budget;

    return {
      categoryId: b.categoryId,
      categoryName: b.category.name,
      currencyId: b.currencyId,
      budget,
      actual,
      diff,
      pct,
    };
  });

  res.json({ year: ym.year, month: ym.month, rows });
};

/* =========================================================
   NEW: Update other expenses (manual line) via MonthlyBudget
   PUT /budgets/other-expenses/:year/:month  { otherExpensesUsd }
========================================================= */

export const updateOtherExpenses = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const body = req.body as
    | { otherExpensesUsd?: number }
    | { amount?: number; currencyId?: string; usdUyuRate?: number };

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "Invalid year or month" });
  }

  let otherExpensesUsd: number;

  if ("amount" in body && body.currencyId === "UYU" && typeof body.usdUyuRate === "number" && body.usdUyuRate > 0) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    otherExpensesUsd = amount / body.usdUyuRate;
  } else if ("otherExpensesUsd" in body && typeof body.otherExpensesUsd === "number" && Number.isFinite(body.otherExpensesUsd)) {
    otherExpensesUsd = body.otherExpensesUsd;
  } else {
    return res.status(400).json({ error: "Provide otherExpensesUsd or (amount, currencyId: 'UYU', usdUyuRate)" });
  }

  // permitimos negativos (ej. ajustes o ingresos extra contabilizados como "otros")

  const closed = await prisma.monthClose.findFirst({
    where: { userId, year, month },
    select: { id: true },
  });
  if (closed) return res.status(409).json({ error: "Month is closed" });

  const row = await prisma.monthlyBudget.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { otherExpensesUsd },
    create: { userId, year, month, otherExpensesUsd },
    select: { userId: true, year: true, month: true, otherExpensesUsd: true },
  });

  res.json(row);
};

/* =========================================================
   Annual budget endpoint: /budgets/annual?year=YYYY
   - baseExpensesUsd = actual expenses if month has actuals; otherwise drafts (planned unconfirmed)
   - otherExpensesUsd = MonthlyBudget.otherExpensesUsd
   - expensesUsd = base + other
   - keeps your investment/net worth logic
========================================================= */

type InvLite = {
  id: string;
  type: string;
  currencyId: string | null;
  targetAnnualReturn: number;
  yieldStartYear: number | null;
  yieldStartMonth: number | null;
};

type SnapRow = {
  investmentId: string;
  month: number;
  capital: number | null;
  capitalUsd: number | null;
};

function buildInvMonthMap(invId: string, rows: SnapRow[]) {
  const m = new Map<number, { capital: number | null; capitalUsd: number | null }>();
  for (const r of rows) {
    if (r.investmentId !== invId) continue;
    m.set(r.month, { capital: r.capital ?? null, capitalUsd: r.capitalUsd ?? null });
  }
  return m;
}

export const annualBudget = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = parseYear(req.query);
  if (!year) return res.status(400).json({ error: "Provide year query param (e.g., ?year=2026)" });

  // -------- MonthCloses (locked)
  const closes = await prisma.monthClose.findMany({
    where: { userId, year },
    orderBy: { month: "asc" },
  });
  const closeByMonth = new Map<number, typeof closes[number]>();
  for (const c of closes) closeByMonth.set(c.month, c);

  // -------- Income (USD) per month
  const incomeRows = await prisma.income.findMany({
    where: { userId, year },
    select: { month: true, amountUsd: true },
  });
  const incomeByMonth = new Map<number, number>();
  for (const r of incomeRows) incomeByMonth.set(r.month, r.amountUsd ?? 0);

  // -------- Actual expenses (USD) per month from Expenses
  const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));

  const expensesRows = await prisma.expense.findMany({
    where: { userId, date: { gte: yearStart, lt: yearEnd } },
    select: { date: true, amountUsd: true },
  });

  const actualByMonth = new Map<number, number>();
  for (const e of expensesRows) {
    const m = new Date(e.date).getUTCMonth() + 1;
    actualByMonth.set(m, (actualByMonth.get(m) ?? 0) + (e.amountUsd ?? 0));
  }

  // -------- Planned drafts (USD) per month from PlannedExpense (unconfirmed)
  const plannedRows = await prisma.plannedExpense.findMany({
    where: { userId, year, isConfirmed: false },
    select: { month: true, amountUsd: true },
  });

  const plannedByMonth = new Map<number, number>();
  for (const p of plannedRows) {
    plannedByMonth.set(p.month, (plannedByMonth.get(p.month) ?? 0) + (p.amountUsd ?? 0));
  }

  // -------- Other expenses (manual) per month from MonthlyBudget
  const otherRows = await prisma.monthlyBudget.findMany({
    where: { userId, year },
    select: { month: true, otherExpensesUsd: true },
  });

  const otherByMonth = new Map<number, number>();
  for (const r of otherRows) otherByMonth.set(r.month, r.otherExpensesUsd ?? 0);

  // -------- Investments (baseline total NW + portfolio earnings)
  const invs = await prisma.investment.findMany({
    where: { userId },
    select: {
      id: true,
      type: true,
      currencyId: true,
      targetAnnualReturn: true,
      yieldStartYear: true,
      yieldStartMonth: true,
    },
  });

  const portfolios = invs.filter((i) => i.type === "PORTFOLIO");
  const accounts = invs.filter((i) => i.type === "ACCOUNT");

  // snapshots: capital + capitalUsd
  const snaps = await prisma.investmentSnapshot.findMany({
    where: { investment: { userId }, year },
    select: { investmentId: true, month: true, capital: true, capitalUsd: true },
  });

  // FX por mes (para convertir UYU si falta capitalUsd)
  const fxByMonth = new Map<number, number>();
  for (const m of months12) {
    // eslint-disable-next-line no-await-in-loop
    fxByMonth.set(m, await getUsdUyuRateForMonthOrDefault(userId, year, m));
  }

  function snapUsdFor(inv: InvLite, snap: { capital: number | null; capitalUsd: number | null }, m: number) {
    if (snap.capitalUsd != null) return snap.capitalUsd;
    if (snap.capital == null) return null;

    const cur = (inv.currencyId ?? "USD").toUpperCase();
    if (cur === "USD") return snap.capital;

    if (cur === "UYU") {
      const fx = fxByMonth.get(m) ?? 38;
      return fx > 0 ? snap.capital / fx : 0;
    }

    // moneda desconocida: asumimos USD
    return snap.capital;
  }

  function capitalUsdPortfolio(inv: InvLite, byM: Map<number, { capital: number | null; capitalUsd: number | null }>, m: number) {
    const directSnap = byM.get(m);
    if (directSnap) {
      const directUsd = snapUsdFor(inv, directSnap, m);
      if (directUsd != null) return directUsd;
    }

    let baseMonth: number | null = null;
    let baseUsd: number | null = null;

    for (let i = m - 1; i >= 1; i--) {
      const s = byM.get(i);
      if (!s) continue;
      const usd = snapUsdFor(inv, s, i);
      if (usd != null) {
        baseMonth = i;
        baseUsd = usd;
        break;
      }
    }

    if (baseMonth == null || baseUsd == null) return 0;

    const yStart = yieldStartMonthForYear(inv, year as number);
    const startM = Math.max(yStart, baseMonth ?? 0);
    const diff = m - startM;
    if (diff <= 0) return baseUsd;

    return baseUsd * Math.pow(monthlyFactor(inv.targetAnnualReturn ?? 0), diff);
  }

  function capitalUsdAccountCarry(inv: InvLite, byM: Map<number, { capital: number | null; capitalUsd: number | null }>, m: number) {
    const directSnap = byM.get(m);
    if (directSnap) {
      const directUsd = snapUsdFor(inv, directSnap, m);
      if (directUsd != null) return directUsd;
    }

    for (let i = m - 1; i >= 1; i--) {
      const s = byM.get(i);
      if (!s) continue;
      const usd = snapUsdFor(inv, s, i);
      if (usd != null) return usd;
    }
    return 0;
  }

  // -------- Portfolio net worth by month (USD)
  const portfolioNW = months12.map((m) =>
    portfolios.reduce((acc, inv) => {
      const byM = buildInvMonthMap(inv.id, snaps as any);
      return acc + capitalUsdPortfolio(inv as any, byM, m);
    }, 0)
  );

  // projected next jan for December variation (solo portfolio)
  const projectedNextJanPortfolio = portfolios.reduce((acc, inv) => {
    const byM = buildInvMonthMap(inv.id, snaps as any);
    const decCap = capitalUsdPortfolio(inv as any, byM, 12);
    return acc + decCap * monthlyFactor(inv.targetAnnualReturn ?? 0);
  }, 0);

  // variation shift-forward (Jan = Feb - Jan)
  const portfolioVariationShift = months12.map((m, idx) => {
    if (m < 12) return (portfolioNW[idx + 1] ?? 0) - (portfolioNW[idx] ?? 0);
    return projectedNextJanPortfolio - (portfolioNW[11] ?? 0);
  });

  // -------- Flows by month (Portfolio only, USD only)
  const movementRows = await prisma.investmentMovement.findMany({
    where: {
      investment: { userId, type: "PORTFOLIO" },
      date: { gte: yearStart, lt: yearEnd },
    },
    select: { date: true, type: true, amount: true, currencyId: true },
  });

  const flowsByMonth = months12.map(() => 0);
  for (const mv of movementRows) {
    const m = new Date(mv.date).getUTCMonth() + 1;
    if (m < 1 || m > 12) continue;

    const amtUsd = mv.currencyId === "USD" ? Number(mv.amount ?? 0) : 0;

    if (mv.type === "deposit") flowsByMonth[m - 1] += amtUsd;
    else if (mv.type === "withdrawal") flowsByMonth[m - 1] -= amtUsd;
  }

  // -------- Real returns (Portfolio) = variation - flows
  const portfolioRealReturns = months12.map((_, idx) => (portfolioVariationShift[idx] ?? 0) - (flowsByMonth[idx] ?? 0));

  // -------- Total net worth baseline for Jan start (portfolio + accounts)
  const accountsNW = months12.map((m) =>
    accounts.reduce((acc, inv) => {
      const byM = buildInvMonthMap(inv.id, snaps as any);
      return acc + capitalUsdAccountCarry(inv as any, byM, m);
    }, 0)
  );

  const totalNWBaseline = months12.map((_, idx) => (portfolioNW[idx] ?? 0) + (accountsNW[idx] ?? 0));

  // -------- Compose months with locking + Net worth (start) projection
  const months: any[] = [];

  const janLocked = closeByMonth.get(1);
  let prevNetWorthStart = (janLocked?.netWorthStartUsd ?? totalNWBaseline[0] ?? 0);
  let prevBalance = (janLocked?.balanceUsd ?? 0);

  for (let idx = 0; idx < 12; idx++) {
    const m = idx + 1;

    const locked = closeByMonth.get(m);
    if (locked) {
      // Para meses cerrados, mostramos base+other desagregado (other viene de MonthlyBudget)
      const otherExpensesUsd = otherByMonth.get(m) ?? 0;
      const baseExpensesUsd = Math.max(0, (locked.expensesUsd ?? 0) - otherExpensesUsd);

      months.push({
        month: m,
        isClosed: true,
        incomeUsd: locked.incomeUsd,

        baseExpensesUsd,
        otherExpensesUsd,
        expensesUsd: locked.expensesUsd,

        investmentEarningsUsd: locked.investmentEarningsUsd,
        balanceUsd: locked.balanceUsd,
        netWorthUsd: locked.netWorthStartUsd, // START
        source: "locked" as const,
      });

      prevNetWorthStart = locked.netWorthStartUsd;
      prevBalance = locked.balanceUsd;
      continue;
    }

    const incomeUsd = incomeByMonth.get(m) ?? 0;

    // ✅ regla: si hay actuals, usamos actual; si no, usamos drafts
    const actualBase = actualByMonth.get(m) ?? 0;
    const plannedBase = plannedByMonth.get(m) ?? 0;
    const baseExpensesUsd = actualBase > 0 ? actualBase : plannedBase;

    const otherExpensesUsd = otherByMonth.get(m) ?? 0;
    const expensesUsd = baseExpensesUsd + otherExpensesUsd;

    const investmentEarningsUsd = portfolioRealReturns[idx] ?? 0;
    const balanceUsd = incomeUsd - expensesUsd + investmentEarningsUsd;

    const netWorthStartUsd = m === 1 ? (totalNWBaseline[0] ?? 0) : prevNetWorthStart + prevBalance;

    months.push({
      month: m,
      isClosed: false,
      incomeUsd,

      baseExpensesUsd,
      otherExpensesUsd,
      expensesUsd,

      investmentEarningsUsd,
      balanceUsd,
      netWorthUsd: netWorthStartUsd, // START
      source: "computed" as const,
    });

    prevNetWorthStart = netWorthStartUsd;
    prevBalance = balanceUsd;
  }

  res.json({ year, months });
};