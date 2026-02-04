/* scripts/sync-investment-snapshots.js */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// =======================
// CONFIG / INPUT
// =======================

const USER_EMAIL = process.env.USER_EMAIL;
if (!USER_EMAIL) {
  console.error('❌ Falta USER_EMAIL. Ej: USER_EMAIL="secure2@test.com" node scripts/sync-investment-snapshots.js');
  process.exit(1);
}

// Mapeo exacto desde la planilla -> Investment.name en DB
// Nota: hay fondos duplicados por moneda (Santander/CF), por eso es por (fondo + moneda)
function mapFundName(sheetFund, currencyId) {
  const key = `${sheetFund}__${currencyId}`;

  const map = {
    "Santander__USD": "Santander USD",
    "Santander__UYU": "Santander UYU",

    "CF__USD": "CF USD",
    "CF__UYU": "CF UYU",

    // Planilla: "Coinbase (wallet)" / DB: "Coinbase Wallet"
    "Coinbase (wallet)__USD": "Coinbase Wallet",
    "Coinbase (wallet)__UYU": "Coinbase Wallet",

    // El resto suele matchear directo
  };

  return map[key] ?? sheetFund;
}

// Planilla embebida (tu tabla)
const ROWS = [
  // Dec/2025
  ["Dec/2025","Caja","Santander",262364,"USD",262364],
  ["Dec/2025","Caja","Santander",234803,"UYU",5971],
  ["Dec/2025","Caja","CF",40000,"UYU",1017],
  ["Dec/2025","Caja","CF",6496,"USD",6496],
  ["Dec/2025","Caja","Wallet",500,"UYU",13],
  ["Dec/2025","Caja","MercadoPago",2960,"UYU",75],
  ["Dec/2025","Caja","Stocks NS",56342,"USD",56342],
  ["Dec/2025","Inversiones","Prenda Alquiler",5550,"USD",5550],
  ["Dec/2025","Inversiones","Seguro muebles",3700,"USD",3700],
  ["Dec/2025","Inversiones","Urraburu",350478,"USD",350478],
  ["Dec/2025","Inversiones","Pershing",291864,"USD",291864],
  ["Dec/2025","Inversiones","LatinSec",55585,"USD",55585],
  ["Dec/2025","Inversiones","Bricksave",20758,"USD",20758],
  ["Dec/2025","Inversiones","Alquiler",220000,"USD",220000],
  ["Dec/2025","Inversiones","Ventura",5000,"USD",5000],
  ["Dec/2025","Inversiones","Taxi",18000,"USD",18000],
  ["Dec/2025","Inversiones","Santander",0,"USD",0],
  ["Dec/2025","Inversiones","Prex",371,"USD",371],
  ["Dec/2025","Inversiones","Binance",64,"USD",64],
  ["Dec/2025","Inversiones","Coinbase (wallet)",30,"USD",30],

  // Jan/2026
  ["Jan/2026","Caja","Santander",267217,"USD",267217],
  ["Jan/2026","Caja","Santander",140586,"UYU",3575],
  ["Jan/2026","Caja","CF",40000,"UYU",1017],
  ["Jan/2026","Caja","CF",6496,"USD",6496],
  ["Jan/2026","Caja","SoySantander",18501,"UYU",470],
  ["Jan/2026","Caja","Tarjeta Visa",1473,"USD",1473],
  ["Jan/2026","Caja","Wallet",1390,"UYU",35],
  ["Jan/2026","Caja","MercadoPago",152,"UYU",4],
  ["Jan/2026","Caja","Stocks NS",56342,"USD",56342],
  ["Jan/2026","Inversiones","Prenda Alquiler",5550,"USD",5550],
  ["Jan/2026","Inversiones","Seguro muebles",3700,"USD",3700],
  ["Jan/2026","Inversiones","Urraburu",353150,"USD",353150],
  ["Jan/2026","Inversiones","Pershing",293595,"USD",293595],
  ["Jan/2026","Inversiones","LatinSec",55814,"USD",55814],
  ["Jan/2026","Inversiones","Bricksave",20899,"USD",20899],
  ["Jan/2026","Inversiones","Alquiler",220000,"USD",220000],
  ["Jan/2026","Inversiones","Ventura",5000,"USD",5000],
  ["Jan/2026","Inversiones","Taxi",18000,"USD",18000],
  ["Jan/2026","Inversiones","Prex",371,"USD",371],
  ["Jan/2026","Inversiones","Binance",64,"USD",64],
  ["Jan/2026","Inversiones","Coinbase (wallet)",30,"USD",30],

  // Feb/2026
  ["Feb/2026","Caja","Santander",98142,"USD",98142],
  ["Feb/2026","Caja","Santander",62905,"UYU",1656],
  ["Feb/2026","Caja","CF",40000,"UYU",1053],
  ["Feb/2026","Caja","CF",6496,"USD",6496],
  ["Feb/2026","Caja","SoySantander",22250,"UYU",586],
  ["Feb/2026","Caja","Tarjeta Visa",454,"USD",454],
  ["Feb/2026","Caja","Wallet",1500,"UYU",39],
  ["Feb/2026","Caja","MercadoPago",1170,"UYU",31],
  ["Feb/2026","Caja","Scotiabank",3000,"USD",3000],
  ["Feb/2026","Caja","Stocks NS",56342,"USD",56342],
  ["Feb/2026","Inversiones","Prenda Alquiler",5550,"USD",5550],
  ["Feb/2026","Inversiones","Seguro muebles",3700,"USD",3700],
  ["Feb/2026","Inversiones","Urraburu",355365,"USD",355365],
  ["Feb/2026","Inversiones","Pershing",310075,"USD",310075],
  ["Feb/2026","Inversiones","LatinSec",56135,"USD",56135],
  ["Feb/2026","Inversiones","Bricksave",21039,"USD",21039],
  ["Feb/2026","Inversiones","Alquiler",220000,"USD",220000],
  ["Feb/2026","Inversiones","Ventura",7932,"USD",7932],
  ["Feb/2026","Inversiones","Taxi",192058,"USD",192058],
  ["Feb/2026","Inversiones","Prex",371,"USD",371],
  ["Feb/2026","Inversiones","Binance",64,"USD",64],
  ["Feb/2026","Inversiones","Coinbase (wallet)",30,"USD",30],
];

