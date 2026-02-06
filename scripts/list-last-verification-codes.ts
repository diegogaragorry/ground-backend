/**
 * Lista los últimos códigos de verificación (registro o reset). No muestra el código en claro (solo se guarda el hash).
 * Uso: npx tsx scripts/list-last-verification-codes.ts
 * Prod: DATABASE_URL="postgresql://..." npx tsx scripts/list-last-verification-codes.ts
 *
 * Opcional: PURPOSE=signup o PURPOSE=reset_password (default: ambos)
 * Opcional: LIMIT=10 (default: 20)
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { prisma } from "../src/lib/prisma";

const PURPOSE = process.env.PURPOSE?.trim() || undefined; // "signup" | "reset_password" | undefined = ambos
const LIMIT = Math.min(100, Math.max(1, parseInt(process.env.LIMIT || "20", 10) || 20));

async function main() {
  const where = PURPOSE ? { purpose: PURPOSE } : {};

  const rows = await prisma.emailVerificationCode.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      email: true,
      purpose: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      attempts: true,
      ip: true,
    },
  });

  if (rows.length === 0) {
    console.log("No hay registros" + (PURPOSE ? ` con purpose=${PURPOSE}` : "") + ".");
    return;
  }

  console.log(`Últimos ${rows.length} códigos de verificación (el código en sí no se guarda, solo un hash):\n`);

  const now = new Date();
  for (const r of rows) {
    const expired = r.expiresAt <= now;
    const used = !!r.usedAt;
    const status = used ? "usado" : expired ? "expirado" : "válido";
    console.log({
      email: r.email,
      purpose: r.purpose,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      attempts: r.attempts,
      status,
      ip: r.ip ?? undefined,
    });
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
