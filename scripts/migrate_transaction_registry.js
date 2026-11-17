const { masterPool } = require('../src/config/branchManager');

async function migrate() {
  console.log('--- Applying Transaction-Level Collection Schema Migration ---');

  const statements = [
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS request_key VARCHAR(100);`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_initial BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS collected_by_id VARCHAR(50);`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS collected_by_name VARCHAR(100);`,
    `UPDATE payments SET is_initial = COALESCE(is_initial_settlement, FALSE) WHERE is_initial IS NULL OR (is_initial = FALSE AND is_initial_settlement = TRUE);`,
    `UPDATE payments SET paid_at = created_at WHERE paid_at IS NULL;`,
    `UPDATE payments SET collected_by_id = created_by WHERE collected_by_id IS NULL AND created_by IS NOT NULL;`,
    `UPDATE payments SET collected_by_name = created_by_name WHERE collected_by_name IS NULL AND created_by_name IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_request_key ON payments(request_key) WHERE request_key IS NOT NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);`,
    `CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);`,
    `CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_branch_id ON invoices(branch_id);`,
    `CREATE INDEX IF NOT EXISTS idx_payments_branch_id ON payments(branch_id);`
  ];

  for (const sql of statements) {
    try {
      await masterPool.query(sql);
      console.log('Executed:', sql.slice(0, 50) + '...');
    } catch (err) {
      console.warn('Notice on:', sql.slice(0, 50), err.message);
    }
  }

  console.log('✔ Transaction-level collection schema migration completed successfully.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
