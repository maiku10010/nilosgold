-- NULL means not applicable; preserve existing historical measurements.
ALTER TABLE public.job_costs
  ALTER COLUMN "goldUsed" DROP NOT NULL,
  ALTER COLUMN gold_scrap DROP NOT NULL,
  ALTER COLUMN "goldCostPerG" DROP NOT NULL,
  ALTER COLUMN "stoneCost" DROP NOT NULL,
  ALTER COLUMN "laborCost" DROP NOT NULL,
  ALTER COLUMN labor_charge DROP NOT NULL;
