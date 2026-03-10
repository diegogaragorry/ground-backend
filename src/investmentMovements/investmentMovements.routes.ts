import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBillingWriteAccess } from "../middlewares/requireBillingWriteAccess";
import {
  listInvestmentMovements,
  createInvestmentMovement,
  updateInvestmentMovement,
  deleteInvestmentMovement,
} from "./investmentMovements.controller";

const router = Router();

router.get("/", requireAuth, listInvestmentMovements);
router.post("/", requireAuth, requireBillingWriteAccess, createInvestmentMovement);
router.put("/:id", requireAuth, requireBillingWriteAccess, updateInvestmentMovement);
router.delete("/:id", requireAuth, requireBillingWriteAccess, deleteInvestmentMovement);

export default router;
