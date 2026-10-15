-- Additive historical import area. Does not replay historical transactions into
-- current operational ledgers, which may already contain earlier imports.
CREATE TABLE public.legacy_invoices (
  record_id text PRIMARY KEY,
  legacy_invoice text NOT NULL CHECK (legacy_invoice LIKE 'LIN-%'),
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  invoice_date date,
  date_estimated boolean NOT NULL DEFAULT false,
  customer_name text,
  description text,
  status text NOT NULL CHECK (status IN (
    'Fully Paid, Unfinished Product', 'Finished Product, Unpaid', 'Cancelled',
    'Not Yet Finished', 'Fully Paid, Finished Product',
    'Fully Paid, Product Status Unknown', 'Unpaid, Product Status Unknown'
  )),
  pulled_out boolean NOT NULL DEFAULT false,
  sale_price numeric(18,2) CHECK (sale_price >= 0),
  recorded_payment numeric(18,2) CHECK (recorded_payment >= 0),
  assumed_payment numeric(18,2) CHECK (assumed_payment >= 0),
  reconciled_payment numeric(18,2) CHECK (reconciled_payment >= 0),
  balance numeric(18,2) CHECK (balance >= 0),
  excess_payment numeric(18,2) CHECK (excess_payment >= 0),
  excess_classification text CHECK (excess_classification = 'Price Change or Tip'),
  UNIQUE (source_file, source_row),
  CONSTRAINT legacy_pulled_out_nulls CHECK (NOT pulled_out OR (
    status = 'Cancelled' AND sale_price IS NULL AND recorded_payment IS NULL
    AND assumed_payment IS NULL AND reconciled_payment IS NULL
    AND balance IS NULL AND excess_payment IS NULL AND excess_classification IS NULL
  )),
  CONSTRAINT legacy_payment_sum CHECK (
    reconciled_payment IS NULL OR (recorded_payment IS NOT NULL AND assumed_payment IS NOT NULL
    AND reconciled_payment = recorded_payment + assumed_payment)
  ),
  CONSTRAINT legacy_balance_calculation CHECK (
    sale_price IS NULL OR reconciled_payment IS NULL OR
    (balance IS NOT NULL AND balance = greatest(sale_price - reconciled_payment, 0))
  ),
  CONSTRAINT legacy_excess_calculation CHECK (
    sale_price IS NULL OR recorded_payment IS NULL OR
    (excess_payment IS NOT NULL AND excess_payment = greatest(recorded_payment - sale_price, 0))
  )
);
CREATE INDEX legacy_invoices_legacy_invoice_idx ON public.legacy_invoices (legacy_invoice);
CREATE INDEX legacy_invoices_invoice_date_status_idx ON public.legacy_invoices (invoice_date, status);

CREATE TABLE public.legacy_sheet_rows (
  record_id text PRIMARY KEY,
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  processing text NOT NULL CHECK (processing IN (
    'Reconciled', 'Inventory Deferred', 'Historical Reference Only', 'Pulled Out'
  )),
  invoice_record_id text REFERENCES public.legacy_invoices(record_id) ON DELETE RESTRICT,
  original_data jsonb NOT NULL CHECK (jsonb_typeof(original_data) = 'object'),
  cleaned_data jsonb NOT NULL CHECK (jsonb_typeof(cleaned_data) = 'object'),
  UNIQUE (source_file, source_row)
);
CREATE INDEX legacy_sheet_rows_invoice_record_id_idx ON public.legacy_sheet_rows (invoice_record_id);
ALTER TABLE public.legacy_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_sheet_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_invoices, public.legacy_sheet_rows FROM anon, authenticated;
