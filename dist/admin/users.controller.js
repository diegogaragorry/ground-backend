"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeMyPassword = exports.deleteUser = exports.updateUser = exports.createUser = exports.getRecentActivity = exports.listUsers = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../lib/prisma");
function cleanEmail(s) {
    const v = String(s ?? "").trim().toLowerCase();
    return v.includes("@") ? v : null;
}
function validatePassword(pw) {
    const v = String(pw ?? "");
    // ajustá la regla si querés (min 8 por ejemplo)
    if (v.length < 6)
        return null;
    return v;
}
// GET /admin/users (SUPER_ADMIN)
const listUsers = async (req, res) => {
    const rows = await prisma_1.prisma.user.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, role: true, createdAt: true },
    });
    res.json({ rows });
};
exports.listUsers = listUsers;
const RECENT_USERS_LIMIT = 25;
const RECENT_CODES_LIMIT = 40;
// GET /admin/recent-activity (SUPER_ADMIN) — últimos usuarios creados y últimos códigos de verificación (para ver en producción)
const getRecentActivity = async (req, res) => {
    const [recentUsers, recentCodes] = await Promise.all([
        prisma_1.prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            take: RECENT_USERS_LIMIT,
            select: { id: true, email: true, role: true, createdAt: true },
        }),
        prisma_1.prisma.emailVerificationCode.findMany({
            orderBy: { createdAt: "desc" },
            take: RECENT_CODES_LIMIT,
            select: {
                id: true,
                email: true,
                purpose: true,
                createdAt: true,
                expiresAt: true,
                usedAt: true,
                attempts: true,
            },
        }),
    ]);
    const now = new Date();
    const codesWithStatus = recentCodes.map((c) => ({
        ...c,
        status: c.usedAt ? "used" : c.expiresAt <= now ? "expired" : "pending",
    }));
    res.json({
        recentUsers,
        recentVerificationCodes: codesWithStatus,
        note: "Verification codes are sent in background; send errors are only logged server-side.",
    });
};
exports.getRecentActivity = getRecentActivity;
// POST /admin/users (SUPER_ADMIN)
const createUser = async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const role = req.body?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER";
    if (!email)
        return res.status(400).json({ error: "Invalid email" });
    if (!password)
        return res.status(400).json({ error: "Password min length is 6" });
    const hash = await bcryptjs_1.default.hash(password, 10);
    try {
        const user = await prisma_1.prisma.user.create({
            data: { email, password: hash, role },
            select: { id: true, email: true, role: true, createdAt: true },
        });
        res.status(201).json(user);
    }
    catch (e) {
        const msg = String(e?.message ?? "");
        if (msg.includes("Unique") || msg.includes("unique")) {
            return res.status(409).json({ error: "Email already exists" });
        }
        return res.status(500).json({ error: "Error creating user" });
    }
};
exports.createUser = createUser;
// PUT /admin/users/:id (SUPER_ADMIN)
const updateUser = async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    const email = req.body?.email != null ? cleanEmail(req.body.email) : undefined;
    const role = req.body?.role != null ? (req.body.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER") : undefined;
    const patch = {};
    if (email !== undefined) {
        if (!email)
            return res.status(400).json({ error: "Invalid email" });
        patch.email = email;
    }
    if (role !== undefined)
        patch.role = role;
    // password opcional
    if (req.body?.password != null) {
        const pw = validatePassword(req.body.password);
        if (!pw)
            return res.status(400).json({ error: "Password min length is 6" });
        patch.password = await bcryptjs_1.default.hash(pw, 10);
    }
    try {
        const user = await prisma_1.prisma.user.update({
            where: { id },
            data: patch,
            select: { id: true, email: true, role: true, createdAt: true },
        });
        res.json(user);
    }
    catch (e) {
        return res.status(500).json({ error: "Error updating user" });
    }
};
exports.updateUser = updateUser;
// DELETE /admin/users/:id (SUPER_ADMIN)
const deleteUser = async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!id)
        return res.status(400).json({ error: "Invalid id" });
    // (opcional) evitar que se borre a sí mismo:
    if (req.userId === id)
        return res.status(400).json({ error: "You can't delete yourself" });
    await prisma_1.prisma.user.delete({ where: { id } });
    res.status(204).send();
};
exports.deleteUser = deleteUser;
// POST /admin/me/password (USER + SUPER_ADMIN)
const changeMyPassword = async (req, res) => {
    const userId = req.userId;
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = validatePassword(req.body?.newPassword);
    if (!newPassword)
        return res.status(400).json({ error: "New password min length is 6" });
    const me = await prisma_1.prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!me)
        return res.status(404).json({ error: "User not found" });
    const ok = await bcryptjs_1.default.compare(currentPassword, me.password);
    if (!ok)
        return res.status(400).json({ error: "Current password is invalid" });
    const hash = await bcryptjs_1.default.hash(newPassword, 10);
    await prisma_1.prisma.user.update({ where: { id: userId }, data: { password: hash } });
    res.status(204).send();
};
exports.changeMyPassword = changeMyPassword;
