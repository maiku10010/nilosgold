-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FINISHED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'FINISHED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "inventory_category" AS ENUM ('GOLD', 'SILVER', 'SCRAP', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS');

-- CreateTable
CREATE TABLE "clients" (
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "contactNum" TEXT,
    "email" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "employees" (
    "empId" TEXT NOT NULL,
    "empName" TEXT NOT NULL,
    "empRole" TEXT NOT NULL,
    "rates" DECIMAL(65,30) NOT NULL,
    "userName" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tempPasswordExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("empId")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "inquiryId" TEXT NOT NULL,
    "universal_reference_id" TEXT,
    "isFullyPaid" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "gold_karat" SMALLINT,
    "quotedPrice" DECIMAL(65,30) NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactInfo" TEXT,
    "email" TEXT,
    "details" TEXT,
    "status" "InquiryStatus" NOT NULL DEFAULT 'PENDING',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("inquiryId")
);

-- CreateTable
CREATE TABLE "job_costs" (
    "service_type" TEXT NOT NULL,
    "jobCostId" TEXT NOT NULL,
    "universal_reference_id" TEXT,
    "item_name" TEXT,
    "delivery_date" TIMESTAMP(3),
    "goldUsed" DECIMAL(65,30) DEFAULT 0.00,
    "gold_karat" SMALLINT,
    "gold_scrap" DECIMAL(65,30) DEFAULT 0.00,
    "stoneCost" DECIMAL(65,30) DEFAULT 0.00,
    "laborCost" DECIMAL(65,30) DEFAULT 0.00,
    "labor_charge" DECIMAL(65,30) DEFAULT 0.00,
    "other_cost" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "goldCostPerG" DECIMAL(12,2) DEFAULT 0.00,
    "status" "JobStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "readyNotifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "empId" TEXT,
    "client_id" TEXT,
    "inquiryId" TEXT,

    CONSTRAINT "job_costs_pkey" PRIMARY KEY ("jobCostId")
);

-- CreateTable
CREATE TABLE "sales" (
    "invoiceId" TEXT NOT NULL,
    "universal_reference_id" TEXT,
    "serviceType" TEXT NOT NULL,
    "price" DECIMAL(65,30),
    "price_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "status" "SalesStatus" NOT NULL DEFAULT 'PAID',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptSentAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "clientId" TEXT NOT NULL,
    "jobCostId" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("invoiceId")
);

-- CreateTable
CREATE TABLE "inventory" (
    "referenceId" TEXT NOT NULL,
    "universal_reference_id" TEXT,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(65,30) DEFAULT 0.00,
    "category" "inventory_category" NOT NULL DEFAULT 'GOLD',
    "gold_karat" SMALLINT,
    "source_date" TEXT,
    "quantityIn" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "quantityOut" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "quantityLoss" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "jobCostId" TEXT,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("referenceId")
);

-- CreateTable
CREATE TABLE "expenses" (
    "expenseId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("expenseId")
);

-- CreateTable
CREATE TABLE "job_cost_items" (
    "item_id" TEXT NOT NULL,
    "job_cost_id" TEXT NOT NULL,
    "description" TEXT,
    "line_price" DECIMAL(65,30),
    "gold_grams" DECIMAL(65,30),
    "gold_cost" DECIMAL(65,30),
    "stone_cost" DECIMAL(65,30),
    "labor_cost" DECIMAL(65,30),
    "labor_charge" DECIMAL(65,30),
    "other_cost" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_cost_items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "workbook_import_issues" (
    "issue_id" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workbook_import_issues_pkey" PRIMARY KEY ("issue_id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payment_number" INTEGER,
    "method" TEXT,
    "notes" TEXT,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "empId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "logId" TEXT NOT NULL,
    "actorEmpId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("logId")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "requestId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeData" JSONB,
    "proposedData" JSONB,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requesterEmpId" TEXT NOT NULL,
    "reviewerEmpId" TEXT,
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("requestId")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_userName_key" ON "employees"("userName");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_universal_reference_id_key" ON "inquiries"("universal_reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_costs_inquiryId_key" ON "job_costs"("inquiryId");

-- CreateIndex
CREATE INDEX "job_costs_universal_reference_id_idx" ON "job_costs"("universal_reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_jobCostId_key" ON "sales"("jobCostId");

-- CreateIndex
CREATE INDEX "sales_universal_reference_id_idx" ON "sales"("universal_reference_id");

-- CreateIndex
CREATE INDEX "job_cost_items_job_cost_id_idx" ON "job_cost_items"("job_cost_id");

-- CreateIndex
CREATE INDEX "workbook_import_issues_source_hash_idx" ON "workbook_import_issues"("source_hash");

-- CreateIndex
CREATE INDEX "sale_payments_invoice_id_paid_at_idx" ON "sale_payments"("invoice_id", "paid_at");

-- CreateIndex
CREATE INDEX "auth_sessions_empId_revokedAt_idx" ON "auth_sessions"("empId", "revokedAt");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "system_logs_actorEmpId_createdAt_idx" ON "system_logs"("actorEmpId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "approval_requests_status_createdAt_idx" ON "approval_requests"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "approval_requests_entityType_entityId_status_idx" ON "approval_requests"("entityType", "entityId", "status");

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("clientId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_empId_fkey" FOREIGN KEY ("empId") REFERENCES "employees"("empId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("clientId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("inquiryId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_jobCostId_fkey" FOREIGN KEY ("jobCostId") REFERENCES "job_costs"("jobCostId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_jobCostId_fkey" FOREIGN KEY ("jobCostId") REFERENCES "job_costs"("jobCostId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cost_items" ADD CONSTRAINT "job_cost_items_job_cost_id_fkey" FOREIGN KEY ("job_cost_id") REFERENCES "job_costs"("jobCostId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales"("invoiceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_empId_fkey" FOREIGN KEY ("empId") REFERENCES "employees"("empId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_actorEmpId_fkey" FOREIGN KEY ("actorEmpId") REFERENCES "employees"("empId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requesterEmpId_fkey" FOREIGN KEY ("requesterEmpId") REFERENCES "employees"("empId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewerEmpId_fkey" FOREIGN KEY ("reviewerEmpId") REFERENCES "employees"("empId") ON DELETE SET NULL ON UPDATE CASCADE;

-- API-only access: browser roles have no direct access to business tables.
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "clients" FROM anon, authenticated;
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "employees" FROM anon, authenticated;
ALTER TABLE "inquiries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "inquiries" FROM anon, authenticated;
ALTER TABLE "job_costs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "job_costs" FROM anon, authenticated;
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "sales" FROM anon, authenticated;
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "inventory" FROM anon, authenticated;
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "expenses" FROM anon, authenticated;
ALTER TABLE "job_cost_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "job_cost_items" FROM anon, authenticated;
ALTER TABLE "workbook_import_issues" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "workbook_import_issues" FROM anon, authenticated;
ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "sale_payments" FROM anon, authenticated;
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "auth_sessions" FROM anon, authenticated;
ALTER TABLE "system_logs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "system_logs" FROM anon, authenticated;
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "approval_requests" FROM anon, authenticated;

ALTER TABLE inquiries ADD CONSTRAINT inquiries_gold_karat_range CHECK (gold_karat BETWEEN 10 AND 24);
ALTER TABLE job_costs ADD CONSTRAINT job_costs_gold_karat_range CHECK (gold_karat BETWEEN 10 AND 24);
ALTER TABLE inventory ADD CONSTRAINT inventory_gold_karat_range CHECK (gold_karat BETWEEN 10 AND 24);
ALTER TABLE inventory ADD CONSTRAINT inventory_gold_karat_category CHECK (gold_karat IS NULL OR category IN ('GOLD', 'SCRAP'));
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_amount_nonnegative CHECK (amount >= 0);
