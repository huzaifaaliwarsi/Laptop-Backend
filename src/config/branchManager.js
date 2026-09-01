const { Pool, Client } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ENCRYPTION_KEY = (process.env.BRANCH_SECRET_KEY || process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026')
  .padEnd(32, '0')
  .slice(0, 32);
const IV_LENGTH = 16;
const BRANCH_PROVISIONING_LOCK_ID = 884422001; // PostgreSQL Transaction Advisory Lock ID
const CURRENT_SCHEMA_VERSION = '2.1.0';

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(String(text));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return null;
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    console.error('[BranchManager] Decryption error:', e.message);
    return null;
  }
}

// Master Database Pool Configuration
const masterPoolConfig = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL
  ? {
      connectionString: process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'retail_repair_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'admin123',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

const masterPool = new Pool(masterPoolConfig);

masterPool.on('error', (err) => {
  console.error('[Master DB Pool] Unexpected error on idle client:', err);
});

// Dynamic Branch Connection Pools Cache (branchId -> Pool)
const branchPools = new Map();

/**
 * Initialize Master DB tables, Super Admin, and auto-register Branch 1
 */
async function initMasterDb() {
  try {
    // 1. Create master tables
    await masterPool.query(`
      CREATE TABLE IF NOT EXISTS master_branches (
        id SERIAL PRIMARY KEY,
        branch_code VARCHAR(20) UNIQUE NOT NULL,
        branch_name VARCHAR(150) NOT NULL,
        db_name VARCHAR(150) NOT NULL,
        db_host VARCHAR(255) NOT NULL,
        db_port INT NOT NULL DEFAULT 5432,
        db_user VARCHAR(150) NOT NULL,
        db_password_encrypted TEXT,
        db_connection_url_encrypted TEXT,
        db_ssl BOOLEAN DEFAULT TRUE,
        schema_version VARCHAR(50) DEFAULT '${CURRENT_SCHEMA_VERSION}',
        status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Provisioning', 'Maintenance', 'Deleted')),
        phone VARCHAR(50),
        email VARCHAR(150),
        city VARCHAR(100),
        address TEXT,
        admin_name VARCHAR(150),
        admin_username VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS master_super_admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150),
        status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS master_audit_logs (
        id SERIAL PRIMARY KEY,
        branch_id INT,
        action VARCHAR(100) NOT NULL,
        details JSONB,
        performed_by VARCHAR(150),
        ip_address VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Global Staff Identity Registry (enforces cross-branch uniqueness of username & phone)
      CREATE TABLE IF NOT EXISTS master_staff_identities (
        id SERIAL PRIMARY KEY,
        branch_id INT NOT NULL,
        branch_user_id VARCHAR(100),
        normalized_username VARCHAR(100) NOT NULL,
        normalized_phone VARCHAR(50),
        role VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'Active',
        reservation_token VARCHAR(100),
        reservation_status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_master_staff_username UNIQUE (normalized_username)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_master_staff_phone 
      ON master_staff_identities (normalized_phone) 
      WHERE normalized_phone IS NOT NULL AND normalized_phone != '';

      CREATE INDEX IF NOT EXISTS idx_master_staff_branch_user 
      ON master_staff_identities (branch_id, branch_user_id);

      -- Ensure columns exist if table was created previously
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS schema_version VARCHAR(50) DEFAULT '${CURRENT_SCHEMA_VERSION}';
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS email VARCHAR(150);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_name VARCHAR(150);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_username VARCHAR(100);
    `);

    // 2. Initialize Super Admin if none exists (from ENV or secure initialization)
    const saCheck = await masterPool.query(`SELECT id FROM master_super_admins LIMIT 1`);
    if (saCheck.rows.length === 0) {
      const saUser = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
      const saPass = process.env.SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_INITIAL_PASSWORD || 'SuperAdmin@Secure2026!';
      const saName = process.env.SUPER_ADMIN_NAME || 'Super Admin';
      const saEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@system.local';
      
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(saPass, salt);

      await masterPool.query(`
        INSERT INTO master_super_admins (username, password_hash, name, email, status)
        VALUES ($1, $2, $3, $4, 'Active')
        ON CONFLICT (username) DO NOTHING
      `, [saUser.toLowerCase().trim(), hash, saName, saEmail]);

      console.log(`[BranchManager] Initialized Super Admin account (${saUser}) in Master DB`);
    }

    // 3. Register existing operational database as Branch 1
    const branchCheck = await masterPool.query(`SELECT id, branch_code FROM master_branches WHERE branch_code = 'BR-01' OR id = 1 LIMIT 1`);
    if (branchCheck.rows.length === 0) {
      let b1Host = process.env.DB_HOST || '127.0.0.1';
      let b1Port = parseInt(process.env.DB_PORT || '5432', 10);
      let b1Name = process.env.DB_NAME || 'retail_repair_db';
      let b1User = process.env.DB_USER || 'postgres';
      let b1Pass = process.env.DB_PASSWORD || 'admin123';
      let b1UrlEnc = null;

      if (process.env.DATABASE_URL) {
        b1UrlEnc = encrypt(process.env.DATABASE_URL);
        try {
          const parsed = new URL(process.env.DATABASE_URL);
          b1Host = parsed.hostname || b1Host;
          b1Port = parseInt(parsed.port || '5432', 10);
          b1Name = parsed.pathname.replace(/^\//, '') || b1Name;
          b1User = parsed.username || b1User;
          b1Pass = parsed.password || b1Pass;
        } catch (e) {}
      }

      await masterPool.query(`
        INSERT INTO master_branches (
          id, branch_code, branch_name, db_name, db_host, db_port, db_user,
          db_password_encrypted, db_connection_url_encrypted, db_ssl, schema_version, status,
          phone, email, city, address, admin_name, admin_username
        ) VALUES (
          1, 'BR-01', 'Main Branch (Branch 1)', $1, $2, $3, $4, $5, $6, $7, '${CURRENT_SCHEMA_VERSION}', 'Active',
          '0300-1234567', 'main@branch.pk', 'Lahore', 'Main Workshop & Retail Showroom', 'Store Manager', 'admin'
        ) ON CONFLICT (branch_code) DO NOTHING
      `, [
        b1Name,
        b1Host,
        b1Port,
        b1User,
        encrypt(b1Pass),
        b1UrlEnc,
        process.env.DB_SSL === 'false' ? false : true
      ]);

      console.log('[BranchManager] Registered existing database as Branch 1 (BR-01)');
    }
  } catch (err) {
    console.error('[BranchManager] Master DB initialization error:', err);
  }
}

/**
 * Get or create connection pool for a branch
 */
async function getBranchPool(branchId, allowInactive = false) {
  const bId = parseInt(branchId, 10);

  if (branchPools.has(bId)) {
    return branchPools.get(bId);
  }

  const res = await masterPool.query(`SELECT * FROM master_branches WHERE id = $1 LIMIT 1`, [bId]);
  
  if (res.rows.length === 0) {
    if (bId === 1) {
      const fallbackPool = new Pool(masterPoolConfig);
      branchPools.set(1, fallbackPool);
      return fallbackPool;
    }
    throw new Error(`Branch with ID ${bId} not found in master registry.`);
  }

  const branch = res.rows[0];

  if (branch.status === 'Inactive' && !allowInactive) {
    throw new Error(`Branch ${branch.branch_name} (${branch.branch_code}) is currently inactive.`);
  }

  let poolConfig;

  if (branch.db_connection_url_encrypted) {
    const connStr = decrypt(branch.db_connection_url_encrypted);
    if (connStr) {
      poolConfig = {
        connectionString: connStr,
        ssl: branch.db_ssl ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };
    }
  }

  if (!poolConfig) {
    const rawPass = decrypt(branch.db_password_encrypted) || '';
    poolConfig = {
      host: branch.db_host,
      port: branch.db_port || 5432,
      database: branch.db_name,
      user: branch.db_user,
      password: rawPass,
      ssl: branch.db_ssl ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  const newPool = new Pool(poolConfig);

  newPool.on('error', (err) => {
    console.error(`[Branch ${branch.branch_code} Pool] Unexpected client error:`, err);
  });

  branchPools.set(bId, newPool);
  return newPool;
}

/**
 * Execute the full application schema & migrations pipeline on a branch database
 */
async function executeFullMigrationPipeline(client, branchSettings = {}) {
  const schemaPath = path.join(__dirname, '..', '..', 'seeds', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error('Base schema file not found at ' + schemaPath);
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await client.query(schemaSql);

  // Apply all column migrations & tables identical to Branch 1
  await client.query(`
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

    CREATE TABLE IF NOT EXISTS repair_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO repair_categories (name, description, is_active)
    VALUES 
      ('Laptop', 'Laptop notebooks, ultrabooks and MacBooks', TRUE),
      ('Mobile', 'Smartphones, iPhones and tablets', TRUE),
      ('Desktop', 'Custom PC towers, desktop workstations and gaming rigs', TRUE),
      ('Printer', 'Laser, inkjet, barcode and thermal printers', TRUE),
      ('Accessories', 'Chargers, power supplies, keyboards and peripherals', TRUE)
    ON CONFLICT (name) DO NOTHING;

    ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS category_id INT REFERENCES repair_categories(id) ON DELETE SET NULL;
    ALTER TABLE repair_jobs ADD COLUMN IF NOT EXISTS category_name VARCHAR(100);
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

    CREATE TABLE IF NOT EXISTS spare_part_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS repair_parts_movements (
      id SERIAL PRIMARY KEY,
      part_id VARCHAR(50) NOT NULL REFERENCES repair_parts(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      quantity INT NOT NULL,
      reference_type VARCHAR(50),
      reference_id VARCHAR(100),
      notes TEXT,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

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

    -- Ensure branch users table role check constraint
    UPDATE users SET role = 'admin' WHERE role = 'super_admin' OR role = 'Super Admin';
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'sales', 'technician'));
  `);

  // Initialize Branch 2 Business Settings & Starting Balances
  const openCash = parseFloat(branchSettings.openingCash || 0);
  const openOnline = parseFloat(branchSettings.openingOnline || 0);

  await client.query(`
    INSERT INTO business_settings (
      id, company_name, tagline, phone, address, 
      opening_cash, opening_online
    ) VALUES (
      1, $1, $2, $3, $4, $5, $6
    ) ON CONFLICT (id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      phone = EXCLUDED.phone,
      address = EXCLUDED.address,
      opening_cash = EXCLUDED.opening_cash,
      opening_online = EXCLUDED.opening_online
  `, [
    branchSettings.branchName || 'Branch 2',
    'POS, Inventory & Repair Workshop',
    branchSettings.phone || '',
    branchSettings.address || '',
    openCash,
    openOnline
  ]);
}

/**
 * AUTOMATED PROVISIONING ENGINE FOR BRANCH 2
 * Strictly concurrency-safe using PostgreSQL Transaction Advisory Lock.
 * Derives database connection from backend provisioning layer (no client DB credentials).
 */
async function provisionBranch2Database(payload, performedBy = 'superadmin') {
  const masterClient = await masterPool.connect();
  let createdDbName = null;
  let targetPool = null;

  try {
    await masterClient.query('BEGIN');

    // 1. CONCURRENCY ADVISORY LOCK: Strictly locks branch provisioning across all sessions
    await masterClient.query('SELECT pg_advisory_xact_lock($1)', [BRANCH_PROVISIONING_LOCK_ID]);

    // 2. HARD RULE CHECK: Count total registered branches
    const countRes = await masterClient.query(
      `SELECT COUNT(*) AS total FROM master_branches WHERE status != 'Deleted'`
    );
    const totalBranches = parseInt(countRes.rows[0]?.total || 0, 10);

    if (totalBranches >= 2) {
      const err = new Error('Maximum branch limit reached. Only 2 branches are allowed.');
      err.statusCode = 400;
      err.code = 'MAX_BRANCHES_REACHED';
      throw err;
    }

    const branchCode = payload.branchCode ? String(payload.branchCode).trim().toUpperCase() : 'BR-02';
    
    // Check branch_code uniqueness
    const codeCheck = await masterClient.query(`SELECT id FROM master_branches WHERE branch_code = $1`, [branchCode]);
    if (codeCheck.rows.length > 0) {
      const err = new Error(`Branch code "${branchCode}" already exists.`);
      err.statusCode = 400;
      throw err;
    }

    // 3. Derive DB configuration from Backend Provisioning Environment (no raw DB inputs required from UI)
    let host = process.env.BRANCH_2_DB_HOST || process.env.DB_HOST || '127.0.0.1';
    let port = parseInt(process.env.BRANCH_2_DB_PORT || process.env.DB_PORT || '5432', 10);
    let user = process.env.BRANCH_2_DB_USER || process.env.DB_USER || 'postgres';
    let password = process.env.BRANCH_2_DB_PASSWORD || process.env.DB_PASSWORD || 'admin123';
    let dbSsl = process.env.DB_SSL === 'false' ? false : true;
    let targetDbName = process.env.BRANCH_2_DB_NAME || 'retail_repair_branch_02';
    let connectionUrl = process.env.BRANCH_2_DATABASE_URL || null;

    if (process.env.DATABASE_URL && !process.env.BRANCH_2_DATABASE_URL) {
      try {
        const parsed = new URL(process.env.DATABASE_URL);
        host = parsed.hostname || host;
        port = parseInt(parsed.port || '5432', 10);
        user = parsed.username || user;
        password = parsed.password || password;
        targetDbName = process.env.BRANCH_2_DB_NAME || 'retail_repair_branch_02';
        connectionUrl = process.env.DATABASE_URL.replace(/\/neondb(\?|$)/, `/${targetDbName}$1`);
      } catch (e) {}
    }

    // 4. Create database on PostgreSQL server if local/dedicated administrative connection allows
    if (!connectionUrl) {
      try {
        const adminClient = new Client({
          host,
          port,
          user,
          password,
          database: 'postgres',
          ssl: dbSsl ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 5000
        });

        await adminClient.connect();
        const checkDb = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [targetDbName]);
        if (checkDb.rows.length === 0) {
          await adminClient.query(`CREATE DATABASE "${targetDbName}"`);
          createdDbName = targetDbName;
          console.log(`[Provisioning Engine] Created new database: ${targetDbName}`);
        }
        await adminClient.end();
      } catch (dbCreateErr) {
        console.warn(`[Provisioning Engine] Direct CREATE DATABASE check notice:`, dbCreateErr.message);
        // If connecting to a managed pooler like Neon where DB is already provisioned or using designated connection string
      }
    }

    // 5. Connect to the new Branch 2 database
    const branchPoolConfig = connectionUrl
      ? {
          connectionString: connectionUrl,
          ssl: dbSsl ? { rejectUnauthorized: false } : false,
          max: 10,
          connectionTimeoutMillis: 10000
        }
      : {
          host,
          port,
          database: targetDbName,
          user,
          password,
          ssl: dbSsl ? { rejectUnauthorized: false } : false,
          max: 10,
          connectionTimeoutMillis: 10000
        };

    targetPool = new Pool(branchPoolConfig);
    const branchClient = await targetPool.connect();

    try {
      // 6. Execute full schema and migrations pipeline
      console.log(`[Provisioning Engine] Running schema and migrations pipeline on Branch 2...`);
      await executeFullMigrationPipeline(branchClient, {
        branchName: payload.branchName,
        phone: payload.phone,
        address: payload.address,
        openingCash: payload.openingCash,
        openingOnline: payload.openingOnline
      });

      // 7. Validate and Register Branch 2 Admin in Master Identity Registry
      const { normalizeUsername, normalizePhone } = require('../utils/phoneHelper');
      const adminUsername = normalizeUsername(payload.adminUsername || 'admin2');
      const adminContact = normalizePhone(payload.adminContact || payload.phone || null);
      const adminPassword = payload.adminPassword || 'Admin@Branch2';
      const adminName = payload.adminName || 'Branch 2 Manager';

      // Check username global uniqueness
      const uCheck = await masterClient.query(
        'SELECT id FROM master_staff_identities WHERE normalized_username = $1',
        [adminUsername]
      );
      if (uCheck.rows.length > 0) {
        const err = new Error('Username already exists in another branch. Please choose a different username.');
        err.statusCode = 409;
        err.code = 'USERNAME_ALREADY_EXISTS';
        throw err;
      }

      // Check phone global uniqueness if phone provided
      if (adminContact) {
        const pCheck = await masterClient.query(
          'SELECT id FROM master_staff_identities WHERE normalized_phone = $1',
          [adminContact]
        );
        if (pCheck.rows.length > 0) {
          const err = new Error('Phone number is already registered in another branch.');
          err.statusCode = 409;
          err.code = 'PHONE_ALREADY_EXISTS';
          throw err;
        }
      }

      // Reserve in master_staff_identities
      await masterClient.query(
        `INSERT INTO master_staff_identities (
          branch_id, branch_user_id, normalized_username, normalized_phone,
          role, status, reservation_status, created_at, updated_at
        ) VALUES (
          2, 'USR-ADMIN-BR02', $1, $2,
          'admin', 'Active', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) ON CONFLICT (normalized_username) DO UPDATE SET
          branch_id = 2,
          branch_user_id = 'USR-ADMIN-BR02',
          normalized_phone = EXCLUDED.normalized_phone,
          status = 'Active'`,
        [adminUsername, adminContact]
      );

      // Create in Branch 2 physical database
      const salt = await bcrypt.genSalt(10);
      const adminPassHash = await bcrypt.hash(adminPassword, salt);

      await branchClient.query(`
        INSERT INTO users (id, name, contact, designation, role, username, password_hash, status)
        VALUES ('USR-ADMIN-BR02', $1, $2, 'Branch Manager', 'admin', $3, $4, 'Active')
        ON CONFLICT (username) DO UPDATE SET
          name = EXCLUDED.name,
          password_hash = EXCLUDED.password_hash,
          status = 'Active'
      `, [adminName, adminContact, adminUsername, adminPassHash]);

      console.log(`[Provisioning Engine] Created Branch 2 Admin account (${adminUsername}) in Branch 2 database and Master Registry.`);
    } finally {
      branchClient.release();
    }

    // 8. Register Branch 2 in Master DB registry
    const encryptedPass = encrypt(password);
    const encryptedUrl = connectionUrl ? encrypt(connectionUrl) : null;

    const insertRes = await masterClient.query(`
      INSERT INTO master_branches (
        id, branch_code, branch_name, db_name, db_host, db_port, db_user,
        db_password_encrypted, db_connection_url_encrypted, db_ssl, schema_version, status,
        phone, email, city, address, admin_name, admin_username
      ) VALUES (
        2, $1, $2, $3, $4, $5, $6, $7, $8, $9, '${CURRENT_SCHEMA_VERSION}', 'Active',
        $10, $11, $12, $13, $14, $15
      ) RETURNING id, branch_code, branch_name, db_name, db_host, db_port, db_user, db_ssl, schema_version, status, phone, email, city, address, admin_name, admin_username, created_at
    `, [
      branchCode,
      payload.branchName || 'Branch 2',
      targetDbName,
      host,
      port,
      user,
      encryptedPass,
      encryptedUrl,
      dbSsl,
      payload.phone || '',
      payload.email || '',
      payload.city || 'Karachi',
      payload.address || '',
      payload.adminName || 'Branch 2 Manager',
      payload.adminUsername || 'admin2'
    ]);

    // 9. Log to Master Audit Log
    await masterClient.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (2, 'BRANCH_PROVISIONED', $1, $2)
    `, [
      JSON.stringify({
        branch_name: payload.branchName,
        branch_code: branchCode,
        admin_username: payload.adminUsername || 'admin2',
        db_name: targetDbName,
        schema_version: CURRENT_SCHEMA_VERSION
      }),
      performedBy
    ]);

    await masterClient.query('COMMIT');
    console.log(`[Provisioning Engine] Branch 2 successfully provisioned and activated in Master DB!`);

    return insertRes.rows[0];
  } catch (err) {
    await masterClient.query('ROLLBACK');
    if (targetPool) {
      try { await targetPool.end(); } catch (e) {}
    }
    console.error('[Provisioning Engine] Provisioning failed, rolled back Master DB:', err.message);
    throw err;
  } finally {
    masterClient.release();
  }
}

/**
 * List all registered branches (Safely masks passwords)
 */
async function listBranches() {
  const res = await masterPool.query(`
    SELECT 
      id, 
      branch_code, 
      branch_name, 
      db_name, 
      db_host, 
      db_port, 
      db_user, 
      db_ssl, 
      schema_version,
      status, 
      phone, 
      email,
      city,
      address, 
      admin_name,
      admin_username,
      created_at, 
      updated_at 
    FROM master_branches 
    WHERE status != 'Deleted'
    ORDER BY id ASC
  `);
  return res.rows;
}

/**
 * Get Branch by ID
 */
async function getBranchById(branchId) {
  const res = await masterPool.query(`
    SELECT 
      id, 
      branch_code, 
      branch_name, 
      db_name, 
      db_host, 
      db_port, 
      db_user, 
      db_ssl, 
      schema_version,
      status, 
      phone, 
      email,
      city,
      address, 
      admin_name,
      admin_username,
      created_at, 
      updated_at 
    FROM master_branches 
    WHERE id = $1 AND status != 'Deleted' LIMIT 1
  `, [parseInt(branchId, 10)]);
  return res.rows[0] || null;
}

/**
 * Update Branch info / status
 */
async function updateBranch(branchId, updates) {
  const bId = parseInt(branchId, 10);
  const { branch_name, phone, email, city, address, status, admin_name } = updates;
  
  const res = await masterPool.query(`
    UPDATE master_branches 
    SET 
      branch_name = COALESCE($1, branch_name),
      phone = COALESCE($2, phone),
      email = COALESCE($3, email),
      city = COALESCE($4, city),
      address = COALESCE($5, address),
      status = COALESCE($6, status),
      admin_name = COALESCE($7, admin_name),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $8
    RETURNING id, branch_code, branch_name, db_name, db_host, db_port, db_user, db_ssl, schema_version, status, phone, email, city, address, admin_name, admin_username, updated_at
  `, [branch_name, phone, email, city, address, status, admin_name, bId]);

  if (status === 'Inactive' && branchPools.has(bId)) {
    const oldPool = branchPools.get(bId);
    branchPools.delete(bId);
    try { await oldPool.end(); } catch (e) {}
  }

  return res.rows[0] || null;
}

module.exports = {
  masterPool,
  initMasterDb,
  getBranchPool,
  executeFullMigrationPipeline,
  provisionBranch2Database,
  listBranches,
  getBranchById,
  updateBranch,
  encrypt,
  decrypt,
  CURRENT_SCHEMA_VERSION
};
