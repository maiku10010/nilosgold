-- Add the statuses required for the Inquiry -> Job Costing -> Daily Sales flow.
-- Existing enum values and rows are preserved.
ALTER TYPE public."JobStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE public."SalesStatus" ADD VALUE IF NOT EXISTS 'FINISHED';
