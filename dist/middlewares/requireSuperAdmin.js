"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = requireSuperAdmin;
const prisma_1 = require("../lib/prisma");
async function requireSuperAdmin(req, res, next) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: "Unauthorized" });
    const me = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    if (!me || me.role !== "SUPER_ADMIN") {
        return res.status(403).json({ error: "Super admin only" });
    }
    next();
}
