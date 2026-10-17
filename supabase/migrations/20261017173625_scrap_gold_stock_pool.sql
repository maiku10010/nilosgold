BEGIN;
ALTER TABLE public.inventory DROP CONSTRAINT inventory_gold_karat_category;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_gold_karat_category
  CHECK (gold_karat IS NULL OR category IN ('GOLD', 'SCRAP'));
-- The inventory table is the item catalogue as well as the movement ledger.
-- A zero opening balance registers the item without inventing recovered stock.
INSERT INTO public.inventory ("referenceId", "itemName", category, unit, "unitPrice", "quantityIn", "quantityOut", "quantityLoss")
SELECT gen_random_uuid()::text, 'Scrap gold', 'SCRAP', 'grams', 0, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.inventory WHERE category = 'SCRAP' AND "itemName" = 'Scrap gold' AND "deletedAt" IS NULL);
CREATE UNIQUE INDEX inventory_job_scrap_recovery_unique ON public.inventory ("jobCostId")
  WHERE category = 'SCRAP' AND "jobCostId" IS NOT NULL AND "deletedAt" IS NULL;
COMMIT;
