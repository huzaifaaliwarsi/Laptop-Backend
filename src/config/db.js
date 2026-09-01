const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const branchManager = require('./branchManager');
const branchContext = require('../middleware/branchContext');

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

// Default Branch 1 / Fallback pool
const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client (Branch 1)', err);
});

/**
 * Returns the active request's branch pool, or defaults safely to Branch 1 pool
 */
function getActivePool() {
  try {
    const store = branchContext.getBranchStore();
    if (store && store.pool) {
      return store.pool;
    }
  } catch (e) {
    // Ignore context error and use fallback pool
  }
  return pool;
}

const query = (text, params) => getActivePool().query(text, params);

const getClient = () => getActivePool().connect();

const withTransaction = async (callback) => {
  const client = await getActivePool().connect();
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

// Master DB accessor
const master = {
  pool: branchManager.masterPool,
  query: (text, params) => branchManager.masterPool.query(text, params),
  getClient: () => branchManager.masterPool.connect(),
  withTransaction: async (callback) => {
    const client = await branchManager.masterPool.connect();
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
  }
};

// Initialize Master DB and ensure Branch 1 critical columns exist
(async () => {
  try {
    // 1. Initialize Central Master DB
    await branchManager.initMasterDb();

    // 2. Ensure Branch 1 operational database migrations
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

      -- Migration: add device_password and pattern_code to repair_jobs
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS device_password VARCHAR(100);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS pattern_code VARCHAR(50);

      -- Migration: Add missing columns to repair_jobs if they do not exist
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS item_type VARCHAR(50) DEFAULT 'Service';
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS customer_email VARCHAR(150);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS accessories_received TEXT;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS physical_condition TEXT;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS initial_quotation NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS warranty_terms TEXT;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS internal_notes TEXT;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS technical_notes TEXT;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS diagnosis_result TEXT;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS customer_approval_status VARCHAR(50) DEFAULT 'Not Required';
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS customer_approval_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approval_channel VARCHAR(50);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approved_by_user_id VARCHAR(50);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approval_note TEXT;

      -- Migration: Dedicated workshop repair parts catalogue
      CREATE TABLE IF NOT EXISTS repair_parts (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        compatible_models TEXT,
        cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        selling_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        current_stock INT NOT NULL DEFAULT 0,
        min_stock_alert INT NOT NULL DEFAULT 2,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Migration: Spare part categories table
      CREATE TABLE IF NOT EXISTS spare_part_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Seed baseline categories if empty
      INSERT INTO spare_part_categories (name, description) VALUES
        ('Screen / LCD', 'Replacement display panels and digitizers'),
        ('Battery', 'OEM and compatible batteries'),
        ('Keyboard', 'Internal and external keyboards'),
        ('Motherboard', 'Main logic boards and daughterboards'),
        ('Charging Port', 'DC jacks and USB-C charging flex'),
        ('Camera', 'Front and rear camera modules'),
        ('Speaker', 'Earpiece and loud speaker modules'),
        ('Housing', 'Back glass, frames, and bezels'),
        ('Storage', 'Internal SSDs, eMMC, and flash modules'),
        ('RAM', 'SO-DIMM and laptop memory sticks'),
        ('Cooling Fan', 'CPU/GPU cooling fans and heatsinks'),
        ('Power Supply', 'Internal power boards and adapters')
      ON CONFLICT (name) DO NOTHING;

      -- Migration: Spare parts inventory movements audit trail
      -- BUG FIX: part_id must be INT (not VARCHAR) to match repair_parts.id SERIAL type.
      -- Also added all missing columns that routes depend on (part_code, part_name, direction, etc.).
      CREATE TABLE IF NOT EXISTS repair_parts_movements (
        id SERIAL PRIMARY KEY,
        part_id INT REFERENCES repair_parts(id) ON DELETE CASCADE,
        part_code VARCHAR(50),
        part_name VARCHAR(255),
        direction VARCHAR(10) NOT NULL DEFAULT 'IN',
        quantity INT NOT NULL DEFAULT 0,
        reason TEXT,
        reference_type VARCHAR(100),
        reference_id VARCHAR(100),
        balance_after INT DEFAULT 0,
        performed_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        performed_by_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Add any missing columns to existing repair_parts_movements tables
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS part_code VARCHAR(50);
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS part_name VARCHAR(255);
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'IN';
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS reason TEXT;
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS balance_after INT DEFAULT 0;
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS performed_by_name VARCHAR(255);
      ALTER TABLE repair_parts_movements ADD COLUMN IF NOT EXISTS performed_by VARCHAR(50);

      CREATE INDEX IF NOT EXISTS idx_repair_parts_code ON repair_parts(code);
      CREATE INDEX IF NOT EXISTS idx_repair_parts_category ON repair_parts(category);

      -- Migration: Formal customer approval workflow for additional quotation / newly found faults
      CREATE TABLE IF NOT EXISTS repair_additional_work_requests (
        id SERIAL PRIMARY KEY,
        repair_job_id VARCHAR(50) NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
        diagnosed_fault TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
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

      -- Migration: Operational role cleanup (Branch users can only be admin, sales, technician)
      -- BUG FIX: Wrapped in DO block with existence check so it only runs once, not on every restart.
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE role IN ('super_admin', 'Super Admin') LIMIT 1) THEN
          UPDATE users SET role = 'admin' WHERE role = 'super_admin' OR role = 'Super Admin';
        END IF;
      END $$;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'sales', 'technician'));

      -- Add status column to repair_parts if missing
      ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active';
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
  master,
  getActivePool,
};
