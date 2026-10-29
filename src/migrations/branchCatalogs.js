const catalogTables=['product_categories','accessory_categories','repair_categories','expense_categories','spare_part_categories'];
async function seedBranchCatalogs(client, branchId) {
  if(Number(branchId)===1) return;
  for(const table of catalogTables) {
    const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name NOT IN ('id','branch_id') ORDER BY ordinal_position",[table])).rows.map(r=>'"'+r.column_name+'"').join(',');
    if(columns) await client.query(`INSERT INTO ${table} (${columns},branch_id) SELECT ${columns},$1 FROM ${table} WHERE branch_id=1 ON CONFLICT(branch_id,name) DO NOTHING`,[branchId]);
  }
  for(const [child,parent] of [['products','product_categories'],['repair_jobs','repair_categories'],['expenses','expense_categories']]) {
    await client.query(`UPDATE ${child} c SET category_id=dest.id FROM ${parent} src JOIN ${parent} dest ON src.name=dest.name AND dest.branch_id=$1 WHERE c.category_id=src.id AND c.branch_id=$1 AND src.branch_id=1`,[branchId]);
  }
}
module.exports={seedBranchCatalogs,catalogTables};
