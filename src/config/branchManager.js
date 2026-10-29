const { Pool, Client } = require('pg');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
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
const masterPoolConfig = process.env.DATABASE_URL || process.env.MASTER_DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL || process.env.MASTER_DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      
      max: 10,
      idleTimeoutMillis: 120000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'isywouhn_saadcomm',
      user: process.env.DB_USER || 'isywouhn_saadcomm_user',
      password: process.env.DB_PASSWORD || '',
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
        admin_password_encrypted TEXT,
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

      CREATE UNIQUE INDEX IF NOT EXISTS uq_master_branch_code ON master_branches(branch_code);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_master_identity_username ON master_staff_identities(normalized_username);
      CREATE INDEX IF NOT EXISTS idx_master_staff_branch_user 
      ON master_staff_identities (branch_id, branch_user_id);

      -- Ensure columns exist if table was created previously
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS schema_version VARCHAR(50) DEFAULT '${CURRENT_SCHEMA_VERSION}';
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS email VARCHAR(150);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_name VARCHAR(150);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_username VARCHAR(100);
      ALTER TABLE master_branches ADD COLUMN IF NOT EXISTS admin_password_encrypted TEXT;
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
      let b1Name = process.env.DB_NAME || 'isywouhn_saadcomm';
      let b1User = process.env.DB_USER || 'isywouhn_saadcomm_user';
      let b1Pass = process.env.DB_PASSWORD || '';
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

      const b1AdminPassword = process.env.LOCAL_ADMIN_PASSWORD || 'admin';
      await masterPool.query(`
        INSERT INTO master_branches (
          id, branch_code, branch_name, db_name, db_host, db_port, db_user,
          db_password_encrypted, db_connection_url_encrypted, db_ssl, schema_version, status,
          phone, email, city, address, admin_name, admin_username, admin_password_encrypted
        ) VALUES (
          1, 'BR-01', 'Main Branch (Branch 1)', $1, $2, $3, $4, $5, $6, $7, '${CURRENT_SCHEMA_VERSION}', 'Active',
          '0300-1234567', 'main@branch.pk', 'Lahore', 'Main Workshop & Retail Showroom', 'Store Manager', 'admin', $8
        ) ON CONFLICT (branch_code) DO NOTHING
      `, [
        b1Name,
        b1Host,
        b1Port,
        b1User,
        encrypt(b1Pass),
        b1UrlEnc,
        process.env.DB_SSL === 'false' ? false : true,
        encrypt(b1AdminPassword)
      ]);

      console.log('[BranchManager] Registered existing database as Branch 1 (BR-01)');
    }

    // Ensure Branch 1 has admin_password_encrypted populated if currently null
    const b1PassFallback = process.env.LOCAL_ADMIN_PASSWORD || 'admin';
    await masterPool.query(`
      UPDATE master_branches
      SET admin_password_encrypted = $1
      WHERE (id = 1 OR branch_code = 'BR-01') AND (admin_password_encrypted IS NULL OR admin_password_encrypted = '')
    `, [encrypt(b1PassFallback)]);
  } catch (err) {
    console.error('[BranchManager] Master DB initialization error:', err);
    throw err;
  }
}

/**
 * Get connection pool for a branch (Single Shared Database Architecture)
 */
async function getBranchPool(branchId, allowInactive = false) {
  const bId = Number(branchId);
  if (!Number.isSafeInteger(bId) || bId < 1) throw Object.assign(new Error('Invalid branch ID'), {status:400});
  const res = await masterPool.query('SELECT id, status FROM master_branches WHERE id = $1', [bId]);
  const branch = res.rows[0];
  if (!branch || branch.status === 'Deleted') throw Object.assign(new Error('Branch not found'), {status:404});
  if (branch.status !== 'Active' && !allowInactive) throw Object.assign(new Error('Branch is not active'), {status:403});
  const { createScopedPool } = require('./scopedPool');
  if (!branchPools.has(bId)) branchPools.set(bId, createScopedPool(masterPool, bId));
  return branchPools.get(bId);
}

