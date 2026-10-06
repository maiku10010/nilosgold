ALTER TABLE "inquiries" ADD COLUMN IF NOT EXISTS "universal_reference_id" TEXT;
ALTER TABLE "job_costs" ADD COLUMN IF NOT EXISTS "universal_reference_id" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "universal_reference_id" TEXT;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "universal_reference_id" TEXT;
ALTER TABLE "job_costs" ALTER COLUMN "goldCostPerG" TYPE DECIMAL(12, 2) USING ROUND("goldCostPerG"::numeric, 2);

-- Keep each existing inquiry/job/sale chain on one shared reference.
UPDATE "inquiries" SET "universal_reference_id" = "inquiryId" WHERE "universal_reference_id" IS NULL;
UPDATE "job_costs" j SET "universal_reference_id" = COALESCE(i."universal_reference_id", j."jobCostId")
FROM "inquiries" i WHERE j."inquiryId" = i."inquiryId" AND j."universal_reference_id" IS NULL;
UPDATE "job_costs" SET "universal_reference_id" = "jobCostId" WHERE "universal_reference_id" IS NULL;
UPDATE "sales" s SET "universal_reference_id" = COALESCE(j."universal_reference_id", s."invoiceId")
FROM "job_costs" j WHERE s."jobCostId" = j."jobCostId" AND s."universal_reference_id" IS NULL;
UPDATE "sales" SET "universal_reference_id" = "invoiceId" WHERE "universal_reference_id" IS NULL;
UPDATE "inventory" v SET "universal_reference_id" = COALESCE(j."universal_reference_id", v."referenceId")
FROM "job_costs" j WHERE v."jobCostId" = j."jobCostId" AND v."universal_reference_id" IS NULL;
UPDATE "inventory" SET "universal_reference_id" = "referenceId" WHERE "universal_reference_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "inquiries_universal_reference_id_key" ON "inquiries"("universal_reference_id");
CREATE UNIQUE INDEX IF NOT EXISTS "job_costs_universal_reference_id_key" ON "job_costs"("universal_reference_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_universal_reference_id_key" ON "sales"("universal_reference_id");
DROP INDEX IF EXISTS "inventory_jobCostId_key";
CREATE INDEX IF NOT EXISTS "inventory_jobCostId_idx" ON "inventory"("jobCostId");
CREATE INDEX IF NOT EXISTS "inventory_universal_reference_id_idx" ON "inventory"("universal_reference_id");
