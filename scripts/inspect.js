const db = require('../src/config/db');

async function main() {
  const tables = ['invoices', 'payments', 'accounts', 'invoice_items'];
  for (const t of tables) {
    const res = await db.query(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = $1 
       ORDER BY ordinal_position`,
      [t]
    );
    console.log(`\n=== ${t.toUpperCase()} ===`);
    console.log(res.rows.map(r => `${r.column_name}: ${r.data_type}`).join('\n'));
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

