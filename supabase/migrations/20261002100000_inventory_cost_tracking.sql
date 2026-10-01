ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS "unitPrice" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "jobCostId" text UNIQUE;

ALTER TABLE public.job_costs
  ADD COLUMN IF NOT EXISTS gold_scrap numeric NOT NULL DEFAULT 0;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS "inventoryReferenceId" text UNIQUE;

DO $$ BEGIN
  ALTER TABLE public.inventory
    ADD CONSTRAINT inventory_job_cost_id_fkey FOREIGN KEY ("jobCostId")
    REFERENCES public.job_costs("jobCostId") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_inventory_reference_id_fkey FOREIGN KEY ("inventoryReferenceId")
    REFERENCES public.inventory("referenceId") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
