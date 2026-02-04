"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = registerUser;
exports.loginUser = loginUser;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../prisma");
const JWT_SECRET = "super_secret_dev_key";
async function registerUser(data) {
    const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
    const user = await prisma_1.prisma.user.create({
        data: {
            email: data.email,
            password: hashedPassword,
        },
    });
    return { id: user.id, email: user.email };
}
async function loginUser(data) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { email: data.email },
    });
    if (!user)
        throw new Error("Invalid credentials");
    const valid = await bcrypt_1.default.compare(data.password, user.password);
    if (!valid)
        throw new Error("Invalid credentials");
    const token = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "1d",
    });
    return { token };
}
