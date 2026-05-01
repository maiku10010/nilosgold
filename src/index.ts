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



const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running beautifully on http://localhost:${PORT}`);
});