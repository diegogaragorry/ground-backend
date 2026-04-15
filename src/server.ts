import path from "path";
import dotenv from "dotenv";

// Cargar .env lo antes posible (Prisma necesita DATABASE_URL al primer uso)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import dns from "dns";

// Railway puede no tener IPv6; forzar IPv4 para SMTP (Gmail)
dns.setDefaultResultOrder("ipv4first");

import app from "./app";
import { startBillingScheduler } from "./billing/scheduler";
import { prisma } from "./lib/prisma";
import { startExpenseReminderScheduler } from "./reminders/scheduler";

const PORT = Number(process.env.PORT) || 3000;

async function ensureRuntimeSchema() {
  // Compatibilidad de despliegue: si Railway levantó el código antes de correr Prisma migrate,
  // agregamos la columna nueva para evitar que el backend quede caído por rollout parcial.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT
  `);
}

async function start() {
  await ensureRuntimeSchema();
  startBillingScheduler();
  startExpenseReminderScheduler();

  // Sin host para enlazar todas las interfaces (IPv4 + IPv6); Railway puede conectar por IPv6.
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
