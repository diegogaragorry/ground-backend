import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { listCategories, createCategory, updateCategory, deleteCategory } from "./categories.controller";

const router = Router();

router.get("/", requireAuth, listCategories);
router.post("/", requireAuth, createCategory);
router.put("/:id", requireAuth, updateCategory);
router.delete("/:id", requireAuth, deleteCategory);

export default router;