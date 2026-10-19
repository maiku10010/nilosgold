-- Preserve historical FINISHED values; pickup is recorded explicitly going forward.
ALTER TYPE public."JobStatus" ADD VALUE IF NOT EXISTS 'RELEASED';
