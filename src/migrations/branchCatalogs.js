const catalogTables=['product_categories','accessory_categories','repair_categories','expense_categories','spare_part_categories'];
const baselineNames = {
  product_categories: ['Laptop','PC','LCD / Screen','Accessories','Desktop','Printers'],
  accessory_categories: ['Mouse','Keyboard','Charger','SSD','RAM','Laptop Bag','Cable'],
  expense_categories: ['Rent','Salary','Utilities','Transport','Repair / Maintenance','Marketing','Office Expense','Internet','Tea / Refreshment','Other'],
  repair_categories: ['Laptop','Mobile','Desktop','Printer','Accessories'],
  spare_part_categories: ['Screen / LCD','Battery','Keyboard','Motherboard','Charging Port','Camera','Speaker','Housing','Storage','RAM','Cooling Fan','Power Supply']
};
const categoryOwners = { product_categories: 'products', repair_categories: 'repair_jobs', expense_categories: 'expenses' };
async function seedBranchCatalogs(client, branchId, { seedDefaults = true } = {}) {
  if(Number(branchId)===1) return;
  for(const table of catalogTables) {
    const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name NOT IN ('id','branch_id') ORDER BY ordinal_position",[table])).rows.map(r=>'"'+r.column_name+'"').join(',');
    if(columns) {
      // Preserve legacy references without synchronizing custom branch-1 catalogs.
      const child = categoryOwners[table];
      const referenced = child ? `EXISTS (SELECT 1 FROM ${child} c WHERE c.branch_id=$1 AND c.category_id=src.id)` : 'FALSE';
      const systemDefault = columns.includes('"is_system"') ? 'src.is_system = TRUE OR ' : '';
      const defaults = !seedDefaults ? 'FALSE' : `(${systemDefault}src.name = ANY($2::text[]))`;
      const params = seedDefaults ? [branchId, baselineNames[table] || []] : [branchId];
      await client.query(`
        INSERT INTO ${table} (${columns}, branch_id)
        SELECT ${columns}, $1 
        FROM ${table} src
        WHERE src.branch_id = 1
          AND (${defaults} OR ${referenced})
          AND NOT EXISTS (
            SELECT 1 FROM ${table} dest 
            WHERE dest.branch_id = $1 AND dest.name = src.name
          )
      `, params);
    }
  }
  for(const [child,parent] of [['products','product_categories'],['repair_jobs','repair_categories'],['expenses','expense_categories']]) {
    await client.query(`UPDATE ${child} c SET category_id=dest.id FROM ${parent} src JOIN ${parent} dest ON src.name=dest.name AND dest.branch_id=$1 WHERE c.category_id=src.id AND c.branch_id=$1 AND src.branch_id=1`,[branchId]);
  }
}
module.exports={seedBranchCatalogs,catalogTables};
