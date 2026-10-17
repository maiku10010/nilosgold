-- Commit the enum change separately before using its new value.
ALTER TYPE public.inventory_category ADD VALUE IF NOT EXISTS 'SCRAP';
