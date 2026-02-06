import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { listUsers, createUser, updateUser, deleteUser, changeMyPassword, getRecentActivity } from "./users.controller";

const router = Router();

// normal user: cambia su password
router.post("/me/password", requireAuth, changeMyPassword);

// super admin: actividad reciente (usuarios + códigos)
router.get("/recent-activity", requireAuth, requireSuperAdmin, getRecentActivity);

// super admin: CRUD usuarios
router.get("/users", requireAuth, requireSuperAdmin, listUsers);
router.post("/users", requireAuth, requireSuperAdmin, createUser);
router.put("/users/:id", requireAuth, requireSuperAdmin, updateUser);
router.delete("/users/:id", requireAuth, requireSuperAdmin, deleteUser);

export default router;