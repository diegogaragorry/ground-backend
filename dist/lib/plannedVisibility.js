"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterVisiblePlannedRows = filterVisiblePlannedRows;
const prisma_1 = require("./prisma");
function plannedTemplateKey(row) {
    return [
        String(row.expenseType ?? "").trim(),
        String(row.categoryId ?? "").trim(),
        String(row.description ?? "").trim().toLowerCase(),
    ].join("::");
}
async function filterVisiblePlannedRows(userId, rows) {
    const orphanDrafts = rows.filter((row) => row.templateId == null && row.isConfirmed !== true);
    if (orphanDrafts.length === 0)
        return rows;
    const hiddenTemplates = await prisma_1.prisma.expenseTemplate.findMany({
        where: { userId, showInExpenses: false },
        select: { expenseType: true, categoryId: true, description: true },
    });
    if (hiddenTemplates.length === 0)
        return rows;
    const hiddenKeys = new Set(hiddenTemplates.map(plannedTemplateKey));
    return rows.filter((row) => {
        if (row.templateId != null || row.isConfirmed === true)
            return true;
        return !hiddenKeys.has(plannedTemplateKey(row));
    });
}
