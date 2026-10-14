-- Normalize payment events and remove stored values that are derivable from
-- sales, payments, and inventory movements.

DO $$ BEGIN
  CREATE TYPE public.inventory_category AS ENUM ('GOLD', 'SILVER', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.sale_payments (
  payment_id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES public.sales("invoiceId") ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  paid_at timestamptz,
  payment_number integer,
  method text,
  source_sheet text,
  source_row integer,
  notes text,
  CONSTRAINT sale_payments_source_sheet_source_row_payment_number_key UNIQUE (source_sheet, source_row, payment_number)
);
CREATE INDEX sale_payments_invoice_id_paid_at_idx ON public.sale_payments(invoice_id, paid_at);

INSERT INTO public.sale_payments (payment_id, invoice_id, amount, paid_at, payment_number, method, source_sheet)
SELECT 'legacy-payment-' || "invoiceId", "invoiceId", payment, "date", 1, NULL, 'legacy_sales_payment'
FROM public.sales
WHERE payment > 0;

ALTER TABLE public.sales
  ADD COLUMN source_sheet text,
  ADD COLUMN source_row integer,
  ADD COLUMN source_invoice_number text,
  ADD COLUMN source_date text,
  ADD COLUMN source_status text,
  ADD COLUMN source_type text,
  ADD CONSTRAINT sales_source_row_key UNIQUE (source_sheet, source_row);
ALTER TABLE public.sales DROP COLUMN payment;

ALTER TABLE public.clients DROP COLUMN balance;

ALTER TABLE public.job_costs
  ADD COLUMN labor_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN other_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN source_data_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN source_notes text,
  ADD COLUMN client_id text,
  ADD COLUMN source_sheet text,
  ADD COLUMN source_row integer,
  ADD CONSTRAINT job_costs_source_row_key UNIQUE (source_sheet, source_row),
  ALTER COLUMN "empId" DROP NOT NULL,
  ALTER COLUMN "date" DROP NOT NULL;
ALTER TABLE public.job_costs DROP CONSTRAINT IF EXISTS "job_costs_empId_fkey";
ALTER TABLE public.job_costs
  ADD CONSTRAINT job_costs_empId_fkey FOREIGN KEY ("empId") REFERENCES public.employees("empId") ON DELETE SET NULL;
ALTER TABLE public.job_costs
  ADD CONSTRAINT job_costs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients("clientId") ON DELETE SET NULL;

ALTER TABLE public.inventory
  ADD COLUMN source_sheet text,
  ADD COLUMN source_row integer,
  ADD COLUMN source_date text,
  ADD CONSTRAINT inventory_source_row_key UNIQUE (source_sheet, source_row);
UPDATE public.inventory SET
  "quantityIn" = CASE WHEN "quantityIn" = 0 THEN "goldIn" ELSE "quantityIn" END,
  "quantityOut" = CASE WHEN "quantityOut" = 0 THEN "goldOut" ELSE "quantityOut" END,
  "quantityLoss" = CASE WHEN "quantityLoss" = 0 THEN scraps ELSE "quantityLoss" END;
ALTER TABLE public.inventory ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.inventory
  ALTER COLUMN category TYPE public.inventory_category USING upper(category)::public.inventory_category;
ALTER TABLE public.inventory ALTER COLUMN category SET DEFAULT 'GOLD'::public.inventory_category;
ALTER TABLE public.inventory
  DROP COLUMN balance,
  DROP COLUMN "goldIn",
  DROP COLUMN "goldOut",
  DROP COLUMN scraps,
  DROP COLUMN "totalGold";

ALTER TABLE public.expenses
  ADD COLUMN source_sheet text,
  ADD COLUMN source_row integer,
  ADD CONSTRAINT expenses_source_row_key UNIQUE (source_sheet, source_row);
DELETE FROM public.expenses WHERE "inventoryReferenceId" IS NOT NULL;
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_inventory_reference_id_fkey;
ALTER TABLE public.expenses DROP COLUMN "inventoryReferenceId";

-- The server connects with the database owner credentials. Keep direct
-- Data API access closed until explicit row policies are designed.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
