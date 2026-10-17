-- Recover only existing, allocated jobs missing a scrap ledger entry; safe to rerun.
INSERT INTO public.inventory ("referenceId", universal_reference_id, "jobCostId", "itemName", category, unit, gold_karat, "quantityIn", "quantityOut", "quantityLoss", "unitPrice")
SELECT gen_random_uuid()::text, j."jobCostId", j."jobCostId", 'Scrap gold', 'SCRAP', 'grams', j.gold_karat, j.gold_scrap, 0, 0, 0
FROM public.job_costs j
WHERE j."deletedAt" IS NULL AND j.gold_scrap > 0
  AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.category='GOLD' AND i."jobCostId"=j."jobCostId" AND i."deletedAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.category='SCRAP' AND i."jobCostId"=j."jobCostId" AND i."deletedAt" IS NULL);
