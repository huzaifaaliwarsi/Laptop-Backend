const quote = value => '"' + value.replace(/"/g, '""') + '"';
const { catalogTables, seedBranchCatalogs } = require('./branchCatalogs');

async function migrateSharedDatabase(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(884422002)');

    // Ensure core multi-tenant tables and sequences exist first
    await c.query(`CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
      branch_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(branch_id,key));
      CREATE TABLE IF NOT EXISTS whatsapp_auth_leases (
      branch_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
      CREATE SEQUENCE IF NOT EXISTS public.entity_id_sequence START 1000000000;
      CREATE TABLE IF NOT EXISTS branch_counters (branch_id INTEGER NOT NULL, key TEXT NOT NULL, value BIGINT NOT NULL, PRIMARY KEY(branch_id,key));`);

    let hasRuntimeRole = false;
    try {
      await c.query('SAVEPOINT role_sp');
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'retail_branch_runtime') THEN
          BEGIN
            CREATE ROLE retail_branch_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;
      END $$`);
      const role = await c.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'retail_branch_runtime'");
      if (role.rows.length > 0 && !role.rows[0].rolsuper && !role.rows[0].rolbypassrls) {
        const owner = (await c.query('SELECT current_user AS name')).rows[0].name;
        await c.query(`GRANT retail_branch_runtime TO ${quote(owner)}`);
        await c.query('GRANT USAGE ON SCHEMA public TO retail_branch_runtime');
        hasRuntimeRole = true;
      }
      await c.query('RELEASE SAVEPOINT role_sp');
    } catch (_) {
      hasRuntimeRole = false;
      try { await c.query('ROLLBACK TO SAVEPOINT role_sp'); } catch (e) {}
    }
    const identityFKs = await c.query("SELECT conname FROM pg_constraint WHERE conrelid='master_staff_identities'::regclass AND contype='f'");
    for (const row of identityFKs.rows) await c.query(`ALTER TABLE master_staff_identities ALTER CONSTRAINT ${quote(row.conname)} DEFERRABLE INITIALLY DEFERRED`);
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map(r => r.tablename);
    const scoped = tables.filter(t => !t.startsWith('master_'));
    for (const table of scoped) {
      const t = quote(table);
      await c.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS branch_id INTEGER NOT NULL DEFAULT 1`);
      await c.query(`ALTER TABLE ${t} ALTER COLUMN branch_id SET DEFAULT COALESCE(NULLIF(current_setting('app.branch_id', true), '')::integer, 1)`);
      await c.query(`CREATE INDEX IF NOT EXISTS ${quote('idx_branch_' + table)} ON ${t}(branch_id)`);
      const fkName='fk_branch_'+table;
      const existingFK=await c.query('SELECT 1 FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2',[table,fkName]);
      if(!existingFK.rows.length) await c.query(`ALTER TABLE ${t} ADD CONSTRAINT ${quote(fkName)} FOREIGN KEY(branch_id) REFERENCES master_branches(id) DEFERRABLE INITIALLY DEFERRED`);
      if (hasRuntimeRole) {
        await c.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await c.query(`DROP POLICY IF EXISTS branch_isolation ON ${t}`);
        await c.query(`CREATE POLICY branch_isolation ON ${t} TO retail_branch_runtime
          USING (branch_id = NULLIF(current_setting('app.branch_id', true), '')::integer)
          WITH CHECK (branch_id = NULLIF(current_setting('app.branch_id', true), '')::integer)`);
        await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO retail_branch_runtime`);
      }
    }
    if (hasRuntimeRole) {
      await c.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO retail_branch_runtime');
    }

    await c.query(`ALTER TABLE repair_additional_work_requests ALTER COLUMN id DROP DEFAULT;
      ALTER TABLE repair_additional_work_requests ALTER COLUMN id TYPE VARCHAR(50) USING id::text;
      ALTER TABLE repair_additional_work_requests ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(100);
      ALTER TABLE repair_additional_work_requests ADD COLUMN IF NOT EXISTS fault_finding TEXT;
      ALTER TABLE repair_additional_work_requests ADD COLUMN IF NOT EXISTS recommended_service TEXT;
      ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT FALSE;
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS city VARCHAR(100);`);

    // Older databases retain the former names with NOT NULL constraints.
    const legacyWorkColumns=await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='repair_additional_work_requests' AND column_name IN ('diagnosed_fault','recommended_action')");
    for(const {column_name} of legacyWorkColumns.rows) {
      const replacement=column_name==='diagnosed_fault'?'fault_finding':'recommended_service';
      await c.query(`ALTER TABLE repair_additional_work_requests ALTER COLUMN ${quote(column_name)} DROP NOT NULL`);
      await c.query(`UPDATE repair_additional_work_requests SET ${quote(replacement)}=COALESCE(${quote(replacement)},${quote(column_name)}) WHERE ${quote(replacement)} IS NULL`);
    }

    // Inherit ownership for old child rows before enforcing references.
    for (const [child, key, parent] of [
      ['invoice_items','invoice_id','invoices'], ['repair_job_lines','repair_job_id','repair_jobs'],
      ['repair_parts_used','repair_job_id','repair_jobs'], ['repair_status_history','repair_job_id','repair_jobs'],
      ['whatsapp_messages','conversation_id','whatsapp_conversations']
    ]) {
      if (scoped.includes(child) && scoped.includes(parent))
        await c.query(`UPDATE ${quote(child)} c SET branch_id = p.branch_id FROM ${quote(parent)} p WHERE c.${quote(key)} = p.id AND c.branch_id IS DISTINCT FROM p.branch_id`);
    }

    // Old global business identifiers become branch-local. Staff identity stays global.
    for (const [table, column] of [...catalogTables.map(t=>[t,'name']), ['products','code'], ['invoices','invoice_no'], ['repair_jobs','tracking_id'], ['repair_services','code'], ['repair_parts','code'], ['whatsapp_conversations','contact']]) {
      const constraints = await c.query(`SELECT conname FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'u'
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = $1::regclass AND attname = $2)]::smallint[]`, [table,column]);
      for (const row of constraints.rows) await c.query(`ALTER TABLE ${quote(table)} DROP CONSTRAINT ${quote(row.conname)}`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${quote('uq_branch_' + table + '_' + column)} ON ${quote(table)}(branch_id, ${quote(column)})`);
    }
    const branches=await c.query("SELECT id FROM master_branches WHERE id<>1");
    for(const branch of branches.rows) await seedBranchCatalogs(c,branch.id,{seedDefaults:false});
    for (const table of ['business_settings','whatsapp_settings']) {
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${quote('uq_branch_' + table)} ON ${quote(table)}(branch_id)`);
      await c.query(`CREATE OR REPLACE FUNCTION ${quote('scope_' + table)}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.id := NEW.branch_id; RETURN NEW; END $$;
        DROP TRIGGER IF EXISTS scope_settings ON ${quote(table)};
        CREATE TRIGGER scope_settings BEFORE INSERT ON ${quote(table)} FOR EACH ROW EXECUTE FUNCTION ${quote('scope_' + table)}();`);
    }

    // Foreign keys alone do not enforce branch ownership (Postgres FK checks bypass RLS).
    const refs = await c.query(`SELECT t.relname AS child, a.attname AS column, p.relname AS parent, pa.attname AS target
      FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_class p ON p.oid=f.confrelid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=f.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=f.confkey[1]
      WHERE f.contype='f' AND n.nspname='public' AND array_length(f.conkey,1)=1`);
    for (const table of scoped) {
      let checks = refs.rows.filter(r => r.child === table && scoped.includes(r.parent)).map(r => `
        IF NEW.${quote(r.column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.${quote(r.parent)} p WHERE p.${quote(r.target)} = NEW.${quote(r.column)} AND p.branch_id = NEW.branch_id) THEN
          RAISE EXCEPTION 'Invalid cross-branch reference: ${table}.${r.column}' USING ERRCODE='23503'; END IF;`).join('\n');
      if (['invoices','accounts','payments'].includes(table)) checks += `
        IF NEW.party_id IS NOT NULL AND LOWER(NEW.party_type) = 'customer' AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id=NEW.party_id AND p.branch_id=NEW.branch_id) THEN
          RAISE EXCEPTION 'Invalid customer reference' USING ERRCODE='23503'; END IF;
        IF NEW.party_id IS NOT NULL AND LOWER(NEW.party_type) = 'vendor' AND NOT EXISTS (SELECT 1 FROM public.vendors p WHERE p.id=NEW.party_id AND p.branch_id=NEW.branch_id) THEN
          RAISE EXCEPTION 'Invalid vendor reference' USING ERRCODE='23503'; END IF;`;
      await c.query(`CREATE OR REPLACE FUNCTION ${quote('check_branch_' + table)}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
            RAISE EXCEPTION 'Moving records between branches is not allowed' USING ERRCODE='23514';
          END IF;
          ${checks} RETURN NEW;
        END $$;
        DROP TRIGGER IF EXISTS branch_references ON ${quote(table)};
        CREATE TRIGGER branch_references BEFORE INSERT OR UPDATE ON ${quote(table)} FOR EACH ROW EXECUTE FUNCTION ${quote('check_branch_' + table)}();`);
    }
    await require('./identifierAllocation').migrateIdentifierAllocation(c, {grantRuntimeRole: hasRuntimeRole});
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
module.exports = { migrateSharedDatabase };
