import express from "express";
import cors from "cors";

import authRoutes from "./auth/auth.routes";
import incomeRoutes from "./income/income.routes";
import expensePlansRoutes from "./expensePlans/expensePlans.routes";

import budgetsRoutes from "./budgets/budgets.routes";
import expensesRoutes from "./expenses/expenses.routes";
import categoriesRoutes from "./categories/categories.routes";
import investmentsRoutes from "./investments/investments.routes";
import networthRoutes from "./networth/networth.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);

app.use("/income", incomeRoutes);
app.use("/expensePlans", expensePlansRoutes);

app.use("/budgets", budgetsRoutes);
app.use("/expenses", expensesRoutes);
app.use("/categories", categoriesRoutes);
app.use("/investments", investmentsRoutes);
app.use("/networth", networthRoutes);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});