import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = {
  name: string;
  capital: number;
  currencyId: "USD" | "UYU";
  capitalUsd: number;
  yieldStart: { year: number; month: number };
};

function n(s: string) {
  // "98,146" -> 98146
  return Number(s.replace(/,/g, ""));
}

async function main() {
  // Tomamos el primer user (como venís trabajando con 1 usuario)
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No users found. Run the app and register; then run 'npm run seed' again to load investments.");
    return;
  }

  const baseYear = 2026;
  const baseMonth = 1;

  const rows: Row[] = [
    { name: "Santander USD", capital: n("98,146"), currencyId: "USD", capitalUsd: n("98,146"), yieldStart: { year: 2026, month: 1 } },
    { name: "Santander UYU", capital: n("74,530"), currencyId: "UYU", capitalUsd: n("1,917"), yieldStart: { year: 2026, month: 1 } },
    { name: "CF UYU", capital: n("40,000"), currencyId: "UYU", capitalUsd: n("1,029"), yieldStart: { year: 2026, month: 1 } },
    { name: "CF USD", capital: n("6,496"), currencyId: "USD", capitalUsd: n("6,496"), yieldStart: { year: 2026, month: 1 } },
    { name: "SoySantander", capital: n("22,250"), currencyId: "UYU", capitalUsd: n("572"), yieldStart: { year: 2026, month: 1 } },
    { name: "Tarjeta Visa", capital: n("454"), currencyId: "USD", capitalUsd: n("454"), yieldStart: { year: 2026, month: 1 } },
    { name: "Wallet", capital: n("1,500"), currencyId: "UYU", capitalUsd: n("39"), yieldStart: { year: 2026, month: 1 } },
    { name: "MercadoPago", capital: n("1,170"), currencyId: "UYU", capitalUsd: n("30"), yieldStart: { year: 2026, month: 1 } },
    { name: "Scotiabank", capital: n("3,000"), currencyId: "USD", capitalUsd: n("3,000"), yieldStart: { year: 2026, month: 1 } },
    { name: "Stocks NS", capital: n("56,342"), currencyId: "USD", capitalUsd: n("56,342"), yieldStart: { year: 2026, month: 1 } },
    { name: "Prenda Alquiler", capital: n("5,550"), currencyId: "USD", capitalUsd: n("5,550"), yieldStart: { year: 2026, month: 1 } },
    { name: "Seguro muebles", capital: n("3,700"), currencyId: "USD", capitalUsd: n("3,700"), yieldStart: { year: 2026, month: 1 } },
    { name: "Urraburu", capital: n("358,708"), currencyId: "USD", capitalUsd: n("358,708"), yieldStart: { year: 2026, month: 1 } },
    { name: "Pershing", capital: n("313,112"), currencyId: "USD", capitalUsd: n("313,112"), yieldStart: { year: 2026, month: 1 } },
    { name: "Sura", capital: n("56,010"), currencyId: "USD", capitalUsd: n("56,010"), yieldStart: { year: 2026, month: 1 } },
    { name: "Bricksave", capital: n("21,039"), currencyId: "USD", capitalUsd: n("21,039"), yieldStart: { year: 2026, month: 1 } },
    { name: "Alquiler", capital: n("220,000"), currencyId: "USD", capitalUsd: n("220,000"), yieldStart: { year: 2026, month: 1 } },
    { name: "Ventura", capital: n("7,932"), currencyId: "USD", capitalUsd: n("7,932"), yieldStart: { year: 2026, month: 4 } }, // Abril
    { name: "Taxi", capital: n("192,058"), currencyId: "USD", capitalUsd: n("192,058"), yieldStart: { year: 2026, month: 2 } }, // Febrero
    { name: "Prex", capital: n("371"), currencyId: "USD", capitalUsd: n("371"), yieldStart: { year: 2026, month: 1 } },
    { name: "Binance", capital: n("64"), currencyId: "USD", capitalUsd: n("64"), yieldStart: { year: 2026, month: 1 } },
    { name: "Coinbase (wallet)", capital: n("30"), currencyId: "USD", capitalUsd: n("30"), yieldStart: { year: 2026, month: 1 } },
  ];

  for (const r of rows) {
    // Encontramos por (userId, name) (sin unique formal)
    const existing = await prisma.investment.findFirst({
      where: { userId: user.id, name: r.name },
    });

    const inv = existing
      ? await prisma.investment.update({
          where: { id: existing.id },
          data: {
            type: "PORTFOLIO",
            currencyId: r.currencyId,
            targetAnnualReturn: 0, // lo seteás desde UI
            yieldStartYear: r.yieldStart.year,
            yieldStartMonth: r.yieldStart.month,
          },
        })
      : await prisma.investment.create({
          data: {
            userId: user.id,
            name: r.name,
            type: "PORTFOLIO",
            currencyId: r.currencyId,
            targetAnnualReturn: 0,
            yieldStartYear: r.yieldStart.year,
            yieldStartMonth: r.yieldStart.month,
          },
        });

    await prisma.investmentSnapshot.upsert({
      where: {
        investmentId_year_month: {
          investmentId: inv.id,
          year: baseYear,
          month: baseMonth,
        },
      },
      create: {
        investmentId: inv.id,
        year: baseYear,
        month: baseMonth,
        capital: r.capital,
        capitalUsd: r.capitalUsd,
        isClosed: false,
      },
      update: {
        capital: r.capital,
        capitalUsd: r.capitalUsd,
      },
    });
  }

  console.log(`Seed OK: ${rows.length} investments + snapshots for ${baseYear}-${baseMonth}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
