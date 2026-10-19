-- Remove spreadsheet coordinates while preserving business records and values.
ALTER TABLE public.job_costs
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.sales
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.inventory
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.sale_payments
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.workbook_import_issues
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.job_cost_items
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_sales_row,
  DROP COLUMN IF EXISTS source_cost_row;
