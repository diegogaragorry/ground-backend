"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAuth_1 = require("../middlewares/requireAuth");
const requireSuperAdmin_1 = require("../middlewares/requireSuperAdmin");
const users_controller_1 = require("./users.controller");
const router = (0, express_1.Router)();
// normal user: cambia su password
router.post("/me/password", requireAuth_1.requireAuth, users_controller_1.changeMyPassword);
// super admin: CRUD usuarios
router.get("/users", requireAuth_1.requireAuth, requireSuperAdmin_1.requireSuperAdmin, users_controller_1.listUsers);
router.post("/users", requireAuth_1.requireAuth, requireSuperAdmin_1.requireSuperAdmin, users_controller_1.createUser);
router.put("/users/:id", requireAuth_1.requireAuth, requireSuperAdmin_1.requireSuperAdmin, users_controller_1.updateUser);
router.delete("/users/:id", requireAuth_1.requireAuth, requireSuperAdmin_1.requireSuperAdmin, users_controller_1.deleteUser);
exports.default = router;
