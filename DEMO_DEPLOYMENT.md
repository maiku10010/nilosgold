# GoldDemo deployment

The API and UI are separate repositories. Both use `feature/white-label-demo`.
The API is Express + Prisma; the companion `nilosgoldui` app is Vite + React.
`NEXT_PUBLIC_APP_NAME` defaults to `Goldsmith OS`; set it to `GoldDemo` in both projects.
Vite explicitly exposes only `VITE_*` and `NEXT_PUBLIC_*` variables to browser code.

## Provisioning status

Provisioned on 2026-10-20:

- Supabase: **GoldDemo**, Singapore, project `kzupjvycvcspinpctmty`.
- Vercel API: **golddemo-api**, https://golddemo-api.vercel.app.
- Vercel UI: **golddemo**, https://golddemo-five.vercel.app.
- `goldsmith.vercel.app` is owned by another team and could not be assigned.
- The older `nilosgold-db` was paused with the user's authorization to free a slot.
  **nilosgold-db-singapore** remains running and was not modified.

The new database was initialized from the schema snapshot and seeded with mock
records only. Verification found zero non-DEMO IDs across every business module.
All 13 public tables have RLS enabled; anon/authenticated grants are revoked.
The security advisor reports only informational no-policy notices, intentional
for this API-only design (see [Supabase's explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

The API uses its own `golddemo_api` database role, fresh credentials, and a fresh
AUTH_SECRET, stored as encrypted Vercel variables. It cannot use either shop
connection when `DEMO_SUPABASE_PROJECT_REF=kzupjvycvcspinpctmty` is set. Verified
TLS uses the official Supabase CA supplied through `DATABASE_SSL_CA`; certificate
verification remains enabled. A public copy of that CA is in `certs/` for local
reference (not a secret).

The frontend is pinned with `VITE_DEMO_API_ORIGIN=https://golddemo-api.vercel.app`.
An API URL mismatch fails the build and client startup. Its public Supabase URL
and key also belong only to GoldDemo. No production credentials were copied.
The `.vercelignore` excludes historical imported datasets and local env files.

Private generated setup/login credentials are in the ignored `.env.demo.local`.
Do not commit this file or paste its database/session secrets into chat. Demo
usernames remain `demo.admin`, `demo.staff`, and `demo.maker`.

## Fresh database setup

1. Copy `.env.example` to the ignored `.env.demo.local` and enter **only the new
   project's** credentials. Leave the existing `.env` untouched.
2. Set `DATABASE_URL` to the transaction pooler (6543). Set `DIRECT_URL` to the
   direct connection or session pooler (5432), with a URL-encoded password. Use
   the database owner or a dedicated privileged Prisma role. Set the new public
   Supabase URL and publishable/legacy anon key; never expose a service-role key.
3. Set `DEMO_ALLOW_SEED=true`, `DEMO_DATABASE_HOST` to the exact DIRECT_URL host,
   and `DEMO_ADMIN_PASSWORD` to a private password (12+ characters, at most 72
   UTF-8 bytes). These setup variables belong only in the local demo env file.
4. In PowerShell, from the API checkout:

   ```powershell
   $env:DOTENV_CONFIG_PATH = '.env.demo.local'
   npm ci
   npx prisma generate
   npm run demo:bootstrap
   npm run demo:seed
   ```

The bootstrap uses the committed current-schema snapshot `prisma/demo-schema.sql`
inside a transaction and refuses any existing public tables. It enables RLS on
all 13 application tables and revokes access from `anon` and `authenticated`.
The API uses its database credentials and its existing employee/session auth;
Supabase Auth is not used. Browser clients call the API, not Supabase tables.
The public Supabase variables are reserved for integrations, not needed for the
current app. You may disable the Data API for this Prisma-only database.

The seed is atomic, refuses any populated application table, deletes nothing,
and hashes the supplied password with bcrypt. It creates 3 employees, 12 clients,
24 inquiries, 18 linked jobs and line items, 12 daily sales with paid/partial/
pending examples and payments, gold/silver/packaging/boxes/gems/findings/tools
stock, gold consumption and recovered scrap, 16 expenses, 24 audit logs, and a
pending staff approval. Dates are relative to seed time; addresses use example.com.
Login usernames are `demo.admin`, `demo.staff`, `demo.maker`; all initially use
the supplied password. Keep that password private. An unrestricted public login
allows persistent writes; share credentials only with intended demo users.

This is a **fresh-install snapshot**, separate from historical Prisma/Supabase
migrations that assume legacy tables and imported shop data. Do not replay those
historical migrations or `data/imports` on this database. Keep production migration
history intact. Future demo schema changes need reviewed additive migrations
against this snapshot. Regenerate the snapshot with `prisma migrate diff` when
the Prisma schema changes, retaining its RLS and SQL-only constraints.

Verify after seeding using the new database SQL editor:

```sql
select 'inquiries' as module, count(*) from inquiries
union all select 'jobs', count(*) from job_costs
union all select 'sales', count(*) from sales
union all select 'inventory', count(*) from inventory
union all select 'expenses', count(*) from expenses
union all select 'audit', count(*) from system_logs;
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Run Supabase's database security advisors after provisioning. Bootstrap, seed, and isolation queries were verified on the new project.

## Vercel projects and branch

Create new Vercel projects through Git import rather than relinking the existing
shop projects or copying their environment variables:

| Project | Repository / branch | Build | Output / preset |
| --- | --- | --- | --- |
| GoldDemo (`golddemo`) | UI repository / `feature/white-label-demo` | `npm run check` | `dist`, Vite |
| GoldDemo API (`golddemo-api`) | API repository / `feature/white-label-demo` | `npm run vercel-build` | Express |

Use each repository root and `npm ci`. Existing `vercel.json` files supply the
build settings. In each new project's Git/Production environment settings, set
the production branch to `feature/white-label-demo`. Never change the production
branch or credentials of the existing shop projects. Choose a Singapore function
region for the new API, near its new Supabase database.

Configure **API Production** variables from the new instance:

- `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_APP_NAME=GoldDemo`.
- A fresh `AUTH_SECRET` (32+ random characters), `AUTH_COOKIE_NAME=goldsmith_demo_session`.
- `CORS_ORIGIN=https://golddemo-five.vercel.app` plus the actual assigned UI project
  domain if needed. Origins are exact; add any preview URL explicitly to the API
  preview environment to test it.
- Optional `APP_CONTACT`, `APP_RECEIPT_FOOTER`, and server-only `GOLD_API_KEY`.
- Leave `RESEND_API_KEY` and `EMAIL_FROM` unset until a separate demo sender is
  verified. Then set `EMAIL_FROM=GoldDemo <receipts@your-verified-domain>`.
- Set `DEMO_SUPABASE_PROJECT_REF` to the new project reference. Omit local setup
  variables `DEMO_ALLOW_SEED`, `DEMO_DATABASE_HOST`, and `DEMO_ADMIN_PASSWORD`. Seeding and schema bootstrap never run in build/start.

Configure **UI Production** variables:

- `NEXT_PUBLIC_APP_NAME=GoldDemo`, optional `NEXT_PUBLIC_APP_TAGLINE`.
- `NEXT_PUBLIC_APP_LOGO=/demo-logo.svg` (generic asset shipped in `public/`).
  You may place `demo-logo.png` there and set this variable to `/demo-logo.png`.
- `VITE_API_BASE_URL=https://<actual-new-api-domain>` without a trailing slash.
  Also set `VITE_DEMO_API_ORIGIN` to exactly the same URL.
  This is required for the separate API deployment; `/api` is the local fallback.
- Optional new `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  Never add database URLs, passwords, or other secrets to the UI environment.

Deploy the API after bootstrap/seed, then build/deploy the UI with its final API
URL. Public branding and URLs are embedded at build time; redeploy after changes.
Under the new UI project's Domains settings, use the assigned `golddemo-five.vercel.app`. `goldsmith.vercel.app` is unavailable. If Vercel cannot assign it, choose an available Vercel subdomain. For
a purchased custom domain, add it there and use the exact DNS records Vercel
provides. Do not point any production shop hostname to the demo.

## Verification

Run `npm run check` in both repositories. The API check includes seed TypeScript
validation and uses mocked databases for HTTP tests; it never seeds a live DB.
After deployment, verify `/health`, admin/staff login, each module's data, creating
an inquiry and job, stock allocation, sale/payment balances, approval permissions,
and audit entries. Confirm the title, favicon, login/sidebar, and receipt email
branding. Test email using a controlled mailbox after explicitly configuring it.

References: [Supabase Prisma](https://supabase.com/docs/guides/database/prisma),
[Vercel Git settings](https://vercel.com/docs/git),
[Vercel domains](https://vercel.com/docs/domains/working-with-domains).
