-- Preserve unknown historical purity instead of assigning a default karat.
BEGIN;

ALTER TABLE public.inquiries
  ADD COLUMN gold_karat smallint,
  ADD CONSTRAINT inquiries_gold_karat_range CHECK (gold_karat BETWEEN 10 AND 24);

ALTER TABLE public.job_costs
  ADD COLUMN gold_karat smallint,
  ADD CONSTRAINT job_costs_gold_karat_range CHECK (gold_karat BETWEEN 10 AND 24);

ALTER TABLE public.inventory
  ADD COLUMN gold_karat smallint,
  ADD CONSTRAINT inventory_gold_karat_range CHECK (gold_karat BETWEEN 10 AND 24),
  ADD CONSTRAINT inventory_gold_karat_category CHECK (gold_karat IS NULL OR category = 'GOLD');

COMMENT ON COLUMN public.inquiries.gold_karat IS 'Requested gold karat (10-24); NULL means unspecified.';
COMMENT ON COLUMN public.job_costs.gold_karat IS 'Gold karat for this costing (10-24); NULL means unspecified.';
COMMENT ON COLUMN public.inventory.gold_karat IS 'Gold karat for this movement (10-24); NULL means unspecified or not gold.';

COMMIT;
