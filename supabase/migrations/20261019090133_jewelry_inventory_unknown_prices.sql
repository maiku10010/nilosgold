-- Preserve missing source prices without representing them as free purchases.
ALTER TABLE public.inventory ALTER COLUMN "unitPrice" DROP NOT NULL;
COMMENT ON COLUMN public.inventory."unitPrice" IS 'Unit cost; NULL means not provided, zero means known zero cost.';
