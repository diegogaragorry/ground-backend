"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
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
// ✅ CORS primero (antes de rutas)
app.use((0, cors_1.default)({ origin: ["http://localhost:5173", "http://localhost:5174"] }));
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
exports.default = app;
