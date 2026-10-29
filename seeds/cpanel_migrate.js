/**
 * cPanel Production PostgreSQL Safe Migration Script
 * SAFE & NON-DESTRUCTIVE:
 * - NEVER drops any tables.
 * - NEVER deletes any existing data.
 * - Only uses "CREATE TABLE IF NOT EXISTS" and "ADD COLUMN IF NOT EXISTS".
 * 
 * Run in cPanel Terminal: node seeds/cpanel_migrate.js
 */
const fs = require('fs');
const path = require('path');

// 1. Load cPanel environment variables
const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.cpanel'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '.env.cpanel'),
  '/home/isywouhn/api.saadcomm.isywarecloud.com/.env',
  '/home/isywouhn/api.saadcomm.isywarecloud.com/.env.cpanel'
];
for (const p of envCandidates) {
  try {
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p });
    }
  } catch (_) {}
}
require('dotenv').config();

const branchManager = require('../src/config/branchManager');

async function runSafeMigration() {
  console.log('====================================================');
  console.log('  STARTING CPANEL POSTGRESQL SAFE MIGRATION');
  console.log('====================================================');
  console.log(`Connecting to: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'isywouhn_saadcomm'}`);

  const pool = branchManager.masterPool;
  const client = await pool.connect();

  try {
    console.log('\n[Step 1/4] Ensuring Master DB registry & Super Admin...');
    await branchManager.initMasterDb();
    console.log('✔ master_branches, master_super_admins, master_staff_identities ready.');

    console.log('\n[Step 2/4] Ensuring multi-tenant branch_id column on all operational tables...');
    const tablesToScope = [
      'users', 'customers', 'vendors', 'products', 'product_categories',
      'accessory_categories', 'expense_categories', 'expenses', 'invoices',
      'invoice_items', 'held_bills', 'accounts', 'payments', 'vendor_returns',
      'repair_categories', 'repair_services', 'repair_jobs', 'repair_job_lines',
      'repair_status_history', 'spare_part_categories', 'repair_parts',
      'repair_parts_used', 'repair_parts_movements', 'repair_additional_work_requests',
      'business_settings', 'whatsapp_settings', 'whatsapp_conversations',
      'whatsapp_messages', 'inventory_movements', 'audit_logs'
    ];

    for (const tbl of tablesToScope) {
      // Check if table exists before adding column
      const tblCheck = await client.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      `, [tbl]);

      if (tblCheck.rows.length > 0) {
        await client.query(`ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tbl}_branch_id" ON "${tbl}"(branch_id)`);
      }
    }
    console.log('✔ branch_id multi-tenant columns verified.');

    console.log('\n[Step 3/4] Ensuring latest schema columns on existing tables...');
    await client.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn_cnic VARCHAR(100);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ntn_tax_id VARCHAR(100);
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE repair_services ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT 'repair';
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS diagnosis_fee NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS is_diagnosis_adjusted BOOLEAN DEFAULT FALSE;
      ALTER TABLE repair_job_lines ADD COLUMN IF NOT EXISTS line_type VARCHAR(50) DEFAULT 'repair';
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS adjust_diagnosis_fee BOOLEAN DEFAULT FALSE;
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS ntn VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS strn VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS pos_id VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS fbr_pos_id VARCHAR(100);
      ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fbr_invoice_no VARCHAR(100);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_address TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_tax_id VARCHAR(100);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hs_code VARCHAR(50);
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount NUMERIC(18, 2) DEFAULT 0.00;
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS device_password VARCHAR(100);
      ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS pattern_code VARCHAR(50);
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
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_password_encrypted TEXT;
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_name VARCHAR(150);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_username VARCHAR(100);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS email VARCHAR(150);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS address TEXT;
    `);
    console.log('✔ All extended column definitions verified.');

    console.log('\n[Step 4/4] Running repairPartIds migration...');
    await require('../src/migrations/repairPartIds').migrateRepairPartIds(pool);
    console.log('✔ repairPartIds verified.');

    console.log('\n====================================================');
    console.log('  SAFE MIGRATION COMPLETE! ZERO DATA LOSS.');
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ Migration Error:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runSafeMigration();
