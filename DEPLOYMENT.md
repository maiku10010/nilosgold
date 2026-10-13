# Deployment and health checks

The Vercel project `nilosgold` deploys production automatically from GitHub `main`.
It uses the Express framework preset, Node 24, `npm ci`, and `npm run vercel-build`.
The build generates and validates Prisma, compiles TypeScript, and runs the test suite.
No database migration is required for the inventory/contact/gold-rate release.

Run `npm run check` locally before pushing. The HTTP smoke test starts a temporary
localhost server and checks health plus authentication boundaries. Tests use mocks
for database/email/provider calls; they do not alter production records.
After a push, verify that the deployment for that exact commit is Ready and that
`https://nilosgold.vercel.app/health` responds successfully.

## Gold pricing

Set `GOLD_API_KEY` as a server-only Vercel environment variable to use GoldAPI.io
XAU/PHP. Never expose it through frontend variables. The optional `GOLD_API_URL`
must be `https://www.goldapi.io/api/XAU/PHP`.

If the primary provider fails or has no key, the API uses Gold-API.com USD gold
and ExchangeRate-API's daily USD/PHP conversion. Responses identify the source,
quote time, FX time, and whether the rate is stale. Values represent 24K PHP per
gram. Provider responses are validated and requests have six-second timeouts.
Successful quotes are cached for five minutes in each running server instance.
During outages, an available in-memory last-known quote may be used for up to
24 hours; cold starts have no persistent fallback cache. Without a valid quote,
the API returns 503 and the UI asks for a verified manual job-costing rate.

The automated suite covers primary/backup responses, unit conversion, cache
coalescing, stale/error handling, invalid payloads, and credential destination.
The public health route checks application startup, not database connectivity.
