// Older installations used SERIAL repair part IDs; the API issues PRT-* IDs.
// Preserve existing numeric IDs as strings and update dependent FK columns together.
async function migrateRepairPartIds(pool) {
  const c=await pool.connect();
  const q=s=>'"'+s.replace(/"/g,'""')+'"';
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(884422002)');
    const type=await c.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='repair_parts' AND column_name='id'");
    if (type.rows.length && type.rows[0].data_type !== 'character varying') {
      const refs=await c.query(`SELECT t.relname AS table_name, a.attname AS column_name, f.conname, pg_get_constraintdef(f.oid) AS definition
        FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=f.conkey[1]
        WHERE f.contype='f' AND f.confrelid='repair_parts'::regclass`);
      for(const r of refs.rows) await c.query(`ALTER TABLE ${q(r.table_name)} DROP CONSTRAINT ${q(r.conname)}`);
      await c.query('ALTER TABLE repair_parts ALTER COLUMN id DROP DEFAULT');
      await c.query('ALTER TABLE repair_parts ALTER COLUMN id TYPE VARCHAR(50) USING id::text');
      for(const r of refs.rows) {
        await c.query(`ALTER TABLE ${q(r.table_name)} ALTER COLUMN ${q(r.column_name)} TYPE VARCHAR(50) USING ${q(r.column_name)}::text`);
        await c.query(`ALTER TABLE ${q(r.table_name)} ADD CONSTRAINT ${q(r.conname)} ${r.definition}`);
      }
    }
    await c.query('COMMIT');
  } catch(error) {await c.query('ROLLBACK');throw error;} finally {c.release();}
}
module.exports={migrateRepairPartIds};
