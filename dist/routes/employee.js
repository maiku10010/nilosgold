"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_1 = __importDefault(require("./users"));
// Retain the old URL as a guarded alias. No legacy credential or delete bypass.
const router = (0, express_1.Router)();
router.delete('/:id', (_req, res) => res.status(405).json({ error: 'Use Users to deactivate this account.' }));
router.put('/:id', (_req, res) => res.status(405).json({ error: 'Use Users to change roles or reset passwords.' }));
router.use(users_1.default);
exports.default = router;
