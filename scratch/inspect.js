const { pool } = require('../src/config/db');

async function inspect() {
  const p = await pool.query("SELECT id, code, brand, model, initial_stock, stock_in, stock_out, current_stock, source_name FROM products");
  console.log('PRODUCTS:', JSON.stringify(p.rows, null, 2));

  const m = await pool.query("SELECT * FROM inventory_movements ORDER BY id DESC LIMIT 15");
  console.log('MOVEMENTS:', JSON.stringify(m.rows, null, 2));

  const vr = await pool.query("SELECT * FROM vendor_returns ORDER BY created_at DESC LIMIT 5");
  console.log('VENDOR_RETURNS:', JSON.stringify(vr.rows, null, 2));

  process.exit(0);
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
