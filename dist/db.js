"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
require("dotenv/config");
function runtimeDatabaseUrl() {
    const configuredUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
    if (!configuredUrl)
        throw new Error('DATABASE_URL or DIRECT_URL must be configured.');
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
const pool = new pg_1.Pool({
    connectionString: runtimeDatabaseUrl(),
    max: process.env.VERCEL === '1' ? 1 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
});
// Wrap the pool in the Prisma Adapter
const adapter = new adapter_pg_1.PrismaPg(pool);
// Initialize and export the Prisma Client
exports.prisma = new client_1.PrismaClient({ adapter });
