-- Generalize the inventory ledger while retaining the legacy gold columns/API.
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'GOLD',
  ADD COLUMN IF NOT EXISTS "quantityIn" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quantityOut" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quantityLoss" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0;

UPDATE public.inventory
SET "quantityIn" = "goldIn",
    "quantityOut" = "goldOut",
    "quantityLoss" = scraps,
    balance = "totalGold",
    category = 'GOLD'
WHERE category = 'GOLD';

ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_category_check
  CHECK (category IN ('GOLD', 'SILVER', 'GEMSTONES', 'BOXES', 'PACKAGING', 'FINDINGS', 'TOOLS'));

CREATE INDEX IF NOT EXISTS inventory_category_date_idx
  ON public.inventory (category, date);
