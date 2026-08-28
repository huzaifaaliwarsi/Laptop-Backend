const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'retail_repair_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'admin123',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Ensure critical columns exist
(async () => {
  try {
    await pool.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn_cnic VARCHAR(100);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ntn_tax_id VARCHAR(100);
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE repair_services ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT 'repair';
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS diagnosis_fee NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS is_diagnosis_adjusted BOOLEAN DEFAULT FALSE;
      ALTER TABLE repair_job_lines ADD COLUMN IF NOT EXISTS line_type VARCHAR(50) DEFAULT 'repair';
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS adjust_diagnosis_fee BOOLEAN DEFAULT FALSE;
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS ntn VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS strn VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS pos_id VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS fbr_pos_id VARCHAR(100);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fbr_invoice_no VARCHAR(100);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_address TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_tax_id VARCHAR(100);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hs_code VARCHAR(50);
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount NUMERIC(18, 2) DEFAULT 0.00;

      -- Ensure default standard diagnosis services exist
      INSERT INTO repair_services (id, code, name, charges, duration, conditions, status, service_type)
      VALUES 
        ('SRV-DIAG-01', 'SRV-DIAG-01', 'Standard Laptop Diagnosis & Inspection', 1000.00, '1-2 Hours', 'Complete motherboard, power rails & hardware diagnosis', 'Active', 'diagnosis'),
        ('SRV-DIAG-02', 'SRV-DIAG-02', 'Chip-Level Power & Logic Board In-Depth Inspection', 1500.00, '1-2 Days', 'Deep oscilloscope & schematic power sequence trace', 'Active', 'diagnosis')
      ON CONFLICT (id) DO UPDATE SET service_type = EXCLUDED.service_type;
    `);
  } catch (err) {
    console.error('[DB Init] Column check error:', err.message);
  }
})();

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
};

