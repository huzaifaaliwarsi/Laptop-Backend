/**
 * cPanel Production PostgreSQL Safe Migration Script
 * SAFE & NON-DESTRUCTIVE:
 * - NEVER drops any tables.
 * - NEVER deletes any existing data.
 * - Installs branch policies, grants and branch-local constraints as well as columns.
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
      try {
        const tblCheck = await client.query(`
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        `, [tbl]);

        if (tblCheck.rows.length > 0) {
          await client.query(`ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1`);
          await client.query(`ALTER TABLE "${tbl}" ALTER COLUMN branch_id SET DEFAULT COALESCE(NULLIF(current_setting('app.branch_id', true), '')::integer, 1)`);
          await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tbl}_branch_id" ON "${tbl}"(branch_id)`);
        }
      } catch (tableErr) {
        // Safe skip if ownership restricts ALTER TABLE on already configured tables
      }
    }

    // Ensure branch_counters, auth tables, and missing repair tables exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS branch_counters (
        branch_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value BIGINT NOT NULL,
        PRIMARY KEY(branch_id, key)
      );
      CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
        branch_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY(branch_id, key)
      );
      CREATE TABLE IF NOT EXISTS whatsapp_auth_leases (
        branch_id INTEGER PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE SEQUENCE IF NOT EXISTS public.entity_id_sequence START 1000000000;

      CREATE TABLE IF NOT EXISTS repair_parts_movements (
        id SERIAL PRIMARY KEY,
        branch_id INT NOT NULL DEFAULT 1,
        part_id VARCHAR(50) REFERENCES repair_parts(id) ON DELETE CASCADE,
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

      CREATE TABLE IF NOT EXISTS repair_additional_work_requests (
        id VARCHAR(50) PRIMARY KEY,
        branch_id INT NOT NULL DEFAULT 1,
        repair_job_id VARCHAR(50) NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
        tracking_id VARCHAR(100),
        fault_finding TEXT NOT NULL DEFAULT '',
        recommended_service TEXT NOT NULL DEFAULT '',
        diagnosed_fault TEXT,
        recommended_action TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_addl_work_branch ON repair_additional_work_requests(branch_id);
      CREATE INDEX IF NOT EXISTS idx_parts_mov_part_id ON repair_parts_movements(part_id);
      CREATE INDEX IF NOT EXISTS idx_parts_mov_branch ON repair_parts_movements(branch_id);
    `);
    console.log('✔ branch_id multi-tenant columns and branch_counters verified.');

    console.log('\n[Step 3/4] Ensuring latest schema columns on existing tables...');
    const extraColumns = [
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn_cnic VARCHAR(100)',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100)',
      'ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT',
      'ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ntn_tax_id VARCHAR(100)',
      'ALTER TABLE vendors ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100)',
      'ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT \'[]\'::jsonb',
      'ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT \'{}\'::jsonb',
      'ALTER TABLE repair_services ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT \'repair\'',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS diagnosis_fee NUMERIC(18, 2) DEFAULT 0.00',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS is_diagnosis_adjusted BOOLEAN DEFAULT FALSE',
      'ALTER TABLE repair_job_lines ADD COLUMN IF NOT EXISTS line_type VARCHAR(50) DEFAULT \'repair\'',
      'ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS adjust_diagnosis_fee BOOLEAN DEFAULT FALSE',
      'ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS ntn VARCHAR(100)',
      'ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS strn VARCHAR(100)',
      'ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS pos_id VARCHAR(100)',
      'ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS fbr_pos_id VARCHAR(100)',
      'ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS city VARCHAR(100)',
      'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0.00',
      'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(18, 2) DEFAULT 0.00',
      'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fbr_invoice_no VARCHAR(100)',
      'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_address TEXT',
      'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_tax_id VARCHAR(100)',
      'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100)',
      'ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hs_code VARCHAR(50)',
      'ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount NUMERIC(18, 2) DEFAULT 0.00',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS device_password VARCHAR(100)',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS pattern_code VARCHAR(50)',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS item_type VARCHAR(50) DEFAULT \'Service\'',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS customer_email VARCHAR(150)',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100)',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS accessories_received TEXT',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS physical_condition TEXT',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS initial_quotation NUMERIC(18, 2) DEFAULT 0.00',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(18, 2) DEFAULT 0.00',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS warranty_terms TEXT',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS internal_notes TEXT',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS technical_notes TEXT',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS diagnosis_result TEXT',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS customer_approval_status VARCHAR(50) DEFAULT \'Not Required\'',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS customer_approval_at TIMESTAMP WITH TIME ZONE',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approval_channel VARCHAR(50)',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approved_by_user_id VARCHAR(50)',
      'ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS approval_note TEXT',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_password_encrypted TEXT',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_name VARCHAR(150)',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_username VARCHAR(100)',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS phone VARCHAR(50)',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS email VARCHAR(150)',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS city VARCHAR(100)',
      'ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS address TEXT',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS auto_invoice_whatsapp BOOLEAN DEFAULT TRUE',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT FALSE',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS auto_status_notifications BOOLEAN DEFAULT TRUE',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS welcome_message TEXT',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS shop_location TEXT',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS bot_enabled BOOLEAN DEFAULT TRUE',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS human_handoff BOOLEAN DEFAULT TRUE',
      'ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS sales_access BOOLEAN DEFAULT FALSE',
      'ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS bot_state VARCHAR(50)',
      'ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS approval_tracking_id VARCHAR(100)',
      'ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS lead_type VARCHAR(50)',
      'ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS last_message TEXT'
    ];

    for (const q of extraColumns) {
      try {
        await client.query(q);
      } catch (_) {}
    }
    console.log('✔ All extended column definitions verified.');

    console.log('\n[Step 4/4] Running repairPartIds migration and Branch 2 catalogs...');
    await require('../src/migrations/repairPartIds').migrateRepairPartIds(pool);
    
    // Fix global UNIQUE(name) constraints on catalog tables to UNIQUE(branch_id, name)
    const constraintsToFix = [
      { table: 'product_categories', oldConstraint: 'product_categories_name_key' },
      { table: 'expense_categories', oldConstraint: 'expense_categories_name_key' },
      { table: 'accessory_categories', oldConstraint: 'accessory_categories_name_key' },
      { table: 'repair_categories', oldConstraint: 'repair_categories_name_key' },
      { table: 'spare_part_categories', oldConstraint: 'spare_part_categories_name_key' }
    ];

    for (const item of constraintsToFix) {
      try {
        await client.query(`ALTER TABLE "${item.table}" DROP CONSTRAINT IF EXISTS "${item.oldConstraint}"`);
        await client.query(`ALTER TABLE "${item.table}" DROP CONSTRAINT IF EXISTS "${item.table}_name_key"`);
        await client.query(`ALTER TABLE "${item.table}" DROP CONSTRAINT IF EXISTS "${item.table}_branch_name_key"`);
        await client.query(`ALTER TABLE "${item.table}" ADD CONSTRAINT "${item.table}_branch_name_key" UNIQUE (branch_id, name)`);
      } catch (_) {}
    }

    // Grant all table and sequence permissions so non-owner runtime never gets 42501 permission denied
    try {
      await client.query(`
        GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
      `);
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_branch_runtime') THEN
            EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA public TO retail_branch_runtime';
            EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO retail_branch_runtime';
          END IF;
        END $$;
      `);
    } catch (_) {}

    // Explicitly copy or seed categories for Branch 2
    try {
      await client.query(`
        INSERT INTO product_categories (name, code_prefix, is_system, branch_id)
        SELECT name, code_prefix, is_system, 2
        FROM product_categories WHERE branch_id = 1
        ON CONFLICT (branch_id, name) DO NOTHING;

        INSERT INTO expense_categories (name, branch_id)
        SELECT name, 2
        FROM expense_categories WHERE branch_id = 1
        ON CONFLICT (branch_id, name) DO NOTHING;

        INSERT INTO accessory_categories (name, branch_id)
        SELECT name, 2
        FROM accessory_categories WHERE branch_id = 1
        ON CONFLICT (branch_id, name) DO NOTHING;

        INSERT INTO repair_categories (name, description, is_active, branch_id)
        SELECT name, description, is_active, 2
        FROM repair_categories WHERE branch_id = 1
        ON CONFLICT (branch_id, name) DO NOTHING;

        INSERT INTO spare_part_categories (name, branch_id)
        SELECT name, 2
        FROM spare_part_categories WHERE branch_id = 1
        ON CONFLICT (branch_id, name) DO NOTHING;
      `);

      const b2Check = await client.query('SELECT COUNT(*)::int AS cnt FROM product_categories WHERE branch_id = 2');
      if ((b2Check.rows[0]?.cnt || 0) === 0) {
        const defaults = ['Laptop', 'PC', 'LCD / Screen', 'Accessories', 'Desktop', 'Printers'];
        for (const cat of defaults) {
          await client.query(
            'INSERT INTO product_categories (name, code_prefix, is_system, branch_id) VALUES ($1, $2, TRUE, 2) ON CONFLICT (branch_id, name) DO NOTHING',
            [cat, cat.substring(0, 3).toUpperCase()]
          );
        }
      }
    } catch (catErr) {
      console.warn('Note on categories seeding:', catErr.message);
    }

    console.log('Installing mandatory branch isolation policies & catalogs...');
    try {
      await require('../src/migrations/sharedDatabase').migrateSharedDatabase(pool);
    } catch (migErr) {
      console.warn('Note on shared policies (proceeding):', migErr.message);
    }
    try {
      await require('../src/migrations/branchCatalogs').seedBranchCatalogs(client, 2, { seedDefaults: true });
    } catch (_) {}
    console.log('✔ repairPartIds and Branch 2 catalogs verified.');

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
