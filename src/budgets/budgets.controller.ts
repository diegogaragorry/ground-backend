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
  const { year, month, categoryId, currencyId, amount, encryptedPayload } = req.body ?? {};

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "year and month are required (month 1-12)" });
  }
  if (!categoryId || typeof categoryId !== "string") return res.status(400).json({ error: "categoryId is required" });
  if (!currencyId || typeof currencyId !== "string") return res.status(400).json({ error: "currencyId is required" });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: "amount must be a number >= 0" });
  }

  const hasEncrypted = typeof encryptedPayload === "string" && encryptedPayload.length > 0;
  const amountToStore = hasEncrypted ? 0 : amount;

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
    update: {
      amount: amountToStore,
      encryptedPayload: hasEncrypted ? encryptedPayload : null,
    },
    create: {
      userId,
      year,
      month,
      categoryId,
      currencyId,
      amount: amountToStore,
      ...(hasEncrypted ? { encryptedPayload: encryptedPayload } : {}),
    },
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
      encryptedPayload: (b as { encryptedPayload?: string | null }).encryptedPayload ?? undefined,
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
  const body = req.body as {
    otherExpensesUsd?: number;
    encryptedPayload?: string;
    amount?: number;
    currencyId?: string;
    usdUyuRate?: number;
  };

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "Invalid year or month" });
  }

  const hasEncrypted = typeof body.encryptedPayload === "string" && body.encryptedPayload.length > 0;
  let otherExpensesUsd: number;

  if (hasEncrypted) {
    otherExpensesUsd = 0;
  } else if ("amount" in body && body.currencyId === "UYU" && typeof body.usdUyuRate === "number" && body.usdUyuRate > 0) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    otherExpensesUsd = amount / body.usdUyuRate;
  } else if ("otherExpensesUsd" in body && typeof body.otherExpensesUsd === "number" && Number.isFinite(body.otherExpensesUsd)) {
    otherExpensesUsd = body.otherExpensesUsd;
  } else {
    return res.status(400).json({ error: "Provide otherExpensesUsd or (amount, currencyId: 'UYU', usdUyuRate) or encryptedPayload" });
  }

  if (!hasEncrypted) {
    const closed = await prisma.monthClose.findFirst({
      where: { userId, year, month, isClosed: true },
      select: { id: true },
    });
    if (closed) return res.status(409).json({ error: "Month is closed" });
  }

  const row = await prisma.monthlyBudget.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: {
      otherExpensesUsd,
      ...(hasEncrypted && body.encryptedPayload ? { encryptedPayload: body.encryptedPayload } : {}),
    },
    create: {
      userId,
      year,
      month,
      otherExpensesUsd,
      ...(hasEncrypted && body.encryptedPayload ? { encryptedPayload: body.encryptedPayload } : {}),
    },
    select: { userId: true, year: true, month: true, otherExpensesUsd: true, encryptedPayload: true },
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
  isClosed?: boolean;
};

function buildInvMonthMap(invId: string, rows: SnapRow[]) {
  const m = new Map<number, { capital: number | null; capitalUsd: number | null; isClosed?: boolean }>();
  for (const r of rows) {
    if (r.investmentId !== invId) continue;
    m.set(r.month, { capital: r.capital ?? null, capitalUsd: r.capitalUsd ?? null, isClosed: r.isClosed ?? false });
  }
  return m;
}

