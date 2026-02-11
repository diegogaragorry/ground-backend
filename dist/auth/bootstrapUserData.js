"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapUserData = bootstrapUserData;
// src/auth/bootstrapUserData.ts
const prisma_1 = require("../lib/prisma");
const defaultTemplates_1 = require("./defaultTemplates");
async function bootstrapUserData(userId) {
    // 1. categorías únicas (con nameKey para i18n en frontend)
    const categories = Array.from(new Map(defaultTemplates_1.DEFAULT_TEMPLATES.map(t => [
        `${t.category}|${t.type}`,
        { name: t.category, expenseType: t.type, nameKey: t.categoryKey },
    ])).values());
    // 2. crear categorías
    const createdCategories = await prisma_1.prisma.$transaction(categories.map(c => prisma_1.prisma.category.create({
        data: {
            userId,
            name: c.name,
            expenseType: c.expenseType,
            nameKey: c.nameKey,
        },
    })));
    // 3. mapear categoryName+type → id
    const categoryMap = new Map(createdCategories.map(c => [`${c.name}|${c.expenseType}`, c.id]));
    // 4. crear templates (con descriptionKey para i18n en frontend)
    await prisma_1.prisma.$transaction(defaultTemplates_1.DEFAULT_TEMPLATES.map(t => prisma_1.prisma.expenseTemplate.create({
        data: {
            userId,
            expenseType: t.type,
            description: t.description,
            descriptionKey: t.descriptionKey,
            categoryId: categoryMap.get(`${t.category}|${t.type}`),
            defaultAmountUsd: null,
        },
    })));
}
