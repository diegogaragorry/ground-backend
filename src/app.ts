import path from "path";
import dotenv from "dotenv";

// Cargar .env desde la raíz del backend (funciona aunque se ejecute desde otro directorio)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

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

// ✅ CORS: orígenes permitidos (Vercel, ground.finance y subdominios, localhost).
const allowedOrigins = [
  /^https:\/\/[\w.-]+\.vercel\.app$/,      // cualquier deployment Vercel (prod + preview)
  /^https:\/\/([\w.-]+\.)?ground\.finance$/, // ground.finance, www.ground.finance, app.ground.finance, etc.
  /^https?:\/\/localhost(:\d+)?$/,           // dev local
];

function isOriginAllowed(origin: string | undefined): boolean {
  return !origin || allowedOrigins.some((re) => re.test(origin));
}

// ✅ Responder preflight OPTIONS explícitamente (evita 502 con el proxy de Railway).
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

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

// ✅ Errores no capturados → siempre JSON (nunca HTML) y log para Railway
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { detail: err.message }),
  });
});

export default app;
