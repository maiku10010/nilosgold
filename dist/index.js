"use strict";
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
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? '*' }));
app.use(express_1.default.json());
app.use('/auth', auth_1.default);
// Mount all routes
app.use('/inquiries', inquiries_1.default);
app.use('/sales', sales_1.default);
app.use('/client', client_1.default);
app.use('/employee', employee_1.default);
app.use('/expenses', expenses_1.default);
app.use('/inventory', inventory_1.default);
app.use('/job_costing', job_costing_1.default);
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Goldsmith Master Control API is running' });
});
const PORT = process.env.PORT || 3000;
// Vercel imports this handler as a serverless function; local runs still listen on PORT.
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`Goldsmith Master Control API running on http://localhost:${PORT}`);
    });
}
exports.default = app;
