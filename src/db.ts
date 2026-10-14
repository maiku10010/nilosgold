import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

function runtimeDatabaseUrl(): string {
  const configuredUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!configuredUrl) throw new Error('DATABASE_URL or DIRECT_URL must be configured.');

  // Supabase's session pooler (port 5432) reserves one database connection for
  // every client. Serverless instances are short-lived and can exhaust that
  // small pool very quickly, so Vercel must use transaction mode (port 6543).
  if (process.env.VERCEL === '1') {
    const url = new URL(configuredUrl);
    if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432') {
      url.port = '6543';
      return url.toString();
    }
  }

  return configuredUrl;
}

// A serverless invocation only needs one database connection. Keeping this at
// one prevents every warm Vercel instance from opening pg's default ten.
const pool = new Pool({
  connectionString: runtimeDatabaseUrl(),
  max: process.env.VERCEL === '1' ? 1 : 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});

// Wrap the pool in the Prisma Adapter
const adapter = new PrismaPg(pool);

// Initialize and export the Prisma Client
export const prisma = new PrismaClient({ adapter });
