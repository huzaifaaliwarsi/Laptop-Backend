const { catalogTables }=require('../migrations/branchCatalogs');
const q=s=>'"'+s.replace(/"/g,'""')+'"';
async function deleteEmptyBranch(pool,branchId,performedBy) {
  if(Number(branchId)===1) throw Object.assign(new Error('The main branch cannot be deleted'),{status:400});
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(884422001)');
    const branch=(await c.query('SELECT * FROM master_branches WHERE id=$1 FOR UPDATE',[branchId])).rows[0];
    if(!branch) throw Object.assign(new Error('Branch not found'),{status:404});
    const tables=(await c.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='branch_id' AND table_name NOT LIKE 'master_%' ORDER BY table_name")).rows.map(r=>r.table_name);
    await c.query('LOCK TABLE '+tables.map(q).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
    const setup=new Set([...catalogTables,'users','business_settings','whatsapp_settings','whatsapp_auth_state','whatsapp_auth_leases','branch_counters','audit_logs']);
    for(const table of tables.filter(t=>!setup.has(t))) {
      if((await c.query(`SELECT 1 FROM ${q(table)} WHERE branch_id=$1 LIMIT 1`,[branchId])).rows.length)
        throw Object.assign(new Error('Branch has operational records. Archive it instead of deleting it.'),{status:409});
    }
    for(const table of ['audit_logs','whatsapp_auth_state','whatsapp_auth_leases','business_settings','whatsapp_settings','branch_counters','users',...catalogTables])
      await c.query(`DELETE FROM ${q(table)} WHERE branch_id=$1`,[branchId]);
    await c.query('DELETE FROM master_staff_identities WHERE branch_id=$1',[branchId]);
    await c.query('DELETE FROM master_branches WHERE id=$1',[branchId]);
    await c.query("INSERT INTO master_audit_logs(action,details,performed_by) VALUES ('BRANCH_PERMANENTLY_DELETED',$1,$2)",[JSON.stringify({branchId,branchCode:branch.branch_code}),performedBy]);
    await c.query('COMMIT');
  } catch(error) { await c.query('ROLLBACK'); throw error; } finally {c.release();}
}
module.exports={deleteEmptyBranch};
