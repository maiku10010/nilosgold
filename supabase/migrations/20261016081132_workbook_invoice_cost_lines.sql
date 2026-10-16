-- Workbook reconciliation: invoice identifiers are date-based, while the
-- repeated sheet invoice number remains a non-unique external reference.
ALTER TABLE public.sales
  ALTER COLUMN price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS price_confirmed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer;
ALTER TABLE public.job_costs
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_price_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_price_nonnegative CHECK (price IS NULL OR price >= 0);
ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer;
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer,
  ADD COLUMN IF NOT EXISTS source_date text;

DROP INDEX IF EXISTS public.sales_universal_reference_id_key;
CREATE INDEX IF NOT EXISTS sales_universal_reference_id_idx ON public.sales(universal_reference_id);
DROP INDEX IF EXISTS public.job_costs_universal_reference_id_key;
CREATE INDEX IF NOT EXISTS job_costs_universal_reference_id_idx ON public.job_costs(universal_reference_id);

CREATE TABLE public.job_cost_items (
  item_id text PRIMARY KEY,
  job_cost_id text NOT NULL REFERENCES public.job_costs("jobCostId") ON DELETE CASCADE,
  description text,
  line_price numeric(14,2) CHECK (line_price IS NULL OR line_price >= 0),
  gold_grams numeric(14,4), gold_cost numeric(14,2), stone_cost numeric(14,2),
  labor_cost numeric(14,2), labor_charge numeric(14,2), other_cost numeric(14,2),
  source_sheet text NOT NULL, source_sales_row integer NOT NULL, source_cost_row integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_cost_items_job_cost_id_idx ON public.job_cost_items(job_cost_id);
CREATE UNIQUE INDEX job_cost_items_source_rows_key
  ON public.job_cost_items(source_sheet, source_sales_row, COALESCE(source_cost_row, 0));
ALTER TABLE public.job_cost_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_cost_items FROM anon, authenticated;

CREATE TABLE public.workbook_import_issues (
  issue_id text PRIMARY KEY,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_sheet text NOT NULL, source_row integer, message text NOT NULL, details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workbook_import_issues_source_hash_idx ON public.workbook_import_issues(source_hash);
ALTER TABLE public.workbook_import_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workbook_import_issues FROM anon, authenticated;
