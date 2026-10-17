BEGIN;
ALTER TABLE public.job_costs ADD COLUMN service_type text;
UPDATE public.job_costs j SET service_type = s."serviceType"
FROM public.sales s WHERE s."jobCostId" = j."jobCostId";
UPDATE public.job_costs j SET service_type = initcap(lower(trim(i.category)))
FROM public.inquiries i WHERE i."inquiryId" = j."inquiryId" AND j.service_type IS NULL
  AND lower(trim(i.category)) IN ('repair', 'custom', 'resize', 'cleaning');
ALTER TABLE public.job_costs ALTER COLUMN service_type SET NOT NULL;
ALTER TABLE public.job_costs ADD CONSTRAINT job_costs_service_type_valid
  CHECK (service_type IN ('Repair', 'Custom', 'Resize', 'Cleaning'));
COMMIT;
