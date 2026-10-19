# GoldDemo deployment

The API and UI are separate repositories. Both use `feature/white-label-demo`.
The API is Express + Prisma; the companion `nilosgoldui` app is Vite + React.
`NEXT_PUBLIC_APP_NAME` defaults to `Goldsmith OS`; set it to `GoldDemo` in both projects.
Vite explicitly exposes only `VITE_*` and `NEXT_PUBLIC_*` variables to browser code.

## Provisioning status

Creating **GoldDemo** in **maiku10010's Org**, Singapore, was attempted on
2026-10-20. Supabase rejected it because the account has reached its two active
free-project limit. No project was created and no existing database was modified.
Make a project slot available or upgrade through Supabase, then create the new
project. Do not reuse the shop database for this demo.

The requested address is `https://goldsmith.vercel.app`. This is a Vercel-owned
subdomain, subject to availability, rather than a custom DNS domain. It has not
been claimed or deployed. If unavailable, use the assigned project domain or a
domain you own, and update CORS and the UI API URL accordingly.

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

Run Supabase's database security advisors after provisioning. Live bootstrap,
seed, and database verification remain blocked by the project quota.

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
- `CORS_ORIGIN=https://goldsmith.vercel.app` plus the actual assigned UI project
  domain if needed. Origins are exact; add any preview URL explicitly to the API
  preview environment to test it.
- Optional `APP_CONTACT`, `APP_RECEIPT_FOOTER`, and server-only `GOLD_API_KEY`.
- Leave `RESEND_API_KEY` and `EMAIL_FROM` unset until a separate demo sender is
  verified. Then set `EMAIL_FROM=GoldDemo <receipts@your-verified-domain>`.
- Omit `DEMO_*` variables. Seeding and schema bootstrap never run in build/start.

Configure **UI Production** variables:

- `NEXT_PUBLIC_APP_NAME=GoldDemo`, optional `NEXT_PUBLIC_APP_TAGLINE`.
- `NEXT_PUBLIC_APP_LOGO=/demo-logo.svg` (generic asset shipped in `public/`).
  You may place `demo-logo.png` there and set this variable to `/demo-logo.png`.
- `VITE_API_BASE_URL=https://<actual-new-api-domain>` without a trailing slash.
  This is required for the separate API deployment; `/api` is the local fallback.
- Optional new `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  Never add database URLs, passwords, or other secrets to the UI environment.

Deploy the API after bootstrap/seed, then build/deploy the UI with its final API
URL. Public branding and URLs are embedded at build time; redeploy after changes.
Under the new UI project's Domains settings, assign `goldsmith.vercel.app` if
available. If Vercel cannot assign it, choose an available Vercel subdomain. For
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
