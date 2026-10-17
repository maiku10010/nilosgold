BEGIN;
DROP INDEX IF EXISTS public.inventory_job_scrap_recovery_unique;
-- Earlier job allocations included recovered scrap as a gold stock loss.
-- Only the job's gold used is a source deduction now.
UPDATE public.inventory SET "quantityLoss" = 0
WHERE category = 'GOLD' AND "jobCostId" IS NOT NULL AND "quantityLoss" > 0;
INSERT INTO public.inventory ("referenceId", "itemName", category, unit, "unitPrice", "quantityIn", "quantityOut", "quantityLoss")
SELECT gen_random_uuid()::text, 'Scrap gold', 'SCRAP', 'grams', 0, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.inventory WHERE category = 'SCRAP' AND "itemName" = 'Scrap gold' AND "deletedAt" IS NULL);
COMMIT;
