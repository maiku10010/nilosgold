-- Add reversible archival and secure application workflow metadata.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;
ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;
ALTER TABLE public.job_costs ADD COLUMN IF NOT EXISTS "readyNotifiedAt" timestamp without time zone;
ALTER TABLE public.job_costs ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS "receiptSentAt" timestamp without time zone;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;

ALTER TYPE public."JobStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';
DO $$ BEGIN
  CREATE TYPE public."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id text PRIMARY KEY,
  "empId" text NOT NULL REFERENCES public.employees("empId") ON DELETE CASCADE,
  "expiresAt" timestamp without time zone NOT NULL,
  "revokedAt" timestamp without time zone,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_sessions_employee_revoked_idx ON public.auth_sessions ("empId", "revokedAt");
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON public.auth_sessions ("expiresAt");

CREATE TABLE IF NOT EXISTS public.system_logs (
  "logId" text PRIMARY KEY,
  "actorEmpId" text REFERENCES public.employees("empId") ON DELETE SET NULL,
  "actorName" text NOT NULL,
  "actorRole" text NOT NULL,
  action text NOT NULL,
  "entityType" text,
  "entityId" text,
  details jsonb,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS system_logs_created_at_idx ON public.system_logs ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS system_logs_actor_created_at_idx ON public.system_logs ("actorEmpId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.approval_requests (
  "requestId" text PRIMARY KEY,
  "entityType" text NOT NULL,
  "entityId" text NOT NULL,
  action text NOT NULL,
  "beforeData" jsonb,
  "proposedData" jsonb,
  status public."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requesterEmpId" text NOT NULL REFERENCES public.employees("empId") ON DELETE RESTRICT,
  "reviewerEmpId" text REFERENCES public.employees("empId") ON DELETE SET NULL,
  "reviewerNote" text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" timestamp without time zone
);
CREATE INDEX IF NOT EXISTS approval_requests_status_created_idx ON public.approval_requests (status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS approval_requests_entity_status_idx ON public.approval_requests ("entityType", "entityId", status);

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_sessions, public.system_logs, public.approval_requests FROM anon, authenticated;
