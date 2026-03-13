import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  listExpenseTemplates,
  createExpenseTemplate,
  upsertExpenseTemplatesBatch,
  updateExpenseTemplate,
  deleteExpenseTemplate,
  setVisibilityToSelected,
} from "./expenseTemplates.controller";

const router = Router();

// ✅ cualquier usuario autenticado puede gestionar SUS templates
router.get("/expenseTemplates", requireAuth, listExpenseTemplates);
router.post("/expenseTemplates", requireAuth, createExpenseTemplate);
router.post("/expenseTemplates/batch", requireAuth, upsertExpenseTemplatesBatch);
router.post("/expenseTemplates/set-visibility", requireAuth, setVisibilityToSelected);
router.put("/expenseTemplates/:id", requireAuth, updateExpenseTemplate);
router.delete("/expenseTemplates/:id", requireAuth, deleteExpenseTemplate);

export default router;
