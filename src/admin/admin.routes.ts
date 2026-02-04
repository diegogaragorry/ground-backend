import { Router } from "express";
import categoriesRouter from "../categories/categories.routes";
import monthClosesRouter from "../monthCloses/monthCloses.routes";
import usersAdminRoutes from "./users.routes";
import expenseTemplatesRouter from "./expenseTemplates.routes";
import expenseTemplatesRoutes from "./expenseTemplates.routes";
// ...

const router = Router();

router.use(usersAdminRoutes);
router.use(expenseTemplatesRouter); 
router.use("/categories", categoriesRouter);
router.use("/monthCloses", monthClosesRouter);
router.use("/expenseTemplates", expenseTemplatesRouter);
router.use(expenseTemplatesRoutes);

export default router;