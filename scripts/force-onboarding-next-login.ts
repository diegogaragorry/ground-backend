/**
 * Set forceOnboardingNextLogin = true for a user so they see the onboarding wizard on next login.
 * Usage: EMAIL=christian.fachola@gmail.com npx tsx scripts/force-onboarding-next-login.ts
 * For prod: DATABASE_URL="postgresql://..." EMAIL=christian.fachola@gmail.com npx tsx scripts/force-onboarding-next-login.ts
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { prisma } from "../src/lib/prisma";

const EMAIL = process.env.EMAIL?.trim()?.toLowerCase();

async function main() {
  if (!EMAIL || !EMAIL.includes("@")) {
    console.error("Set EMAIL (e.g. EMAIL=christian.fachola@gmail.com)");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.error("User not found:", EMAIL);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { forceOnboardingNextLogin: true },
  });

  console.log("OK: forceOnboardingNextLogin = true for", EMAIL);
  console.log("Next time they log in they will see the onboarding wizard.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
