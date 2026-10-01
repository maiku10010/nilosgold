ALTER TABLE public.job_costs
  ADD COLUMN IF NOT EXISTS item_name text,
  ADD COLUMN IF NOT EXISTS delivery_date date;
