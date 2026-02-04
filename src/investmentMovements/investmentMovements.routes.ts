import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  listInvestmentMovements,
  createInvestmentMovement,
  updateInvestmentMovement,
  deleteInvestmentMovement,
} from "./investmentMovements.controller";

const router = Router();

router.get("/", requireAuth, listInvestmentMovements);
router.post("/", requireAuth, createInvestmentMovement);
router.put("/:id", requireAuth, updateInvestmentMovement);
router.delete("/:id", requireAuth, deleteInvestmentMovement);

export default router;