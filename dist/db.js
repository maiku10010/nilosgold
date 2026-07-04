"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
require("dotenv/config");
// Create a connection pool using your Supabase DIRECT_URL
const pool = new pg_1.Pool({ connectionString: process.env.DIRECT_URL });
// Wrap the pool in the Prisma Adapter
const adapter = new adapter_pg_1.PrismaPg(pool);
// Initialize and export the Prisma Client
exports.prisma = new client_1.PrismaClient({ adapter });
