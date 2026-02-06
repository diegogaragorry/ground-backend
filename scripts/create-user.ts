/**
 * One-off script to create a user with bootstrap (categories, templates, drafts, bank account).
 * Usage: npx tsx scripts/create-user.ts
 * Or:    EMAIL=iturgara@gmail.com PASSWORD=passuser npx tsx scripts/create-user.ts
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma";
import { bootstrapUserData } from "../src/auth/bootstrapUserData";

const EMAIL = process.env.EMAIL ?? "iturgara@gmail.com";
const PASSWORD = process.env.PASSWORD ?? "passuser";

async function main() {
  const email = EMAIL.trim().toLowerCase();
  if (!email.includes("@")) {
    console.error("Invalid EMAIL");
    process.exit(1);
  }
  if (PASSWORD.length < 6) {
    console.error("PASSWORD must be at least 6 characters");
    process.exit(1);
  }

  const hash = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error("User already exists:", email);
    process.exit(1);
  }

  const user = await prisma.user.create({
    data: { email, password: hash, role: "USER" },
  });

  await bootstrapUserData(user.id);

  await prisma.investment.create({
    data: {
      userId: user.id,
      name: "Bank Account",
      type: "ACCOUNT",
      currencyId: "USD",
      targetAnnualReturn: 0,
      yieldStartYear: new Date().getUTCFullYear(),
      yieldStartMonth: 1,
    },
  });

  console.log("User created:", user.email, "(id:", user.id, ")");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