export async function buildAnnualData(userId: string, year: number): Promise<{ year: number; months: any[]; expensesUsdByMonth?: Record<number, number> }> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

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

  // -------- Other expenses (manual) per month from MonthlyBudget (include encryptedPayload for E2EE)
  const otherRows = await prisma.monthlyBudget.findMany({
    where: { userId, year },
    select: { month: true, otherExpensesUsd: true, encryptedPayload: true },
  });

  const otherByMonth = new Map<number, { otherExpensesUsd: number; encryptedPayload?: string | null }>();
  for (const r of otherRows) {
    otherByMonth.set(r.month, {
      otherExpensesUsd: r.otherExpensesUsd ?? 0,
      encryptedPayload: r.encryptedPayload ?? undefined,
    });
  }

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
    select: { investmentId: true, month: true, capital: true, capitalUsd: true, isClosed: true },
  });
  const explicitSnapshotMonths = new Set<number>();
  for (const s of snaps) {
    const cap = s.capital ?? 0;
    const capUsd = s.capitalUsd ?? 0;
    const hasMeaningfulValue = cap !== 0 || capUsd !== 0;
    // Ignore open 0/0 placeholders (common after onboarding/E2EE flows):
    // those should not reset net worth anchors/projections.
    if ((hasMeaningfulValue || s.isClosed) && s.month >= 1 && s.month <= 12) {
      explicitSnapshotMonths.add(s.month);
    }
  }

  // FX por mes (para convertir UYU si falta capitalUsd) — en paralelo
  const fxValues = await Promise.all(months12.map((m) => getUsdUyuRateForMonthOrDefault(userId, year, m)));
  const fxByMonth = new Map<number, number>();
  months12.forEach((m, i) => fxByMonth.set(m, fxValues[i]));

  function snapUsdFor(inv: InvLite, snap: { capital: number | null; capitalUsd: number | null; isClosed?: boolean }, m: number) {
    const cap = snap.capital;
    const capUsd = snap.capitalUsd;
    const isOpenZeroPlaceholder = !snap.isClosed && (cap ?? 0) === 0 && (capUsd ?? 0) === 0;
    if (isOpenZeroPlaceholder) return null;
    if (capUsd != null) return capUsd;
    if (cap == null) return null;

    const cur = (inv.currencyId ?? "USD").toUpperCase();
    if (cur === "USD") return snap.capital;

    if (cur === "UYU") {
      const fx = fxByMonth.get(m) ?? 38;
      return fx > 0 ? cap / fx : 0;
    }

    // moneda desconocida: asumimos USD
    return cap;
  }

  function capitalUsdPortfolio(inv: InvLite, byM: Map<number, { capital: number | null; capitalUsd: number | null; isClosed?: boolean }>, m: number) {
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

  function capitalUsdAccountCarry(inv: InvLite, byM: Map<number, { capital: number | null; capitalUsd: number | null; isClosed?: boolean }>, m: number) {
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

  // -------- Flows by month (Portfolio only, USD + UYU converted to USD)
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

    const cur = (mv.currencyId ?? "USD").toUpperCase();
    let amtUsd: number;
    if (cur === "USD") {
      amtUsd = Number(mv.amount ?? 0);
    } else if (cur === "UYU") {
      const rate = fxByMonth.get(m) ?? Number(process.env.DEFAULT_USD_UYU_RATE ?? 38);
      amtUsd = rate > 0 ? Number(mv.amount ?? 0) / rate : 0;
    } else {
      amtUsd = 0;
    }

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
      const otherData = otherByMonth.get(m);
      const otherExpensesUsd = otherData?.otherExpensesUsd ?? 0;
      const baseExpensesUsd = Math.max(0, (locked.expensesUsd ?? 0) - otherExpensesUsd);
      const lockedEncryptedPayload = (locked as { encryptedPayload?: string | null }).encryptedPayload ?? undefined;
      const isClosed = (locked as { isClosed?: boolean }).isClosed !== false;

      months.push({
        month: m,
        isClosed,
        incomeUsd: locked.incomeUsd,

        baseExpensesUsd,
        otherExpensesUsd,
        otherExpensesEncryptedPayload: otherData?.encryptedPayload ?? undefined,
        expensesUsd: locked.expensesUsd,

        investmentEarningsUsd: locked.investmentEarningsUsd,
        balanceUsd: locked.balanceUsd,
        netWorthUsd: locked.netWorthStartUsd,
        source: "locked" as const,
        ...(lockedEncryptedPayload ? { lockedEncryptedPayload } : {}),
      });

      prevNetWorthStart = locked.netWorthStartUsd;
      prevBalance = locked.balanceUsd;
      continue;
    }

    const incomeUsd = incomeByMonth.get(m) ?? 0;

    // Regla: si hay actuals, usamos actual.
    // Si no hay actuals, usamos drafts solo para mes actual/futuros.
    // Meses pasados sin actuals deben quedar en 0.
    const actualBase = actualByMonth.get(m) ?? 0;
    const plannedBase = plannedByMonth.get(m) ?? 0;
    const isPastMonth = year < currentYear || (year === currentYear && m < currentMonth);
    const baseExpensesUsd = actualBase > 0 ? actualBase : (isPastMonth ? 0 : plannedBase);

    const otherData = otherByMonth.get(m);
    const otherExpensesUsd = otherData?.otherExpensesUsd ?? 0;
    const expensesUsd = baseExpensesUsd + otherExpensesUsd;

    const investmentEarningsUsd = portfolioRealReturns[idx] ?? 0;
    const balanceUsd = incomeUsd - expensesUsd + investmentEarningsUsd;

    const chainedNetWorthStartUsd = m === 1 ? (totalNWBaseline[0] ?? 0) : prevNetWorthStart + prevBalance;
    const baselineNetWorthStartUsd = totalNWBaseline[idx] ?? chainedNetWorthStartUsd;
    // If user has an explicit snapshot in this month, anchor start net worth to baseline
    // so first active month reflects actual loaded capital (instead of carrying from prior months).
    const netWorthStartUsd = explicitSnapshotMonths.has(m) ? baselineNetWorthStartUsd : chainedNetWorthStartUsd;

    months.push({
      month: m,
      isClosed: false,
      incomeUsd,

      baseExpensesUsd,
      otherExpensesUsd,
      otherExpensesEncryptedPayload: otherData?.encryptedPayload ?? undefined,
      expensesUsd,

      investmentEarningsUsd,
      balanceUsd,
      netWorthUsd: netWorthStartUsd,
      source: "computed" as const,
    });

    prevNetWorthStart = netWorthStartUsd;
    prevBalance = balanceUsd;
  }

  // include the expense totals for callers that need them (pageData)
  const expenseObj: Record<number, number> = {};
  for (const [m, amt] of actualByMonth.entries()) expenseObj[m] = amt;
  return { year, months, expensesUsdByMonth: expenseObj };
}

