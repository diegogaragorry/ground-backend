import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import { listCategories, createCategory, updateCategory, deleteCategory } from "./categories.controller";

const router = Router();

router.get("/", requireAuth, listCategories);
router.post("/", requireAuth, requireBillingWriteAccess, createCategory);
router.put("/:id", requireAuth, requireBillingWriteAccess, updateCategory);
router.delete("/:id", requireAuth, requireBillingWriteAccess, deleteCategory);

export default router;
