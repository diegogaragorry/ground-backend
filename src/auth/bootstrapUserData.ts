// src/auth/bootstrapUserData.ts
import { prisma } from "../lib/prisma";
import { DEFAULT_TEMPLATES } from "./defaultTemplates";

export async function bootstrapUserData(userId: string) {
  // 1. categorías únicas
  const categories = Array.from(
    new Map(
      DEFAULT_TEMPLATES.map(t => [
        `${t.category}|${t.type}`,
        { name: t.category, expenseType: t.type },
      ])
    ).values()
  );

  // 2. crear categorías
  const createdCategories = await prisma.$transaction(
    categories.map(c =>
      prisma.category.create({
        data: {
          userId,
          name: c.name,
          expenseType: c.expenseType,
        },
      })
    )
  );

  // 3. mapear categoryName+type → id
  const categoryMap = new Map(
    createdCategories.map(c => [`${c.name}|${c.expenseType}`, c.id])
  );

  // 4. crear templates (sin PlannedExpense: los drafts solo aparecen para lo que el usuario elige en onboarding o añade en Admin)
  await prisma.$transaction(
    DEFAULT_TEMPLATES.map(t =>
      prisma.expenseTemplate.create({
        data: {
          userId,
          expenseType: t.type,
          description: t.description,
          categoryId: categoryMap.get(`${t.category}|${t.type}`)!,
          defaultAmountUsd: null,
        },
      })
    )
  );
}