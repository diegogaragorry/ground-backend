"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const categories_routes_1 = __importDefault(require("../categories/categories.routes"));
const monthCloses_routes_1 = __importDefault(require("../monthCloses/monthCloses.routes"));
const users_routes_1 = __importDefault(require("./users.routes"));
const expenseTemplates_routes_1 = __importDefault(require("./expenseTemplates.routes"));
const expenseTemplates_routes_2 = __importDefault(require("./expenseTemplates.routes"));
// ...
const router = (0, express_1.Router)();
router.use(users_routes_1.default);
router.use(expenseTemplates_routes_1.default);
router.use("/categories", categories_routes_1.default);
router.use("/monthCloses", monthCloses_routes_1.default);
router.use("/expenseTemplates", expenseTemplates_routes_1.default);
router.use(expenseTemplates_routes_2.default);
exports.default = router;
