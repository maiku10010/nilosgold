import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg'; // <-- 1. Import the new Postgres Driver
import { PrismaPg } from '@prisma/adapter-pg'; // <-- 2. Import the Prisma Adapter
import 'dotenv/config';

// 3. Create a connection pool using your Supabase DIRECT_URL
const pool = new Pool({ connectionString: process.env.DIRECT_URL });

// 4. Wrap the pool in the Prisma Adapter
const adapter = new PrismaPg(pool);

// 5. Wake up the Prisma Client and explicitly hand it the adapter!
const prisma = new PrismaClient({ adapter });

const app = express();

app.use(express.json());

//read operation
app.get('/sales', async (req: Request, res: Response) => {
  try {
    const allSales = await prisma.sales.findMany({include: {client: true}});
    res.json(allSales);
  }
    catch (error) {
      console.error('Error fetching sales:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
});

//create operation



const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running beautifully on http://localhost:${PORT}`);
});