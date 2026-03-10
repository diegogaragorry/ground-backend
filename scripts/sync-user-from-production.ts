/**
 * Trae de producción todos los datos de un usuario y los inserta en la base local,
 * reemplazando al usuario con ese email si ya existe.
 *
 * Uso:
 *   1. En .env tené DATABASE_URL (local).
 *   2. Pasá la URL de producción (ej. desde Railway):
 *      PRODUCTION_DATABASE_URL="postgresql://..." SYNC_USER_EMAIL="diego.garagorry@gmail.com" npx tsx scripts/sync-user-from-production.ts
 *
 * Requiere: PRODUCTION_DATABASE_URL y opcionalmente SYNC_USER_EMAIL (default: diego.garagorry@gmail.com).
 */

import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { Prisma, PrismaClient } from "@prisma/client";

const PRODUCTION_DATABASE_URL = process.env.PRODUCTION_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const SYNC_USER_EMAIL = (process.env.SYNC_USER_EMAIL ?? "diego.garagorry@gmail.com").trim().toLowerCase();

if (!PRODUCTION_DATABASE_URL) {
  console.error("Falta PRODUCTION_DATABASE_URL (ej. desde Railway → Postgres → Variables).");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL en .env (base local).");
  process.exit(1);
}

const prodPrisma = new PrismaClient({
  datasources: { db: { url: PRODUCTION_DATABASE_URL } },
});
const localPrisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

type RawRow = Record<string, unknown>;

/** Añade campos opcionales que puede no tener el esquema de prod (ej. encryptedPayload, isClosed). */
function withOptionals<T extends RawRow>(row: T, defaults: Record<string, unknown>): T {
  const out = { ...row };
  for (const [k, v] of Object.entries(defaults)) if (!(k in out) || out[k] === undefined) out[k] = v;
  return out as T;
}

/** Ejecuta query en prod; si la tabla no existe (42P01), devuelve [] */
async function prodQueryRaw<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const code = (err as { meta?: { code?: string }; code?: string })?.meta?.code ?? (err as { code?: string })?.code;
    if (code === "42P01" || code === "P2010") return fallback;
    throw err;
  }
}

