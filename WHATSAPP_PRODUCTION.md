# WhatsApp entirely on Vercel

The backend now uses a Vercel **Daemon** for Baileys. Vercel HTTP Functions
keep serving the API; they do not own WhatsApp sockets. The existing PostgreSQL
master database carries branch-scoped commands and connection status, and each
branch database retains credentials and Signal keys. No additional hosting
provider or messaging provider is required.

## Deploy

1. Deploy the backend repository root (`Laptop-Backend`) as the Vercel project.
   The project Root Directory must be unset / repository root: Vercel Daemons
   currently do not support a project root set to a subfolder.
2. Keep existing production database, JWT and branch encryption environment
   variables. Daemons inherit production environment variables. Do not set
   `WHATSAPP_WORKER` in project settings; only Docker sets it for the worker.
3. Deploy `vercel.json`, `Dockerfile.whatsapp`, and the updated source together
   to **production**. Preview deployments do not run Daemons. The configuration
   starts one `whatsapp` daemon in `sin1`, alongside the existing API.
4. Confirm the daemon is running in the Vercel dashboard and check its logs.
   The database role needs CREATE TABLE and read/write access for
   `whatsapp_worker_status`, `whatsapp_worker_control`, `whatsapp_worker_commands`
   in the master database and the existing auth tables in branch databases.
5. Keep the frontend's API URL pointed to the same Vercel backend domain.
   Generate a QR, scan, send a test message, then close the browser and verify
   incoming bot replies still work. Redeploy and verify the saved login restores.

The worker is guarded by an expiring lease during deployment overlap. API
instances read the same status instead of their own empty in-memory sessions.
Failed or stale workers cannot advertise a live connection. Message commands
are claimed once and are not replayed after a crash: if delivery is uncertain,
the API reports an error rather than silently sending a duplicate.

The worker receives no inbound traffic; all commands pass through the existing
authenticated API and PostgreSQL. Completed command payloads are cleared and
records expire after one hour. Treat status QR values and auth tables as secrets.

## Validation

`node --test src/modules/whatsapp/*.test.cjs`

The database integration test is opt-in:
`RUN_WA_DB_TESTS=1 node --test src/modules/whatsapp/worker.integration.test.cjs`
It creates only transaction-scoped TEMP tables and rolls them back; no customer
messages are sent and no customer data or credentials are changed.

Vercel Daemons are a public beta, production-only. Hobby includes a limited
monthly Active CPU quota; hitting it stops daemons until renewal or upgrade.
Pro charges for daemon compute/memory. Check the project's plan and quota before
declaring production operation verified.

Official references:
- https://vercel.com/docs/daemons
- https://vercel.com/docs/daemons/config-reference
- https://vercel.com/docs/daemons/limits

Local development still uses `npm run dev` / `npm start` with the in-process
WhatsApp service. Do not run local and production WhatsApp owners against the
same linked account/database concurrently. WhatsApp-side unlink or revocation
still requires relinking; application persistence cannot override that.