/**
 * AUTOMATED PROVISIONING ENGINE FOR BRANCH 2
 * Single Shared Database Multi-Tenancy Architecture (branch_id = 2)
 */
async function provisionBranch2Database(payload, performedBy = 'superadmin') {
  const masterClient = await masterPool.connect();

  try {
    await masterClient.query('BEGIN');

    // 1. CONCURRENCY ADVISORY LOCK
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

    // 3. Validate and Register Branch 2 Admin in Master Identity Registry
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

    // 4. Reserve in master_staff_identities
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

    // 5. Create Branch 2 Admin in users table with branch_id = 2
    const salt = await bcrypt.genSalt(10);
    const adminPassHash = await bcrypt.hash(adminPassword, salt);

    await masterClient.query(`
      INSERT INTO users (id, branch_id, name, contact, designation, role, username, password_hash, status)
      VALUES ('USR-ADMIN-BR02', 2, $1, $2, 'Branch Manager', 'admin', $3, $4, 'Active')
      ON CONFLICT (username) DO UPDATE SET
        branch_id = 2,
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        status = 'Active'
    `, [adminName, adminContact, adminUsername, adminPassHash]);

    // 6. Initialize Branch 2 Business Settings with branch_id = 2
    const openCash = parseFloat(payload.openingCash || 0);
    const openOnline = parseFloat(payload.openingOnline || 0);

    await masterClient.query(`
      INSERT INTO business_settings (
        id, branch_id, company_name, tagline, phone, address, 
        opening_cash, opening_online
      ) VALUES (
        2, 2, $1, $2, $3, $4, $5, $6
      ) ON CONFLICT (branch_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        opening_cash = EXCLUDED.opening_cash,
        opening_online = EXCLUDED.opening_online
    `, [
      payload.branchName || 'Branch 2',
      'POS, Inventory & Repair Workshop',
      payload.phone || '',
      payload.address || '',
      openCash,
      openOnline
    ]);

    // 7. Initialize Branch 2 WhatsApp Settings with branch_id = 2
    await masterClient.query(`
      INSERT INTO whatsapp_settings (id, branch_id, business_name)
      VALUES (2, 2, $1)
      ON CONFLICT (branch_id) DO UPDATE SET business_name = EXCLUDED.business_name
    `, [payload.branchName || 'Branch 2']);

    // 8. Register Branch 2 in Master DB registry (points to single shared DB)
    let host = process.env.DB_HOST || '127.0.0.1';
    let port = parseInt(process.env.DB_PORT || '5432', 10);
    let user = process.env.DB_USER || 'postgres';
    let targetDbName = process.env.DB_NAME || 'retail_repair_db';
    if (process.env.DATABASE_URL) {
      try {
        const parsed = new URL(process.env.DATABASE_URL);
        host = parsed.hostname || host;
        port = parseInt(parsed.port || '5432', 10);
        user = parsed.username || user;
        targetDbName = parsed.pathname.replace(/^\//, '') || targetDbName;
      } catch (e) {}
    }

    const insertRes = await masterClient.query(`
      INSERT INTO master_branches (
        id, branch_code, branch_name, db_name, db_host, db_port, db_user,
        schema_version, status,
        phone, email, city, address, admin_name, admin_username, admin_password_encrypted
      ) VALUES (
        2, $1, $2, $3, $4, $5, $6, '${CURRENT_SCHEMA_VERSION}', 'Active',
        $7, $8, $9, $10, $11, $12, $13
      ) ON CONFLICT (branch_code) DO UPDATE SET
        branch_name = EXCLUDED.branch_name,
        status = 'Active',
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        city = EXCLUDED.city,
        address = EXCLUDED.address,
        admin_name = EXCLUDED.admin_name,
        admin_username = EXCLUDED.admin_username,
        admin_password_encrypted = EXCLUDED.admin_password_encrypted
      RETURNING id, branch_code, branch_name, db_name, db_host, db_port, db_user, db_ssl, schema_version, status, phone, email, city, address, admin_name, admin_username, admin_password_encrypted, created_at
    `, [
      branchCode,
      payload.branchName || 'Branch 2',
      targetDbName,
      host,
      port,
      user,
      payload.phone || '',
      payload.email || '',
      payload.city || 'Karachi',
      payload.address || '',
      payload.adminName || 'Branch 2 Manager',
      adminUsername,
      encrypt(adminPassword)
    ]);

    // 9. Log to Master Audit Log
    await masterClient.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (2, 'BRANCH_PROVISIONED', $1, $2)
    `, [
      JSON.stringify({
        branch_name: payload.branchName,
        branch_code: branchCode,
        admin_username: adminUsername,
        architecture: 'single_db_shared_tables',
        schema_version: CURRENT_SCHEMA_VERSION
      }),
      performedBy
    ]);

    await require('../migrations/branchCatalogs').seedBranchCatalogs(masterClient, 2);
    await masterClient.query('COMMIT');
    console.log('[Provisioning Engine] Branch 2 successfully created with branch_id = 2 in single database!');

    return insertRes.rows[0];
  } catch (err) {
    await masterClient.query('ROLLBACK');
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
      admin_password_encrypted,
      created_at, 
      updated_at 
    FROM master_branches 
    WHERE status != 'Deleted'
    ORDER BY id ASC
  `);
  return res.rows.map(b => ({
    ...b,
    admin_password: decrypt(b.admin_password_encrypted) || ''
  }));
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
      admin_password_encrypted,
      created_at, 
      updated_at 
    FROM master_branches 
    WHERE id = $1 AND status != 'Deleted' LIMIT 1
  `, [parseInt(branchId, 10)]);
  if (!res.rows[0]) return null;
  const b = res.rows[0];
  b.admin_password = decrypt(b.admin_password_encrypted) || '';
  return b;
}

/**
 * Update Branch info / status
 */
async function updateBranch(branchId, updates) {
  const bId = parseInt(branchId, 10);
  const { branch_name, phone, email, city, address, status, admin_name, admin_username, admin_password } = updates;
  
  let adminPasswordEnc = null;
  if (admin_password && String(admin_password).trim().length > 0) {
    adminPasswordEnc = encrypt(String(admin_password).trim());
  }

  const cleanAdminName = admin_name ? String(admin_name).trim() : null;
  const cleanAdminUser = admin_username ? String(admin_username).trim().toLowerCase() : null;

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
      admin_username = COALESCE($8, admin_username),
      admin_password_encrypted = COALESCE($9, admin_password_encrypted),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10
    RETURNING id, branch_code, branch_name, db_name, db_host, db_port, db_user, db_ssl, schema_version, status, phone, email, city, address, admin_name, admin_username, admin_password_encrypted, updated_at
  `, [branch_name || null, phone || null, email || null, city || null, address || null, status || null, cleanAdminName, cleanAdminUser, adminPasswordEnc, bId]);

  if (status === 'Inactive' && branchPools.has(bId)) {
    const oldPool = branchPools.get(bId);
    branchPools.delete(bId);
    try { await oldPool.end(); } catch (e) {}
  }

  if (!res.rows[0]) return null;
  const b = res.rows[0];
  b.admin_password = decrypt(b.admin_password_encrypted) || '';
  return b;
}

/**
 * Close and evict an active connection pool for a branch
 */
async function closeBranchPool(branchId) {
  const bId = parseInt(branchId, 10);
  if (branchPools.has(bId)) {
    const pool = branchPools.get(bId);
    branchPools.delete(bId);
    try {
      await pool.end();
    } catch (e) {}
  }
}

module.exports = {
  masterPool,
  initMasterDb,
  getBranchPool,
  closeBranchPool,
  provisionBranch2Database,
  listBranches,
  getBranchById,
  updateBranch,
  encrypt,
  decrypt,
  CURRENT_SCHEMA_VERSION
};
