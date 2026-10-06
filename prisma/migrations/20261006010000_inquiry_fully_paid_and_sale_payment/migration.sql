ALTER TABLE "inquiries"
  ADD COLUMN IF NOT EXISTS "isFullyPaid" BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sales' AND column_name = 'downpayment'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sales' AND column_name = 'payment'
  ) THEN
    ALTER TABLE "sales" RENAME COLUMN "downpayment" TO "payment";
  END IF;
END $$;
