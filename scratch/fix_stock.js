const { pool } = require('../src/config/db');

async function fixStock() {
  console.log('[FixStock] Starting database stock cleanup...');
  
  // 1. Remove old erroneous 'Same product replacement' IN records
  const delRes = await pool.query("DELETE FROM inventory_movements WHERE reason LIKE 'Same product replacement%'");
  console.log(`[FixStock] Removed ${delRes.rowCount} bogus IN replacement movements.`);

  // 2. Recalculate each product's stock_in, stock_out, current_stock from scratch
  const prodsRes = await pool.query('SELECT id, code, brand, model FROM products');
  for (const p of prodsRes.rows) {
    const movRes = await pool.query(
      'SELECT direction, SUM(quantity) as total FROM inventory_movements WHERE product_id = $1 GROUP BY direction',
      [p.id]
    );

    let stockIn = 0;
    let stockOut = 0;

    for (const row of movRes.rows) {
      if (row.direction === 'IN') stockIn = parseInt(row.total || 0, 10);
      if (row.direction === 'OUT') stockOut = parseInt(row.total || 0, 10);
    }

    const currentStock = Math.max(0, stockIn - stockOut);

    await pool.query(
      'UPDATE products SET stock_in = $1, stock_out = $2, current_stock = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [stockIn, stockOut, currentStock, p.id]
    );

    console.log(`[FixStock] ${p.code} (${p.brand} ${p.model}) => Stock IN: ${stockIn}, Stock OUT: ${stockOut}, Current Stock: ${currentStock}`);
  }

  console.log('[FixStock] All products stock calculations fixed and reconciled 100% successfully!');
  process.exit(0);
}

fixStock().catch(err => {
  console.error('[FixStock] Error:', err);
  process.exit(1);
});