async function main() {
  console.log("Usuario a sincronizar:", SYNC_USER_EMAIL);
  console.log("Leyendo datos desde producción (raw SQL para tolerar esquema distinto)...");

  const prodUserRows = await prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "User" WHERE email = ${SYNC_USER_EMAIL}`;
  const prodUserRow = prodUserRows[0];
  if (!prodUserRow) {
    console.error("No existe el usuario en producción:", SYNC_USER_EMAIL);
    process.exit(1);
  }
  const userId = prodUserRow.id as string;
  const prodUser = {
    id: prodUserRow.id,
    email: prodUserRow.email,
    password: prodUserRow.password,
    firstName: prodUserRow.firstName ?? null,
    lastName: prodUserRow.lastName ?? null,
    country: prodUserRow.country ?? null,
    preferredLanguage: prodUserRow.preferredLanguage ?? null,
    role: prodUserRow.role,
    createdAt: prodUserRow.createdAt,
    forceOnboardingNextLogin: prodUserRow.forceOnboardingNextLogin ?? false,
    onboardingStep: prodUserRow.onboardingStep ?? "welcome",
    mobileWarningDismissed: prodUserRow.mobileWarningDismissed ?? false,
    preferredDisplayCurrencyId: prodUserRow.preferredDisplayCurrencyId ?? null,
    encryptionSalt: prodUserRow.encryptionSalt ?? null,
    phone: prodUserRow.phone ?? null,
    phoneVerifiedAt: prodUserRow.phoneVerifiedAt ?? null,
    encryptedRecoveryPackage: prodUserRow.encryptedRecoveryPackage ?? null,
  };

  const [
    categories,
    investments,
    incomes,
    expensePlans,
    periods,
    monthlyBudgets,
    expenseTemplates,
    plannedExpenses,
    budgets,
    expenses,
    monthCloses,
    loginLogs,
    phoneVerificationCodes,
    recoverySessions,
    recoveryTokens,
    billingSubscriptions,
    billingEvents,
  ] = await Promise.all([
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Category" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Investment" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Income" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "ExpensePlan" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Period" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "MonthlyBudget" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "ExpenseTemplate" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "PlannedExpense" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Budget" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Expense" WHERE "userId" = ${userId}`,
    prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "MonthClose" WHERE "userId" = ${userId}`,
    prodQueryRaw(() => prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "LoginLog" WHERE "userId" = ${userId}`, []),
    prodQueryRaw(() => prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "PhoneVerificationCode" WHERE "userId" = ${userId}`, []),
    prodQueryRaw(() => prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "RecoverySession" WHERE "userId" = ${userId}`, []),
    prodQueryRaw(() => prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "RecoveryToken" WHERE "userId" = ${userId}`, []),
    prodQueryRaw(() => prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "BillingSubscription" WHERE "userId" = ${userId}`, []),
    prodQueryRaw(() => prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "BillingEvent" WHERE "userId" = ${userId}`, []),
  ]);

  const investmentIds = new Set<string>(investments.map((i) => i.id as string));
  const invIdsArr = [...investmentIds];
  const movements =
    invIdsArr.length > 0
      ? await prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "InvestmentMovement" WHERE "investmentId" IN (${Prisma.join(invIdsArr)})`
      : [];
  const snapshots =
    invIdsArr.length > 0
      ? await prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "InvestmentSnapshot" WHERE "investmentId" IN (${Prisma.join(invIdsArr)})`
      : [];

  const currencyIds = new Set<string>();
  for (const e of expenses) currencyIds.add(e.currencyId as string);
  for (const b of budgets) currencyIds.add(b.currencyId as string);
  for (const m of movements) currencyIds.add(m.currencyId as string);
  for (const i of investments) if (i.currencyId) currencyIds.add(i.currencyId as string);
  for (const inc of incomes) if (inc.currencyId) currencyIds.add(inc.currencyId as string);
  const currIdsArr = [...currencyIds];
  const currencies =
    currIdsArr.length > 0
      ? await prodPrisma.$queryRaw<RawRow[]>`SELECT * FROM "Currency" WHERE id IN (${Prisma.join(currIdsArr)})`
      : [];

  await prodPrisma.$disconnect();

  console.log(
    `Prod: User 1, Categories ${categories.length}, Investments ${investments.length}, Incomes ${incomes.length}, Expenses ${expenses.length}, MonthCloses ${monthCloses.length}, etc.`
  );

  console.log("Escribiendo en base local (reemplazando usuario con ese email)...");

  await localPrisma.$transaction(async (tx) => {
    const deleted = await tx.user.deleteMany({ where: { email: SYNC_USER_EMAIL } });
    if (deleted.count > 0) console.log("  Usuario local con ese email eliminado (y datos en cascada).");

    for (const c of currencies) {
      const id = c.id as string;
      const name = c.name as string;
      await tx.currency.upsert({
        where: { id },
        create: { id, name },
        update: { name },
      });
    }

    await tx.user.create({
      data: {
        id: prodUser.id,
        email: prodUser.email,
        password: prodUser.password,
        firstName: prodUser.firstName,
        lastName: prodUser.lastName,
        country: prodUser.country,
        preferredLanguage: prodUser.preferredLanguage,
        role: prodUser.role,
        createdAt: prodUser.createdAt,
        forceOnboardingNextLogin: prodUser.forceOnboardingNextLogin,
        onboardingStep: prodUser.onboardingStep,
        mobileWarningDismissed: prodUser.mobileWarningDismissed,
        preferredDisplayCurrencyId: prodUser.preferredDisplayCurrencyId,
        encryptionSalt: prodUser.encryptionSalt,
        phone: prodUser.phone,
        phoneVerifiedAt: prodUser.phoneVerifiedAt,
        encryptedRecoveryPackage: prodUser.encryptedRecoveryPackage,
      },
    });

    const opt = (keys: Record<string, unknown>) => (row: RawRow) => withOptionals(row, keys);
    if (categories.length) await tx.category.createMany({ data: categories.map(opt({ nameKey: null })) });
    if (investments.length) await tx.investment.createMany({ data: investments });
    if (incomes.length) await tx.income.createMany({ data: incomes.map(opt({ encryptedPayload: null, nominalUsd: null, extraordinaryUsd: null, taxesUsd: null })) });
    if (expensePlans.length) await tx.expensePlan.createMany({ data: expensePlans });
    if (periods.length) await tx.period.createMany({ data: periods });
    if (monthlyBudgets.length) await tx.monthlyBudget.createMany({ data: monthlyBudgets.map(opt({ encryptedPayload: null })) });
    if (expenseTemplates.length) await tx.expenseTemplate.createMany({ data: expenseTemplates.map(opt({ encryptedPayload: null, descriptionKey: null, defaultCurrencyId: null, showInExpenses: true })) });
    if (plannedExpenses.length) await tx.plannedExpense.createMany({ data: plannedExpenses.map(opt({ encryptedPayload: null, amountUsd: null, amount: null, usdUyuRate: null })) });
    if (budgets.length) await tx.budget.createMany({ data: budgets.map(opt({ encryptedPayload: null })) });
    if (expenses.length) await tx.expense.createMany({ data: expenses.map(opt({ encryptedPayload: null, plannedExpenseId: null })) });
    if (movements.length) await tx.investmentMovement.createMany({ data: movements.map(opt({ encryptedPayload: null })) });
    if (snapshots.length) await tx.investmentSnapshot.createMany({ data: snapshots.map(opt({ encryptedPayload: null, isClosed: false })) });
    if (monthCloses.length) await tx.monthClose.createMany({ data: monthCloses.map(opt({ encryptedPayload: null, isClosed: true, netWorthEndUsd: null })) });
    if (loginLogs.length) await tx.loginLog.createMany({ data: loginLogs });
    if (phoneVerificationCodes.length) await tx.phoneVerificationCode.createMany({ data: phoneVerificationCodes });
    if (recoverySessions.length) await tx.recoverySession.createMany({ data: recoverySessions });
    if (recoveryTokens.length) await tx.recoveryToken.createMany({ data: recoveryTokens });
    if (billingSubscriptions.length) await tx.billingSubscription.createMany({ data: billingSubscriptions });
    if (billingEvents.length) await tx.billingEvent.createMany({ data: billingEvents });
  });

  await localPrisma.$disconnect();
  console.log("Listo. Usuario y todos sus datos están en la base local.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
