import { prisma } from "./prisma";

type PlannedVisibilityRow = {
  templateId?: string | null;
  isConfirmed?: boolean | null;
  expenseType: string;
  categoryId: string;
  description: string;
};

function plannedTemplateKey(row: Pick<PlannedVisibilityRow, "expenseType" | "categoryId" | "description">) {
  return [
    String(row.expenseType ?? "").trim(),
    String(row.categoryId ?? "").trim(),
    String(row.description ?? "").trim().toLowerCase(),
  ].join("::");
}

export async function filterVisiblePlannedRows<T extends PlannedVisibilityRow>(userId: string, rows: T[]): Promise<T[]> {
  const orphanDrafts = rows.filter((row) => row.templateId == null && row.isConfirmed !== true);
  if (orphanDrafts.length === 0) return rows;

  const hiddenTemplates = await prisma.expenseTemplate.findMany({
    where: { userId, showInExpenses: false },
    select: { expenseType: true, categoryId: true, description: true },
  });
  if (hiddenTemplates.length === 0) return rows;

  const hiddenKeys = new Set(hiddenTemplates.map(plannedTemplateKey));
  return rows.filter((row) => {
    if (row.templateId != null || row.isConfirmed === true) return true;
    return !hiddenKeys.has(plannedTemplateKey(row));
  });
}
