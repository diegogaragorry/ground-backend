"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Cargar .env desde la raíz del backend (funciona aunque se ejecute desde otro directorio)
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "..", ".env") });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_routes_1 = __importDefault(require("./auth/auth.routes"));
const requireAuth_1 = require("./middlewares/requireAuth");
const categories_routes_1 = __importDefault(require("./categories/categories.routes"));
const expenses_routes_1 = __importDefault(require("./expenses/expenses.routes"));
const budgets_routes_1 = __importDefault(require("./budgets/budgets.routes"));
const investments_routes_1 = __importDefault(require("./investments/investments.routes"));
const income_routes_1 = __importDefault(require("./income/income.routes"));
const periods_routes_1 = __importDefault(require("./periods/periods.routes"));
const expensePlans_routes_1 = __importDefault(require("./expensePlans/expensePlans.routes"));
const investmentMovements_routes_1 = __importDefault(require("./investmentMovements/investmentMovements.routes"));
const networth_routes_1 = __importDefault(require("./networth/networth.routes"));
const monthCloses_routes_1 = __importDefault(require("./monthCloses/monthCloses.routes"));
const admin_routes_1 = __importDefault(require("./admin/admin.routes"));
const plannedExpenses_routes_1 = __importDefault(require("./plannedExpenses/plannedExpenses.routes"));
const app = (0, express_1.default)();
// ✅ CORS: orígenes permitidos (Vercel, ground.finance y subdominios, localhost).
const allowedOrigins = [
    /^https:\/\/[\w.-]+\.vercel\.app\/?$/, // cualquier deployment Vercel (prod + preview)
    /^https:\/\/([\w.-]+\.)?ground\.finance\/?$/, // ground.finance, www.ground.finance, con o sin /
    /^https?:\/\/localhost(:\d+)?\/?$/, // dev local
];
function isOriginAllowed(origin) {
    if (!origin)
        return true;
    if (allowedOrigins.some((re) => re.test(origin)))
        return true;
    try {
        const u = new URL(origin);
        if (u.hostname.endsWith("ground.finance") || u.hostname.endsWith("vercel.app"))
            return true;
        if (u.hostname === "localhost")
            return true;
    }
    catch {
        /* ignore */
    }
    return false;
}
// ✅ CORS en todas las respuestas (por si el proxy devuelve antes y el navegador no ve header).
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    next();
});
// ✅ Preflight OPTIONS: responder de inmediato con 204 y headers.
app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
        const origin = req.headers.origin;
        if (origin)
            res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Max-Age", "86400");
        res.status(204).end();
        return;
    }
    next();
});
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        }
        else {
            callback(null, false);
        }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
}));
// ✅ JSON después
app.use(express_1.default.json());
// ✅ rutas
app.use("/auth", auth_routes_1.default);
app.use("/categories", categories_routes_1.default);
app.use("/expenses", expenses_routes_1.default);
app.use("/budgets", budgets_routes_1.default);
app.use("/investments", investments_routes_1.default);
app.use("/income", income_routes_1.default);
app.use("/periods", periods_routes_1.default);
app.use("/expensePlans", expensePlans_routes_1.default);
// net worth (si lo estás usando en dashboard/budget)
app.use("/networth", networth_routes_1.default);
// movements (como vos ya lo querías)
app.use("/investments/movements", investmentMovements_routes_1.default);
// (opcional) alias para evitar confusión si el front llama a /investment-movements
app.use("/investment-movements", investmentMovements_routes_1.default);
app.use("/monthCloses", monthCloses_routes_1.default);
app.use("/admin", admin_routes_1.default);
app.use("/plannedExpenses", plannedExpenses_routes_1.default);
app.get("/health", (_, res) => {
    res.json({ status: "ok" });
});
app.get("/me", requireAuth_1.requireAuth, (req, res) => {
    res.json({ userId: req.userId });
});
// ✅ Errores no capturados → siempre JSON (nunca HTML) y log para Railway
app.use((err, _req, res, _next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
        error: "Internal Server Error",
        ...(process.env.NODE_ENV === "development" && { detail: err.message }),
    });
});
exports.default = app;
