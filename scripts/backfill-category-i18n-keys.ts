/**
 * Backfill nameKey on Category and descriptionKey on ExpenseTemplate for existing users.
 * So default categories and template descriptions show in the user's language in the frontend.
 *
 * Usage: npx tsx scripts/backfill-category-i18n-keys.ts
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { prisma } from "../src/lib/prisma";
import { DEFAULT_TEMPLATES } from "../src/auth/defaultTemplates";

async function main() {
  // Map (categoryName, expenseType) -> categoryKey
  const categoryKeyByKey = new Map<string, string>();
  for (const t of DEFAULT_TEMPLATES) {
    const key = `${t.category}|${t.type}`;
    if (!categoryKeyByKey.has(key)) categoryKeyByKey.set(key, t.categoryKey);
  }

  // Map (description, expenseType) -> descriptionKey
  const descriptionKeyByKey = new Map<string, string>();
  for (const t of DEFAULT_TEMPLATES) {
    const key = `${t.description}|${t.type}`;
    descriptionKeyByKey.set(key, t.descriptionKey);
  }

  // 1) Update categories that match default (name, expenseType) and have no nameKey
  const categories = await prisma.category.findMany({
    where: { nameKey: null },
  });

  let categoriesUpdated = 0;
  for (const c of categories) {
    const mapKey = `${c.name}|${c.expenseType}`;
    const nameKey = categoryKeyByKey.get(mapKey);
    if (nameKey) {
      await prisma.category.update({
        where: { id: c.id },
        data: { nameKey },
      });
      categoriesUpdated++;
    }
  }

  // 2) Update expense templates that match default (description, expenseType) and have no descriptionKey
  const templates = await prisma.expenseTemplate.findMany({
    where: { descriptionKey: null },
  });

  let templatesUpdated = 0;
  for (const t of templates) {
    const mapKey = `${t.description}|${t.expenseType}`;
    const descriptionKey = descriptionKeyByKey.get(mapKey);
    if (descriptionKey) {
      await prisma.expenseTemplate.update({
        where: { id: t.id },
        data: { descriptionKey },
      });
      templatesUpdated++;
    }
  }

  console.log(`Categories updated: ${categoriesUpdated}`);
  console.log(`Templates updated: ${templatesUpdated}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
