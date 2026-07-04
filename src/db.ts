import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

// Create a connection pool using your Supabase DIRECT_URL
const pool = new Pool({ connectionString: process.env.DIRECT_URL });

// Wrap the pool in the Prisma Adapter
const adapter = new PrismaPg(pool);

// Initialize and export the Prisma Client
export const prisma = new PrismaClient({ adapter });
