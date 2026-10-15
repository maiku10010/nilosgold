-- Remove the retired import area and provenance, preserving operational rows.
BEGIN;

DROP TABLE IF EXISTS public.legacy_sheet_rows;
DROP TABLE IF EXISTS public.legacy_invoices;

ALTER TABLE public.job_costs
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row,
  DROP COLUMN IF EXISTS source_data_complete,
  DROP COLUMN IF EXISTS source_notes;
ALTER TABLE public.sales
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row,
  DROP COLUMN IF EXISTS source_invoice_number,
  DROP COLUMN IF EXISTS source_date,
  DROP COLUMN IF EXISTS source_status,
  DROP COLUMN IF EXISTS source_type;
ALTER TABLE public.inventory
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row,
  DROP COLUMN IF EXISTS source_date;
ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;
ALTER TABLE public.sale_payments
  DROP COLUMN IF EXISTS source_sheet,
  DROP COLUMN IF EXISTS source_row;

COMMIT;
