"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Cargar .env lo antes posible (Prisma necesita DATABASE_URL al primer uso)
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "..", ".env") });
const dns_1 = __importDefault(require("dns"));
// Railway puede no tener IPv6; forzar IPv4 para SMTP (Gmail)
dns_1.default.setDefaultResultOrder("ipv4first");
const app_1 = __importDefault(require("./app"));
const PORT = Number(process.env.PORT) || 3000;
// Sin host para enlazar todas las interfaces (IPv4 + IPv6); Railway puede conectar por IPv6.
app_1.default.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
});
