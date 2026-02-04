import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import authRoutes from "./auth/auth.routes";
import { requireAuth } from "./middlewares/requireAuth";
import type { AuthRequest } from "./middlewares/requireAuth";
import categoryRoutes from "./categories/categories.routes";
import expenseRoutes from "./expenses/expenses.routes";
import budgetRoutes from "./budgets/budgets.routes";
import investmentRoutes from "./investments/investments.routes";

import incomeRoutes from "./income/income.routes";
import periodsRoutes from "./periods/periods.routes";

import expensePlansRoutes from "./expensePlans/expensePlans.routes";
import investmentMovementsRoutes from "./investmentMovements/investmentMovements.routes";
import netWorthRoutes from "./networth/networth.routes";
import monthClosesRoutes from "./monthCloses/monthCloses.routes";

import adminRouter from "./admin/admin.routes";

import plannedExpensesRoutes from "./plannedExpenses/plannedExpenses.routes";



const app = express();

// ✅ CORS primero (antes de rutas)
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:5174"] }));

// ✅ JSON después
app.use(express.json());

// ✅ rutas
app.use("/auth", authRoutes);
app.use("/categories", categoryRoutes);
app.use("/expenses", expenseRoutes);
app.use("/budgets", budgetRoutes);
app.use("/investments", investmentRoutes);

app.use("/income", incomeRoutes);
app.use("/periods", periodsRoutes);

app.use("/expensePlans", expensePlansRoutes);

// net worth (si lo estás usando en dashboard/budget)
app.use("/networth", netWorthRoutes);

// movements (como vos ya lo querías)
app.use("/investments/movements", investmentMovementsRoutes);

// (opcional) alias para evitar confusión si el front llama a /investment-movements
app.use("/investment-movements", investmentMovementsRoutes);
app.use("/monthCloses", monthClosesRoutes);
app.use("/admin", adminRouter);
app.use("/plannedExpenses", plannedExpensesRoutes);

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ userId: req.userId });
});

export default app;