function parseMonthLabel(label) {
  // "Dec/2025" => {year: 2025, month: 12}
  const [monStr, yearStr] = label.split("/");
  const year = Number(yearStr);
  const map = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
  const month = map[monStr];
  if (!year || !month) throw new Error(`Fecha inválida: ${label}`);
  return { year, month };
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`No existe User con email=${USER_EMAIL}`);

  // Traemos inversiones del usuario a un map (name -> id)
  const invs = await prisma.investment.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  const invByName = new Map(invs.map((i) => [i.name, i.id]));

  // Validación previa: asegurar que cada fondo mapeado exista
  const missing = new Set();
  for (const [fecha, _tipo, fondo, _valorReal, moneda] of ROWS) {
    const mappedName = mapFundName(fondo, moneda);
    if (!invByName.has(mappedName)) missing.add(mappedName);
  }
  if (missing.size) {
    console.error("❌ ERROR: No existen Investment para estos fondos (name exacto):");
    for (const n of [...missing].sort()) console.error(`- ${n}`);
    process.exit(1);
  }

  let upserts = 0;

  for (const [fecha, _tipo, fondo, valorReal, moneda, valorUsd] of ROWS) {
    const { year, month } = parseMonthLabel(fecha);
    const investmentName = mapFundName(fondo, moneda);
    const investmentId = invByName.get(investmentName);

    // Upsert por unique (investmentId, year, month)
    await prisma.investmentSnapshot.upsert({
      where: {
        investmentId_year_month: {
          investmentId,
          year,
          month,
        },
      },
      update: {
        capital: Number(valorReal),
        capitalUsd: Number(valorUsd),
        // no tocamos isClosed
      },
      create: {
        investmentId,
        year,
        month,
        capital: Number(valorReal),
        capitalUsd: Number(valorUsd),
        // isClosed default false
      },
    });

    upserts += 1;
  }

  console.log(`✅ OK: upserted ${upserts} snapshots for user ${USER_EMAIL}`);
}

main()
  .catch((e) => {
    console.error("❌ ERROR:", e.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });