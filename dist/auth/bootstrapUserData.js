"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapUserData = bootstrapUserData;
// src/auth/bootstrapUserData.ts
const prisma_1 = require("../lib/prisma");
const defaultTemplates_1 = require("./defaultTemplates");
async function bootstrapUserData(userId) {
    // New accounts start with a small, useful category set. Templates are created only
    // when the user picks them in onboarding or adds them from settings.
    await prisma_1.prisma.$transaction(defaultTemplates_1.DEFAULT_CATEGORIES.map(c => prisma_1.prisma.category.create({
        data: {
            userId,
            name: c.name,
            expenseType: c.type,
            nameKey: c.nameKey,
        },
    })));
}
