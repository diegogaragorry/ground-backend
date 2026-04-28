// src/auth/bootstrapUserData.ts
import { prisma } from "../lib/prisma";
import { DEFAULT_CATEGORIES } from "./defaultTemplates";

export async function bootstrapUserData(userId: string) {
  // New accounts start with a small, useful category set. Templates are created only
  // when the user picks them in onboarding or adds them from settings.
  await prisma.$transaction(
    DEFAULT_CATEGORIES.map(c =>
      prisma.category.create({
        data: {
          userId,
          name: c.name,
          expenseType: c.type,
          nameKey: c.nameKey,
        },
      })
    )
  );
}
