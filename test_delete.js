const db = require('./src/config/db');

async function test() {
  try {
    await db.query("DELETE FROM inventory_movements WHERE product_code LIKE 'TST-%'");
    await db.query("DELETE FROM products WHERE code LIKE 'TST-%' OR id LIKE 'PRD-TEST%'");

    // 1. Insert product
    const ins = await db.query(
      "INSERT INTO products (id, code, inventory_type, category_name, brand, model, current_stock) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      ['PRD-TEST1', 'TST-001', 'Vendor Purchased', 'Laptop', 'Dell', 'Latitude 5490', 1]
    );
    console.log('Inserted Product:', ins.rows[0].id);

    // 2. Insert movement
    await db.query(
      "INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason) VALUES ($1, $2, 'IN', 1, 'Test')",
      ['PRD-TEST1', 'TST-001']
    );

    // 3. Test Delete logic
    await db.withTransaction(async (client) => {
      await client.query("DELETE FROM inventory_movements WHERE product_id = $1", ['PRD-TEST1']);
      await client.query("DELETE FROM products WHERE id = $1", ['PRD-TEST1']);
    });

    const cnt = await db.query("SELECT count(*)::int as c FROM products");
    console.log('Product deleted successfully! Remaining products in DB:', cnt.rows[0].c);
  } catch (err) {
    console.error('Test Error:', err);
  } finally {
    process.exit(0);
  }
}

test();
