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

      -- Create dedicated repair_categories table
      CREATE TABLE IF NOT EXISTS repair_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Seed default repair categories if not present
      INSERT INTO repair_categories (name, description, is_active)
      VALUES 
        ('Laptop', 'Laptop notebooks, ultrabooks and MacBooks', TRUE),
        ('Mobile', 'Smartphones, iPhones and tablets', TRUE),
        ('Desktop', 'Custom PC towers, desktop workstations and gaming rigs', TRUE),
        ('Printer', 'Laser, inkjet, barcode and thermal printers', TRUE),
        ('Accessories', 'Chargers, power supplies, keyboards and peripherals', TRUE)
      ON CONFLICT (name) DO NOTHING;

      -- Add repair category references to repair_jobs
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS category_id INT REFERENCES repair_categories(id) ON DELETE SET NULL;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS category_name VARCHAR(100);

      -- Backfill legacy records if needed
      UPDATE repair_jobs rj
      SET category_name = COALESCE(rj.category_name, rj.product_type, 'Laptop')
      WHERE rj.category_name IS NULL;

      UPDATE repair_jobs rj
      SET category_id = rc.id
      FROM repair_categories rc
      WHERE rj.category_id IS NULL AND LOWER(rj.category_name) = LOWER(rc.name);

      -- Add catalog price snapshot and quantity to repair_job_lines
      ALTER TABLE repair_job_lines ADD COLUMN IF NOT EXISTS catalog_price_snapshot NUMERIC(18, 2);
      ALTER TABLE repair_job_lines ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1;

      UPDATE repair_job_lines
      SET quantity = 1
      WHERE quantity IS NULL OR quantity <= 0;

      UPDATE repair_job_lines
      SET catalog_price_snapshot = charges
      WHERE catalog_price_snapshot IS NULL;

      -- Ensure default standard diagnosis services exist
      INSERT INTO repair_services (id, code, name, charges, duration, conditions, status, service_type)
      VALUES 
        ('SRV-DIAG-01', 'SRV-DIAG-01', 'Standard Laptop Diagnosis & Inspection', 1000.00, '1-2 Hours', 'Complete motherboard, power rails & hardware diagnosis', 'Active', 'diagnosis'),
        ('SRV-DIAG-02', 'SRV-DIAG-02', 'Chip-Level Power & Logic Board In-Depth Inspection', 1500.00, '1-2 Days', 'Deep oscilloscope & schematic power sequence trace', 'Active', 'diagnosis')
      ON CONFLICT (id) DO UPDATE SET service_type = EXCLUDED.service_type;

      -- Create dedicated repair_parts table (Spare Parts Inventory)
      CREATE TABLE IF NOT EXISTS repair_parts (
        id VARCHAR(50) PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'General',
        compatible_models TEXT,
        cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        selling_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        current_stock INT NOT NULL DEFAULT 0,
        min_stock_alert INT NOT NULL DEFAULT 2,
        status VARCHAR(50) NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create dedicated spare_part_categories table
      CREATE TABLE IF NOT EXISTS spare_part_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        code_prefix VARCHAR(20) DEFAULT 'PRT',
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO spare_part_categories (name, code_prefix, is_system)
      VALUES
        ('Screen / Display', 'SCR', TRUE),
        ('Battery', 'BAT', TRUE),
        ('Keyboard', 'KB', TRUE),
        ('Motherboard IC', 'IC', TRUE),
        ('Cooling / Fan', 'FAN', TRUE),
        ('Power Port / Jack', 'JCK', TRUE),
        ('Thermal Paste', 'THP', TRUE),
        ('RAM / Memory', 'RAM', TRUE),
        ('Storage / SSD', 'SSD', TRUE),
        ('Hinges & Casing', 'HNG', TRUE),
        ('Flex Cable & Connector', 'FLX', TRUE),
        ('Camera / Speaker / Wi-Fi', 'MOD', TRUE),
        ('Other Spare Part', 'PRT', TRUE)
      ON CONFLICT (name) DO NOTHING;

      -- Create repair_parts_movements table (Stock Movement Ledger for Spare Parts)
      CREATE TABLE IF NOT EXISTS repair_parts_movements (
        id SERIAL PRIMARY KEY,
        part_id VARCHAR(50) REFERENCES repair_parts(id) ON DELETE CASCADE,
        part_code VARCHAR(50),
        part_name VARCHAR(255),
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('IN', 'OUT')),
        quantity INT NOT NULL,
        reason TEXT,
        reference_type VARCHAR(100),
        reference_id VARCHAR(100),
        balance_after INT,
        performed_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        performed_by_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approval_source VARCHAR(50);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS declined_at TIMESTAMP WITH TIME ZONE;

      -- Create repair_additional_work_requests table (Additional Fault Approval Engine)
      CREATE TABLE IF NOT EXISTS repair_additional_work_requests (
        id VARCHAR(50) PRIMARY KEY,
        repair_job_id VARCHAR(50) NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
        tracking_id VARCHAR(50) NOT NULL,
        fault_finding TEXT NOT NULL,
        recommended_service TEXT NOT NULL,
        service_charge NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        parts_charge NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        total_quotation NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        customer_safe_note TEXT,
        parts_payload JSONB DEFAULT '[]'::jsonb,
        status VARCHAR(50) NOT NULL DEFAULT 'Pending Approval',
        approval_source VARCHAR(50),
        approved_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        approved_by_name VARCHAR(255),
        customer_response TEXT,
        quotation_snapshot JSONB,
        created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        created_by_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP WITH TIME ZONE,
        declined_at TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_addl_work_repair_job ON repair_additional_work_requests(repair_job_id);
      CREATE INDEX IF NOT EXISTS idx_addl_work_status ON repair_additional_work_requests(status);
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