export const annualBudget = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = parseYear(req.query);
  if (!year) return res.status(400).json({ error: "Provide year query param (e.g., ?year=2026)" });
  const data = await buildAnnualData(userId, year);
  res.json(data);
};

/** GET /budgets/page-data?year=YYYY - single payload for Presupuestos: annual, income, planned, expenses, investments, snapshots, movements. */
export const pageData = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const year = parseYear(req.query);
  if (!year) return res.status(400).json({ error: "Provide year query param (e.g., ?year=2026)" });
  const prevYear = year - 1;
  const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
  const prevYearStart = new Date(Date.UTC(prevYear, 0, 1, 0, 0, 0));
  const prevYearEnd = new Date(Date.UTC(prevYear + 1, 0, 1, 0, 0, 0));

  // buildAnnualData already scans expenses and produces base totals per month; reuse it
  const [annual, incomeRows, plannedRows, investments, movementRows, expenseRows] = await Promise.all([
    buildAnnualData(userId, year),
    prisma.income.findMany({
      where: { userId, year },
      orderBy: { month: "asc" },
      select: { id: true, month: true, amountUsd: true, nominalUsd: true, extraordinaryUsd: true, taxesUsd: true, encryptedPayload: true },
    }),
    prisma.plannedExpense.findMany({
      where: { userId, year },
      select: { month: true, amountUsd: true, encryptedPayload: true },
    }),
    // we only need minimal investment metadata here;
    // snapshots are fetched in bulk below
    prisma.investment.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, currencyId: true, targetAnnualReturn: true, yieldStartYear: true, yieldStartMonth: true },
    }),
    prisma.investmentMovement.findMany({
      where: { investment: { userId }, date: { gte: yearStart, lt: yearEnd } },
      orderBy: [{ date: "asc" }],
      select: { id: true, investmentId: true, date: true, type: true, amount: true, currencyId: true, encryptedPayload: true },
    }),
    prisma.expense.findMany({
      where: { userId, date: { gte: yearStart, lt: yearEnd } },
      orderBy: [{ date: "asc" }],
      select: { date: true, amountUsd: true, encryptedPayload: true },
    }),
  ]);

  const income = {
    year,
    rows: incomeRows.map((r) => {
      const nominal = r.nominalUsd ?? r.amountUsd ?? 0;
      const extraordinary = r.extraordinaryUsd ?? 0;
      const taxes = r.taxesUsd ?? 0;
      const totalUsd = r.nominalUsd != null ? nominal + extraordinary - taxes : (r.amountUsd ?? 0);
      return { id: r.id, month: r.month, totalUsd, encryptedPayload: r.encryptedPayload ?? undefined };
    }),
  };

  const planned = { year, rows: plannedRows.map((r) => ({ month: r.month, amountUsd: r.amountUsd ?? null, encryptedPayload: r.encryptedPayload ?? undefined })) };

  // Build a simple totals map for expenses by month.  buildAnnualData already computed it,
  // but we don't expose it there; we can reconstruct from the `annual` result instead
  // (the helper changed below). To avoid an extra query, we use `annual.expensesUsdByMonth`.
  // `annual` is modified to contain that map in the new helper.
  const expensesByMonth = { byMonth: Array.from({ length: 12 }, (_, i) => {
    const amt = (annual as any).expensesUsdByMonth?.[i + 1] ?? 0;
    // keep same shape consumed by front-end: array of objects with amountUsd
    return amt !== 0 ? [{ amountUsd: amt }] : [];
  }) };
  const yearExpensesByMonth = { byMonth: Array.from({ length: 12 }, () => [] as Array<{ amountUsd?: number; encryptedPayload?: string | null }>) };
  for (const row of expenseRows) {
    const monthIndex = row.date.getUTCMonth();
    if (monthIndex < 0 || monthIndex >= 12) continue;
    yearExpensesByMonth.byMonth[monthIndex]?.push({
      amountUsd: row.amountUsd ?? 0,
      encryptedPayload: row.encryptedPayload ?? undefined,
    });
  }

  const portfolios = investments.filter((i) => i.type === "PORTFOLIO");
  const portfolioIds = portfolios.map((p) => p.id);
  // batch snapshots in two simple queries instead of one per portfolio (N+1 problem)
  const allSnapsYear = await prisma.investmentSnapshot.findMany({
    where: { investmentId: { in: portfolioIds }, year },
    orderBy: { month: "asc" },
    select: { id: true, investmentId: true, year: true, month: true, capital: true, capitalUsd: true, encryptedPayload: true, isClosed: true },
  });
  const allSnapsPrevYear = await prisma.investmentSnapshot.findMany({
    where: { investmentId: { in: portfolioIds }, year: prevYear },
    orderBy: { month: "asc" },
    select: { id: true, investmentId: true, year: true, month: true, capital: true, capitalUsd: true, encryptedPayload: true, isClosed: true },
  });
  const allInvestmentSnapsYear = await prisma.investmentSnapshot.findMany({
    where: { investment: { userId }, year },
    orderBy: [{ investmentId: "asc" }, { month: "asc" }],
    select: { investmentId: true, month: true, capital: true, capitalUsd: true, encryptedPayload: true },
  });
  // group them into arrays in the same structure the front‑end expects
  const snapsByInv = new Map<string, typeof allSnapsYear>();
  for (const s of allSnapsYear) {
    const arr = snapsByInv.get(s.investmentId) ?? [];
    arr.push(s);
    snapsByInv.set(s.investmentId, arr);
  }
  const snapsByInvPrev = new Map<string, typeof allSnapsPrevYear>();
  for (const s of allSnapsPrevYear) {
    const arr = snapsByInvPrev.get(s.investmentId) ?? [];
    arr.push(s);
    snapsByInvPrev.set(s.investmentId, arr);
  }
  const snapshotsYear = portfolios.map((p) => snapsByInv.get(p.id) ?? []);
  const snapshotsPrevYear = portfolios.map((p) => snapsByInvPrev.get(p.id) ?? []);

  const snapToMonth = (snaps: { id?: string; month: number; capital: number | null; capitalUsd: number | null; encryptedPayload: string | null; isClosed?: boolean }[]) => {
    const map = new Map(snaps.map((s) => [s.month, s]));
    return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
      const s = map.get(m);
      return s
        ? { id: s.id ?? null, month: m, closingCapital: s.capital ?? null, closingCapitalUsd: s.capitalUsd ?? null, encryptedPayload: s.encryptedPayload ?? undefined, isClosed: s.isClosed ?? false }
        : { id: null, month: m, closingCapital: null, closingCapitalUsd: null, encryptedPayload: undefined, isClosed: false };
    });
  };
  const allSnapsByInv = new Map<string, typeof allInvestmentSnapsYear>();
  for (const s of allInvestmentSnapsYear) {
    const arr = allSnapsByInv.get(s.investmentId) ?? [];
    arr.push(s);
    allSnapsByInv.set(s.investmentId, arr);
  }

  const movements = {
    year,
    rows: movementRows.map((mv) => ({
      id: mv.id,
      investmentId: mv.investmentId,
      date: mv.date.toISOString().slice(0, 10),
      month: mv.date.getUTCMonth() + 1,
      type: mv.type,
      amount: mv.amount,
      currencyId: mv.currencyId,
      encryptedPayload: mv.encryptedPayload ?? undefined,
    })),
  };

  res.json({
    annual,
    income,
    planned,
    expensesByMonth,
    yearExpensesByMonth,
    investments: investments.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      currencyId: i.currencyId,
      targetAnnualReturn: i.targetAnnualReturn,
      yieldStartYear: i.yieldStartYear,
      yieldStartMonth: i.yieldStartMonth,
    })),
    snapshotsYear: snapshotsYear.map(snapToMonth),
    snapshotsPrevYear: snapshotsPrevYear.map(snapToMonth),
    investmentSnapshotsYear: investments.map((inv) => ({
      investmentId: inv.id,
      months: snapToMonth(allSnapsByInv.get(inv.id) ?? []),
    })),
    movements,
  });
};
