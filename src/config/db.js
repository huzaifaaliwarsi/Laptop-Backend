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

      -- Update repair_parts_used to support repair_parts
      ALTER TABLE repair_parts_used ALTER COLUMN product_id DROP NOT NULL;
      ALTER TABLE repair_parts_used ADD COLUMN IF NOT EXISTS part_id VARCHAR(50) REFERENCES repair_parts(id) ON DELETE SET NULL;

      -- Seed baseline workshop spare parts if none exist
      INSERT INTO repair_parts (id, code, name, category, compatible_models, cost_price, selling_price, current_stock, min_stock_alert, status)
      VALUES
        ('PRT-0001', 'SCRN-156-FHD', '15.6 Inch FHD 30-Pin Slim LED Screen Panel', 'Screen / Display', 'Dell Inspiron 3511, HP 15-dw, Lenovo IdeaPad 3', 7500.00, 9500.00, 10, 2, 'Active'),
        ('PRT-0002', 'SCRN-140-FHD', '14.0 Inch FHD 30-Pin IPS Display Screen', 'Screen / Display', 'Dell Latitude 7490/5400, ThinkPad T480/T490', 7000.00, 9000.00, 8, 2, 'Active'),
        ('PRT-0003', 'BATT-DELL-WDX', 'Dell WDX0R 42Wh 3-Cell Replacement Battery', 'Battery', 'Dell Inspiron 15-5567, 13-5368, Latitude 3480', 3200.00, 4500.00, 12, 3, 'Active'),
        ('PRT-0004', 'BATT-HP-HT03', 'HP HT03XL Original 41Wh Battery', 'Battery', 'HP 15-da, 15-db, 14-ce, Pavilion 14-cf', 3400.00, 4800.00, 10, 3, 'Active'),
        ('PRT-0005', 'KB-DELL-5400', 'Dell Latitude 5400/5410 Backlit Keyboard', 'Keyboard', 'Dell Latitude 5400, 5410, 5401, 7400', 1800.00, 2800.00, 6, 2, 'Active'),
        ('PRT-0006', 'FAN-HP-15DA', 'HP 15-da / 15-db CPU Cooling Fan', 'Cooling / Fan', 'HP 15-da0000, 15-db0000, 250 G7', 650.00, 1200.00, 15, 4, 'Active'),
        ('PRT-0007', 'JACK-DC-DELL', 'Dell 4.5mm Small Pin DC Power Jack Cable', 'Power Port / Jack', 'Dell Inspiron 3501, 3505, Vostro 3500', 400.00, 850.00, 20, 5, 'Active'),
        ('PRT-0008', 'PORT-TYPEC-01', 'Universal USB Type-C 16-Pin Charging Connector', 'Power Port / Jack', 'Universal USB-C Laptops & Mobiles', 150.00, 500.00, 50, 10, 'Active'),
        ('PRT-0009', 'IC-SIO-IT8586', 'ITE IT8586E FXA Super I/O Controller IC', 'Motherboard IC', 'Lenovo IdeaPad, ThinkPad motherboard circuits', 800.00, 1800.00, 10, 2, 'Active'),
        ('PRT-0010', 'IC-PWR-TPS512', 'TPS51225 Dual Step-Down DC-DC Power IC', 'Motherboard IC', 'Dell / HP 3V/5V Standby Power Section', 350.00, 1000.00, 15, 3, 'Active'),
        ('PRT-0011', 'TH-PASTE-MX4', 'Arctic MX-4 Thermal Compound 4g Syringe', 'Thermal Paste', 'All Laptops, Desktops & GPU Heatsinks', 950.00, 1500.00, 25, 5, 'Active'),
        ('PRT-0012', 'RAM-DDR4-8GB', 'Kingston 8GB DDR4 3200MHz SODIMM Laptop RAM', 'RAM / Memory', 'DDR4 Supported Laptops & All-in-Ones', 3800.00, 4800.00, 14, 3, 'Active'),
        ('PRT-0013', 'SSD-NVME-256', 'Lexar NM620 256GB M.2 NVMe PCIe SSD', 'Storage / SSD', 'All Laptops & Desktops with NVMe M.2 Slot', 4200.00, 5500.00, 12, 3, 'Active')
      ON CONFLICT (id) DO NOTHING;

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

