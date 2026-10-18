ALTER TABLE public.employees
  ADD COLUMN "mustChangePassword" boolean NOT NULL DEFAULT false,
  ADD COLUMN "tempPasswordExpiresAt" timestamp(3),
  ADD COLUMN "lastLoginAt" timestamp(3);
-- Existing accounts retain their current credentials. New and reset accounts
-- receive only a bcrypt hash and a 24-hour expiry through the server.
