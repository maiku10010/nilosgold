"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
// Import modular CRUD routers
const inquiries_1 = __importDefault(require("./routes/inquiries"));
const sales_1 = __importDefault(require("./routes/sales"));
const client_1 = __importDefault(require("./routes/client"));
const employee_1 = __importDefault(require("./routes/employee"));
const expenses_1 = __importDefault(require("./routes/expenses"));
const inventory_1 = __importDefault(require("./routes/inventory"));
const job_costing_1 = __importDefault(require("./routes/job_costing"));
const auth_1 = __importDefault(require("./routes/auth"));
const audit_logs_1 = __importDefault(require("./routes/audit_logs"));
const profit_analysis_1 = __importDefault(require("./routes/profit_analysis"));
const gold_1 = __importDefault(require("./routes/gold"));
const approvals_1 = __importStar(require("./approvals"));
const auth_2 = require("./auth");
const audit_1 = require("./audit");
const app = (0, express_1.default)();
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,https://nilosgoldui.vercel.app')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
app.use((0, cors_1.default)({
    origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '1mb' }));
// Public health and sign-in routes. All business and report APIs require a valid session.
app.get('/health', (_req, res) => res.json({ status: 'ok', message: 'Goldsmith Accounting API is running' }));
app.use('/auth', auth_1.default);
app.use(auth_2.authenticate);
app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !(0, auth_2.assertAllowedOrigin)(req, res))
        return;
    next();
});
app.use(audit_1.auditMutations);
app.use(approvals_1.queueStaffChanges);
// Reports, approvals, and audit history are administrator-only on the server.
app.use('/approvals', auth_2.requireAdmin, approvals_1.default);
app.use('/audit-logs', auth_2.requireAdmin, audit_logs_1.default);
app.use('/profit-analysis', auth_2.requireAdmin, profit_analysis_1.default);
app.use('/gold', gold_1.default);
// Mount all operational CRUD routes.
app.use('/inquiries', inquiries_1.default);
app.use('/sales', sales_1.default);
app.use('/client', client_1.default);
app.use('/employee', auth_2.requireAdmin, employee_1.default);
app.use('/expenses', expenses_1.default);
app.use('/inventory', inventory_1.default);
app.use('/job_costing', job_costing_1.default);
app.use('/job-cost', job_costing_1.default);
// Keep unexpected API failures machine-readable for the frontend.
app.use((error, _req, res, _next) => {
    console.error('Unhandled API error:', error);
    if (res.headersSent)
        return;
    const message = error instanceof Error ? error.message : 'An unexpected server error occurred.';
    res.status(500).json({ error: message });
});
const PORT = process.env.PORT || 3000;
// Vercel imports this handler as a serverless function; local runs still listen on PORT.
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`Goldsmith Master Control API running on http://localhost:${PORT}`);
    });
}
exports.default = app;
