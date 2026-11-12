import express from 'express';
import { readableError } from './lib/readableError';
import cors from 'cors';
import 'dotenv/config';

// Import modular CRUD routers
import inquiriesRouter from './routes/inquiries';
import salesRouter from './routes/sales';
import clientRouter from './routes/client';
import employeeRouter from './routes/employee';
import usersRouter from './routes/users';
import expensesRouter from './routes/expenses';
import inventoryRouter from './routes/inventory';
import jobCostingRouter from './routes/job_costing';
import authRouter from './routes/auth';
import auditLogsRouter from './routes/audit_logs';
import profitAnalysisRouter from './routes/profit_analysis';
import goldRouter from './routes/gold';
import approvalsRouter, { queueStaffChanges } from './approvals';
import { assertAllowedOrigin, authenticate, isAllowedOrigin, requireAdmin, requirePasswordChanged } from './auth';
import { auditMutations } from './audit';

const app = express();

// Keep field identifiers in metadata, while presenting readable errors in every route.
app.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: any) => json(res.statusCode >= 400 && body && typeof body === 'object' && 'error' in body
    ? { ...body, error: readableError(body.error) } : body);
  next();
});

app.use(cors({
  origin(origin, callback) { callback(null, !origin || isAllowedOrigin(origin)); },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Public health and sign-in routes. All business and report APIs require a valid session.
app.get('/health', (_req, res) => res.json({ status: 'ok', message: 'Goldsmith Accounting API is running' }));
app.use('/auth', authRouter);
app.use(authenticate);
app.use(requirePasswordChanged);
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !assertAllowedOrigin(req, res)) return;
  next();
});
// User lifecycle routes write their audit event atomically with the change.
app.use('/users', requireAdmin, usersRouter);
app.use('/employee', requireAdmin, employeeRouter);
app.use(auditMutations);
app.use(queueStaffChanges);

// Reports, approvals, and audit history are administrator-only on the server.
app.use('/approvals', requireAdmin, approvalsRouter);
app.use('/audit-logs', requireAdmin, auditLogsRouter);
app.use('/profit-analysis', requireAdmin, profitAnalysisRouter);
app.use('/gold', goldRouter);

// Mount all operational CRUD routes.
app.use('/inquiries', inquiriesRouter);
app.use('/sales', salesRouter);
app.use('/client', clientRouter);
app.use('/expenses', expensesRouter);
app.use('/inventory', inventoryRouter);
app.use('/job_costing', jobCostingRouter);
app.use('/job-cost', jobCostingRouter);

// Keep unexpected API failures machine-readable for the frontend.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled API error:', error);
  if (res.headersSent) return;
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

export default app;
