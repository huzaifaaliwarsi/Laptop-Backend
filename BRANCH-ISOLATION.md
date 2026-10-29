# Shared database and local verification

All branches now use the same physical PostgreSQL pool. `getBranchPool(id)` returns a branch-scoped handle, not a new database connection configuration. `backend/server.js` delegates to the same source server as npm.

Each operation runs under the non-login, non-superuser `retail_branch_runtime` role with transaction-local `app.branch_id`. PostgreSQL row-level security applies to every operational table, including categories, settings, invoice/repair children and WhatsApp state. Missing SQL filters therefore do not expose or mutate another branch's rows. Inserts default to the current branch; explicit foreign-branch inserts fail. Foreign-key and party-reference triggers reject cross-branch associations. The privileged master pool is reserved for registry administration, provisioning and migrations.

Role and branch state reset on commit/rollback, including with transaction-pooling proxies. Ordinary users cannot choose their branch through headers or request bodies. Inactive/missing branches fail without falling back to another branch. Invoice PDFs require authentication.

Startup waits for migrations before accepting traffic. Migrations add branch ownership to existing records, retain the branch-1 default for legacy data, copy category definitions to existing/new branches, preserve legacy numeric spare-part IDs as strings, and create branch-scoped unique indexes. Runtime roles require no schema-creation permission. The migration account needs permission to create/grant the restricted role and alter its own tables. This follows PostgreSQL's [row security model](https://www.postgresql.org/docs/17/ddl-rowsecurity.html); superusers and table owners must not be used for branch operations.

Branch deletion rejects operational records and is transactional; archive populated branches. Reset deletes only the selected branch's operational records. The existing two-branch limit remains.

## Local use

From `backend`:

```powershell
npm run setup:local
npm run start:local
```

The local launcher ignores cloud connection URLs. It defaults to loopback PostgreSQL and the new `retail_repair_shared_local` database; existing `retail_repair_db` and cloud databases are not reset. It only loads the reset-capable base schema when it has just created that new database. Local admin credentials are stored in ignored `.env.local` as `LOCAL_ADMIN_USERNAME` and `LOCAL_ADMIN_PASSWORD`.

Optional local overrides: `LOCAL_DB_HOST` (loopback only), `LOCAL_DB_PORT`, `LOCAL_DB_USER`, `LOCAL_DB_PASSWORD`, `LOCAL_DB_NAME`. Do not use the general seed/reset scripts to migrate an existing database.

```powershell
npm run test:branches
npm run test:whatsapp
node scripts/local-smoke.cjs
```

Branch regression tests create and drop their own loopback-only `retail_branch_test_*` databases. They cover fresh/legacy schema migration and reruns; branch provisioning/recreation; unfiltered reads/writes; forged headers/body IDs; concurrent pool isolation; rollback; concurrent IDs; customer/staff creation; repair and child records; inventory, sales, payments and purchases; foreign references; additional repair work; exact consolidated totals with date filters; reset isolation; safe deletion; inactive branches. The smoke test starts and stops its own local server and checks health, login, settings and unauthenticated PDF rejection.

No production deployment or cloud migration was performed. Live WhatsApp device pairing was not exercised; the existing 13 session/auth-store regression tests pass. Data in historical separate branch databases is not automatically imported by this code migration; importing that data requires a separate, backed-up data migration with ID remapping. Local verification uses synthetic fixtures, not production data.

## POS duplicate-ID regression

Entity primary keys must never use a branch-visible `MAX + 1`: another branch can already own the same key. `retail_next_entity_id` reserves from a global PostgreSQL sequence and checks existing IDs across branches through a narrowly scoped definer function. It returns only a new identifier. Imported IDs ahead of the sequence are skipped. Normal reads and writes retain row-level security. Invoice/product/tracking numbers use an atomic branch-counter UPSERT, preventing simultaneous requests from reserving the same number.

The regression suite now also verifies hidden existing IDs, imported IDs ahead of the sequence, three repeated plus twelve simultaneous HTTP POS sales, and eight simultaneous cross-branch sales, including invoice/payment/account persistence. `npm run dev` uses the loopback-only local launcher; `npm start` remains the deployment entry point using configured environment variables.
