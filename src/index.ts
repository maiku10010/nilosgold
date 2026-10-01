import express from 'express';
import cors from 'cors';
import 'dotenv/config';

// Import modular CRUD routers
import inquiriesRouter from './routes/inquiries';
import salesRouter from './routes/sales';
import clientRouter from './routes/client';
import employeeRouter from './routes/employee';
import expensesRouter from './routes/expenses';
import inventoryRouter from './routes/inventory';
import jobCostingRouter from './routes/job_costing';
import authRouter from './routes/auth';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? '*' }));
app.use(express.json());
app.use('/auth', authRouter);

// Mount all routes
app.use('/inquiries', inquiriesRouter);
app.use('/sales', salesRouter);
app.use('/client', clientRouter);
app.use('/employee', employeeRouter);
app.use('/expenses', expensesRouter);
app.use('/inventory', inventoryRouter);
app.use('/job_costing', jobCostingRouter);

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

export default app;
