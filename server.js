// CRITICAL: Load .env at the absolute first line before any module or pool loads
const _fs = require('fs');
const _path = require('path');
const _envCandidates = [
  _path.join(__dirname, '.env'),
  _path.join(__dirname, '.env.cpanel'),
  _path.join(process.cwd(), '.env'),
  '/home/isywouhn/api.saadcomm.isywarecloud.com/.env',
  '/home/isywouhn/api.saadcomm.isywarecloud.com/.env.cpanel'
];
for (const _p of _envCandidates) {
  try {
    if (_fs.existsSync(_p)) {
      require('dotenv').config({ path: _p });
    }
  } catch (_) {}
}
require('dotenv').config();

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/middleware/errorHandler.js
var require_errorHandler = __commonJS({
  "src/middleware/errorHandler.js"(exports2, module2) {
    var errorHandler = (err, req, res, next) => {
      console.error("[API Error]:", err);
      if (err.code === "23505") {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_KEY",
          message: "A record with this unique value already exists.",
          detail: err.detail
        });
      }
      if (err.code === "23503") {
        return res.status(409).json({
          success: false,
          code: "FOREIGN_KEY_VIOLATION",
          message: err.detail || err.message || "Related record or user reference could not be found.",
          detail: err.detail
        });
      }
      if (err.status) {
        return res.status(err.status).json({
          success: false,
          code: err.code || "BUSINESS_ERROR",
          message: err.message
        });
      }
      const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
      return res.status(statusCode).json({
        success: false,
        code: "SERVER_ERROR",
        message: err.message || "Internal Server Error"
      });
    };
    module2.exports = errorHandler;
  }
});

// src/utils/phoneHelper.js
var require_phoneHelper = __commonJS({
  "src/utils/phoneHelper.js"(exports2, module2) {
    function normalizeUsername(username) {
      if (!username) return "";
      return String(username).trim().toLowerCase();
    }
    function normalizePhone(rawPhone) {
      if (!rawPhone) return null;
      let p = String(rawPhone).trim();
      if (!p) return null;
      p = p.replace(/[\s\-\(\)\.]+/g, "");
      if (!p) return null;
      if (p.startsWith("+92")) {
        p = "0" + p.slice(3);
      } else if (p.startsWith("0092")) {
        p = "0" + p.slice(4);
      } else if (p.startsWith("92") && p.length === 12 && p.startsWith("923")) {
        p = "0" + p.slice(2);
      }
      if (/^03\d{9}$/.test(p)) {
        return p;
      }
      if (/^0\d{9,10}$/.test(p)) {
        return p;
      }
      if (/^\+\d{7,15}$/.test(p)) {
        return p;
      }
      if (/^\d{7,15}$/.test(p)) {
        if (p.length === 10 && p.startsWith("3")) {
          return "0" + p;
        }
        return p;
      }
      const cleanDigits = p.replace(/[^\d+]/g, "");
      return cleanDigits.length >= 7 ? cleanDigits : null;
    }
    function isValidPhone(phone) {
      if (!phone) return false;
      const normalized = normalizePhone(phone);
      return normalized !== null && normalized.length >= 7 && normalized.length <= 16;
    }
    module2.exports = {
      normalizeUsername,
      normalizePhone,
      isValidPhone
    };
  }
});

// src/config/branchManager.js
var require_branchManager = __commonJS({
  "src/config/branchManager.js"(exports2, module2) {
    var { Pool, Client } = require("pg");
    var path2 = require("path");
    var fs2 = require("fs");
    var crypto = require("crypto");
    var bcrypt = require("bcryptjs");
    require("dotenv").config();
    require("dotenv").config({ path: path2.join(__dirname, ".env") });
    require("dotenv").config({ path: path2.join(__dirname, "..", ".env") });
    require("dotenv").config({ path: path2.join(__dirname, "..", "..", ".env") });
    var ENCRYPTION_KEY = (process.env.BRANCH_SECRET_KEY || process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026").padEnd(32, "0").slice(0, 32);
    var IV_LENGTH = 16;
    var BRANCH_PROVISIONING_LOCK_ID = 884422001;
    var CURRENT_SCHEMA_VERSION = "2.1.0";
    function encrypt(text) {
      if (!text) return null;
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
      let encrypted = cipher.update(String(text));
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      return iv.toString("hex") + ":" + encrypted.toString("hex");
    }
    function decrypt(text) {
      if (!text) return null;
      try {
        const parts = text.split(":");
        const iv = Buffer.from(parts.shift(), "hex");
        const encryptedText = Buffer.from(parts.join(":"), "hex");
        const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
      } catch (e) {
        console.error("[BranchManager] Decryption error:", e.message);
        return null;
      }
    }
    var masterPoolConfig = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL ? {
      connectionString: process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 12e4,
      connectionTimeoutMillis: 1e4,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1e4
    } : {
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || "5432", 10),
      database: process.env.DB_NAME || "isywouhn_saadcomm",
      user: process.env.DB_USER || "isywouhn_saadcomm_user",
      password: process.env.DB_PASSWORD || "",
      max: 10,
      idleTimeoutMillis: 3e4,
      connectionTimeoutMillis: 1e4
    };
    var masterPool = new Pool(masterPoolConfig);
    masterPool.on("error", (err) => {
      console.error("[Master DB Pool] Unexpected error on idle client:", err);
    });
    var branchPools = /* @__PURE__ */ new Map();
    async function initMasterDb() {
      try {
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
        const saCheck = await masterPool.query(`SELECT id FROM master_super_admins LIMIT 1`);
        if (saCheck.rows.length === 0) {
          const saUser = process.env.SUPER_ADMIN_USERNAME || "superadmin";
          const saPass = process.env.SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_INITIAL_PASSWORD || "SuperAdmin@Secure2026!";
          const saName = process.env.SUPER_ADMIN_NAME || "Super Admin";
          const saEmail = process.env.SUPER_ADMIN_EMAIL || "superadmin@system.local";
          const salt = await bcrypt.genSalt(10);
          const hash = await bcrypt.hash(saPass, salt);
          await masterPool.query(`
        INSERT INTO master_super_admins (username, password_hash, name, email, status)
        VALUES ($1, $2, $3, $4, 'Active')
        ON CONFLICT (username) DO NOTHING
      `, [saUser.toLowerCase().trim(), hash, saName, saEmail]);
          console.log(`[BranchManager] Initialized Super Admin account (${saUser}) in Master DB`);
        }
        const branchCheck = await masterPool.query(`SELECT id, branch_code FROM master_branches WHERE branch_code = 'BR-01' OR id = 1 LIMIT 1`);
        if (branchCheck.rows.length === 0) {
          let b1Host = process.env.DB_HOST || "127.0.0.1";
          let b1Port = parseInt(process.env.DB_PORT || "5432", 10);
          let b1Name = process.env.DB_NAME || "isywouhn_saadcomm";
          let b1User = process.env.DB_USER || "isywouhn_saadcomm_user";
          let b1Pass = process.env.DB_PASSWORD || "";
          let b1UrlEnc = null;
          if (process.env.DATABASE_URL) {
            b1UrlEnc = encrypt(process.env.DATABASE_URL);
            try {
              const parsed = new URL(process.env.DATABASE_URL);
              b1Host = parsed.hostname || b1Host;
              b1Port = parseInt(parsed.port || "5432", 10);
              b1Name = parsed.pathname.replace(/^\//, "") || b1Name;
              b1User = parsed.username || b1User;
              b1Pass = parsed.password || b1Pass;
            } catch (e) {
            }
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
            process.env.DB_SSL === "false" ? false : true
          ]);
          console.log("[BranchManager] Registered existing database as Branch 1 (BR-01)");
        }
      } catch (err) {
        console.error("[BranchManager] Master DB initialization error:", err);
      }
    }
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
      if (branch.status === "Inactive" && !allowInactive) {
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
            idleTimeoutMillis: 3e4,
            connectionTimeoutMillis: 1e4
          };
        }
      }
      if (!poolConfig) {
        const rawPass = decrypt(branch.db_password_encrypted) || "";
        poolConfig = {
          host: branch.db_host,
          port: branch.db_port || 5432,
          database: branch.db_name,
          user: branch.db_user,
          password: rawPass,
          ssl: branch.db_ssl ? { rejectUnauthorized: false } : false,
          max: 20,
          idleTimeoutMillis: 3e4,
          connectionTimeoutMillis: 1e4
        };
      }
      const newPool = new Pool(poolConfig);
      newPool.on("error", (err) => {
        console.error(`[Branch ${branch.branch_code} Pool] Unexpected client error:`, err);
      });
      branchPools.set(bId, newPool);
      return newPool;
    }
    async function executeFullMigrationPipeline(client, branchSettings = {}) {
      const schemaPath = path2.join(__dirname, "..", "..", "seeds", "schema.sql");
      if (!fs2.existsSync(schemaPath)) {
        throw new Error("Base schema file not found at " + schemaPath);
      }
      const schemaSql = fs2.readFileSync(schemaPath, "utf8");
      await client.query(schemaSql);
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
        branchSettings.branchName || "Branch 2",
        "POS, Inventory & Repair Workshop",
        branchSettings.phone || "",
        branchSettings.address || "",
        openCash,
        openOnline
      ]);
    }
    async function provisionBranch2Database(payload, performedBy = "superadmin") {
      const masterClient = await masterPool.connect();
      let createdDbName = null;
      let targetPool = null;
      try {
        await masterClient.query("BEGIN");
        await masterClient.query("SELECT pg_advisory_xact_lock($1)", [BRANCH_PROVISIONING_LOCK_ID]);
        const countRes = await masterClient.query(
          `SELECT COUNT(*) AS total FROM master_branches WHERE status != 'Deleted'`
        );
        const totalBranches = parseInt(countRes.rows[0]?.total || 0, 10);
        if (totalBranches >= 2) {
          const err = new Error("Maximum branch limit reached. Only 2 branches are allowed.");
          err.statusCode = 400;
          err.code = "MAX_BRANCHES_REACHED";
          throw err;
        }
        const branchCode = payload.branchCode ? String(payload.branchCode).trim().toUpperCase() : "BR-02";
        const codeCheck = await masterClient.query(`SELECT id FROM master_branches WHERE branch_code = $1`, [branchCode]);
        if (codeCheck.rows.length > 0) {
          const err = new Error(`Branch code "${branchCode}" already exists.`);
          err.statusCode = 400;
          throw err;
        }
        let host = process.env.BRANCH_2_DB_HOST || process.env.DB_HOST || "127.0.0.1";
        let port = parseInt(process.env.BRANCH_2_DB_PORT || process.env.DB_PORT || "5432", 10);
        let user = process.env.BRANCH_2_DB_USER || process.env.DB_USER || "postgres";
        let password = process.env.BRANCH_2_DB_PASSWORD || process.env.DB_PASSWORD || "admin123";
        let dbSsl = process.env.DB_SSL === "false" ? false : true;
        let targetDbName = process.env.BRANCH_2_DB_NAME || "retail_repair_branch_02";
        let connectionUrl = process.env.BRANCH_2_DATABASE_URL || null;
        if (process.env.DATABASE_URL && !process.env.BRANCH_2_DATABASE_URL) {
          try {
            const parsed = new URL(process.env.DATABASE_URL);
            host = parsed.hostname || host;
            port = parseInt(parsed.port || "5432", 10);
            user = parsed.username || user;
            password = parsed.password || password;
            targetDbName = process.env.BRANCH_2_DB_NAME || "retail_repair_branch_02";
            connectionUrl = process.env.DATABASE_URL.replace(/\/neondb(\?|$)/, `/${targetDbName}$1`);
          } catch (e) {
          }
        }
        if (!connectionUrl) {
          try {
            const adminClient = new Client({
              host,
              port,
              user,
              password,
              database: "postgres",
              ssl: dbSsl ? { rejectUnauthorized: false } : false,
              connectionTimeoutMillis: 5e3
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
          }
        }
        const branchPoolConfig = connectionUrl ? {
          connectionString: connectionUrl,
          ssl: dbSsl ? { rejectUnauthorized: false } : false,
          max: 10,
          connectionTimeoutMillis: 1e4
        } : {
          host,
          port,
          database: targetDbName,
          user,
          password,
          ssl: dbSsl ? { rejectUnauthorized: false } : false,
          max: 10,
          connectionTimeoutMillis: 1e4
        };
        targetPool = new Pool(branchPoolConfig);
        const branchClient = await targetPool.connect();
        try {
          console.log(`[Provisioning Engine] Running schema and migrations pipeline on Branch 2...`);
          await executeFullMigrationPipeline(branchClient, {
            branchName: payload.branchName,
            phone: payload.phone,
            address: payload.address,
            openingCash: payload.openingCash,
            openingOnline: payload.openingOnline
          });
          const { normalizeUsername, normalizePhone } = require_phoneHelper();
          const adminUsername = normalizeUsername(payload.adminUsername || "admin2");
          const adminContact = normalizePhone(payload.adminContact || payload.phone || null);
          const adminPassword = payload.adminPassword || "Admin@Branch2";
          const adminName = payload.adminName || "Branch 2 Manager";
          const uCheck = await masterClient.query(
            "SELECT id FROM master_staff_identities WHERE normalized_username = $1",
            [adminUsername]
          );
          if (uCheck.rows.length > 0) {
            const err = new Error("Username already exists in another branch. Please choose a different username.");
            err.statusCode = 409;
            err.code = "USERNAME_ALREADY_EXISTS";
            throw err;
          }
          if (adminContact) {
            const pCheck = await masterClient.query(
              "SELECT id FROM master_staff_identities WHERE normalized_phone = $1",
              [adminContact]
            );
            if (pCheck.rows.length > 0) {
              const err = new Error("Phone number is already registered in another branch.");
              err.statusCode = 409;
              err.code = "PHONE_ALREADY_EXISTS";
              throw err;
            }
          }
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
          payload.branchName || "Branch 2",
          targetDbName,
          host,
          port,
          user,
          encryptedPass,
          encryptedUrl,
          dbSsl,
          payload.phone || "",
          payload.email || "",
          payload.city || "Karachi",
          payload.address || "",
          payload.adminName || "Branch 2 Manager",
          payload.adminUsername || "admin2"
        ]);
        await masterClient.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (2, 'BRANCH_PROVISIONED', $1, $2)
    `, [
          JSON.stringify({
            branch_name: payload.branchName,
            branch_code: branchCode,
            admin_username: payload.adminUsername || "admin2",
            db_name: targetDbName,
            schema_version: CURRENT_SCHEMA_VERSION
          }),
          performedBy
        ]);
        await masterClient.query("COMMIT");
        console.log(`[Provisioning Engine] Branch 2 successfully provisioned and activated in Master DB!`);
        return insertRes.rows[0];
      } catch (err) {
        await masterClient.query("ROLLBACK");
        if (targetPool) {
          try {
            await targetPool.end();
          } catch (e) {
          }
        }
        console.error("[Provisioning Engine] Provisioning failed, rolled back Master DB:", err.message);
        throw err;
      } finally {
        masterClient.release();
      }
    }
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
      if (status === "Inactive" && branchPools.has(bId)) {
        const oldPool = branchPools.get(bId);
        branchPools.delete(bId);
        try {
          await oldPool.end();
        } catch (e) {
        }
      }
      return res.rows[0] || null;
    }
    async function closeBranchPool(branchId) {
      const bId = parseInt(branchId, 10);
      if (branchPools.has(bId)) {
        const pool = branchPools.get(bId);
        branchPools.delete(bId);
        try {
          await pool.end();
        } catch (e) {
        }
      }
    }
    module2.exports = {
      masterPool,
      initMasterDb,
      getBranchPool,
      closeBranchPool,
      executeFullMigrationPipeline,
      provisionBranch2Database,
      listBranches,
      getBranchById,
      updateBranch,
      encrypt,
      decrypt,
      CURRENT_SCHEMA_VERSION
    };
  }
});

// src/middleware/branchContext.js
var require_branchContext = __commonJS({
  "src/middleware/branchContext.js"(exports2, module2) {
    var { AsyncLocalStorage } = require("async_hooks");
    var branchManager = require_branchManager();
    var jwt = require("jsonwebtoken");
    var branchStorage = new AsyncLocalStorage();
    async function branchContextMiddleware(req, res, next) {
      try {
        let branchId = 1;
        let isSuperAdmin = false;
        let token = null;
        if (req.cookies && req.cookies.token) {
          token = req.cookies.token;
        } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
          token = req.headers.authorization.split(" ")[1];
        }
        let decoded = null;
        if (token) {
          try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026");
            if (decoded && decoded.role === "super_admin") {
              isSuperAdmin = true;
            }
          } catch (e) {
          }
        }
        if (isSuperAdmin) {
          if (req.headers["x-branch-id"]) {
            const headerBId = parseInt(req.headers["x-branch-id"], 10);
            if (!isNaN(headerBId) && headerBId > 0) {
              branchId = headerBId;
            }
          }
        } else if (decoded && decoded.branchId) {
          branchId = parseInt(decoded.branchId, 10) || 1;
        } else if (req.headers["x-branch-id"]) {
          const headerBId = parseInt(req.headers["x-branch-id"], 10);
          if (!isNaN(headerBId) && headerBId > 0) {
            branchId = headerBId;
          }
        }
        const pool = await branchManager.getBranchPool(branchId, isSuperAdmin);
        req.branchId = branchId;
        branchStorage.run({ branchId, pool, isSuperAdmin }, () => {
          next();
        });
      } catch (err) {
        if (req.headers["x-branch-id"] && req.headers.authorization) {
          try {
            const fallbackPool = await branchManager.getBranchPool(1, true);
            req.branchId = 1;
            return branchStorage.run({ branchId: 1, pool: fallbackPool, isSuperAdmin: true }, () => {
              next();
            });
          } catch (fallbackErr) {
            return next(err);
          }
        }
        next(err);
      }
    }
    function getBranchStore() {
      return branchStorage.getStore() || null;
    }
    module2.exports = {
      branchStorage,
      branchContextMiddleware,
      getBranchStore
    };
  }
});

// src/config/db.js
var require_db = __commonJS({
  "src/config/db.js"(exports2, module2) {
    var { Pool } = require("pg");
    var path2 = require("path");
    require("dotenv").config();
    require("dotenv").config({ path: path2.join(__dirname, ".env") });
    require("dotenv").config({ path: path2.join(__dirname, "..", ".env") });
    require("dotenv").config({ path: path2.join(__dirname, "..", "..", ".env") });
    var branchManager = require_branchManager();
    var branchContext = require_branchContext();
    var poolConfig = process.env.DATABASE_URL ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 12e4,
      connectionTimeoutMillis: 1e4,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1e4
    } : {
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || "5432", 10),
      database: process.env.DB_NAME || "isywouhn_saadcomm",
      user: process.env.DB_USER || "isywouhn_saadcomm_user",
      password: process.env.DB_PASSWORD || "",
      max: 20,
      idleTimeoutMillis: 3e4,
      connectionTimeoutMillis: 1e4
    };
    var pool = new Pool(poolConfig);
    pool.on("error", (err) => {
      console.error("Unexpected error on idle PostgreSQL client (Branch 1)", err);
    });
    function getActivePool() {
      try {
        const store = branchContext.getBranchStore();
        if (store && store.pool) {
          return store.pool;
        }
      } catch (e) {
      }
      return pool;
    }
    var query = (text, params) => getActivePool().query(text, params);
    var getClient = () => getActivePool().connect();
    var withTransaction = async (callback) => {
      const client = await getActivePool().connect();
      try {
        await client.query("BEGIN");
        const result2 = await callback(client);
        await client.query("COMMIT");
        return result2;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    };
    var master = {
      pool: branchManager.masterPool,
      query: (text, params) => branchManager.masterPool.query(text, params),
      getClient: () => branchManager.masterPool.connect(),
      withTransaction: async (callback) => {
        const client = await branchManager.masterPool.connect();
        try {
          await client.query("BEGIN");
          const result2 = await callback(client);
          await client.query("COMMIT");
          return result2;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    };
    (async () => {
      try {
        await branchManager.initMasterDb();
        await pool.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn_cnic VARCHAR(100);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ntn_tax_id VARCHAR(100);
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS st_reg_no VARCHAR(100);
      ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE products ALTER COLUMN brand DROP NOT NULL;
      ALTER TABLE products ALTER COLUMN model DROP NOT NULL;
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
        console.error("[DB Init] Column check error:", err.message);
      }
    })();
    module2.exports = {
      pool,
      query,
      getClient,
      withTransaction,
      master,
      getActivePool
    };
  }
});

// src/config/cache.js
var require_cache = __commonJS({
  "src/config/cache.js"(exports2, module2) {
    var path2 = require("path");
    require("dotenv").config({ path: path2.join(__dirname, "..", "..", ".env") });
    var InMemoryCache = class {
      constructor() {
        this.store = /* @__PURE__ */ new Map();
      }
      get(key) {
        const item = this.store.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
          this.store.delete(key);
          return null;
        }
        return item.value;
      }
      set(key, value, ttlSeconds = 60) {
        const expiry = Date.now() + ttlSeconds * 1e3;
        this.store.set(key, { value, expiry });
      }
      del(key) {
        this.store.delete(key);
      }
      invalidatePattern(pattern) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        for (const key of this.store.keys()) {
          if (regex.test(key)) {
            this.store.delete(key);
          }
        }
      }
      flush() {
        this.store.clear();
      }
    };
    var memoryStore = new InMemoryCache();
    console.log("\u26A1 [Cache Engine] Active: Ultra-Fast High-Performance In-Memory Cache (0.01ms latency, direct Neon DB).");
    var CacheService = {
      async get(key) {
        return memoryStore.get(key);
      },
      async set(key, value, ttlSeconds = 60) {
        memoryStore.set(key, value, ttlSeconds);
      },
      async del(key) {
        memoryStore.del(key);
      },
      async invalidatePattern(pattern) {
        memoryStore.invalidatePattern(pattern);
      },
      /**
       * Branch-scoped invalidation: clears cache for a specific branch instantly.
       * Format: route:branch_<id>:<path pattern>
       */
      async invalidateBranchPattern(branchId, routePattern) {
        if (!branchId) {
          return this.invalidatePattern(`route:*:${routePattern}`);
        }
        const pattern = `route:branch_${branchId}:${routePattern}`;
        memoryStore.invalidatePattern(pattern);
      },
      /**
       * Batch branch invalidations: instantly clears multiple patterns without blocking.
       */
      async invalidateBranchPatterns(branchId, routePatterns) {
        if (!Array.isArray(routePatterns) || routePatterns.length === 0) return;
        for (const p of routePatterns) {
          this.invalidateBranchPattern(branchId, p);
        }
      },
      async flush() {
        memoryStore.flush();
      },
      // Cache-aside helper
      async wrap(key, ttlSeconds, fetchFn) {
        const cached = this.get(key);
        if (cached !== null && cached !== void 0) {
          return cached;
        }
        const freshData = await fetchFn();
        if (freshData !== null && freshData !== void 0) {
          this.set(key, freshData, ttlSeconds);
        }
        return freshData;
      },
      isRedisConnected() {
        return false;
      }
    };
    function cacheRoute(ttlSeconds = 60, customKeyFn = null) {
      return (req, res, next) => {
        if (req.method !== "GET") {
          return next();
        }
        const { getBranchStore } = require_branchContext();
        const branchStore = getBranchStore();
        let branchScope = null;
        if (req.user?.isSuperAdmin || branchStore?.isSuperAdmin) {
          if (req.headers["x-branch-id"]) {
            const headerBId = parseInt(req.headers["x-branch-id"], 10);
            branchScope = !isNaN(headerBId) ? `branch_${headerBId}` : "sa_all";
          } else {
            branchScope = "sa_all";
          }
        } else {
          const verifiedBranchId = branchStore?.branchId || req.user?.branchId || req.branchId;
          if (!verifiedBranchId) {
            return next();
          }
          branchScope = `branch_${verifiedBranchId}`;
        }
        const role = req.user?.role || "anon";
        const userId = req.user?.id || "anon";
        const isBustCache = Boolean(req.query._t || req.query.nocache === "true" || req.headers["cache-control"] === "no-cache");
        const cleanQuery = { ...req.query || {} };
        delete cleanQuery._t;
        delete cleanQuery._;
        delete cleanQuery.timestamp;
        delete cleanQuery.t;
        delete cleanQuery.nocache;
        const fullPath = `${req.baseUrl || ""}${req.path || ""}`;
        const isPersonalEndpoint = fullPath.includes("/me") || fullPath.includes("/my-") || fullPath.includes("/profile");
        const userScope = isPersonalEndpoint ? `:${userId}` : "";
        const key = customKeyFn ? customKeyFn(req) : `route:${branchScope}:${fullPath}:${JSON.stringify(cleanQuery)}:${role}${userScope}`;
        if (!isBustCache) {
          const cached = memoryStore.get(key);
          if (cached) {
            res.setHeader("X-Cache-Status", "HIT");
            return res.json(cached);
          }
        }
        const originalJson = res.json.bind(res);
        res.json = (data) => {
          res.setHeader("X-Cache-Status", "MISS");
          if (res.statusCode >= 200 && res.statusCode < 300 && data && data.success !== false) {
            memoryStore.set(key, data, ttlSeconds);
          }
          return originalJson(data);
        };
        next();
      };
    }
    function getBranchIdFromReq(req) {
      try {
        const { getBranchStore } = require_branchContext();
        const branchStore = getBranchStore();
        if (req.user?.isSuperAdmin || branchStore?.isSuperAdmin) {
          if (req.headers && req.headers["x-branch-id"]) {
            const hb = parseInt(req.headers["x-branch-id"], 10);
            return !isNaN(hb) ? hb : null;
          }
          return null;
        }
        return branchStore?.branchId || req.user?.branchId || req.branchId || null;
      } catch {
        return req.user?.branchId || req.branchId || null;
      }
    }
    module2.exports = {
      CacheService,
      cacheRoute,
      getBranchIdFromReq
    };
  }
});

// src/middleware/auth.js
var require_auth = __commonJS({
  "src/middleware/auth.js"(exports2, module2) {
    var jwt = require("jsonwebtoken");
    var db = require_db();
    var authenticateToken = async (req, res, next) => {
      try {
        let token = null;
        if (req.cookies && req.cookies.token) {
          token = req.cookies.token;
        } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
          token = req.headers.authorization.split(" ")[1];
        }
        if (!token) {
          return res.status(401).json({
            success: false,
            code: "UNAUTHORIZED",
            message: "Authentication required. Please login."
          });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026");
        const { CacheService } = require_cache();
        const branchManager = require_branchManager();
        if (decoded.role === "super_admin") {
          let saUser = await CacheService.get(`auth:sa:${decoded.id}`);
          if (!saUser) {
            const saRes = await branchManager.masterPool.query(
              "SELECT id, username, name, email, status FROM master_super_admins WHERE id = $1",
              [decoded.id]
            );
            if (saRes.rows.length === 0 || saRes.rows[0].status === "Inactive") {
              return res.status(401).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "Super Admin account no longer exists or is inactive."
              });
            }
            saUser = saRes.rows[0];
            await CacheService.set(`auth:sa:${decoded.id}`, saUser, 60);
          }
          req.user = {
            ...saUser,
            role: "super_admin",
            isSuperAdmin: true
          };
          return next();
        }
        const branchId = parseInt(decoded.branchId, 10) || 1;
        let branch = await CacheService.get(`auth:branch:${branchId}`);
        if (!branch) {
          branch = await branchManager.getBranchById(branchId);
          if (branch) {
            await CacheService.set(`auth:branch:${branchId}`, branch, 120);
          }
        }
        if (!branch || branch.status === "Inactive") {
          return res.status(403).json({
            success: false,
            code: "BRANCH_INACTIVE",
            message: `Branch "${branch?.branch_name || branchId}" is currently inactive. Please contact Platform Super Admin.`
          });
        }
        let user = await CacheService.get(`auth:user:${decoded.id}`);
        if (!user) {
          const userRes = await db.query("SELECT id, name, contact, designation, role, username, status FROM users WHERE id = $1", [decoded.id]);
          if (userRes.rows.length === 0) {
            return res.status(401).json({
              success: false,
              code: "USER_NOT_FOUND",
              message: "User account no longer exists."
            });
          }
          user = userRes.rows[0];
          await CacheService.set(`auth:user:${decoded.id}`, user, 60);
        }
        if (user.status === "Inactive") {
          return res.status(403).json({
            success: false,
            code: "ACCOUNT_INACTIVE",
            message: "Your account has been deactivated. Please contact an administrator."
          });
        }
        req.user = {
          ...user,
          branchId
        };
        next();
      } catch (error) {
        if (error.name === "TokenExpiredError") {
          return res.status(401).json({
            success: false,
            code: "TOKEN_EXPIRED",
            message: "Session has expired. Please login again."
          });
        }
        return res.status(401).json({
          success: false,
          code: "INVALID_TOKEN",
          message: "Invalid session token. Please login again."
        });
      }
    };
    module2.exports = authenticateToken;
  }
});

// src/services/identityRegistry.js
var require_identityRegistry = __commonJS({
  "src/services/identityRegistry.js"(exports2, module2) {
    var crypto = require("crypto");
    var branchManager = require_branchManager();
    var { normalizeUsername, normalizePhone, isValidPhone } = require_phoneHelper();
    var IdentityConflictError = class extends Error {
      constructor(code, message) {
        super(message);
        this.name = "IdentityConflictError";
        this.code = code;
        this.statusCode = 409;
      }
    };
    async function scanIdentityConflicts() {
      const branches = await branchManager.listBranches();
      const allUsers = [];
      const branchStats = {};
      for (const b of branches) {
        branchStats[b.id] = { branchCode: b.branch_code, branchName: b.branch_name, count: 0 };
        try {
          const pool = await branchManager.getBranchPool(b.id, true);
          const res = await pool.query(
            "SELECT id, name, contact, designation, role, username, status FROM users ORDER BY id ASC"
          );
          branchStats[b.id].count = res.rows.length;
          for (const u of res.rows) {
            allUsers.push({
              branchId: b.id,
              branchCode: b.branch_code,
              branchName: b.branch_name,
              userId: u.id,
              rawUsername: u.username,
              normalizedUsername: normalizeUsername(u.username),
              rawContact: u.contact,
              normalizedPhone: normalizePhone(u.contact),
              role: u.role,
              name: u.name,
              status: u.status
            });
          }
        } catch (err) {
          console.error(`[IdentityRegistry] Error scanning branch ${b.id}:`, err.message);
        }
      }
      const conflicts = [];
      const usernameMap = /* @__PURE__ */ new Map();
      const phoneMap = /* @__PURE__ */ new Map();
      for (const user of allUsers) {
        if (user.normalizedUsername) {
          if (usernameMap.has(user.normalizedUsername)) {
            const existing = usernameMap.get(user.normalizedUsername);
            conflicts.push({
              type: "USERNAME_DUPLICATE",
              conflictingValue: user.normalizedUsername,
              primaryUser: existing,
              conflictingUser: user
            });
          } else {
            usernameMap.set(user.normalizedUsername, user);
          }
        }
        if (user.normalizedPhone) {
          if (phoneMap.has(user.normalizedPhone)) {
            const existing = phoneMap.get(user.normalizedPhone);
            conflicts.push({
              type: "PHONE_DUPLICATE",
              conflictingValue: user.normalizedPhone,
              primaryUser: existing,
              conflictingUser: user
            });
          } else {
            phoneMap.set(user.normalizedPhone, user);
          }
        }
      }
      return {
        duplicatesFound: conflicts.length > 0,
        conflicts,
        totalScanned: allUsers.length,
        branchStats,
        allUsers
      };
    }
    async function reserveIdentity({ branchId, username, phone, role, status = "Active" }) {
      const normUsername = normalizeUsername(username);
      if (!normUsername) {
        const err = new Error("Username is required.");
        err.statusCode = 400;
        err.code = "MISSING_USERNAME";
        throw err;
      }
      const normPhone = normalizePhone(phone);
      if (phone && !normPhone) {
        const err = new Error("Invalid phone number format.");
        err.statusCode = 400;
        err.code = "INVALID_PHONE";
        throw err;
      }
      const reservationToken = crypto.randomBytes(16).toString("hex");
      try {
        const res = await branchManager.masterPool.query(
          `INSERT INTO master_staff_identities (
        branch_id, branch_user_id, normalized_username, normalized_phone,
        role, status, reservation_token, reservation_status, created_at, updated_at
      ) VALUES (
        $1, NULL, $2, $3,
        $4, $5, $6, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING id`,
          [branchId, normUsername, normPhone, role, status, reservationToken]
        );
        return {
          reservationId: res.rows[0].id,
          reservationToken,
          normalizedUsername: normUsername,
          normalizedPhone: normPhone
        };
      } catch (err) {
        if (err.code === "23505") {
          const detail = String(err.detail || err.message || "");
          if (detail.includes("normalized_phone") || err.constraint === "uq_master_staff_phone") {
            throw new IdentityConflictError(
              "PHONE_ALREADY_EXISTS",
              "This user already exists: Phone number is already registered with another staff member."
            );
          }
          throw new IdentityConflictError(
            "USERNAME_ALREADY_EXISTS",
            "This user already exists: Username is already taken. Please choose a different username."
          );
        }
        throw err;
      }
    }
    async function finalizeIdentity({ reservationId, reservationToken, branchUserId }) {
      const res = await branchManager.masterPool.query(
        `UPDATE master_staff_identities
     SET branch_user_id = $1, reservation_status = 'active', reservation_token = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND reservation_token = $3 AND reservation_status = 'pending'
     RETURNING id`,
        [String(branchUserId), reservationId, reservationToken]
      );
      if (res.rows.length === 0) {
        console.error(`[IdentityRegistry] Failed to finalize reservation ${reservationId}: token mismatch or not pending.`);
        return false;
      }
      return true;
    }
    async function releaseReservation({ reservationId, reservationToken }) {
      try {
        await branchManager.masterPool.query(
          `DELETE FROM master_staff_identities
       WHERE id = $1 AND reservation_token = $2 AND reservation_status = 'pending'`,
          [reservationId, reservationToken]
        );
        console.log(`[IdentityRegistry] Released pending reservation ${reservationId}`);
      } catch (err) {
        console.error(`[IdentityRegistry] Error releasing pending reservation ${reservationId}:`, err.message);
      }
    }
    async function updateIdentity({ branchId, branchUserId, currentUsername, username, phone, role, status = "Active" }) {
      const normUsername = normalizeUsername(username);
      if (!normUsername) {
        const err = new Error("Username is required.");
        err.statusCode = 400;
        err.code = "MISSING_USERNAME";
        throw err;
      }
      const normCurrentUsername = normalizeUsername(currentUsername || username);
      const normPhone = normalizePhone(phone);
      if (phone && !normPhone) {
        const err = new Error("Invalid phone number format.");
        err.statusCode = 400;
        err.code = "INVALID_PHONE";
        throw err;
      }
      const curRes = await branchManager.masterPool.query(
        `SELECT * FROM master_staff_identities 
     WHERE (branch_id = $1 AND normalized_username = $2)
        OR (branch_id = $1 AND branch_user_id = $3)
     ORDER BY (normalized_username = $2) DESC
     LIMIT 1`,
        [branchId, normCurrentUsername, String(branchUserId)]
      );
      const previousIdentity = curRes.rows[0] || null;
      const excludeId = previousIdentity ? previousIdentity.id : -1;
      const userCheck = await branchManager.masterPool.query(
        `SELECT id FROM master_staff_identities 
     WHERE normalized_username = $1 AND id != $2`,
        [normUsername, excludeId]
      );
      if (userCheck.rows.length > 0) {
        throw new IdentityConflictError(
          "USERNAME_ALREADY_EXISTS",
          "This user already exists: Username is already taken. Please choose a different username."
        );
      }
      if (normPhone) {
        const phoneCheck = await branchManager.masterPool.query(
          `SELECT id FROM master_staff_identities 
       WHERE normalized_phone = $1 AND id != $2`,
          [normPhone, excludeId]
        );
        if (phoneCheck.rows.length > 0) {
          throw new IdentityConflictError(
            "PHONE_ALREADY_EXISTS",
            "This user already exists: Phone number is already registered with another staff member."
          );
        }
      }
      let res;
      if (previousIdentity) {
        res = await branchManager.masterPool.query(
          `UPDATE master_staff_identities
       SET branch_user_id = $1, normalized_username = $2, normalized_phone = $3, role = $4, status = $5, reservation_status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
          [String(branchUserId), normUsername, normPhone, role, status, previousIdentity.id]
        );
      } else {
        res = await branchManager.masterPool.query(
          `INSERT INTO master_staff_identities (
        branch_id, branch_user_id, normalized_username, normalized_phone,
        role, status, reservation_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING *`,
          [branchId, String(branchUserId), normUsername, normPhone, role, status]
        );
      }
      return {
        updatedIdentity: res.rows[0],
        previousIdentity
      };
    }
    async function restoreIdentity({ branchId, branchUserId, previousIdentity }) {
      if (!previousIdentity) return;
      try {
        await branchManager.masterPool.query(
          `UPDATE master_staff_identities
       SET normalized_username = $1, normalized_phone = $2, role = $3, status = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
          [
            previousIdentity.normalized_username,
            previousIdentity.normalized_phone,
            previousIdentity.role,
            previousIdentity.status,
            previousIdentity.id
          ]
        );
        console.log(`[IdentityRegistry] Compensated & restored previous identity for ${branchUserId} in Branch ${branchId}`);
      } catch (err) {
        console.error(`[IdentityRegistry CRITICAL] Failed to restore identity for ${branchUserId}:`, err.message);
      }
    }
    async function setIdentityStatus({ branchId, branchUserId, status }) {
      try {
        await branchManager.masterPool.query(
          `UPDATE master_staff_identities
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE branch_id = $2 AND branch_user_id = $3`,
          [status, branchId, String(branchUserId)]
        );
      } catch (err) {
        console.error(`[IdentityRegistry] Error updating status for ${branchUserId}:`, err.message);
      }
    }
    async function resolveIdentityByUsername(username) {
      const normUsername = normalizeUsername(username);
      if (!normUsername) return null;
      const res = await branchManager.masterPool.query(
        `SELECT id, branch_id, branch_user_id, normalized_username, normalized_phone, role, status, reservation_status
     FROM master_staff_identities
     WHERE normalized_username = $1`,
        [normUsername]
      );
      if (res.rows.length === 0) {
        return null;
      }
      if (res.rows.length > 1) {
        console.error(`[IdentityRegistry SECURITY ALERT] Ambiguous identity resolution detected for username "${normUsername}". Count: ${res.rows.length}`);
        return {
          ambiguous: true,
          count: res.rows.length,
          identities: res.rows
        };
      }
      return res.rows[0];
    }
    module2.exports = {
      scanIdentityConflicts,
      reserveIdentity,
      finalizeIdentity,
      releaseReservation,
      updateIdentity,
      restoreIdentity,
      setIdentityStatus,
      resolveIdentityByUsername,
      IdentityConflictError
    };
  }
});

// src/modules/auth/auth.routes.js
var require_auth_routes = __commonJS({
  "src/modules/auth/auth.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var bcrypt = require("bcryptjs");
    var jwt = require("jsonwebtoken");
    var db = require_db();
    var authenticateToken = require_auth();
    var identityRegistry = require_identityRegistry();
    var { normalizeUsername } = require_phoneHelper();
    router.post("/login", async (req, res, next) => {
      try {
        const { username, password, portal } = req.body;
        if (!username || !password) {
          return res.status(400).json({
            success: false,
            code: "MISSING_CREDENTIALS",
            message: "Username and password are required."
          });
        }
        const cleanUsername = normalizeUsername(username);
        const branchManager = require_branchManager();
        const saRes = await branchManager.masterPool.query(
          `SELECT id, username, password_hash, name, email, status FROM master_super_admins WHERE LOWER(username) = $1 LIMIT 1`,
          [cleanUsername]
        );
        if (saRes.rows.length > 0) {
          const sa = saRes.rows[0];
          if (sa.status === "Inactive") {
            return res.status(403).json({
              success: false,
              code: "ACCOUNT_INACTIVE",
              message: "This Super Admin account is inactive."
            });
          }
          const isMatch2 = await bcrypt.compare(password, sa.password_hash);
          if (isMatch2) {
            const branches = await branchManager.listBranches();
            const primaryBranch = branches[0] || { id: 1, branch_code: "BR-01", branch_name: "Saad Communication" };
            const token2 = jwt.sign(
              {
                id: sa.id,
                username: sa.username,
                name: sa.name,
                role: "super_admin",
                isSuperAdmin: true,
                branchId: primaryBranch.id || 1
              },
              process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026",
              { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
            );
            res.cookie("token", token2, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
              maxAge: 30 * 24 * 60 * 60 * 1e3
            });
            return res.json({
              success: true,
              message: "Super Admin login successful",
              data: {
                token: token2,
                branch: primaryBranch,
                user: {
                  id: sa.id,
                  name: sa.name,
                  username: sa.username,
                  email: sa.email,
                  role: "super_admin",
                  isSuperAdmin: true
                }
              }
            });
          }
        }
        const identity = await identityRegistry.resolveIdentityByUsername(cleanUsername);
        if (!identity) {
          return res.status(401).json({
            success: false,
            code: "INVALID_CREDENTIALS",
            message: "Invalid username or password."
          });
        }
        if (identity.ambiguous) {
          console.error(`[Auth Security Alert] Ambiguous identity detected for "${cleanUsername}". Login rejected.`);
          return res.status(409).json({
            success: false,
            code: "IDENTITY_RESOLUTION_REQUIRED",
            message: "Ambiguous user identity detected across branches. Please contact Platform Super Admin."
          });
        }
        const branchId = identity.branch_id;
        const branchMeta = await branchManager.getBranchById(branchId);
        if (!branchMeta || branchMeta.status === "Inactive") {
          return res.status(403).json({
            success: false,
            code: "BRANCH_INACTIVE",
            message: `Branch "${branchMeta?.branch_name || branchId}" is currently inactive. Please contact Platform Super Admin.`
          });
        }
        const branchPool = await branchManager.getBranchPool(branchId, true);
        const userRes = await branchPool.query(
          `SELECT id, name, contact, designation, role, username, password_hash, status 
       FROM users 
       WHERE LOWER(username) = $1 OR (id = $2 AND $2 IS NOT NULL)
       LIMIT 1`,
          [cleanUsername, identity.branch_user_id]
        );
        if (userRes.rows.length === 0) {
          console.warn(`[Auth Inconsistency] Master identity found for ${cleanUsername} in Branch ${branchId} but user not found in branch DB.`);
          return res.status(401).json({
            success: false,
            code: "INVALID_CREDENTIALS",
            message: "Invalid username or password."
          });
        }
        const matchedUser = userRes.rows[0];
        if (matchedUser.status === "Inactive" || identity.status === "Inactive") {
          return res.status(403).json({
            success: false,
            code: "ACCOUNT_INACTIVE",
            message: "Your account is inactive. Please contact an administrator."
          });
        }
        const isMatch = await bcrypt.compare(password, matchedUser.password_hash);
        if (!isMatch) {
          return res.status(401).json({
            success: false,
            code: "INVALID_CREDENTIALS",
            message: "Invalid username or password."
          });
        }
        if (portal && matchedUser.role !== portal) {
          const correctPortal = matchedUser.role === "admin" ? "Admin Portal" : matchedUser.role === "sales" ? "Sales Staff Portal" : "Technician Portal";
          return res.status(400).json({
            success: false,
            code: "PORTAL_MISMATCH",
            message: `This account belongs to ${correctPortal}. Please select the correct portal to login.`
          });
        }
        const token = jwt.sign(
          { id: matchedUser.id, username: matchedUser.username, role: matchedUser.role, branchId },
          process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026",
          { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
        );
        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60 * 1e3
        });
        return res.json({
          success: true,
          message: "Login successful",
          data: {
            token,
            branch: branchMeta,
            user: {
              id: matchedUser.id,
              name: matchedUser.name,
              contact: matchedUser.contact,
              designation: matchedUser.designation,
              role: matchedUser.role,
              username: matchedUser.username,
              branchId
            }
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/logout", (req, res) => {
      res.clearCookie("token");
      return res.json({
        success: true,
        message: "Logged out successfully"
      });
    });
    router.get("/me", async (req, res) => {
      try {
        let token = null;
        if (req.cookies && req.cookies.token) {
          token = req.cookies.token;
        } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
          token = req.headers.authorization.split(" ")[1];
        }
        if (!token) {
          return res.status(401).json({
            success: false,
            code: "NO_TOKEN",
            message: "No authorization token provided",
            data: { user: null }
          });
        }
        let decoded;
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026");
        } catch (jwtErr) {
          return res.status(401).json({
            success: false,
            code: "TOKEN_EXPIRED",
            message: "Token has expired or is invalid",
            data: { user: null }
          });
        }
        const branchManager = require_branchManager();
        const activeBranch = await branchManager.getBranchById(req.branchId || decoded.branchId || 1);
        if (decoded.role === "super_admin") {
          const saRes = await branchManager.masterPool.query(
            "SELECT id, username, name, email, status FROM master_super_admins WHERE id = $1",
            [decoded.id]
          );
          if (saRes.rows.length === 0 || saRes.rows[0].status === "Inactive") {
            return res.status(401).json({
              success: false,
              code: "USER_INACTIVE",
              message: "Account not found or inactive",
              data: { user: null }
            });
          }
          return res.json({
            success: true,
            data: {
              user: {
                ...saRes.rows[0],
                role: "super_admin",
                isSuperAdmin: true
              },
              branch: activeBranch || { id: 1, branch_code: "BR-01", branch_name: "Saad Communication" }
            }
          });
        }
        const userRes = await db.query(
          "SELECT id, name, contact, designation, role, username, status FROM users WHERE id = $1",
          [decoded.id]
        );
        if (userRes.rows.length === 0 || userRes.rows[0].status === "Inactive") {
          return res.status(401).json({
            success: false,
            code: "USER_INACTIVE",
            message: "Account not found or inactive",
            data: { user: null }
          });
        }
        return res.json({
          success: true,
          data: {
            user: userRes.rows[0],
            branch: activeBranch || { id: 1, branch_code: "BR-01", branch_name: "Saad Communication" }
          }
        });
      } catch (error) {
        console.error("[Auth /me error]:", error.message);
        return res.status(500).json({
          success: false,
          code: "SERVER_ERROR",
          message: "Temporary server or database error verifying session"
        });
      }
    });
    module2.exports = router;
  }
});

// src/utils/financialFormulas.js
var require_financialFormulas = __commonJS({
  "src/utils/financialFormulas.js"(exports2, module2) {
    var db = require_db();
    async function getAvailableBalance(method, client = db) {
      if (!["Cash", "Online"].includes(method)) {
        return 0;
      }
      const result2 = await client.query(
        `
    SELECT
      (
        COALESCE(
          (
            SELECT
              CASE
                WHEN $1 = 'Cash'
                  THEN opening_cash
                ELSE opening_online
              END
            FROM business_settings
            WHERE id = 1
          ),
          0
        )

        +

        COALESCE(
          (
            SELECT SUM(
              CASE
                WHEN direction = 'Received'
                  THEN amount

                WHEN direction = 'Paid'
                  THEN -amount

                ELSE 0
              END
            )
            FROM payments
            WHERE payment_method = $1
              AND affects_money = TRUE
          ),
          0
        )

        -

        COALESCE(
          (
            SELECT SUM(amount)
            FROM expenses
            WHERE payment_method = $1
          ),
          0
        )
      ) AS available_balance
    `,
        [method]
      );
      return parseFloat(
        result2.rows[0]?.available_balance || 0
      );
    }
    async function validateOutflow(method, amount, label = "Payment", client = db) {
      const reqAmount = parseFloat(amount || 0);
      if (reqAmount <= 0) {
        return true;
      }
      if (!["Cash", "Online"].includes(method)) {
        return true;
      }
      try {
        const available = await getAvailableBalance(
          method,
          client
        );
        if (reqAmount > available + 5e-3) {
          console.warn(
            `[Financial Outflow Warning] ${label}: ${method} drawer balance is PKR ${available} (required: PKR ${reqAmount}). Outflow recorded; balance will reflect negatively.`
          );
        }
      } catch (err) {
        console.error(
          "Error checking balance:",
          err
        );
      }
      return true;
    }
    module2.exports = {
      getAvailableBalance,
      validateOutflow
    };
  }
});

// src/modules/whatsapp/auth-store.js
var require_auth_store = __commonJS({
  "src/modules/whatsapp/auth-store.js"(exports2, module2) {
    var fs2 = require("node:fs/promises");
    var path2 = require("node:path");
    var { randomUUID } = require("node:crypto");
    var schema = `CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  branch_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (branch_id, key)
)`;
    var fileKey = (key) => key.replace(/\//g, "__").replace(/:/g, "-");
    var leaseSchema = `CREATE TABLE IF NOT EXISTS whatsapp_auth_leases (
  branch_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
)`;
    async function hasSavedSession(pool, branchId) {
      await pool.query(schema);
      const { rows } = await pool.query(
        "SELECT value FROM whatsapp_auth_state WHERE branch_id = $1 AND key = 'creds.json'",
        [branchId]
      );
      if (!rows.length) return null;
      const creds = JSON.parse(rows[0].value);
      return Boolean(creds.me?.id || creds.registered);
    }
    async function openAuthStore(pool, branchId, authDir, baileys, onFailure, force = true) {
      await pool.query(schema);
      await pool.query(leaseSchema);
      const client = await pool.connect();
      const owner = randomUUID();
      let heartbeat;
      let closed = false;
      let queue = Promise.resolve();
      const fail = (error) => {
        if (!closed) onFailure(error);
      };
      client.on("error", fail);
      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        await queue.catch(() => {
        });
        try {
          await client.query("DELETE FROM whatsapp_auth_leases WHERE branch_id = $1 AND owner = $2", [branchId, owner]);
        } finally {
          client.release(true);
        }
      };
      const run = (task) => {
        if (closed) return Promise.reject(new Error("WhatsApp auth store is closed"));
        const result2 = queue.then(async () => {
          await client.query("BEGIN");
          try {
            await client.query(`UPDATE whatsapp_auth_leases SET expires_at = NOW() + INTERVAL '60 seconds'
          WHERE branch_id = $1 AND owner = $2`, [branchId, owner]);
            const value = await task();
            await client.query("COMMIT");
            return value;
          } catch (error) {
            await client.query("ROLLBACK").catch(() => {
            });
            throw error;
          }
        });
        queue = result2.catch(fail);
        return result2;
      };
      const put = (key, value) => client.query(
        `INSERT INTO whatsapp_auth_state (branch_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [branchId, key, value]
      );
      try {
        const lockQuery = force ? `INSERT INTO whatsapp_auth_leases (branch_id, owner, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '60 seconds') ON CONFLICT (branch_id) DO UPDATE
         SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at RETURNING owner` : `INSERT INTO whatsapp_auth_leases (branch_id, owner, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '60 seconds') ON CONFLICT (branch_id) DO UPDATE
         SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
         WHERE whatsapp_auth_leases.expires_at <= NOW() RETURNING owner`;
        const lock = await client.query(lockQuery, [branchId, owner]);
        if (!lock.rows.length) {
          const activeLease = await client.query(`SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW())))) AS seconds
        FROM whatsapp_auth_leases WHERE branch_id = $1`, [branchId]);
          const error = new Error("WhatsApp session is owned by another server instance");
          error.code = "WA_SESSION_BUSY";
          error.retryAfterMs = Math.min(6e4, Math.max(1e3, Number(activeLease.rows[0]?.seconds || 1) * 1e3));
          throw error;
        }
        let { rows } = await client.query(
          "SELECT key, value FROM whatsapp_auth_state WHERE branch_id = $1",
          [branchId]
        );
        if (!rows.length) {
          const files = await fs2.readdir(authDir).catch((error) => {
            if (error.code === "ENOENT") return [];
            throw error;
          });
          await run(async () => {
            for (const file of files.filter((file2) => file2.endsWith(".json"))) {
              const value = await fs2.readFile(path2.join(authDir, file), "utf8");
              JSON.parse(value);
              await put(file, value);
            }
            await put("_migrated", "true");
          });
          ({ rows } = await client.query("SELECT key, value FROM whatsapp_auth_state WHERE branch_id = $1", [branchId]));
        }
        const decode = (value) => JSON.parse(value, baileys.BufferJSON.reviver);
        const encode = (value) => JSON.stringify(value, baileys.BufferJSON.replacer);
        const stored = rows.find((row) => row.key === "creds.json");
        const previous = stored ? decode(stored.value) : null;
        const creds = previous && Object.keys(previous).length ? previous : baileys.initAuthCreds();
        const keyCache = new Map(rows.map((row) => [row.key, row.value]));
        heartbeat = setInterval(() => {
          run(async () => {
          }).catch(() => {
          });
        }, 15e3);
        heartbeat.unref?.();
        return {
          state: {
            creds,
            keys: {
              get: async (type, ids) => {
                await queue;
                if (closed) throw new Error("WhatsApp auth store is closed");
                return Object.fromEntries(ids.map((id) => {
                  const encoded = keyCache.get(fileKey(`${type}-${id}.json`));
                  let value = encoded === void 0 ? void 0 : decode(encoded);
                  if (value && type === "app-state-sync-key") value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
                  return [id, value];
                }));
              },
              set: (data) => {
                const entries = Object.entries(data).flatMap(([type, values]) => Object.entries(values).map(([id, value]) => [fileKey(`${type}-${id}.json`), value == null ? null : encode(value)]));
                return run(async () => {
                  const writes = entries.filter(([, value]) => value !== null);
                  const deletes = entries.filter(([, value]) => value === null).map(([key]) => key);
                  if (writes.length) await client.query(
                    `INSERT INTO whatsapp_auth_state (branch_id, key, value)
                 SELECT $1, item.key, item.value FROM UNNEST($2::text[], $3::text[]) AS item(key, value)
                 ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`,
                    [branchId, writes.map(([key]) => key), writes.map(([, value]) => value)]
                  );
                  if (deletes.length) await client.query(
                    "DELETE FROM whatsapp_auth_state WHERE branch_id = $1 AND key = ANY($2::text[])",
                    [branchId, deletes]
                  );
                }).then(() => {
                  for (const [key, value] of entries) {
                    if (value === null) keyCache.delete(key);
                    else keyCache.set(key, value);
                  }
                });
              }
            }
          },
          saveCreds: () => {
            const value = encode(creds);
            return run(() => put("creds.json", value));
          },
          flush: () => queue,
          clear: () => run(async () => {
            await client.query("DELETE FROM whatsapp_auth_state WHERE branch_id = $1", [branchId]);
            await put("creds.json", "{}");
            await put("_migrated", "true");
          }),
          close
        };
      } catch (error) {
        await close();
        throw error;
      }
    }
    async function releaseLease(pool, branchId) {
      try {
        await pool.query("DELETE FROM whatsapp_auth_leases WHERE branch_id = $1", [branchId]);
      } catch (_) {
      }
    }
    module2.exports = { openAuthStore, hasSavedSession, releaseLease };
  }
});

// src/config/socket.js
var require_socket = __commonJS({
  "src/config/socket.js"(exports2, module2) {
    var { Server } = require("socket.io");
    var jwt = require("jsonwebtoken");
    var { getBranchStore } = require_branchContext();
    var branchManager = require_branchManager();
    var io = null;
    var initSocket2 = (httpServer, corsOrigin) => {
      io = new Server(httpServer, {
        cors: {
          origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin) || /^http:\/\/192\.168\.[0-9]+\.[0-9]+(:[0-9]+)?$/.test(origin);
            const isVercel = /\.vercel\.app$/.test(origin);
            if (isLocal || isVercel || !corsOrigin || corsOrigin === "*" || corsOrigin === origin) {
              return callback(null, true);
            }
            return callback(null, true);
          },
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          credentials: true
        }
      });
      io.use(async (socket, next) => {
        try {
          let token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
          if (token && token.startsWith("Bearer ")) {
            token = token.slice(7);
          }
          if (!token && socket.handshake.headers?.cookie) {
            const match = socket.handshake.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
            if (match) token = match[1];
          }
          if (!token) {
            socket.user = { role: "anon", isAnon: true };
            return next();
          }
          const decoded = jwt.verify(token, process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026");
          if (decoded.role === "super_admin") {
            const saRes = await branchManager.masterPool.query(
              "SELECT id, username, name, status FROM master_super_admins WHERE id = $1 LIMIT 1",
              [decoded.id]
            );
            if (saRes.rows.length === 0 || saRes.rows[0].status === "Inactive") {
              return next(new Error("Super Admin account is inactive or not found."));
            }
            socket.user = {
              ...saRes.rows[0],
              role: "super_admin",
              isSuperAdmin: true
            };
            return next();
          }
          const branchId = parseInt(decoded.branchId, 10) || 1;
          const branch = await branchManager.getBranchById(branchId);
          if (!branch || branch.status === "Inactive") {
            return next(new Error(`Branch ${branchId} is inactive.`));
          }
          socket.user = {
            id: decoded.id,
            username: decoded.username,
            role: decoded.role,
            branchId,
            isSuperAdmin: false
          };
          next();
        } catch (err) {
          socket.user = { role: "anon", isAnon: true };
          next();
        }
      });
      io.on("connection", (socket) => {
        const user = socket.user || { role: "anon" };
        if (user.isSuperAdmin) {
          socket.join("super_admin");
        } else if (user.branchId) {
          socket.join(`branch_${user.branchId}`);
          if (user.role) {
            socket.join(`branch_${user.branchId}_${user.role}`);
          }
        }
        socket.on("join_branch", (data) => {
          if (user.isSuperAdmin && data?.branchId) {
            socket.join(`branch_${parseInt(data.branchId, 10)}`);
          }
        });
        socket.on("disconnect", () => {
        });
      });
      return io;
    };
    var getIO = () => io;
    var emitEvent = (eventName, payload, explicitBranchId = null) => {
      if (!io) return;
      const branchId = explicitBranchId || getBranchStore()?.branchId;
      if (branchId) {
        io.to(`branch_${branchId}`).emit(eventName, payload);
        io.to("super_admin").emit(eventName, { ...payload, _branchId: branchId });
      } else {
        io.to("super_admin").emit(eventName, payload);
      }
    };
    var emitToRole = (role, eventName, payload, explicitBranchId = null) => {
      if (!io) return;
      const branchId = explicitBranchId || getBranchStore()?.branchId;
      if (branchId) {
        io.to(`branch_${branchId}_${role}`).emit(eventName, payload);
        io.to("super_admin").emit(eventName, { ...payload, _branchId: branchId, _role: role });
      } else {
        io.to("super_admin").emit(eventName, { ...payload, _role: role });
      }
    };
    module2.exports = {
      initSocket: initSocket2,
      getIO,
      emitEvent,
      emitToRole
    };
  }
});

// src/utils/codeGenerator.js
var require_codeGenerator = __commonJS({
  "src/utils/codeGenerator.js"(exports2, module2) {
    var db = require_db();
    async function getNextProductCode(categoryId, client = db) {
      let prefix = "PRD";
      if (categoryId) {
        const catRes = await client.query("SELECT code_prefix, name FROM product_categories WHERE id = $1", [categoryId]);
        if (catRes.rows.length > 0) {
          prefix = catRes.rows[0].code_prefix || String(catRes.rows[0].name).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "PRD";
        }
      }
      const res = await client.query(
        `SELECT code FROM products WHERE code ILIKE $1`,
        [`${prefix}-%`]
      );
      let maxNum = 0;
      for (const row of res.rows) {
        const parts = String(row.code).split("-");
        const numPart = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
      let nextNum = maxNum + 1;
      let candidate = `${prefix}-${String(nextNum).padStart(4, "0")}`;
      while (true) {
        const check = await client.query("SELECT 1 FROM products WHERE code = $1", [candidate]);
        if (check.rows.length === 0) break;
        nextNum++;
        candidate = `${prefix}-${String(nextNum).padStart(4, "0")}`;
      }
      return candidate;
    }
    async function getNextInvoiceNo(typeKey, client = db) {
      const map = {
        sale: "SAL",
        vendor_purchase: "VPU",
        customer_purchase: "CPU",
        exchange: "EXC",
        repair: "RPR",
        diagnosis: "DIA"
      };
      const prefix = map[typeKey] || "INV";
      const res = await client.query(
        `SELECT invoice_no FROM invoices WHERE invoice_no ILIKE $1`,
        [`${prefix}-%`]
      );
      let maxNum = 0;
      for (const row of res.rows) {
        const parts = String(row.invoice_no).split("-");
        const numPart = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
      let nextNum = maxNum + 1;
      let candidate = `${prefix}-${String(nextNum).padStart(5, "0")}`;
      while (true) {
        const check = await client.query("SELECT 1 FROM invoices WHERE invoice_no = $1", [candidate]);
        if (check.rows.length === 0) break;
        nextNum++;
        candidate = `${prefix}-${String(nextNum).padStart(5, "0")}`;
      }
      return candidate;
    }
    async function getNextTrackingId(client = db) {
      const branchContext = require_branchContext();
      const store = branchContext.getBranchStore();
      const branchId = store?.branchId || 1;
      const prefix = "RPR";
      const baseOffset = branchId === 2 ? 2e4 : 1e4;
      const res = await client.query(
        `SELECT tracking_id FROM repair_jobs WHERE tracking_id ILIKE 'RPR-%' OR tracking_id ILIKE '%-RPR-%'`
      );
      let maxNum = baseOffset;
      for (const row of res.rows) {
        const parts = String(row.tracking_id).split("-");
        const lastPart = parts[parts.length - 1];
        const numPart = parseInt(lastPart, 10);
        if (!isNaN(numPart) && numPart >= baseOffset && numPart < baseOffset + 1e4 && numPart > maxNum) {
          maxNum = numPart;
        }
      }
      let nextNum = maxNum + 1;
      let candidate = `${prefix}-${nextNum}`;
      while (true) {
        const check = await client.query("SELECT 1 FROM repair_jobs WHERE tracking_id = $1", [candidate]);
        if (check.rows.length === 0) break;
        nextNum++;
        candidate = `${prefix}-${nextNum}`;
      }
      return candidate;
    }
    async function getNextEntityId(table, idColumn, prefix, padLength = 4, client = db) {
      const res = await client.query(
        `SELECT ${idColumn} as entity_id FROM ${table} WHERE ${idColumn} ILIKE $1`,
        [`${prefix}-%`]
      );
      let maxNum = 0;
      for (const row of res.rows) {
        const parts = String(row.entity_id).split("-");
        const numPart = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
      let nextNum = maxNum + 1;
      let candidate = `${prefix}-${String(nextNum).padStart(padLength, "0")}`;
      while (true) {
        const check = await client.query(`SELECT 1 FROM ${table} WHERE ${idColumn} = $1`, [candidate]);
        if (check.rows.length === 0) break;
        nextNum++;
        candidate = `${prefix}-${String(nextNum).padStart(padLength, "0")}`;
      }
      return candidate;
    }
    module2.exports = {
      getNextProductCode,
      getNextInvoiceNo,
      getNextTrackingId,
      getNextEntityId
    };
  }
});

// src/modules/whatsapp/whatsapp.templates.js
var require_whatsapp_templates = __commonJS({
  "src/modules/whatsapp/whatsapp.templates.js"(exports2, module2) {
    function formatMoney(amount) {
      const num = parseFloat(amount || 0);
      return "PKR " + num.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function formatDate(dateVal) {
      if (!dateVal) return null;
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return String(dateVal).trim() || null;
        return d.toISOString().split("T")[0];
      } catch (e) {
        return String(dateVal).trim() || null;
      }
    }
    function formatDevice(job) {
      if (!job) return "Laptop / Device";
      const brand = (job.brand || "").trim();
      const model = (job.model || job.product_name || "").trim();
      const type = (job.product_type || "").trim();
      const serial = (job.serial || "").trim();
      const nameParts = [brand, model].filter(Boolean);
      let devName = nameParts.length > 0 ? nameParts.join(" ") : type || "Laptop / Device";
      if (serial) {
        devName += ` (S/N: ${serial})`;
      }
      return devName;
    }
    function buildIntakeConfirmationTemplate({ job, requestedService = "", isDiagnosis = false }) {
      const trackingId = job.tracking_id || job.id;
      const device = formatDevice(job);
      const status = job.status || (isDiagnosis ? "Diagnosis Received" : "Job Received");
      const expected = formatDate(job.expected_completion) || (job.duration ? String(job.duration).trim() : null);
      const serviceName = requestedService || (isDiagnosis ? "Diagnostic Inspection & Fault Analysis" : job.problem || "Standard Hardware Service");
      const lines = [
        isDiagnosis ? "\u{1F527} *Diagnosis Order Received*" : "\u{1F527} *Repair Order Confirmed*",
        "",
        `\u{1F4CB} *Tracking ID:* ${trackingId}`,
        `\u{1F4F1} *Device:* ${device}`,
        `\u{1F527} *Service:* ${serviceName}`,
        `\u{1F4CB} *Status:* ${status}`
      ];
      if (expected) {
        lines.push(`\u{1F4C5} *Expected:* ${expected}`);
      }
      lines.push("");
      lines.push(`Apne device ka live status jan'ne ke liye kisi bhi waqt *${trackingId}* send karein.`);
      return lines.join("\n");
    }
    function buildTrackingResponseTemplate({ job, safeNote = "" }) {
      const trackingId = job.tracking_id || job.id;
      const device = formatDevice(job);
      const status = job.status || "In Progress";
      const expected = formatDate(job.expected_completion) || "In Progress";
      const total = parseFloat(job.total || 0);
      const paid = parseFloat(job.paid || 0);
      const balance = Math.max(0, total - paid);
      const lines = [
        "\u{1F527} Repair Tracking Status",
        "",
        `\u{1F4CB} Tracking ID: ${trackingId}`,
        `\u{1F4F1} Device: ${device}`,
        `\u{1F4CB} Status: ${status}`,
        `\u{1F4C5} Expected Completion: ${expected}`,
        `\u{1F4B3} Total: ${formatMoney(total)}`,
        `\u{1F4B3} Paid: ${formatMoney(paid)}`,
        `\u{1F4B3} Balance: ${formatMoney(balance)}`
      ];
      const noteToShow = safeNote || job.final_remarks;
      if (noteToShow && String(noteToShow).trim() !== "") {
        lines.push(`\u{1F4CB} Note: ${String(noteToShow).trim()}`);
      }
      if (status === "Waiting for Customer Approval") {
        const quoteAmt = parseFloat(job.quotation_amount || 0);
        lines.push("");
        lines.push("\u2705 Approval Required:");
        if (quoteAmt > 0) {
          lines.push(`\u{1F4B3} Estimated Cost: ${formatMoney(quoteAmt)}`);
        }
        lines.push("Reply 1 or APPROVE to proceed.");
        lines.push("Reply 2 or DECLINE to cancel.");
      }
      return lines.join("\n");
    }
    function buildStatusUpdateTemplate({ job, safeNote = "" }) {
      const trackingId = job.tracking_id || job.id;
      const device = formatDevice(job);
      const status = job.status || "In Progress";
      const expected = formatDate(job.expected_completion);
      const total = parseFloat(job.total || 0);
      const paid = parseFloat(job.paid || 0);
      const balance = Math.max(0, total - paid);
      const lines = [
        "\u{1F4CB} *Repair Status Update*",
        "",
        `\u{1F4CB} *Tracking ID:* ${trackingId}`,
        `\u{1F4F1} *Device:* ${device}`,
        `\u{1F4CB} *Status:* ${status}`
      ];
      if (expected) {
        lines.push(`\u{1F4C5} *Expected Completion:* ${expected}`);
      }
      lines.push(`\u{1F4B3} *Total:* ${formatMoney(total)}`);
      lines.push(`\u{1F4B3} *Paid:* ${formatMoney(paid)}`);
      lines.push(`\u{1F4B3} *Balance:* ${formatMoney(balance)}`);
      const noteToShow = safeNote || job.final_remarks;
      if (noteToShow && String(noteToShow).trim() !== "") {
        lines.push(`\u{1F4CB} *Note:* ${String(noteToShow).trim()}`);
      }
      lines.push("");
      lines.push(`Apne device ka live status jan'ne ke liye kisi bhi waqt *${trackingId}* send karein.`);
      return lines.join("\n");
    }
    function buildQuotationApprovalTemplate(job) {
      const trackingId = job.tracking_id || job.id;
      const quoteAmt = parseFloat(job.quotation_amount || 0);
      const lines = [
        "\u{1F527} *Repair Approval Required*",
        "",
        `*Repair:* ${trackingId}`,
        ""
      ];
      if (job.diagnosed_issue) {
        lines.push(`*Diagnosis:* ${job.diagnosed_issue.trim()}`);
      }
      if (job.recommended_solution) {
        lines.push(`*Recommended Repair:* ${job.recommended_solution.trim()}`);
      }
      lines.push(`*Quoted Amount:* ${formatMoney(quoteAmt)}`);
      if (job.final_remarks && String(job.final_remarks).trim()) {
        lines.push(`*Note:* ${String(job.final_remarks).trim()}`);
      }
      lines.push("");
      lines.push("Reply:");
      lines.push("*1* \u2014 Approve Repair");
      lines.push("*2* \u2014 Decline Repair");
      return lines.join("\n");
    }
    function buildApprovalConfirmationTemplate(job) {
      const trackingId = job.tracking_id || job.id;
      const quoteAmt = parseFloat(job.quotation_amount || 0);
      const lines = [
        "\u2705 *Repair Approved*",
        "",
        `*Repair:* ${trackingId}`,
        "*Status:* Repair Approved"
      ];
      if (job.recommended_solution) {
        lines.push(`*Approved Repair:* ${job.recommended_solution.trim()}`);
      }
      if (quoteAmt > 0) {
        lines.push(`*Quoted Amount:* ${formatMoney(quoteAmt)}`);
      }
      lines.push("");
      lines.push("Our technician has started the repair work. Original quotation is now queued.");
      return lines.join("\n");
    }
    function buildDeclineConfirmationTemplate(job) {
      const trackingId = job.tracking_id || job.id;
      const lines = [
        "\u{1F4CB} *Repair Declined*",
        "",
        `*Repair:* ${trackingId}`,
        "*Status:* Repair Declined",
        "",
        "Repair work has been cancelled. Only diagnostic inspection charges (if applicable) apply."
      ];
      return lines.join("\n");
    }
    function buildPaymentReceiptTemplate({ job, amountPaid = 0, newBalance = 0 }) {
      const trackingId = job.tracking_id || job.id;
      const device = formatDevice(job);
      const total = parseFloat(job.total || 0);
      const lines = [
        "\u{1F4B3} Payment Received",
        "",
        `\u{1F4CB} Tracking ID: ${trackingId}`,
        `\u{1F4F1} Device: ${device}`,
        `\u{1F4B3} Amount Paid: ${formatMoney(amountPaid)}`,
        `\u{1F4B3} Total Bill: ${formatMoney(total)}`,
        `\u{1F4B3} Balance Due: ${formatMoney(newBalance)}`,
        "",
        `Send ${trackingId} anytime for live status.`
      ];
      return lines.join("\n");
    }
    function buildDeliveryClosedTemplate(job) {
      const trackingId = job.tracking_id || job.id;
      const device = formatDevice(job);
      const total = parseFloat(job.total || 0);
      const lines = [
        "\u2705 Device Delivered",
        "",
        `\u{1F4CB} Tracking ID: ${trackingId}`,
        `\u{1F4F1} Device: ${device}`,
        `\u{1F4CB} Status: Delivered & Closed`,
        `\u{1F4B3} Total Paid: ${formatMoney(total)}`,
        `\u{1F4B3} Balance: PKR 0.00`,
        "",
        "Thank you for choosing our service!"
      ];
      return lines.join("\n");
    }
    function buildAdditionalWorkApprovalTemplate({ job, workRequest }) {
      const trackingId = job.tracking_id || job.id;
      const totalAdditionalCost = parseFloat(workRequest.total_quotation || parseFloat(workRequest.service_charge || 0) + parseFloat(workRequest.parts_charge || 0));
      const lines = [
        "\u{1F527} *Additional Repair Approval*",
        "",
        `*Repair:* ${trackingId}`,
        "Our technician found an additional issue:",
        "",
        `*Issue:* ${workRequest.fault_finding || "Additional hardware fault"}`,
        `*Recommended:* ${workRequest.recommended_service || "Component replacement / repair"}`,
        `*Additional Cost:* ${formatMoney(totalAdditionalCost)}`
      ];
      if (workRequest.customer_safe_note && String(workRequest.customer_safe_note).trim()) {
        lines.push(`*Note:* ${String(workRequest.customer_safe_note).trim()}`);
      }
      lines.push("");
      lines.push("Reply:");
      lines.push("*1* \u2014 Approve");
      lines.push("*2* \u2014 Decline");
      return lines.join("\n");
    }
    function buildAdditionalWorkApprovedTemplate({ job, workRequest }) {
      const trackingId = job.tracking_id || job.id;
      const totalAdditionalCost = parseFloat(workRequest.total_quotation || parseFloat(workRequest.service_charge || 0) + parseFloat(workRequest.parts_charge || 0));
      const lines = [
        "\u2705 *Additional Work Approved*",
        "",
        `*Repair:* ${trackingId}`,
        `*Approved Work:* ${workRequest.recommended_service || "Additional Repair Work"}`,
        `*Additional Cost:* ${formatMoney(totalAdditionalCost)}`,
        "",
        "Our technician has queued the additional work. Original and approved repair will proceed."
      ];
      return lines.join("\n");
    }
    function buildAdditionalWorkDeclinedTemplate({ job, workRequest }) {
      const trackingId = job.tracking_id || job.id;
      const lines = [
        "\u{1F4CB} *Additional Work Declined*",
        "",
        `*Repair:* ${trackingId}`,
        `*Declined Work:* ${workRequest.recommended_service || "Additional Repair Work"}`,
        "",
        "No additional charges have been added. Original repair will continue normally."
      ];
      return lines.join("\n");
    }
    module2.exports = {
      formatMoney,
      formatDate,
      formatDevice,
      buildIntakeConfirmationTemplate,
      buildTrackingResponseTemplate,
      buildStatusUpdateTemplate,
      buildQuotationApprovalTemplate,
      buildApprovalConfirmationTemplate,
      buildDeclineConfirmationTemplate,
      buildPaymentReceiptTemplate,
      buildDeliveryClosedTemplate,
      buildAdditionalWorkApprovalTemplate,
      buildAdditionalWorkApprovedTemplate,
      buildAdditionalWorkDeclinedTemplate
    };
  }
});

// src/modules/inventory/inventory.service.js
var require_inventory_service = __commonJS({
  "src/modules/inventory/inventory.service.js"(exports2, module2) {
    var db = require_db();
    var { getNextProductCode, getNextEntityId, getNextInvoiceNo } = require_codeGenerator();
    var { emitEvent } = require_socket();
    function paymentStatus(total, paid) {
      if (paid <= 0) return "Unpaid";
      if (paid >= total) return "Paid";
      return "Partial";
    }
    function buildSpecifications(data) {
      const parts = [];
      if (data.screenSize) parts.push(`Screen/Size: ${data.screenSize}`);
      if (data.processor) parts.push(`Processor: ${data.processor}`);
      if (data.ram) parts.push(`RAM: ${data.ram}`);
      if (data.romSsd) parts.push(`ROM/SSD: ${data.romSsd}`);
      if (data.hardDrive) parts.push(`Hard Drive: ${data.hardDrive}`);
      if (data.graphicsCard) parts.push(`Graphics: ${data.graphicsCard}`);
      if (data.accessoryCategory) parts.push(`Accessory Category: ${data.accessoryCategory}`);
      if (data.description) parts.push(`Description: ${data.description}`);
      if (data.customFields && typeof data.customFields === "object") {
        Object.entries(data.customFields).forEach(([k, v]) => {
          if (v && String(v).trim()) parts.push(`${k}: ${String(v).trim()}`);
        });
      }
      if (data.others) parts.push(`Others: ${data.others}`);
      return parts.join(" | ");
    }
    var InventoryService = class {
      static async getProducts(filters = {}, userRole = "admin") {
        const { search, category, condition, stockStatus, status, inventoryType, inStockOnly, page, limit } = filters;
        let queryText = `
      SELECT 
        p.id, p.code, p.inventory_type, p.category_id, p.category_name, p.brand, p.model,
        p.product_name, p.screen_size, p.processor, p.ram, p.rom_ssd, p.hard_drive,
        p.graphics_card, p.accessory_category, p.description, p.others, p.specifications,
        p.custom_fields,
        p.condition, p.initial_stock, p.stock_in, p.stock_out, p.current_stock, p.low_stock_alert,
        ${userRole === "technician" ? "0.00 as cost_price" : "p.cost_price"},
        p.expected_sale_price, p.remarks, p.source_type, p.source_id, p.source_name,
        p.purchase_invoice_no, p.date_added, p.created_at, p.updated_at
      FROM products p
      WHERE 1=1
    `;
        const params = [];
        if (search && String(search).trim() !== "") {
          params.push(`%${search.trim().toLowerCase()}%`);
          queryText += ` AND (
        LOWER(p.code) LIKE $${params.length} OR
        LOWER(p.brand) LIKE $${params.length} OR
        LOWER(p.model) LIKE $${params.length} OR
        LOWER(COALESCE(p.product_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(p.source_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(p.purchase_invoice_no, '')) LIKE $${params.length} OR
        LOWER(COALESCE(p.specifications, '')) LIKE $${params.length}
      )`;
        }
        if (category) {
          params.push(category);
          queryText += ` AND p.category_name = $${params.length}`;
        }
        if (condition) {
          params.push(condition);
          queryText += ` AND p.condition = $${params.length}`;
        }
        if (inventoryType) {
          params.push(inventoryType);
          queryText += ` AND p.inventory_type = $${params.length}`;
        }
        const activeStockStatus = stockStatus || status;
        if (inStockOnly === true || inStockOnly === "true" || activeStockStatus === "In Stock") {
          queryText += ` AND p.current_stock > 0`;
        } else if (activeStockStatus === "Low Stock") {
          queryText += ` AND p.current_stock > 0 AND p.current_stock <= p.low_stock_alert`;
        } else if (activeStockStatus === "Out of Stock") {
          queryText += ` AND p.current_stock <= 0`;
        }
        queryText += " ORDER BY p.date_added DESC, p.created_at DESC";
        if (limit) {
          const pageNum = parseInt(page || "1", 10);
          const limitNum = parseInt(limit, 10);
          const offset = (pageNum - 1) * limitNum;
          params.push(limitNum);
          queryText += ` LIMIT $${params.length}`;
          params.push(offset);
          queryText += ` OFFSET $${params.length}`;
        }
        const result2 = await db.query(queryText, params);
        return result2.rows.map((row) => ({
          id: row.id,
          code: row.code,
          inventoryType: row.inventory_type,
          categoryId: row.category_id,
          category: row.category_name,
          categoryName: row.category_name,
          brand: row.brand,
          model: row.model,
          productName: row.product_name || row.model,
          screenSize: row.screen_size,
          processor: row.processor,
          ram: row.ram,
          romSsd: row.rom_ssd,
          hardDrive: row.hard_drive,
          graphicsCard: row.graphics_card,
          accessoryCategory: row.accessory_category,
          description: row.description,
          others: row.others,
          specifications: row.specifications,
          condition: row.condition,
          initialStock: parseInt(row.initial_stock || 0, 10),
          stockIn: parseInt(row.stock_in || 0, 10),
          stockOut: parseInt(row.stock_out || 0, 10),
          currentStock: parseInt(row.current_stock || 0, 10),
          lowStockAlert: parseInt(row.low_stock_alert || 1, 10),
          costPrice: parseFloat(row.cost_price || 0),
          expectedSalePrice: parseFloat(row.expected_sale_price || 0),
          remarks: row.remarks,
          sourceType: row.source_type,
          sourceId: row.source_id,
          sourceName: row.source_name,
          vendorId: row.source_id,
          vendorName: row.source_name,
          purchaseInvoiceNo: row.purchase_invoice_no,
          dateAdded: row.date_added,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
      }
      static async getProductById(id, userRole = "admin") {
        const queryText = `
      SELECT 
        p.*,
        ${userRole === "technician" ? "0.00 as cost_price" : "p.cost_price"}
      FROM products p
      WHERE p.id = $1
    `;
        const result2 = await db.query(queryText, [id]);
        if (result2.rows.length === 0) {
          return null;
        }
        const row = result2.rows[0];
        const movementsRes = await db.query(
          `SELECT m.*, u.name as performed_by_name 
       FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.performed_by
       WHERE m.product_id = $1 
       ORDER BY m.date DESC, m.created_at DESC`,
          [id]
        );
        return {
          product: {
            id: row.id,
            code: row.code,
            inventoryType: row.inventory_type,
            categoryId: row.category_id,
            category: row.category_name,
            brand: row.brand,
            model: row.model,
            productName: row.product_name || row.model,
            screenSize: row.screen_size,
            processor: row.processor,
            ram: row.ram,
            romSsd: row.rom_ssd,
            hardDrive: row.hard_drive,
            graphicsCard: row.graphics_card,
            accessoryCategory: row.accessory_category,
            description: row.description,
            others: row.others,
            specifications: row.specifications,
            condition: row.condition,
            initialStock: parseInt(row.initial_stock || 0, 10),
            stockIn: parseInt(row.stock_in || 0, 10),
            stockOut: parseInt(row.stock_out || 0, 10),
            currentStock: parseInt(row.current_stock || 0, 10),
            lowStockAlert: parseInt(row.low_stock_alert || 1, 10),
            costPrice: parseFloat(row.cost_price || 0),
            expectedSalePrice: parseFloat(row.expected_sale_price || 0),
            remarks: row.remarks,
            sourceType: row.source_type,
            sourceId: row.source_id,
            sourceName: row.source_name,
            vendorId: row.source_id,
            vendorName: row.source_name,
            purchaseInvoiceNo: row.purchase_invoice_no,
            dateAdded: row.date_added,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          },
          movements: movementsRes.rows.map((m) => ({
            id: m.id,
            productId: m.product_id,
            productCode: m.product_code,
            direction: m.direction,
            quantity: m.quantity,
            reason: m.reason,
            referenceType: m.reference_type,
            referenceId: m.reference_id,
            performedBy: m.performed_by_name || m.performed_by,
            date: m.date,
            createdAt: m.created_at
          }))
        };
      }
      static async addOrMergeProduct(productData, sourceData, user, client = db) {
        const categoryName = productData.categoryName || productData.category;
        let categoryId = productData.categoryId;
        if (!categoryId) {
          const catRes = await client.query("SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1)", [categoryName]);
          if (catRes.rows.length > 0) {
            categoryId = catRes.rows[0].id;
          } else {
            const insertCat = await client.query("INSERT INTO product_categories (name, code_prefix) VALUES ($1, $2) RETURNING id", [
              categoryName,
              categoryName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "PRD"
            ]);
            categoryId = insertCat.rows[0].id;
          }
        }
        const specifications = productData.specifications || buildSpecifications(productData);
        const quantity = parseInt(productData.quantity || 1, 10);
        const costPrice = parseFloat(productData.costPrice || 0);
        const expectedSalePrice = parseFloat(productData.expectedSalePrice || 0);
        const lowStockAlert = parseInt(productData.lowStockAlert || 1, 10);
        const existingRes = await client.query(
          `SELECT * FROM products 
       WHERE LOWER(category_name) = LOWER($1) 
         AND LOWER(brand) = LOWER($2) 
         AND LOWER(model) = LOWER($3) 
         AND LOWER(COALESCE(specifications, '')) = LOWER($4)
       FOR UPDATE`,
          [categoryName, productData.brand, productData.model, specifications]
        );
        if (existingRes.rows.length > 0) {
          const existing = existingRes.rows[0];
          const updatedStockIn = (parseInt(existing.stock_in, 10) || 0) + quantity;
          const updatedCurrentStock = (parseInt(existing.current_stock, 10) || 0) + quantity;
          const updateRes = await client.query(
            `UPDATE products 
         SET stock_in = $1, current_stock = $2, cost_price = $3, expected_sale_price = $4,
             low_stock_alert = $5, source_id = COALESCE($6, source_id), source_name = COALESCE($7, source_name),
             purchase_invoice_no = COALESCE($8, purchase_invoice_no), updated_at = CURRENT_TIMESTAMP
         WHERE id = $9
         RETURNING *`,
            [
              updatedStockIn,
              updatedCurrentStock,
              costPrice || existing.cost_price,
              expectedSalePrice || existing.expected_sale_price,
              lowStockAlert,
              sourceData.sourceId || existing.source_id,
              sourceData.sourceName || existing.source_name,
              sourceData.invoiceNo || existing.purchase_invoice_no,
              existing.id
            ]
          );
          let validUserId2 = null;
          if (user?.id) {
            const uRes = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uRes.rows.length > 0) validUserId2 = uRes.rows[0].id;
          }
          await client.query(
            `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
         VALUES ($1, $2, 'IN', $3, $4, $5, $6, $7, $8)`,
            [
              existing.id,
              existing.code,
              quantity,
              sourceData.reason || "Stock added to existing product",
              sourceData.refType || "Stock In",
              sourceData.refId || "MANUAL",
              validUserId2,
              sourceData.date || /* @__PURE__ */ new Date()
            ]
          );
          emitEvent("inventory.updated", { productId: existing.id, currentStock: updatedCurrentStock });
          return {
            product: updateRes.rows[0],
            isNew: false
          };
        }
        const code = await getNextProductCode(categoryId, client);
        const productId = await getNextEntityId("products", "id", "PRD", 4, client);
        const customFieldsJson = JSON.stringify(productData.customFields || productData.custom_fields || {});
        const insertRes = await client.query(
          `INSERT INTO products (
        id, code, inventory_type, category_id, category_name, brand, model, product_name,
        screen_size, processor, ram, rom_ssd, hard_drive, graphics_card, accessory_category,
        description, others, specifications, custom_fields, condition, initial_stock, stock_in, stock_out,
        current_stock, low_stock_alert, cost_price, expected_sale_price, remarks, source_type,
        source_id, source_name, purchase_invoice_no, date_added
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19::jsonb, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33
      ) RETURNING *`,
          [
            productId,
            code,
            productData.inventoryType || "Vendor Purchased",
            categoryId,
            categoryName,
            productData.brand || categoryName || "Generic",
            productData.model || productData.productName || categoryName || "Item",
            productData.productName || productData.model || categoryName || "Item",
            productData.screenSize || null,
            productData.processor || null,
            productData.ram || null,
            productData.romSsd || null,
            productData.hardDrive || null,
            productData.graphicsCard || null,
            productData.accessoryCategory || null,
            productData.description || null,
            productData.others || null,
            specifications,
            customFieldsJson,
            productData.condition || "Used",
            quantity,
            // initial_stock
            quantity,
            // stock_in
            0,
            // stock_out
            quantity,
            // current_stock
            lowStockAlert,
            costPrice,
            expectedSalePrice,
            productData.remarks || null,
            sourceData.refType || (sourceData.sourceName && sourceData.sourceName !== "Manual Entry" ? "Vendor Purchase" : "Manual Entry"),
            sourceData.sourceId || sourceData.refId || "MANUAL",
            sourceData.sourceName || null,
            sourceData.invoiceNo || null,
            sourceData.date || /* @__PURE__ */ new Date()
          ]
        );
        let validUserId = null;
        if (user?.id) {
          const uRes = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
          if (uRes.rows.length > 0) validUserId = uRes.rows[0].id;
        }
        await client.query(
          `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
       VALUES ($1, $2, 'IN', $3, $4, $5, $6, $7, $8)`,
          [
            productId,
            code,
            quantity,
            sourceData.reason || "Initial stock added",
            sourceData.refType || "Manual Entry",
            sourceData.refId || "MANUAL",
            validUserId,
            sourceData.date || /* @__PURE__ */ new Date()
          ]
        );
        emitEvent("inventory.product_created", insertRes.rows[0]);
        return {
          product: insertRes.rows[0],
          isNew: true
        };
      }
      static async adjustStock({
        productId,
        direction,
        quantity,
        reason,
        refType,
        refId,
        date,
        user,
        vendorId,
        vendorName,
        vendorContact,
        costPrice,
        purchaseInvoiceNo,
        paid,
        paymentMethod = "Cash",
        referenceId = null
      }, client = db) {
        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty <= 0) {
          const error = new Error("Quantity must be greater than zero.");
          error.status = 400;
          throw error;
        }
        const prodRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [productId]);
        if (prodRes.rows.length === 0) {
          const error = new Error("Product not found.");
          error.status = 404;
          throw error;
        }
        const product = prodRes.rows[0];
        const curStock = parseInt(product.current_stock, 10) || 0;
        if (direction === "OUT" && qty > curStock) {
          const error = new Error(`Insufficient stock. Only ${curStock} item(s) available for ${product.code}.`);
          error.status = 400;
          error.code = "INSUFFICIENT_STOCK";
          throw error;
        }
        let updatedStockIn = parseInt(product.stock_in, 10) || 0;
        let updatedStockOut = parseInt(product.stock_out, 10) || 0;
        let updatedCurrentStock = curStock;
        if (direction === "IN") {
          updatedStockIn += qty;
          updatedCurrentStock += qty;
        } else {
          updatedStockOut += qty;
          updatedCurrentStock -= qty;
        }
        const effectiveCostPrice = costPrice !== void 0 && costPrice !== "" ? parseFloat(costPrice || 0) : parseFloat(product.cost_price || 0);
        const updateRes = await client.query(
          `UPDATE products 
       SET stock_in = $1, stock_out = $2, current_stock = $3,
           cost_price = CASE WHEN $4::numeric > 0 THEN $4 ELSE cost_price END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
          [updatedStockIn, updatedStockOut, updatedCurrentStock, effectiveCostPrice, productId]
        );
        let validUserId = null;
        if (user?.id) {
          const uRes = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
          if (uRes.rows.length > 0) validUserId = uRes.rows[0].id;
        }
        let finalRefType = refType || `Manual ${direction} Adjustment`;
        let finalRefId = refId || "MANUAL";
        const adjDate = date || /* @__PURE__ */ new Date();
        let vId = vendorId;
        let vName = vendorName;
        const hasVendor = vId && vId !== "MANUAL" || vName && vName.trim() !== "" && vName !== "Manual Entry";
        if (direction === "IN" && hasVendor) {
          if (vId && (!vName || vName === "Manual Entry")) {
            const vRes = await client.query("SELECT id, name, contact FROM vendors WHERE id = $1", [vId]);
            if (vRes.rows.length > 0) {
              vName = vRes.rows[0].name;
              if (!vendorContact) vendorContact = vRes.rows[0].contact;
            }
          } else if (vName && (!vId || vId === "MANUAL")) {
            const vRes = await client.query("SELECT id, name, contact FROM vendors WHERE LOWER(name) = LOWER($1)", [vName.trim()]);
            if (vRes.rows.length > 0) {
              vId = vRes.rows[0].id;
              vName = vRes.rows[0].name;
              if (!vendorContact) vendorContact = vRes.rows[0].contact;
            } else {
              vId = await getNextEntityId("vendors", "id", "VND", 4, client);
              await client.query("INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)", [
                vId,
                vName.trim(),
                vendorContact || null
              ]);
            }
          }
          const totalCost = qty * effectiveCostPrice;
          if (totalCost > 0) {
            const paidAmount = paid === void 0 || paid === "" ? totalCost : Math.min(Math.max(0, parseFloat(paid || 0)), totalCost);
            const balance = Math.max(0, totalCost - paidAmount);
            const pStatus = paymentStatus(totalCost, paidAmount);
            let candidateInvNo = purchaseInvoiceNo && purchaseInvoiceNo !== "MANUAL" ? purchaseInvoiceNo : await getNextInvoiceNo("vendor_purchase", client);
            const invExistsCheck = await client.query("SELECT 1 FROM invoices WHERE invoice_no = $1", [candidateInvNo]);
            if (invExistsCheck.rows.length > 0) {
              candidateInvNo = await getNextInvoiceNo("vendor_purchase", client);
            }
            const targetInvoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
            const targetInvoiceNo = candidateInvNo;
            const invRes = await client.query(
              `INSERT INTO invoices (
            id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
            product_total, service_total, total, paid, initial_paid, balance, payment_method,
            reference_id, payment_status, is_voided, created_by, created_by_name
          ) VALUES (
            $1, $2, 'Vendor Purchase', 'vendor_purchase', $3, 'Vendor', $4, $5, $6,
            $7, 0, $7, $8, $8, $9, $10,
            $11, $12, FALSE, $13, $14
          ) RETURNING *`,
              [
                targetInvoiceId,
                targetInvoiceNo,
                adjDate,
                vId,
                vName,
                vendorContact,
                totalCost,
                paidAmount,
                balance,
                paymentMethod,
                referenceId,
                pStatus,
                validUserId,
                user?.name || "Admin"
              ]
            );
            await client.query(
              `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                targetInvoiceId,
                productId,
                product.code,
                `${product.brand} ${product.model}`.trim(),
                `Stock Adjustment (${reason || "Stock Refill"}) \u2014 ${product.category_name} ${product.brand} ${product.model}`,
                qty,
                effectiveCostPrice,
                effectiveCostPrice,
                totalCost
              ]
            );
            if (paidAmount > 0) {
              const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
              await client.query(
                `INSERT INTO payments (
              id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
              direction, amount, date, payment_method, reference_id, notes, affects_money,
              is_initial_settlement, created_by, created_by_name
            ) VALUES (
              $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
              'Paid', $6, $7, $8, $9, $10, TRUE,
              TRUE, $11, $12
            )`,
                [
                  payId,
                  targetInvoiceId,
                  targetInvoiceNo,
                  vId,
                  vName,
                  paidAmount,
                  adjDate,
                  paymentMethod,
                  referenceId,
                  `Stock Adjustment Payment (${product.code})`,
                  validUserId,
                  user?.name || "Admin"
                ]
              );
            }
            if (balance > 0) {
              const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
              await client.query(
                `INSERT INTO accounts (
              id, type, party_type, party_id, party_name, invoice_id, invoice_no,
              amount, remaining, status, date
            ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
                [accId, vId, vName, targetInvoiceId, targetInvoiceNo, balance, balance, adjDate]
              );
            }
            finalRefType = "Vendor Purchase";
            finalRefId = targetInvoiceNo;
            emitEvent("invoice.created", invRes.rows[0]);
          }
        }
        await client.query(
          `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            productId,
            product.code,
            direction,
            qty,
            reason || `Manual ${direction} adjustment`,
            finalRefType,
            finalRefId,
            validUserId,
            adjDate
          ]
        );
        emitEvent("inventory.updated", { productId, currentStock: updatedCurrentStock });
        return {
          product: updateRes.rows[0],
          newStock: updatedCurrentStock,
          invoiceNo: finalRefId !== "MANUAL" ? finalRefId : null
        };
      }
    };
    module2.exports = InventoryService;
  }
});

// src/modules/invoices/invoice-pdf.service.js
var require_invoice_pdf_service = __commonJS({
  "src/modules/invoices/invoice-pdf.service.js"(exports2, module2) {
    var PDFDocument = require("pdfkit");
    var QRCode = require("qrcode");
    var db = require_db();
    var ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    var TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function convertGroup(num) {
      let str = "";
      if (num >= 100) {
        str += ONES[Math.floor(num / 100)] + " Hundred ";
        num %= 100;
      }
      if (num >= 20) {
        const tensPart = TENS[Math.floor(num / 10)];
        const onesPart = ONES[num % 10];
        str += (onesPart ? `${tensPart}-${onesPart}` : tensPart) + " ";
      } else if (num > 0) {
        str += ONES[num] + " ";
      }
      return str.trim();
    }
    function amountInWordsPKR(amount) {
      const num = parseFloat(amount || 0);
      if (isNaN(num) || num === 0) return "Rupees Zero Only.";
      const isNegative = num < 0;
      const absNum = Math.abs(num);
      const integerPart = Math.floor(absNum);
      const decimalPart = Math.round((absNum - integerPart) * 100);
      const billions = Math.floor(integerPart / 1e9);
      const millions = Math.floor(integerPart % 1e9 / 1e6);
      const thousands = Math.floor(integerPart % 1e6 / 1e3);
      const remainder = integerPart % 1e3;
      const parts = [];
      if (billions > 0) parts.push(`${convertGroup(billions)} Billion`);
      if (millions > 0) parts.push(`${convertGroup(millions)} Million`);
      if (thousands > 0) parts.push(`${convertGroup(thousands)} Thousand`);
      if (remainder > 0) parts.push(convertGroup(remainder));
      const words = parts.length > 0 ? parts.join(" ") : "Zero";
      if (decimalPart > 0) {
        return `${isNegative ? "Minus " : ""}Rupees ${words} and ${convertGroup(decimalPart)} Paisas Only.`;
      }
      return `${isNegative ? "Minus " : ""}Rupees ${words} Only.`;
    }
    function numStr(val) {
      const n = parseFloat(val || 0);
      if (isNaN(n)) return "0.00";
      return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtDateDMY(v) {
      if (!v) return "\u2014";
      try {
        const d = new Date(v);
        if (isNaN(d.getTime())) return String(v);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
      } catch (e) {
        return String(v);
      }
    }
    function getDocumentTitle(invoice = {}) {
      const t = String(invoice.type || invoice.typeKey || "").toLowerCase();
      if (invoice.isPaymentReceipt || t.includes("payment receipt") || t === "payment") {
        const isVendor = invoice.partyType === "Vendor" || invoice.direction === "Paid" || String(invoice.accountType || "").includes("Vendor");
        return isVendor ? "VENDOR PAYMENT RECEIPT" : "CUSTOMER PAYMENT RECEIPT";
      }
      if (t.includes("buyback") || t.includes("customer purchase")) return "CUSTOMER BUYBACK RECEIPT";
      if (t.includes("exchange")) return "PRODUCT EXCHANGE INVOICE";
      if (t.includes("vendor return") || t.includes("vendor-return")) return "VENDOR RETURN NOTE";
      if (t.includes("sales return") || t.includes("sale return") || invoice.isVoided) return "SALES RETURN / REFUND RECEIPT";
      if (t.includes("vendor purchase") || t.includes("vendor") || t.includes("purchase")) return "VENDOR PURCHASE INVOICE";
      if (t.includes("diagnosis")) return "DIAGNOSIS & INSPECTION INVOICE";
      if (t.includes("repair")) return "REPAIR SERVICE INVOICE";
      if (t.includes("custom")) return "SALES INVOICE (CUSTOM)";
      const hasTax = parseFloat(invoice.taxAmount || 0) > 0 || !!invoice.fbrInvoiceNo;
      return hasTax ? "SALES TAX INVOICE" : "RETAIL SALES INVOICE";
    }
    async function getBusinessSettings() {
      try {
        const res = await db.query(
          `SELECT company_name, tagline, invoice_subtitle, phone, email, tax_number, ntn, strn, pos_id, fbr_pos_id, address, invoice_footer, logo_data
       FROM business_settings WHERE id = 1`
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (e) {
        console.warn("[InvoicePDF] Could not fetch business_settings:", e.message);
      }
      return {
        company_name: "Saad Communication",
        tagline: "Retail and Repair management system",
        phone: "",
        email: "",
        address: "Karachi, Pakistan",
        ntn: "-",
        strn: "-",
        pos_id: "-"
      };
    }
    async function generateInvoicePdf(invoice) {
      const branding = await getBusinessSettings();
      return new Promise(async (resolve, reject) => {
        try {
          const doc = new PDFDocument({
            size: "A4",
            margin: 30,
            info: {
              Title: `Invoice ${invoice.invoiceNo || invoice.id}`,
              Author: branding.company_name || "Retail & Repair Management",
              Subject: `${getDocumentTitle(invoice)} - ${invoice.invoiceNo || invoice.id}`
            }
          });
          const buffers = [];
          doc.on("data", (chunk) => buffers.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(buffers)));
          doc.on("error", (err) => reject(err));
          const margin = 30;
          const pageWidth = 595.28;
          const contentWidth = pageWidth - margin * 2;
          let curY = margin + 4;
          const companyName = (branding.company_name || "SAAD COMMUNICATION").toUpperCase();
          const companyAddress = branding.address || "Shop #12, Computer Plaza, Main Boulevard Karachi";
          const phone = branding.phone || "";
          const email = branding.email || "";
          const ntn = branding.ntn || branding.tax_number || "-";
          const strn = branding.strn || "-";
          const posId = branding.pos_id || branding.fbr_pos_id || "-";
          let logoBuf = null;
          let hasLogo = false;
          if (branding.logo_data && typeof branding.logo_data === "string" && branding.logo_data.startsWith("data:image")) {
            try {
              const base64Data = branding.logo_data.replace(/^data:image\/\w+;base64,/, "");
              logoBuf = Buffer.from(base64Data, "base64");
              hasLogo = true;
            } catch (logoErr) {
              console.warn("[InvoicePDF] Error parsing logo:", logoErr.message);
            }
          }
          doc.font("Helvetica-Bold").fontSize(16);
          const titleWidth = doc.widthOfString(companyName);
          const logoW = 44;
          const logoH = 34;
          const gap = 12;
          if (hasLogo && logoBuf) {
            const totalHeaderW = logoW + gap + titleWidth;
            const startX = (pageWidth - totalHeaderW) / 2;
            try {
              doc.image(logoBuf, startX, curY - 3, { fit: [logoW, logoH] });
            } catch (imgErr) {
              console.warn("[InvoicePDF] Image rendering skipped:", imgErr.message);
            }
            doc.fillColor("#000000").text(companyName, startX + logoW + gap, curY + 6);
          } else {
            doc.fillColor("#000000").text(companyName, 0, curY + 4, { width: pageWidth, align: "center" });
          }
          curY += 36;
          doc.font("Helvetica").fontSize(8.5).fillColor("#111827");
          doc.text(companyAddress.toUpperCase(), margin, curY, { width: 320, height: 11, lineBreak: false, ellipsis: true });
          curY += 12;
          const contactParts = [];
          if (phone) contactParts.push(`Tel: ${phone}`);
          if (email) contactParts.push(`Email: ${email}`);
          const contactStr = contactParts.join(" | ");
          if (contactStr) {
            doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(contactStr, margin, curY, { width: 320, height: 10, lineBreak: false, ellipsis: true });
          }
          const taxTableY = curY - 14;
          const taxLabelX = margin + 355;
          const taxValX = margin + 415;
          const taxLineW = 118;
          const renderTaxRow = (label, val, y) => {
            doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text(label, taxLabelX, y);
            doc.font("Helvetica").fontSize(8).fillColor("#000000").text(val || "-", taxValX, y, { width: taxLineW, align: "center" });
            doc.moveTo(taxValX - 4, y + 9).lineTo(taxValX + taxLineW, y + 9).lineWidth(0.5).strokeColor("#374151").stroke();
          };
          renderTaxRow("NTN #", ntn, taxTableY);
          renderTaxRow("STRN #", strn, taxTableY + 12);
          renderTaxRow("POS ID #", posId, taxTableY + 24);
          curY += 28;
          doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(1.2).strokeColor("#000000").stroke();
          curY += 8;
          if (invoice.isVoided) {
            doc.rect(margin, curY, contentWidth, 18).fillColor("#fee2e2").fill();
            doc.rect(margin, curY, contentWidth, 18).lineWidth(1).strokeColor("#dc2626").stroke();
            doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#dc2626").text(
              `VOIDED / REFUNDED: ${invoice.voidReason || "Returned"} \xB7 Refund PKR ${numStr(invoice.refundAmount || invoice.total)} via ${invoice.refundMethod || "Return"}`,
              margin,
              curY + 4,
              { width: contentWidth, align: "center" }
            );
            curY += 24;
          }
          const invNo = invoice.invoiceNo || invoice.trackingId || invoice.id || "\u2014";
          const invDate = fmtDateDMY(invoice.date || invoice.createdAt);
          const docTitle = getDocumentTitle(invoice);
          doc.font("Helvetica-Oblique").fontSize(9).fillColor("#111827").text("Invoice No.", margin, curY);
          doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000000").text(invNo, margin + 58, curY);
          doc.font("Helvetica-Oblique").fontSize(9).fillColor("#111827").text("Invoice Date", margin + 155, curY);
          doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000000").text(invDate, margin + 218, curY);
          const titleBoxW = 200;
          const titleBoxH = 19;
          const titleBoxX = margin + contentWidth - titleBoxW;
          doc.rect(titleBoxX, curY - 3, titleBoxW, titleBoxH).lineWidth(1.2).strokeColor("#000000").stroke();
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000").text(docTitle, titleBoxX, curY + 2, { width: titleBoxW, align: "center" });
          curY += 24;
          const boxW = (contentWidth - 10) / 2;
          const isRepairInvoice = !!invoice.repairDetails;
          const boxH = isRepairInvoice ? 84 : 68;
          const leftBoxX = margin;
          const rightBoxX = margin + boxW + 10;
          doc.rect(leftBoxX, curY, boxW, boxH).lineWidth(1.2).strokeColor("#000000").stroke();
          doc.rect(rightBoxX, curY, boxW, boxH).lineWidth(1.2).strokeColor("#000000").stroke();
          const partyName = invoice.partyName || invoice.customerName || invoice.vendorName || "Walk-in Customer";
          const partyAddress = invoice.partyAddress || invoice.address || "\u2014";
          const partyContact = invoice.contact || invoice.phone || "\u2014";
          const stRegNo = invoice.stRegNo || "\u2014";
          const taxId = invoice.partyTaxId || invoice.ntnCnic || invoice.ntn || invoice.ntnTaxId || "\u2014";
          const line1 = { lineBreak: false, ellipsis: true, height: 10 };
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("To: M/s", leftBoxX + 8, curY + 6);
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(partyName, leftBoxX + 64, curY + 6, { width: boxW - 72, ...line1 });
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("Address", leftBoxX + 8, curY + 19);
          doc.font("Helvetica").fontSize(8).fillColor("#000000").text(partyAddress, leftBoxX + 64, curY + 19, { width: boxW - 72, ...line1 });
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("Telephone", leftBoxX + 8, curY + 32);
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(partyContact, leftBoxX + 64, curY + 32, { width: boxW - 72, ...line1 });
          const partyBotY = curY + 48;
          doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#111827").text("ST Reg No", leftBoxX + 8, partyBotY);
          doc.font("Helvetica").fontSize(7.5).fillColor("#000000").text(stRegNo, leftBoxX + 58, partyBotY, { width: 55, ...line1 });
          doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#111827").text("N.T.N / C.N.I.C", leftBoxX + 120, partyBotY);
          doc.font("Helvetica").fontSize(7.5).fillColor("#000000").text(taxId, leftBoxX + 190, partyBotY, { width: boxW - 198, ...line1 });
          if (isRepairInvoice && invoice.repairDetails) {
            const repY = curY + 61;
            doc.moveTo(leftBoxX + 6, repY).lineTo(leftBoxX + boxW - 6, repY).lineWidth(0.5).dash(2, { space: 2 }).strokeColor("#6b7280").stroke();
            doc.undash();
            doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#111827").text("Device:", leftBoxX + 8, repY + 4);
            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000").text(`${invoice.repairDetails.brand || ""} ${invoice.repairDetails.model || ""}`, leftBoxX + 46, repY + 4, { width: boxW - 54, ...line1 });
            if (invoice.repairDetails.problem) {
              doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#dc2626").text("Problem:", leftBoxX + 8, repY + 13);
              doc.font("Helvetica").fontSize(7.5).fillColor("#dc2626").text(invoice.repairDetails.problem, leftBoxX + 46, repY + 13, { width: boxW - 54, ...line1 });
            }
          }
          const paymentMethod = (invoice.paymentMethod || "Cash").toUpperCase();
          const paymentStatus = invoice.isVoided ? "VOIDED / RETURNED" : (invoice.paymentStatus || "PAID").toUpperCase();
          const staff = invoice.createdByName || invoice.createdBy || "Admin";
          const refId = invoice.referenceId || invoice.paymentReference || "";
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("Terms of Payment", rightBoxX + 8, curY + 6);
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(paymentMethod, rightBoxX + 96, curY + 6, { width: boxW - 104, ...line1 });
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("Payment Status", rightBoxX + 8, curY + 19);
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(paymentStatus, rightBoxX + 96, curY + 19, { width: boxW - 104, ...line1 });
          if (refId) {
            doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("Reference / Slip", rightBoxX + 8, curY + 32);
            doc.font("Helvetica").fontSize(8).fillColor("#000000").text(refId, rightBoxX + 96, curY + 32, { width: boxW - 104, ...line1 });
          }
          const rightBotY = curY + (isRepairInvoice ? 64 : 48);
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#111827").text("Sales Person / Tech", rightBoxX + 8, rightBotY);
          doc.font("Helvetica").fontSize(8).fillColor("#000000").text(staff, rightBoxX + 96, rightBotY, { width: boxW - 104, ...line1 });
          curY += boxH + 12;
          const cols = {
            sr: { x: margin, w: 28, align: "center" },
            desc: { x: margin + 30, w: 182, align: "left" },
            code: { x: margin + 214, w: 76, align: "left" },
            qty: { x: margin + 292, w: 42, align: "center" },
            rate: { x: margin + 336, w: 48, align: "right" },
            amount: { x: margin + 386, w: 48, align: "right" },
            disc: { x: margin + 436, w: 40, align: "right" },
            net: { x: margin + 478, w: 57, align: "right" }
          };
          doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(1.2).strokeColor("#000000").stroke();
          curY += 4;
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
          doc.text("S. NO.", cols.sr.x, curY, { width: cols.sr.w, align: cols.sr.align });
          doc.text("DESCRIPTION", cols.desc.x, curY, { width: cols.desc.w, align: cols.desc.align });
          doc.text("H S CODE / CODE", cols.code.x, curY, { width: cols.code.w, align: cols.code.align });
          doc.text("QUANTITY", cols.qty.x, curY, { width: cols.qty.w, align: cols.qty.align });
          doc.text("RATE", cols.rate.x, curY, { width: cols.rate.w, align: cols.rate.align });
          doc.text("AMOUNT", cols.amount.x, curY, { width: cols.amount.w, align: cols.amount.align });
          doc.text("DISCOUNT", cols.disc.x, curY, { width: cols.disc.w, align: cols.disc.align });
          doc.text("NET AMOUNT", cols.net.x, curY, { width: cols.net.w, align: cols.net.align });
          curY += 12;
          doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(1.2).strokeColor("#000000").stroke();
          curY += 6;
          const items = Array.isArray(invoice.items) && invoice.items.length > 0 ? invoice.items : [];
          let totalGross = 0;
          let totalDisc = 0;
          let totalNet = 0;
          if (items.length === 0) {
            const itemTot = parseFloat(invoice.total || 0);
            totalGross = itemTot;
            totalNet = itemTot;
            doc.font("Helvetica").fontSize(8).fillColor("#000000");
            doc.text("1", cols.sr.x, curY, { width: cols.sr.w, align: "center" });
            doc.font("Helvetica-Bold").text(invoice.type || "Standard Invoice Item", cols.desc.x, curY, { width: cols.desc.w });
            doc.font("Helvetica").text("\u2014", cols.code.x, curY, { width: cols.code.w });
            doc.text("1.00", cols.qty.x, curY, { width: cols.qty.w, align: "center" });
            doc.text(numStr(itemTot), cols.rate.x, curY, { width: cols.rate.w, align: "right" });
            doc.text(numStr(itemTot), cols.amount.x, curY, { width: cols.amount.w, align: "right" });
            doc.text("0.00", cols.disc.x, curY, { width: cols.disc.w, align: "right" });
            doc.font("Helvetica-Bold").text(numStr(itemTot), cols.net.x, curY, { width: cols.net.w, align: "right" });
            curY += 22;
          } else {
            items.forEach((item, idx) => {
              const qty = parseFloat(item.quantity || 1);
              const rate = parseFloat(item.rate || item.unitPrice || item.unit_price || item.charges || 0);
              const gross = qty * rate;
              const disc = parseFloat(item.discount || 0);
              const net = parseFloat(item.lineTotal || item.line_total || gross - disc);
              totalGross += gross;
              totalDisc += disc;
              totalNet += net;
              doc.font("Helvetica").fontSize(8).fillColor("#000000");
              doc.text(String(idx + 1), cols.sr.x, curY, { width: cols.sr.w, align: "center" });
              const itemName = item.name || item.description || "Product / Item";
              doc.font("Helvetica-Bold").text(itemName, cols.desc.x, curY, { width: cols.desc.w, height: 10, lineBreak: false, ellipsis: true });
              const hasSubDesc = item.description && item.description !== itemName;
              if (hasSubDesc) {
                doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text(item.description, cols.desc.x, curY + 9, { width: cols.desc.w, height: 9, lineBreak: false, ellipsis: true });
              }
              doc.font("Helvetica").fontSize(8).fillColor("#000000");
              const itemCode = item.hsCode || item.hs_code || item.productCode || item.code || "\u2014";
              doc.text(itemCode, cols.code.x, curY, { width: cols.code.w, height: 10, lineBreak: false, ellipsis: true });
              doc.text(qty.toFixed(2), cols.qty.x, curY, { width: cols.qty.w, align: "center" });
              doc.text(numStr(rate), cols.rate.x, curY, { width: cols.rate.w, align: "right" });
              doc.text(numStr(gross), cols.amount.x, curY, { width: cols.amount.w, align: "right" });
              doc.text(numStr(disc), cols.disc.x, curY, { width: cols.disc.w, align: "right" });
              doc.font("Helvetica-Bold").text(numStr(net), cols.net.x, curY, { width: cols.net.w, align: "right" });
              curY += hasSubDesc ? 22 : 18;
            });
          }
          doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(0.75).strokeColor("#000000").stroke();
          curY += 4;
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000").text("Totals Rs.", margin + 350, curY, { width: 120, align: "right" });
          doc.text(numStr(totalNet || invoice.total), cols.net.x, curY, { width: cols.net.w, align: "right" });
          curY += 12;
          doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(0.6).strokeColor("#000000").stroke();
          doc.moveTo(margin, curY + 2.5).lineTo(margin + contentWidth, curY + 2.5).lineWidth(0.6).strokeColor("#000000").stroke();
          curY += 14;
          const totalAmount = totalNet > 0 ? totalNet : parseFloat(invoice.total || 0);
          const paidAmount = parseFloat(invoice.paid || 0);
          const balanceAmount = Math.max(0, parseFloat(invoice.balance || totalAmount - paidAmount));
          const taxAmount = parseFloat(invoice.taxAmount || invoice.tax_amount || 0);
          const totalExcludingTax = totalGross - totalDisc;
          const leftColW = 280;
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000").text("Amount in Words :", margin, curY);
          doc.font("Helvetica").fontSize(8.5).fillColor("#111827").text(amountInWordsPKR(totalAmount), margin, curY + 12, { width: leftColW, height: 20 });
          if (invoice.remarks) {
            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#374151").text("Remarks:", margin, curY + 36);
            doc.font("Helvetica").fontSize(7.5).fillColor("#4b5563").text(invoice.remarks, margin + 42, curY + 36, { width: leftColW - 42, height: 18 });
          }
          const docVerY = curY + 62;
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text("Document Verification #", margin + 110, docVerY, { width: 160, align: "center" });
          doc.font("Helvetica-Bold").fontSize(9.5).text(invNo, margin + 110, docVerY + 11, { width: 160, align: "center" });
          const sumBoxW = 226;
          const sumBoxX = margin + contentWidth - sumBoxW;
          const hasBalance = balanceAmount > 0;
          const sumBoxH = hasBalance ? 104 : 92;
          doc.rect(sumBoxX, curY, sumBoxW, sumBoxH).lineWidth(1.2).strokeColor("#000000").stroke();
          let sumRowY = curY + 6;
          const sumLblX = sumBoxX + 8;
          const sumValX = sumBoxX + 140;
          const sumValW = 78;
          const renderSumRow = (lbl, val, bold = false, underline = false, color = "#000000") => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor(color).text(lbl, sumLblX, sumRowY);
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor(color).text(numStr(val), sumValX, sumRowY, { width: sumValW, align: "right" });
            sumRowY += 12;
            if (underline) {
              doc.moveTo(sumBoxX, sumRowY - 2).lineTo(sumBoxX + sumBoxW, sumRowY - 2).lineWidth(0.5).strokeColor("#000000").stroke();
            }
          };
          renderSumRow("Gross Amount", totalGross);
          renderSumRow("Discount", totalDisc);
          renderSumRow("Total Excluding Sales Tax Rs.", totalExcludingTax);
          renderSumRow("Sales Tax Rs.", taxAmount, false, true);
          renderSumRow("Total Including Sales Tax Rs.", totalAmount, true);
          renderSumRow("Amount Paid Rs.", paidAmount, true);
          if (hasBalance) {
            renderSumRow("Remaining Balance Rs.", balanceAmount, true, false, "#dc2626");
          }
          try {
            const qrPayload = JSON.stringify({
              inv: invNo,
              dt: invDate,
              tot: totalAmount,
              party: partyName,
              fbr: invoice.fbrInvoiceNo || void 0
            });
            const qrBuf = await QRCode.toBuffer(qrPayload, { margin: 0, width: 80 });
            const qrSize = 54;
            const qrColX = margin + 110;
            const qrColW = 160;
            const qrX = qrColX + (qrColW - qrSize) / 2;
            const qrY = docVerY + 26;
            doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
            doc.font("Helvetica").fontSize(6.5).fillColor("#6b7280").text("Scan to verify", qrColX, qrY + qrSize + 3, { width: qrColW, align: "center" });
          } catch (qrErr) {
            console.warn("[InvoicePDF] QR code error:", qrErr.message);
          }
          doc.end();
        } catch (err) {
          reject(err);
        }
      });
    }
    module2.exports = {
      generateInvoicePdf,
      getBusinessSettings,
      getDocumentTitle,
      amountInWordsPKR
    };
  }
});

// src/modules/invoices/invoices.service.js
var require_invoices_service = __commonJS({
  "src/modules/invoices/invoices.service.js"(exports2, module2) {
    var db = require_db();
    var { getNextInvoiceNo, getNextEntityId } = require_codeGenerator();
    var { validateOutflow } = require_financialFormulas();
    var InventoryService = require_inventory_service();
    var { emitEvent } = require_socket();
    function paymentStatus(total, paid, settled = false) {
      if (settled) return "Settled";
      const t = parseFloat(total || 0);
      const p = parseFloat(paid || 0);
      if (t <= 0 || p >= t) return "Paid";
      if (p > 0) return "Partial";
      return "Unpaid";
    }
    function normalizeInvoiceRow(row) {
      if (!row) return row;
      return {
        ...row,
        invoiceNo: row.invoice_no || row.invoiceNo,
        partyName: row.party_name || row.partyName,
        partyId: row.party_id || row.partyId,
        partyType: row.party_type || row.partyType,
        paymentMethod: row.payment_method || row.paymentMethod,
        paymentStatus: row.payment_status || row.paymentStatus,
        productTotal: row.product_total !== void 0 ? parseFloat(row.product_total) : row.productTotal,
        serviceTotal: row.service_total !== void 0 ? parseFloat(row.service_total) : row.serviceTotal,
        isVoided: row.is_voided !== void 0 ? row.is_voided : row.isVoided,
        referenceId: row.reference_id || row.referenceId,
        repairJobId: row.repair_job_id || row.repairJobId,
        total: row.total !== void 0 ? parseFloat(row.total) : row.total,
        paid: row.paid !== void 0 ? parseFloat(row.paid) : row.paid,
        balance: row.balance !== void 0 ? parseFloat(row.balance) : row.balance
      };
    }
    function getCreator(user) {
      const isSuper = user?.role === "super_admin" || user?.isSuperAdmin;
      return {
        id: isSuper ? null : user?.id || null,
        name: user?.name || (isSuper ? "Platform Super Admin" : user?.username || "Staff")
      };
    }
    var InvoiceService = class {
      /**
       * Complete atomic POS retail sale
       */
      static async createSale(saleData, user) {
        return await db.withTransaction(async (client) => {
          const { customerName, contact, customerId: reqCustId, date, paymentMethod, referenceId, items, paid: reqPaid } = saleData;
          if (!items || !Array.isArray(items) || items.length === 0) {
            const error = new Error("Invoice must contain at least one product line.");
            error.status = 400;
            throw error;
          }
          if (!customerName || String(customerName).trim() === "") {
            const error = new Error("Customer name is required.");
            error.status = 400;
            throw error;
          }
          let customerId = reqCustId;
          const cleanName = customerName.trim();
          const cleanContact = contact ? contact.trim() : null;
          if (!customerId) {
            const custRes = await client.query(
              `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
              [cleanName, cleanContact]
            );
            if (custRes.rows.length > 0) {
              customerId = custRes.rows[0].id;
            } else {
              customerId = await getNextEntityId("customers", "id", "CUS", 4, client);
              await client.query(
                `INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`,
                [customerId, cleanName, cleanContact]
              );
            }
          }
          const invoiceNo = await getNextInvoiceNo("sale", client);
          const invoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
          let productTotal = 0;
          let serviceTotal = 0;
          const processedItems = [];
          for (const item of items) {
            const isService = item.itemType === "service" || item.isService === true;
            const isCustom = item.itemType === "custom_product" || item.isCustom === true || !item.productId && !isService;
            if (isService) {
              const quantity = parseInt(item.quantity || 1, 10);
              const rawPrice = item.salePrice !== void 0 && item.salePrice !== null ? item.salePrice : item.unitPrice || 0;
              const salePrice = parseFloat(rawPrice);
              if (isNaN(salePrice) || salePrice < 0) {
                const error = new Error("Service charge cannot be negative.");
                error.status = 400;
                throw error;
              }
              const lineTotal = quantity * salePrice;
              serviceTotal += lineTotal;
              processedItems.push({
                itemType: "service",
                productId: null,
                code: item.code || "SRV",
                name: item.name ? item.name.trim() : "Service / Software Charge",
                description: item.description ? item.description.trim() : "Service / Software Charge",
                quantity,
                unitPrice: salePrice,
                costPriceSnapshot: 0,
                lineTotal
              });
            } else if (isCustom) {
              const quantity = parseInt(item.quantity || 1, 10);
              if (isNaN(quantity) || quantity <= 0) {
                const error = new Error("Custom item quantity must be greater than 0.");
                error.status = 400;
                throw error;
              }
              const rawSalePrice = item.salePrice !== void 0 && item.salePrice !== null ? item.salePrice : item.unitPrice;
              const salePrice = parseFloat(rawSalePrice || 0);
              if (isNaN(salePrice) || salePrice < 0) {
                const error = new Error("Custom item sale price cannot be negative.");
                error.status = 400;
                throw error;
              }
              const rawCostPrice = item.costPrice !== void 0 && item.costPrice !== null ? item.costPrice : item.purchaseCost !== void 0 ? item.purchaseCost : item.cost_price || 0;
              const costPrice = parseFloat(rawCostPrice || 0);
              if (isNaN(costPrice) || costPrice < 0) {
                const error = new Error("Custom item purchase cost cannot be negative.");
                error.status = 400;
                throw error;
              }
              const lineTotal = quantity * salePrice;
              productTotal += lineTotal;
              processedItems.push({
                itemType: "custom_product",
                productId: null,
                code: item.code || "CUSTOM",
                name: item.name ? item.name.trim() : "Custom Sourced Product",
                description: item.description ? item.description.trim() : "Direct Sourced Custom Item",
                quantity,
                unitPrice: salePrice,
                costPriceSnapshot: costPrice,
                lineTotal
              });
            } else {
              const prodRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [item.productId]);
              if (prodRes.rows.length === 0) {
                const error = new Error("Product not found in inventory.");
                error.status = 404;
                throw error;
              }
              const product = prodRes.rows[0];
              const quantity = parseInt(item.quantity || 1, 10);
              const rawPrice = item.salePrice !== void 0 && item.salePrice !== null && item.salePrice !== "" ? item.salePrice : product.expected_sale_price;
              const salePrice = parseFloat(rawPrice);
              if (isNaN(salePrice) || salePrice < 0) {
                const error = new Error(`Invalid sale price for ${product.code}. Price cannot be negative or blank.`);
                error.status = 400;
                throw error;
              }
              if (quantity <= 0 || quantity > product.current_stock) {
                const error = new Error(`Insufficient stock for ${product.code}. Available: ${product.current_stock}, Requested: ${quantity}`);
                error.status = 400;
                error.code = "INSUFFICIENT_STOCK";
                throw error;
              }
              await InventoryService.adjustStock({
                productId: product.id,
                direction: "OUT",
                quantity,
                reason: `POS Sales Invoice ${invoiceNo}`,
                refType: "Sales Invoice",
                refId: invoiceId,
                date: date || /* @__PURE__ */ new Date(),
                user
              }, client);
              const lineTotal = quantity * salePrice;
              productTotal += lineTotal;
              processedItems.push({
                itemType: "product",
                productId: product.id,
                code: product.code,
                name: `${product.brand} ${product.model || product.product_name || ""}`.trim(),
                description: `${product.category_name} \u2014 ${product.brand} ${product.model} | ${product.specifications || ""}`,
                quantity,
                unitPrice: salePrice,
                costPriceSnapshot: parseFloat(product.cost_price || 0),
                lineTotal
              });
            }
          }
          const total = productTotal + serviceTotal;
          const paid = Math.min(parseFloat(reqPaid || 0), total);
          const balance = Math.max(0, total - paid);
          const payStatus = paymentStatus(total, paid);
          const pMethod = paymentMethod || "Cash";
          if (pMethod === "Online" && paid > 0 && (!referenceId || String(referenceId).trim() === "")) {
            const error = new Error("Online payment reference ID is required.");
            error.status = 400;
            throw error;
          }
          const creator = getCreator(user);
          const invoiceRes = await client.query(
            `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Sales Invoice', 'sale', $3, 'Customer', $4, $5, $6,
          $7, $8, $9, $10, $10, $11, $12,
          $13, $14, FALSE, $15, $16
        ) RETURNING *`,
            [
              invoiceId,
              invoiceNo,
              date || /* @__PURE__ */ new Date(),
              customerId,
              cleanName,
              cleanContact,
              productTotal,
              serviceTotal,
              total,
              paid,
              balance,
              pMethod,
              referenceId ? referenceId.trim() : null,
              payStatus,
              creator.id,
              creator.name
            ]
          );
          for (const pItem of processedItems) {
            await client.query(
              `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                invoiceId,
                pItem.itemType || "product",
                pItem.productId,
                pItem.code,
                pItem.name,
                pItem.description,
                pItem.quantity,
                pItem.unitPrice,
                pItem.costPriceSnapshot,
                pItem.lineTotal
              ]
            );
          }
          if (paid > 0) {
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            await client.query(
              `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
            'Received', $6, $7, $8, $9, 'Initial POS sales payment', TRUE,
            TRUE, $10, $11
          )`,
              [
                payId,
                invoiceId,
                invoiceNo,
                customerId,
                cleanName,
                paid,
                date || /* @__PURE__ */ new Date(),
                pMethod,
                referenceId || null,
                creator.id,
                creator.name
              ]
            );
          }
          if (balance > 0) {
            const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
            await client.query(
              `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Customer Receivable', 'Customer', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
              [accId, customerId, cleanName, invoiceId, invoiceNo, balance, balance, date || /* @__PURE__ */ new Date()]
            );
          }
          emitEvent("invoice.created", invoiceRes.rows[0]);
          return {
            invoice: normalizeInvoiceRow(invoiceRes.rows[0]),
            items: processedItems
          };
        });
        try {
          const InvoiceWhatsAppService = require_invoice_whatsapp_service();
          InvoiceWhatsAppService.sendInvoiceWhatsApp(result.invoice.id).catch((e) => {
            console.error("[createSale] WhatsApp invoice auto-send error:", e.message);
          });
        } catch (waErr) {
          console.error("[createSale] WhatsApp invoice trigger error:", waErr.message);
        }
        return result;
      }
      /**
       * Complete atomic Vendor Purchase
       */
      static async createVendorPurchase(purchaseData, user) {
        return await db.withTransaction(async (client) => {
          const { vendorName, vendorId: reqVndId, date, paymentMethod, referenceId, paid: reqPaid } = purchaseData;
          const lines = Array.isArray(purchaseData.lines) && purchaseData.lines.length > 0 ? purchaseData.lines : purchaseData.product ? [purchaseData.product] : [];
          if (!lines || lines.length === 0) {
            const error = new Error("Purchase must contain at least one product line.");
            error.status = 400;
            throw error;
          }
          if (!vendorName || String(vendorName).trim() === "") {
            const error = new Error("Vendor name is required.");
            error.status = 400;
            throw error;
          }
          let vendorId = reqVndId;
          const cleanName = vendorName.trim();
          const rawContact = purchaseData.vendorContact || purchaseData.contact;
          const cleanContact = rawContact ? String(rawContact).trim() : null;
          if (!vendorId) {
            const vndRes = await client.query(
              `SELECT id FROM vendors WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
              [cleanName, cleanContact]
            );
            if (vndRes.rows.length > 0) {
              vendorId = vndRes.rows[0].id;
            } else {
              vendorId = await getNextEntityId("vendors", "id", "VND", 4, client);
              await client.query(
                `INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)`,
                [vendorId, cleanName, cleanContact]
              );
            }
          }
          const total = lines.reduce((sum, line) => sum + parseInt(line.quantity || 1, 10) * parseFloat(line.costPrice || 0), 0);
          const paid = Math.min(parseFloat(reqPaid || 0), total);
          const balance = Math.max(0, total - paid);
          const pMethod = paymentMethod || "Cash";
          if (paid > 0) {
            await validateOutflow(pMethod, paid, "Vendor Purchase Payment", client);
          }
          const invoiceNo = await getNextInvoiceNo("vendor_purchase", client);
          const invoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
          const payStatus = paymentStatus(total, paid);
          const creator = getCreator(user);
          const invoiceRes = await client.query(
            `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Vendor Purchase', 'vendor_purchase', $3, 'Vendor', $4, $5, $6,
          $7, 0, $8, $9, $10, $11, $12,
          $13, $14, FALSE, $15, $16
        ) RETURNING *`,
            [
              invoiceId,
              invoiceNo,
              date || /* @__PURE__ */ new Date(),
              vendorId,
              cleanName,
              cleanContact,
              total,
              total,
              paid,
              paid,
              balance,
              pMethod,
              referenceId || null,
              payStatus,
              creator.id,
              creator.name
            ]
          );
          const processedItems = [];
          for (const line of lines) {
            const sourceData = {
              inventoryType: "Vendor Purchased",
              sourceName: cleanName,
              invoiceNo,
              date: date || /* @__PURE__ */ new Date(),
              reason: "Vendor Purchase",
              refType: "Vendor Purchase",
              refId: invoiceId
            };
            const mergeResult = await InventoryService.addOrMergeProduct(line, sourceData, user, client);
            const qty = parseInt(line.quantity || 1, 10);
            const costPrice = parseFloat(line.costPrice || 0);
            await client.query(
              `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                invoiceId,
                mergeResult.product.id,
                mergeResult.product.code,
                `${mergeResult.product.brand} ${mergeResult.product.model}`.trim(),
                `${mergeResult.product.category_name} \u2014 ${mergeResult.product.brand} ${mergeResult.product.model}`,
                qty,
                costPrice,
                costPrice,
                qty * costPrice
              ]
            );
            processedItems.push(mergeResult.product);
          }
          if (paid > 0) {
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            await client.query(
              `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
            'Paid', $6, $7, $8, $9, 'Initial vendor purchase payment', TRUE,
            TRUE, $10, $11
          )`,
              [
                payId,
                invoiceId,
                invoiceNo,
                vendorId,
                cleanName,
                paid,
                date || /* @__PURE__ */ new Date(),
                pMethod,
                referenceId || null,
                creator.id,
                creator.name
              ]
            );
          }
          if (balance > 0) {
            const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
            await client.query(
              `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
              [accId, vendorId, cleanName, invoiceId, invoiceNo, balance, balance, date || /* @__PURE__ */ new Date()]
            );
          }
          emitEvent("invoice.created", invoiceRes.rows[0]);
          return {
            invoice: normalizeInvoiceRow(invoiceRes.rows[0]),
            products: processedItems
          };
        });
        try {
          const InvoiceWhatsAppService = require_invoice_whatsapp_service();
          InvoiceWhatsAppService.sendInvoiceWhatsApp(result.invoice.id).catch((e) => {
            console.error("[createVendorPurchase] WhatsApp invoice auto-send error:", e.message);
          });
        } catch (waErr) {
          console.error("[createVendorPurchase] WhatsApp invoice trigger error:", waErr.message);
        }
        return result;
      }
      /**
       * Complete atomic Customer Purchase (Trade-in buyback)
       */
      static async createCustomerPurchase(purchaseData, user) {
        return await db.withTransaction(async (client) => {
          const { customerName, customerId: reqCustId, date, paymentMethod, referenceId, paid: reqPaid } = purchaseData;
          const lines = Array.isArray(purchaseData.lines) && purchaseData.lines.length > 0 ? purchaseData.lines : purchaseData.product ? [purchaseData.product] : [];
          if (!lines || lines.length === 0) {
            const error = new Error("Purchase must contain at least one product line.");
            error.status = 400;
            throw error;
          }
          if (!customerName || String(customerName).trim() === "") {
            const error = new Error("Customer name is required.");
            error.status = 400;
            throw error;
          }
          let customerId = reqCustId;
          const cleanName = customerName.trim();
          const rawContact = purchaseData.customerContact || purchaseData.contact;
          const cleanContact = rawContact ? String(rawContact).trim() : null;
          if (!customerId) {
            const custRes = await client.query(
              `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
              [cleanName, cleanContact]
            );
            if (custRes.rows.length > 0) {
              customerId = custRes.rows[0].id;
            } else {
              customerId = await getNextEntityId("customers", "id", "CUS", 4, client);
              await client.query(
                `INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`,
                [customerId, cleanName, cleanContact]
              );
            }
          }
          const total = lines.reduce((sum, line) => sum + parseInt(line.quantity || 1, 10) * parseFloat(line.costPrice || 0), 0);
          const paid = Math.min(parseFloat(reqPaid || 0), total);
          const balance = Math.max(0, total - paid);
          const pMethod = paymentMethod || "Cash";
          if (paid > 0) {
            await validateOutflow(pMethod, paid, "Customer Purchase Payment", client);
          }
          const invoiceNo = await getNextInvoiceNo("customer_purchase", client);
          const invoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
          const payStatus = paymentStatus(total, paid);
          const invoiceRes = await client.query(
            `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Customer Purchase', 'customer_purchase', $3, 'Customer', $4, $5, $6,
          $7, 0, $8, $9, $10, $11, $12,
          $13, $14, FALSE, $15, $16
        ) RETURNING *`,
            [
              invoiceId,
              invoiceNo,
              date || /* @__PURE__ */ new Date(),
              customerId,
              cleanName,
              cleanContact,
              total,
              total,
              paid,
              paid,
              balance,
              pMethod,
              referenceId || null,
              payStatus,
              user.id,
              user.name
            ]
          );
          const processedItems = [];
          for (const line of lines) {
            const sourceData = {
              inventoryType: "Customer Purchased",
              sourceName: cleanName,
              invoiceNo,
              date: date || /* @__PURE__ */ new Date(),
              reason: "Customer Purchase",
              refType: "Customer Purchase",
              refId: invoiceId
            };
            const mergeResult = await InventoryService.addOrMergeProduct(line, sourceData, user, client);
            const qty = parseInt(line.quantity || 1, 10);
            const costPrice = parseFloat(line.costPrice || 0);
            await client.query(
              `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                invoiceId,
                mergeResult.product.id,
                mergeResult.product.code,
                `${mergeResult.product.brand} ${mergeResult.product.model}`.trim(),
                `${mergeResult.product.category_name} \u2014 ${mergeResult.product.brand} ${mergeResult.product.model}`,
                qty,
                costPrice,
                costPrice,
                qty * costPrice
              ]
            );
            processedItems.push(mergeResult.product);
          }
          if (paid > 0) {
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            await client.query(
              `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Payable',
            'Paid', $6, $7, $8, $9, 'Initial customer purchase payment', TRUE,
            TRUE, $10, $11
          )`,
              [
                payId,
                invoiceId,
                invoiceNo,
                customerId,
                cleanName,
                paid,
                date || /* @__PURE__ */ new Date(),
                pMethod,
                referenceId || null,
                user.id,
                user.name
              ]
            );
          }
          if (balance > 0) {
            const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
            await client.query(
              `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Customer Payable', 'Customer', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
              [accId, customerId, cleanName, invoiceId, invoiceNo, balance, balance, date || /* @__PURE__ */ new Date()]
            );
          }
          emitEvent("invoice.created", invoiceRes.rows[0]);
          return {
            invoice: normalizeInvoiceRow(invoiceRes.rows[0]),
            products: processedItems
          };
        });
        try {
          const InvoiceWhatsAppService = require_invoice_whatsapp_service();
          InvoiceWhatsAppService.sendInvoiceWhatsApp(result.invoice.id).catch((e) => {
            console.error("[createCustomerPurchase] WhatsApp invoice auto-send error:", e.message);
          });
        } catch (waErr) {
          console.error("[createCustomerPurchase] WhatsApp invoice trigger error:", waErr.message);
        }
        return result;
      }
      /**
       * Complete atomic 1-to-1 Product Exchange
       */
      static async createExchange(exchangeData, user) {
        return await db.withTransaction(async (client) => {
          const { customerName, contact, customerId: reqCustId, date, paymentMethod, referenceId } = exchangeData;
          const shopProductId = exchangeData.shopProductId || exchangeData.outProductId;
          const receivedProduct = exchangeData.receivedProduct || exchangeData.inProduct;
          if (!customerName || String(customerName).trim() === "") {
            const error = new Error("Customer name is required.");
            error.status = 400;
            throw error;
          }
          if (!shopProductId) {
            const error = new Error("Please select a shop product for exchange.");
            error.status = 400;
            throw error;
          }
          if (!receivedProduct) {
            const error = new Error("Customer trade-in product details are required.");
            error.status = 400;
            throw error;
          }
          const shopProdRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [shopProductId]);
          if (shopProdRes.rows.length === 0) {
            const error = new Error("Shop product not found.");
            error.status = 404;
            throw error;
          }
          const shopProduct = shopProdRes.rows[0];
          if (shopProduct.current_stock < 1) {
            const error = new Error(`Shop product ${shopProduct.code} is out of stock.`);
            error.status = 400;
            error.code = "INSUFFICIENT_STOCK";
            throw error;
          }
          let customerId = reqCustId;
          const cleanName = customerName.trim();
          const rawContact = contact || exchangeData.customerContact;
          const cleanContact = rawContact ? String(rawContact).trim() : null;
          if (!customerId) {
            const custRes = await client.query(
              `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
              [cleanName, cleanContact]
            );
            if (custRes.rows.length > 0) {
              customerId = custRes.rows[0].id;
            } else {
              customerId = await getNextEntityId("customers", "id", "CUS", 4, client);
              await client.query(`INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`, [customerId, cleanName, cleanContact]);
            }
          }
          const sVal = parseFloat(exchangeData.shopValue || exchangeData.outSaleValue || shopProduct.expected_sale_price || shopProduct.cost_price || 0);
          const cVal = parseFloat(exchangeData.customerValue || exchangeData.inValue || receivedProduct.costPrice || 0);
          let exchangeCase = exchangeData.exchangeCase;
          const diff = sVal - cVal;
          if (!exchangeCase) {
            if (diff > 5e-3) exchangeCase = "Customer Pays Shop";
            else if (diff < -5e-3) exchangeCase = "Shop Pays Customer";
            else exchangeCase = "Even Exchange";
          }
          let difference = 0;
          if (exchangeCase === "Customer Pays Shop") difference = Math.max(0, sVal - cVal);
          else if (exchangeCase === "Shop Pays Customer") difference = Math.max(0, cVal - sVal);
          else difference = 0;
          const reqPaid = exchangeData.paid !== void 0 ? exchangeData.paid : difference;
          const paid = Math.min(parseFloat(reqPaid || 0), difference);
          const balance = Math.max(0, difference - paid);
          const pMethod = paymentMethod || "Cash";
          if (exchangeCase === "Shop Pays Customer" && paid > 0) {
            await validateOutflow(pMethod, paid, "Exchange Payment to Customer", client);
          }
          const invoiceNo = await getNextInvoiceNo("exchange", client);
          const invoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
          const payStatus = paymentStatus(difference, paid, exchangeCase === "Even Exchange");
          await InventoryService.adjustStock({
            productId: shopProduct.id,
            direction: "OUT",
            quantity: 1,
            reason: `Product given in exchange ${invoiceNo}`,
            refType: "Exchange Invoice",
            refId: invoiceId,
            date: date || /* @__PURE__ */ new Date(),
            user
          }, client);
          const sourceData = {
            inventoryType: "Customer Purchased",
            sourceName: cleanName,
            invoiceNo,
            date: date || /* @__PURE__ */ new Date(),
            reason: "Customer exchange item received",
            refType: "Exchange Invoice",
            refId: invoiceId
          };
          const recResult = await InventoryService.addOrMergeProduct(receivedProduct, sourceData, user, client);
          const invoiceRes = await client.query(
            `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          exchange_case, product_total, service_total, total, paid, initial_paid, balance,
          payment_method, reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Exchange Invoice', 'exchange', $3, 'Customer', $4, $5, $6,
          $7, $8, 0, $9, $10, $11, $12,
          $13, $14, $15, FALSE, $16, $17
        ) RETURNING *`,
            [
              invoiceId,
              invoiceNo,
              date || /* @__PURE__ */ new Date(),
              customerId,
              cleanName,
              cleanContact,
              exchangeCase,
              difference,
              difference,
              paid,
              paid,
              balance,
              pMethod,
              referenceId || null,
              payStatus,
              user.id,
              user.name
            ]
          );
          await client.query(
            `INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'product', $2, $3, $4, $5, 1, $6, $7, $8)`,
            [
              invoiceId,
              shopProduct.id,
              shopProduct.code,
              `${shopProduct.brand} ${shopProduct.model}`.trim(),
              `Shop product given: ${shopProduct.category_name} \u2014 ${shopProduct.brand} ${shopProduct.model}`,
              sVal,
              parseFloat(shopProduct.cost_price || 0),
              sVal
            ]
          );
          await client.query(
            `INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'product', $2, $3, $4, $5, 1, $6, $7, $8)`,
            [
              invoiceId,
              recResult.product.id,
              recResult.product.code,
              `${recResult.product.brand} ${recResult.product.model}`.trim(),
              `Customer product received: ${recResult.product.category_name} \u2014 ${recResult.product.brand} ${recResult.product.model}`,
              cVal,
              parseFloat(recResult.product.cost_price || 0),
              cVal
            ]
          );
          if (paid > 0) {
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            const direction = exchangeCase === "Customer Pays Shop" ? "Received" : "Paid";
            const accountType = exchangeCase === "Customer Pays Shop" ? "Customer Receivable" : "Customer Payable";
            await client.query(
              `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, $6,
            $7, $8, $9, $10, $11, 'Initial exchange settlement', TRUE,
            TRUE, $12, $13
          )`,
              [
                payId,
                invoiceId,
                invoiceNo,
                customerId,
                cleanName,
                accountType,
                direction,
                paid,
                date || /* @__PURE__ */ new Date(),
                pMethod,
                referenceId || null,
                user.id,
                user.name
              ]
            );
          }
          if (balance > 0) {
            const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
            const accType = exchangeCase === "Customer Pays Shop" ? "Customer Receivable" : "Customer Payable";
            await client.query(
              `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, $2, 'Customer', $3, $4, $5, $6, $7, $8, 'Open', $9)`,
              [accId, accType, customerId, cleanName, invoiceId, invoiceNo, balance, balance, date || /* @__PURE__ */ new Date()]
            );
          }
          emitEvent("invoice.created", invoiceRes.rows[0]);
          return {
            invoice: normalizeInvoiceRow(invoiceRes.rows[0]),
            shopProduct,
            receivedProduct: recResult.product
          };
        });
        try {
          const InvoiceWhatsAppService = require_invoice_whatsapp_service();
          InvoiceWhatsAppService.sendInvoiceWhatsApp(result.invoice.id).catch((e) => {
            console.error("[createExchange] WhatsApp invoice auto-send error:", e.message);
          });
        } catch (waErr) {
          console.error("[createExchange] WhatsApp invoice trigger error:", waErr.message);
        }
        return result;
      }
      /**
       * Void sales invoice & restore stock
       */
      static async voidSale(id, voidData, user) {
        return await db.withTransaction(async (client) => {
          const invRes = await client.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [id]);
          if (invRes.rows.length === 0) {
            const error = new Error("Invoice not found.");
            error.status = 404;
            throw error;
          }
          const invoice = invRes.rows[0];
          if (invoice.is_voided) {
            const error = new Error("This invoice is already voided.");
            error.status = 400;
            throw error;
          }
          const { reason, refundAmount: reqRefund, refundMethod, referenceId, date } = voidData;
          if (!reason || String(reason).trim() === "") {
            const error = new Error("Void reason is required.");
            error.status = 400;
            throw error;
          }
          const refundAmount = Math.min(parseFloat(reqRefund !== void 0 ? reqRefund : invoice.paid), parseFloat(invoice.paid || 0));
          const rMethod = refundMethod || "Cash";
          const invType = invoice.type || invoice.type_key;
          if (invType === "Customer Purchase") {
            const itemsRes = await client.query("SELECT * FROM invoice_items WHERE invoice_id = $1", [id]);
            for (const item of itemsRes.rows) {
              if (item.product_id && item.quantity > 0) {
                await InventoryService.adjustStock({
                  productId: item.product_id,
                  direction: "OUT",
                  quantity: item.quantity,
                  reason: `Customer Buyback void / return: ${invoice.invoice_no}`,
                  refType: "Customer Purchase Void",
                  refId: invoice.id,
                  date: date || /* @__PURE__ */ new Date(),
                  user
                }, client);
              }
            }
            if (refundAmount > 0) {
              const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
              await client.query(
                `INSERT INTO payments (
              id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
              direction, amount, date, payment_method, reference_id, notes, affects_money,
              is_initial_settlement, created_by, created_by_name
            ) VALUES (
              $1, $2, $3, 'Customer', $4, $5, 'Customer Refund',
              'Received', $6, $7, $8, $9, $10, TRUE, FALSE, $11, $12
            )`,
                [
                  payId,
                  invoice.id,
                  invoice.invoice_no,
                  invoice.party_id,
                  invoice.party_name,
                  refundAmount,
                  date || /* @__PURE__ */ new Date(),
                  rMethod,
                  referenceId ? referenceId.trim() : null,
                  `Customer Buyback Reversal / Void: ${reason.trim()}`,
                  user.id,
                  user.name
                ]
              );
            }
          } else if (invType === "Exchange Invoice" || invType === "Product Exchange") {
            const itemsRes = await client.query("SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC", [id]);
            if (itemsRes.rows.length >= 2) {
              const shopItem = itemsRes.rows[0];
              const custItem = itemsRes.rows[1];
              if (shopItem.product_id) {
                await InventoryService.adjustStock({
                  productId: shopItem.product_id,
                  direction: "IN",
                  quantity: shopItem.quantity || 1,
                  reason: `Exchange void / reversal: ${invoice.invoice_no}`,
                  refType: "Exchange Void",
                  refId: invoice.id,
                  date: date || /* @__PURE__ */ new Date(),
                  user
                }, client);
              }
              if (custItem.product_id) {
                await InventoryService.adjustStock({
                  productId: custItem.product_id,
                  direction: "OUT",
                  quantity: custItem.quantity || 1,
                  reason: `Exchange void / reversal: ${invoice.invoice_no}`,
                  refType: "Exchange Void",
                  refId: invoice.id,
                  date: date || /* @__PURE__ */ new Date(),
                  user
                }, client);
              }
            }
          } else {
            const itemsRes = await client.query("SELECT * FROM invoice_items WHERE invoice_id = $1", [id]);
            for (const item of itemsRes.rows) {
              if (item.product_id && item.quantity > 0) {
                await InventoryService.adjustStock({
                  productId: item.product_id,
                  direction: "IN",
                  quantity: item.quantity,
                  reason: `Sales return / invoice void: ${invoice.invoice_no}`,
                  refType: "Sales Void",
                  refId: invoice.id,
                  date: date || /* @__PURE__ */ new Date(),
                  user
                }, client);
              }
            }
            await client.query(
              `UPDATE accounts SET status = 'Cancelled', remaining = 0 WHERE invoice_id = $1 AND status = 'Open'`,
              [id]
            );
            if (refundAmount > 0) {
              const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
              await client.query(
                `INSERT INTO payments (
              id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
              direction, amount, date, payment_method, reference_id, notes, affects_money,
              is_initial_settlement, created_by, created_by_name
            ) VALUES (
              $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
              'Paid', $6, $7, $8, $9, $10, TRUE, FALSE, $11, $12
            )`,
                [
                  payId,
                  invoice.id,
                  invoice.invoice_no,
                  invoice.party_id,
                  invoice.party_name,
                  refundAmount,
                  date || /* @__PURE__ */ new Date(),
                  rMethod,
                  referenceId ? referenceId.trim() : null,
                  `Sales Void Refund: ${reason.trim()}`,
                  user.id,
                  user.name
                ]
              );
            }
          }
          const updateRes = await client.query(
            `UPDATE invoices SET
          is_voided = TRUE,
          payment_status = 'Voided',
          balance = 0,
          void_date = $1,
          void_reason = $2,
          refund_amount = $3,
          refund_method = $4,
          refund_reference = $5,
          voided_by = $6,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
            [
              date || /* @__PURE__ */ new Date(),
              reason.trim(),
              refundAmount,
              rMethod,
              referenceId ? referenceId.trim() : null,
              user.id,
              id
            ]
          );
          emitEvent("invoice.voided", updateRes.rows[0]);
          return updateRes.rows[0];
        });
      }
      /**
       * Complete atomic Vendor Return with multi-mode settlement
       */
      static async createVendorReturn(returnData, user) {
        return await db.withTransaction(async (client) => {
          const {
            vendorId: reqVndId,
            vendorName: reqVndName,
            productId,
            quantity: reqQty,
            amount: reqAmount,
            unitRate,
            receivedNow: reqReceived,
            initialSettlement: reqSettled,
            paymentMethod,
            settlementMethod,
            referenceId,
            reason,
            date,
            replacementMode,
            sameReplacementQty,
            replacementProductData
          } = returnData;
          const qty = parseInt(reqQty || 1, 10);
          const rate = parseFloat(unitRate || 0);
          const amount = parseFloat(reqAmount || qty * rate || 0);
          const method = settlementMethod || paymentMethod || "Vendor Payable Adjustment";
          if (qty <= 0 || amount <= 0) {
            const error = new Error("Return quantity and amount must be greater than zero.");
            error.status = 400;
            throw error;
          }
          const prodRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [productId]);
          if (prodRes.rows.length === 0) {
            const error = new Error("Returned product not found.");
            error.status = 404;
            throw error;
          }
          const product = prodRes.rows[0];
          if (qty > product.current_stock) {
            const error = new Error(`Only ${product.current_stock} unit(s) available in stock to return.`);
            error.status = 400;
            error.code = "INSUFFICIENT_STOCK";
            throw error;
          }
          let vendor = null;
          let vendorId = reqVndId || returnData.vendor_id;
          const vendorName = reqVndName || returnData.vendor_name || product.source_name;
          if (vendorId) {
            const vndRes = await client.query("SELECT id, name FROM vendors WHERE id = $1", [vendorId]);
            if (vndRes.rows.length > 0) vendor = vndRes.rows[0];
          }
          if (!vendor && vendorName && String(vendorName).trim() !== "" && String(vendorName).trim() !== "Manual Entry") {
            const vndRes = await client.query("SELECT id, name FROM vendors WHERE LOWER(name) = LOWER($1)", [String(vendorName).trim()]);
            if (vndRes.rows.length > 0) {
              vendor = vndRes.rows[0];
              vendorId = vendor.id;
            } else {
              vendorId = await getNextEntityId("vendors", "id", "VND", 4, client);
              await client.query("INSERT INTO vendors (id, name) VALUES ($1, $2)", [vendorId, String(vendorName).trim()]);
              vendor = { id: vendorId, name: String(vendorName).trim() };
            }
          }
          if (!vendor) {
            const error = new Error("Vendor information is required for return.");
            error.status = 400;
            throw error;
          }
          const returnId = await getNextEntityId("vendor_returns", "id", "VRT", 4, client);
          await InventoryService.adjustStock({
            productId: product.id,
            direction: "OUT",
            quantity: qty,
            reason: `Vendor Return ${returnId}`,
            refType: "Vendor Return",
            refId: returnId,
            date: date || /* @__PURE__ */ new Date(),
            user
          }, client);
          let initialSettlement = parseFloat(reqReceived || 0);
          let actualMoneyReceived = 0;
          let exchangeValue = 0;
          let payableAdjustment = 0;
          let repProduct = null;
          let repQty = 0;
          if (method === "Cash" || method === "Online") {
            actualMoneyReceived = initialSettlement;
          } else if (method === "Exchange Credit" || method === "Exchange" || method === "Product Replacement / Exchange") {
            if (replacementMode === "same") {
              repQty = qty;
              await InventoryService.adjustStock({
                productId: product.id,
                direction: "IN",
                quantity: repQty,
                reason: `Same product replacement received from vendor (${returnId})`,
                refType: "Vendor Return Replacement",
                refId: returnId,
                date: date || /* @__PURE__ */ new Date(),
                user
              }, client);
              repProduct = product;
              exchangeValue = amount;
              initialSettlement = amount;
            } else if (replacementMode === "different" && replacementProductData) {
              repQty = parseInt(replacementProductData.quantity || 1, 10);
              if (replacementProductData.id) {
                await InventoryService.adjustStock({
                  productId: replacementProductData.id,
                  direction: "IN",
                  quantity: repQty,
                  reason: `Different product replacement received in vendor exchange (${returnId})`,
                  refType: "Vendor Return Replacement",
                  refId: returnId,
                  date: date || /* @__PURE__ */ new Date(),
                  user
                }, client);
                const getP = await client.query("SELECT * FROM products WHERE id = $1", [replacementProductData.id]);
                repProduct = getP.rows[0];
              } else {
                const sourceData = {
                  inventoryType: "Vendor Purchased",
                  sourceName: vendor.name,
                  invoiceNo: returnId,
                  date: date || /* @__PURE__ */ new Date(),
                  reason: "Different product replacement received in vendor exchange",
                  refType: "Vendor Return",
                  refId: returnId
                };
                const repRes = await InventoryService.addOrMergeProduct(replacementProductData, sourceData, user, client);
                repProduct = repRes.product;
              }
              const repRate = parseFloat(replacementProductData.costPrice || replacementProductData.cost_price || repProduct?.cost_price || rate);
              const repTotal = repQty * repRate;
              exchangeValue = repTotal;
              initialSettlement = Math.min(amount, repTotal);
              const priceDiff = repTotal - amount;
              if (priceDiff > 5e-3) {
                const diffMethod = returnData.diffPaymentMethod || "Cash";
                if (diffMethod === "Cash" || diffMethod === "Online") {
                  const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
                  await client.query(`
                INSERT INTO payments (
                  id, account_id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
                  direction, amount, date, payment_method, reference_id, notes, affects_money,
                  is_initial_settlement, created_by, created_by_name
                ) VALUES (
                  $1, NULL, NULL, $2, 'Vendor', $3, $4, 'Vendor Payable',
                  'Paid', $5, $6, $7, $8, $9, TRUE, TRUE, $10, $11
                )
              `, [
                    payId,
                    returnId,
                    vendor.id,
                    vendor.name,
                    priceDiff,
                    date || /* @__PURE__ */ new Date(),
                    diffMethod,
                    referenceId || null,
                    `Upgrade difference paid to vendor for replacement (${repProduct?.code || ""})`,
                    user.id,
                    user.name
                  ]);
                } else {
                  const accId2 = await getNextEntityId("accounts", "id", "ACC", 4, client);
                  await client.query(`
                INSERT INTO accounts (
                  id, type, party_type, party_id, party_name, invoice_id, invoice_no,
                  amount, remaining, status, date
                ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, NULL, $4, $5, $6, 'Open', $7)
              `, [accId2, vendor.id, vendor.name, returnId, priceDiff, priceDiff, date || /* @__PURE__ */ new Date()]);
                }
              }
            } else {
              exchangeValue = initialSettlement;
            }
          } else if (method === "Vendor Adjustment" || method === "Vendor Payable Adjustment") {
            const openPayables = await client.query(
              `SELECT * FROM accounts WHERE party_id = $1 AND type = 'Vendor Payable' AND status = 'Open' ORDER BY date ASC FOR UPDATE`,
              [vendor.id]
            );
            let remainingToApply = initialSettlement;
            for (const acc of openPayables.rows) {
              if (remainingToApply <= 5e-3) break;
              const accRem = parseFloat(acc.remaining || 0);
              const applyAmt = Math.min(accRem, remainingToApply);
              const newRem = Math.max(0, accRem - applyAmt);
              const newStatus = newRem <= 5e-3 ? "Settled" : "Open";
              await client.query(
                `UPDATE accounts SET remaining = $1, status = $2 WHERE id = $3`,
                [newRem, newStatus, acc.id]
              );
              if (acc.invoice_id) {
                await client.query(
                  `UPDATE invoices SET credit_adjusted = credit_adjusted + $1, balance = $2, payment_status = $3 WHERE id = $4`,
                  [applyAmt, newRem, newRem <= 5e-3 ? "Paid" : "Partial", acc.invoice_id]
                );
              }
              remainingToApply -= applyAmt;
            }
            payableAdjustment = initialSettlement - remainingToApply;
            initialSettlement = payableAdjustment;
          }
          const balance = Math.max(0, amount - initialSettlement);
          const retStatus = balance <= 5e-3 ? "Paid" : initialSettlement > 0 ? "Partial" : "Unpaid";
          const insertRes = await client.query(
            `INSERT INTO vendor_returns (
          id, vendor_id, vendor_name, product_id, product_code, returned_product_name,
          quantity, amount, initial_settlement, actual_money_received, exchange_value,
          payable_adjustment, replacement_mode, replacement_qty, replacement_product_id,
          replacement_product_code, replacement_product_name, replacement_product_cost_price,
          replacement_expected_sale_price, balance, payment_method, settlement_method,
          reference_id, reason, date, status, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
        ) RETURNING *`,
            [
              returnId,
              vendor.id,
              vendor.name,
              product.id,
              product.code,
              `${product.brand} ${product.model || product.product_name || ""}`.trim(),
              qty,
              amount,
              initialSettlement,
              actualMoneyReceived,
              exchangeValue,
              payableAdjustment,
              replacementMode || null,
              repQty,
              repProduct?.id || null,
              repProduct?.code || null,
              repProduct ? `${repProduct.brand} ${repProduct.model || repProduct.product_name || ""}`.trim() : null,
              repProduct ? parseFloat(repProduct.cost_price || 0) : 0,
              repProduct ? parseFloat(repProduct.expected_sale_price || 0) : 0,
              balance,
              method,
              method,
              referenceId ? referenceId.trim() : null,
              reason ? reason.trim() : null,
              date || /* @__PURE__ */ new Date(),
              retStatus,
              user.id,
              user.name
            ]
          );
          const linkedInvNo = returnData.invoiceNo || returnData.purchaseInvoiceNo || referenceId || product.purchase_invoice_no;
          const linkedInvId = returnData.invoiceId;
          if (linkedInvId || linkedInvNo && linkedInvNo !== "MANUAL") {
            const invLookup = await client.query(
              `SELECT * FROM invoices WHERE id = $1 OR invoice_no = $2`,
              [linkedInvId || null, linkedInvNo || null]
            );
            if (invLookup.rows.length > 0) {
              const origInv = invLookup.rows[0];
              const newCreditAdj = parseFloat(origInv.credit_adjusted || 0) + amount;
              const isFullyReturned = newCreditAdj >= parseFloat(origInv.total || 0) - 5e-3;
              await client.query(
                `UPDATE invoices SET
              credit_adjusted = $1,
              is_voided = CASE WHEN $2 THEN TRUE ELSE is_voided END,
              void_reason = CASE WHEN $2 THEN $3 ELSE void_reason END,
              void_date = CASE WHEN $2 THEN $4 ELSE void_date END,
              refund_amount = CASE WHEN $2 THEN $5 ELSE refund_amount END,
              payment_status = CASE WHEN $2 THEN 'Voided' ELSE payment_status END,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
                [
                  newCreditAdj,
                  isFullyReturned,
                  reason ? `Vendor Return: ${reason.trim()}` : "Vendor product return",
                  date || /* @__PURE__ */ new Date(),
                  amount,
                  origInv.id
                ]
              );
            }
          }
          let accId = null;
          if (balance > 0) {
            accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
            await client.query(
              `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Vendor Receivable', 'Vendor', $2, $3, NULL, $4, $5, $6, 'Open', $7)`,
              [accId, vendor.id, vendor.name, returnId, balance, balance, date || /* @__PURE__ */ new Date()]
            );
          }
          if (initialSettlement > 0 && (method === "Cash" || method === "Online" || method === "Exchange Credit" || method === "Exchange" || method === "Product Replacement / Exchange")) {
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            await client.query(
              `INSERT INTO payments (
            id, account_id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, NULL, $3, 'Vendor', $4, $5, 'Vendor Receivable',
            $6, $7, $8, $9, $10, $11, $12,
            TRUE, $13, $14
          )`,
              [
                payId,
                accId,
                returnId,
                vendor.id,
                vendor.name,
                method === "Exchange Credit" || method === "Exchange" || method === "Product Replacement / Exchange" ? "Adjusted" : "Received",
                initialSettlement,
                date || /* @__PURE__ */ new Date(),
                method,
                referenceId || null,
                method === "Exchange Credit" || method === "Exchange" || method === "Product Replacement / Exchange" ? `Replacement product: ${repProduct?.code || ""}` : "Initial vendor return refund",
                method === "Cash" || method === "Online",
                user.id,
                user.name
              ]
            );
          }
          emitEvent("vendor_returns.created", insertRes.rows[0]);
          return insertRes.rows[0];
        });
      }
      /**
       * Retrieve full invoice with line items & party compliance details
       */
      static async getInvoiceById(id) {
        const invRes = await db.query("SELECT * FROM invoices WHERE id = $1 OR invoice_no = $1", [id]);
        if (invRes.rows.length === 0) return null;
        const invoice = invRes.rows[0];
        const itemsRes = await db.query(
          `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`,
          [invoice.id]
        );
        let partyAddress = invoice.party_address || "";
        let partyTaxId = invoice.party_tax_id || "";
        let partyStRegNo = invoice.st_reg_no || "";
        if (invoice.party_id) {
          try {
            if (invoice.party_type === "Vendor" || invoice.type === "Vendor Purchase") {
              const vRes = await db.query("SELECT address, ntn_tax_id, st_reg_no FROM vendors WHERE id = $1", [invoice.party_id]);
              if (vRes.rows.length > 0) {
                if (!partyAddress) partyAddress = vRes.rows[0].address || "";
                if (!partyTaxId) partyTaxId = vRes.rows[0].ntn_tax_id || "";
                if (!partyStRegNo) partyStRegNo = vRes.rows[0].st_reg_no || "";
              }
            } else {
              const cRes = await db.query("SELECT address, ntn_cnic, st_reg_no FROM customers WHERE id = $1", [invoice.party_id]);
              if (cRes.rows.length > 0) {
                if (!partyAddress) partyAddress = cRes.rows[0].address || "";
                if (!partyTaxId) partyTaxId = cRes.rows[0].ntn_cnic || "";
                if (!partyStRegNo) partyStRegNo = cRes.rows[0].st_reg_no || "";
              }
            }
          } catch (err) {
            console.error("[getInvoiceById] Party lookup warning:", err.message);
          }
        }
        let repairDetails = null;
        let computedItems = itemsRes.rows;
        if (invoice.repair_job_id) {
          try {
            const jobRes = await db.query("SELECT * FROM repair_jobs WHERE id = $1", [invoice.repair_job_id]);
            if (jobRes.rows.length > 0) {
              const job = jobRes.rows[0];
              repairDetails = {
                trackingId: job.tracking_id,
                jobType: job.job_type,
                deviceType: job.product_type,
                brand: job.brand,
                model: job.model,
                serial: job.serial,
                problem: job.problem,
                diagnosisFee: parseFloat(job.diagnosis_fee || 0),
                extraCharges: parseFloat(job.extra_charges || 0),
                approvalStatus: job.approval_status
              };
              if (computedItems.length === 0) {
                const linesRes = await db.query("SELECT * FROM repair_job_lines WHERE repair_job_id = $1", [job.id]);
                const partsRes = await db.query("SELECT * FROM repair_parts_used WHERE repair_job_id = $1", [job.id]);
                computedItems = [
                  ...linesRes.rows.map((l) => ({
                    id: l.id,
                    item_type: l.line_type === "diagnosis" ? "diagnosis" : "service",
                    product_id: null,
                    service_id: l.service_id,
                    code: l.service_id || "SRV",
                    name: l.name,
                    description: l.condition || l.name,
                    quantity: l.quantity || 1,
                    unit_price: parseFloat(l.charges || 0),
                    discount: 0,
                    cost_price_snapshot: 0,
                    line_total: parseFloat(l.charges || 0) * parseInt(l.quantity || 1, 10)
                  })),
                  ...partsRes.rows.map((p) => ({
                    id: p.id,
                    item_type: "part",
                    product_id: p.product_id,
                    service_id: null,
                    code: p.product_code || "PART",
                    name: p.product_name,
                    description: `Part for ${job.brand} ${job.model}`,
                    quantity: p.quantity || 1,
                    unit_price: parseFloat(p.customer_charge || 0),
                    discount: 0,
                    cost_price_snapshot: parseFloat(p.cost_price || 0),
                    line_total: parseFloat(p.customer_charge || 0) * parseInt(p.quantity || 1, 10)
                  }))
                ];
              }
            }
          } catch (err) {
            console.error("[getInvoiceById] Repair lookup warning:", err.message);
          }
        }
        return {
          id: invoice.id,
          invoiceNo: invoice.invoice_no,
          type: invoice.type,
          typeKey: invoice.type_key,
          date: invoice.date,
          partyType: invoice.party_type,
          partyId: invoice.party_id,
          partyName: invoice.party_name,
          partyAddress,
          partyTaxId,
          stRegNo: partyStRegNo,
          contact: invoice.contact,
          exchangeCase: invoice.exchange_case,
          productTotal: parseFloat(invoice.product_total || 0),
          serviceTotal: parseFloat(invoice.service_total || 0),
          taxRate: parseFloat(invoice.tax_rate || 0),
          taxAmount: parseFloat(invoice.tax_amount || 0),
          fbrInvoiceNo: invoice.fbr_invoice_no || null,
          total: parseFloat(invoice.total || 0),
          paid: parseFloat(invoice.paid || 0),
          initialPaid: parseFloat(invoice.initial_paid || 0),
          creditAdjusted: parseFloat(invoice.credit_adjusted || 0),
          balance: parseFloat(invoice.balance || 0),
          paymentMethod: invoice.payment_method,
          referenceId: invoice.reference_id,
          paymentStatus: invoice.payment_status,
          isVoided: invoice.is_voided,
          voidDate: invoice.void_date,
          voidReason: invoice.void_reason,
          refundAmount: parseFloat(invoice.refund_amount || 0),
          refundMethod: invoice.refund_method,
          refundReference: invoice.refund_reference,
          repairJobId: invoice.repair_job_id,
          repairDetails,
          deviceInfo: repairDetails ? `${repairDetails.brand || ""} ${repairDetails.model || ""}`.trim() : null,
          trackingId: repairDetails ? repairDetails.trackingId : null,
          createdById: invoice.created_by,
          createdByName: invoice.created_by_name,
          createdAt: invoice.created_at,
          items: computedItems.map((item) => {
            const qty = parseFloat(item.quantity || 1);
            const rate = parseFloat(item.unit_price || 0);
            const discount = parseFloat(item.discount || 0);
            const grossAmount = qty * rate;
            const lineTotal = parseFloat(item.line_total || grossAmount - discount);
            return {
              id: item.id,
              itemType: item.item_type,
              productId: item.product_id,
              serviceId: item.service_id,
              productCode: item.code,
              hsCode: item.hs_code || item.code || "\u2014",
              name: item.name,
              description: item.description,
              quantity: qty,
              rate,
              amount: grossAmount,
              discount,
              lineTotal
            };
          })
        };
      }
    };
    module2.exports = InvoiceService;
  }
});

// src/modules/invoices/invoice-whatsapp.service.js
var require_invoice_whatsapp_service = __commonJS({
  "src/modules/invoices/invoice-whatsapp.service.js"(exports2, module2) {
    var db = require_db();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    var baileys = require_baileys_service();
    var { generateInvoicePdf, getBusinessSettings } = require_invoice_pdf_service();
    function numStr(val) {
      const n = parseFloat(val || 0);
      return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function formatDateStr(d) {
      if (!d) return "\u2014";
      try {
        const dateObj = new Date(d);
        if (isNaN(dateObj.getTime())) return String(d);
        return dateObj.toISOString().split("T")[0];
      } catch (e) {
        return String(d);
      }
    }
    var InvoiceWhatsAppService = class {
      /**
       * Main method to generate PDF and dispatch via WhatsApp (Baileys) + log into WhatsApp CRM
       * @param {string|Object} invoiceIdOrObj - Invoice ID or full invoice object
       * @param {Object} [options] - Optional settings (branchId, customNote)
       */
      static async sendInvoiceWhatsApp(invoiceIdOrObj, options = {}) {
        try {
          const InvoiceService = require_invoices_service();
          let invoice = invoiceIdOrObj;
          if (typeof invoiceIdOrObj === "string" || !invoice?.items) {
            const id = typeof invoiceIdOrObj === "string" ? invoiceIdOrObj : invoiceIdOrObj?.id || invoiceIdOrObj?.invoice_no;
            invoice = await InvoiceService.getInvoiceById(id);
          }
          if (!invoice) {
            console.warn("[InvoiceWhatsApp] Invoice not found for WhatsApp dispatch:", invoiceIdOrObj);
            return { success: false, reason: "invoice_not_found" };
          }
          let rawContact = invoice.contact;
          if (!rawContact && invoice.partyId) {
            try {
              if (invoice.partyType === "Vendor" || invoice.type === "Vendor Purchase") {
                const vRes = await db.query("SELECT contact, phone FROM vendors WHERE id = $1", [invoice.partyId]);
                if (vRes.rows.length > 0) rawContact = vRes.rows[0].contact || vRes.rows[0].phone;
              } else {
                const cRes = await db.query("SELECT contact, phone FROM customers WHERE id = $1", [invoice.partyId]);
                if (cRes.rows.length > 0) rawContact = cRes.rows[0].contact || cRes.rows[0].phone;
              }
            } catch (e) {
              console.warn("[InvoiceWhatsApp] Error looking up contact for party:", e.message);
            }
          }
          const cleanDigits = String(rawContact || "").replace(/[^0-9]/g, "");
          if (!cleanDigits || cleanDigits.length < 8) {
            console.log(`[InvoiceWhatsApp] Invoice #${invoice.invoiceNo || invoice.id} has no valid contact phone number ("${rawContact}"). Skipping WhatsApp.`);
            return { success: false, reason: "no_contact_phone", message: "No valid phone number for party" };
          }
          if (!options.isManual) {
            try {
              const sRes = await db.query("SELECT auto_invoice_whatsapp FROM whatsapp_settings WHERE id = 1");
              if (sRes.rows.length > 0 && sRes.rows[0].auto_invoice_whatsapp === false) {
                console.log("[InvoiceWhatsApp] Auto invoice WhatsApp notifications disabled in settings. Skipping.");
                return { success: false, reason: "auto_disabled_in_settings" };
              }
            } catch (e) {
            }
          }
          const branding = await getBusinessSettings();
          const branchId = parseInt(options.branchId || invoice.branchId || 1, 10) || 1;
          const pdfBuffer = await generateInvoicePdf(invoice);
          const fileName = `Invoice-${invoice.invoiceNo || invoice.id}.pdf`;
          const invTitle = invoice.type || "Sales Invoice";
          const partyLabel = invoice.partyType === "Vendor" || invoice.type === "Vendor Purchase" ? "Vendor" : "Customer";
          const total = parseFloat(invoice.total || 0);
          const paid = parseFloat(invoice.paid || 0);
          const balance = Math.max(0, parseFloat(invoice.balance || 0));
          const payStatus = (invoice.paymentStatus || (balance <= 0 ? "Paid" : "Unpaid")).toUpperCase();
          const lines = [
            `\u{1F4C4} *${invTitle.toUpperCase()}* #${invoice.invoiceNo || invoice.id}`,
            `\u{1F3E2} *${branding.company_name || "Retail & Repair Management"}*`,
            "",
            `\u{1F464} *${partyLabel}:* ${invoice.partyName || "Valued Customer"}`,
            `\u{1F4C5} *Date:* ${formatDateStr(invoice.date)}`,
            `\u{1F4B3} *Payment:* ${invoice.paymentMethod || "Cash"} [${payStatus}]`,
            "",
            `\u{1F4B0} *Total:* PKR ${numStr(total)}`,
            `\u{1F4B5} *Paid:* PKR ${numStr(paid)}`,
            balance > 0 ? `\u26A0\uFE0F *Balance Due:* PKR ${numStr(balance)}` : `\u2705 *Balance:* Fully Settled`
          ];
          if (options.customNote) {
            lines.push("");
            lines.push(`\u{1F4DD} *Note:* ${options.customNote}`);
          }
          lines.push("");
          lines.push("\u{1F4CE} *Official PDF invoice attached above.*");
          lines.push(`Thank you for choosing ${branding.company_name || "us"}!`);
          const captionText = lines.join("\n");
          try {
            let convId = null;
            const convRes = await db.query("SELECT id FROM whatsapp_conversations WHERE contact = $1", [rawContact]);
            if (convRes.rows.length > 0) {
              convId = convRes.rows[0].id;
            } else {
              convId = await getNextEntityId("whatsapp_conversations", "id", "CONV", 4);
              await db.query(
                `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
             VALUES ($1, $2, $3, 'Bot Active', 'Invoice Notification')`,
                [convId, rawContact, invoice.partyName || "Customer / Vendor"]
              );
            }
            const logMsg = `[PDF Document: ${fileName}]
${captionText}`;
            await db.query(
              `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
           VALUES ($1, 'out', $2, 'invoice')`,
              [convId, logMsg]
            );
            await db.query(
              `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [logMsg, convId]
            );
            emitEvent("whatsapp.message_added", {
              conversationId: convId,
              text: logMsg,
              tag: "invoice"
            });
          } catch (crmErr) {
            console.warn("[InvoiceWhatsApp] CRM history log warning:", crmErr.message);
          }
          const isConnected = await baileys.isBranchConnected(branchId);
          if (!isConnected) {
            console.log(`[InvoiceWhatsApp] WhatsApp device not currently connected for Branch ${branchId}. Invoice logged in CRM.`);
            return {
              success: true,
              delivered: false,
              wa_not_connected: true,
              contact: rawContact,
              message: "Invoice logged in CRM, but WhatsApp device is not connected."
            };
          }
          await baileys.sendDocumentMessage(branchId, rawContact, pdfBuffer, fileName, captionText);
          console.log(`[InvoiceWhatsApp] \u2705 Successfully sent Invoice #${invoice.invoiceNo} PDF to ${rawContact} via WhatsApp!`);
          return {
            success: true,
            delivered: true,
            contact: rawContact,
            fileName,
            message: `Invoice PDF successfully sent to ${rawContact}`
          };
        } catch (err) {
          console.error("[InvoiceWhatsApp] Error sending invoice on WhatsApp:", err.message);
          return {
            success: false,
            error: err.message
          };
        }
      }
    };
    module2.exports = InvoiceWhatsAppService;
  }
});

// src/modules/repairs/repairs.service.js
var require_repairs_service = __commonJS({
  "src/modules/repairs/repairs.service.js"(exports2, module2) {
    var db = require_db();
    var { getNextTrackingId, getNextEntityId, getNextInvoiceNo } = require_codeGenerator();
    var { validateOutflow } = require_financialFormulas();
    var InventoryService = require_inventory_service();
    var { emitEvent } = require_socket();
    var {
      buildIntakeConfirmationTemplate,
      buildTrackingResponseTemplate,
      buildStatusUpdateTemplate,
      buildQuotationApprovalTemplate,
      buildApprovalConfirmationTemplate,
      buildDeclineConfirmationTemplate,
      buildPaymentReceiptTemplate,
      buildDeliveryClosedTemplate,
      buildAdditionalWorkApprovalTemplate,
      buildAdditionalWorkApprovedTemplate,
      buildAdditionalWorkDeclinedTemplate
    } = require_whatsapp_templates();
    function simpleRepairStatus(status) {
      if (["Job Received", "Diagnosis Received"].includes(status)) return "Received";
      if (["Diagnosis in Progress", "Diagnosis Completed"].includes(status)) return "Checking";
      if (status === "Waiting for Customer Approval") return "Waiting for Approval";
      if (["Repair Approved", "Work in Progress"].includes(status)) return "Repair in Progress";
      if (status === "Waiting for Parts") return "Waiting for Part";
      if (["Work Completed", "Ready for Delivery"].includes(status)) return "Ready for Delivery";
      if (status === "Delivered & Closed") return "Delivered";
      if (["Repair Declined", "Returned Without Repair", "Cancelled"].includes(status)) return "Cancelled";
      return status || "Received";
    }
    function getCreator(user) {
      const isSuper = user?.role === "super_admin" || user?.isSuperAdmin;
      return {
        id: isSuper ? null : user?.id || null,
        name: user?.name || (isSuper ? "Platform Super Admin" : user?.username || "Staff")
      };
    }
    var RepairService = class _RepairService {
      /**
       * Recalculates and synchronizes linked invoice and receivable accounts
       */
      static async syncLinkedInvoice(repairId, client = db) {
        const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
        if (jobRes.rows.length === 0) return;
        const job = jobRes.rows[0];
        const linesRes = await client.query("SELECT * FROM repair_job_lines WHERE repair_job_id = $1", [repairId]);
        const partsRes = await client.query("SELECT * FROM repair_parts_used WHERE repair_job_id = $1", [repairId]);
        const setRes = await client.query("SELECT adjust_diagnosis_fee FROM business_settings WHERE id = 1");
        const adjustDiagnosisFee = setRes.rows.length > 0 && setRes.rows[0].adjust_diagnosis_fee === true;
        const isDiagOrigin = job.origin_job_type === "Diagnosis Job" || job.job_type === "Diagnosis Job";
        const isApproved = job.approval_status === "Approved" || ["Repair Approved", "Work in Progress", "Waiting for Parts", "Work Completed", "Ready for Delivery", "Delivered & Closed"].includes(job.status);
        let serviceTotal = 0;
        if (isDiagOrigin && isApproved && adjustDiagnosisFee) {
          const nonDiagLines = linesRes.rows.filter((l) => l.line_type !== "diagnosis");
          serviceTotal = nonDiagLines.reduce((sum, line) => sum + parseFloat(line.charges || 0) * parseInt(line.quantity || 1, 10), 0) + parseFloat(job.extra_charges || 0);
        } else {
          serviceTotal = linesRes.rows.reduce((sum, line) => sum + parseFloat(line.charges || 0) * parseInt(line.quantity || 1, 10), 0) + parseFloat(job.extra_charges || 0);
        }
        const partsTotal = partsRes.rows.reduce((sum, part) => sum + parseInt(part.quantity || 1, 10) * parseFloat(part.customer_charge || 0), 0);
        const total = serviceTotal + partsTotal;
        const paid = Math.min(total, parseFloat(job.paid || 0));
        const balance = Math.max(0, total - paid);
        const payStatus = balance <= 5e-3 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
        await client.query(
          `UPDATE repair_jobs SET total = $1, paid = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [total, paid, repairId]
        );
        let invoiceId = job.invoice_id;
        const invoiceType = job.job_type === "Diagnosis Job" && !isApproved ? "Diagnosis Invoice" : "Repair Invoice";
        const invoiceKey = job.job_type === "Diagnosis Job" && !isApproved ? "diagnosis" : "repair";
        if (!invoiceId) {
          invoiceId = await getNextEntityId("invoices", "id", "RINV", 5, client);
          await client.query(
            `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          payment_status, is_voided, repair_job_id, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, 'Customer', $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, FALSE, $17, $18, $19
        )`,
            [
              invoiceId,
              job.tracking_id,
              invoiceType,
              invoiceKey,
              job.date,
              job.customer_id,
              job.customer_name,
              job.contact,
              partsTotal,
              serviceTotal,
              total,
              paid,
              paid,
              balance,
              job.payment_method || "Cash",
              payStatus,
              repairId,
              job.created_by,
              job.created_by_name
            ]
          );
          await client.query("UPDATE repair_jobs SET invoice_id = $1 WHERE id = $2", [invoiceId, repairId]);
        } else {
          await client.query(
            `UPDATE invoices SET
          type = $1,
          type_key = $2,
          product_total = $3,
          service_total = $4,
          total = $5,
          paid = $6,
          balance = $7,
          payment_status = $8,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
            [
              invoiceType,
              invoiceKey,
              partsTotal,
              serviceTotal,
              total,
              paid,
              balance,
              payStatus,
              invoiceId
            ]
          );
        }
        await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [invoiceId]);
        for (const line of linesRes.rows) {
          let lineDesc = line.condition || line.name;
          if (line.line_type === "diagnosis") lineDesc = `Inspection & Diagnosis: ${line.name}`;
          if (line.line_type === "approved_repair") lineDesc = `Approved Repair: ${line.name}`;
          const unitCharge = parseFloat(line.charges || 0);
          const qty = parseInt(line.quantity || 1, 10);
          const lineTotal = unitCharge * qty;
          await client.query(
            `INSERT INTO invoice_items (invoice_id, item_type, service_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'service', $2, $3, $4, $5, $6, $7, 0.00, $8)`,
            [invoiceId, line.service_id, line.service_id || (line.line_type === "diagnosis" ? "DIAG" : "SERVICE"), line.name, lineDesc, qty, unitCharge, lineTotal]
          );
        }
        if (parseFloat(job.extra_charges || 0) > 0) {
          await client.query(
            `INSERT INTO invoice_items (invoice_id, item_type, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'service', 'EXTRA', $2, $3, 1, $4, 0.00, $5)`,
            [invoiceId, `Extra Charge \u2014 ${job.extra_reason || "Additional Work"}`, job.extra_reason || "Extra Charge", parseFloat(job.extra_charges), parseFloat(job.extra_charges)]
          );
        }
        for (const part of partsRes.rows) {
          const qty = parseInt(part.quantity || 1, 10);
          const charge = parseFloat(part.customer_charge || 0);
          await client.query(
            `INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
            [invoiceId, part.product_id, part.product_code, part.name, `Replacement Part: ${part.name}`, qty, charge, parseFloat(part.cost_price_snapshot || 0), qty * charge]
          );
        }
        const accRes = await client.query("SELECT * FROM accounts WHERE invoice_id = $1 AND type = $2", [invoiceId, "Customer Receivable"]);
        if (balance > 0) {
          if (accRes.rows.length > 0) {
            await client.query(
              `UPDATE accounts SET amount = $1, remaining = $2, status = 'Open' WHERE id = $3`,
              [total, balance, accRes.rows[0].id]
            );
          } else {
            const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
            await client.query(
              `INSERT INTO accounts (id, type, party_type, party_id, party_name, invoice_id, invoice_no, amount, remaining, status, date)
           VALUES ($1, 'Customer Receivable', 'Customer', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
              [accId, job.customer_id, job.customer_name, invoiceId, job.tracking_id, total, balance, job.date]
            );
          }
        } else if (accRes.rows.length > 0) {
          await client.query(`UPDATE accounts SET remaining = 0, status = 'Settled' WHERE id = $1`, [accRes.rows[0].id]);
        }
      }
      /**
       * Helper to append automated WhatsApp message to conversation
       */
      static async sendAutomatedWhatsapp(job, customMessageOrNote = "", client = db, options = {}) {
        try {
          const settingsRes = await client.query("SELECT auto_status_notifications FROM whatsapp_settings WHERE id = 1");
          if (settingsRes.rows.length > 0 && settingsRes.rows[0].auto_status_notifications === false) {
            return;
          }
          const cleanContact = String(job.contact || "").trim();
          if (!cleanContact) return;
          let convId = null;
          const convRes = await client.query("SELECT id FROM whatsapp_conversations WHERE contact = $1", [cleanContact]);
          if (convRes.rows.length > 0) {
            convId = convRes.rows[0].id;
          } else {
            convId = await getNextEntityId("whatsapp_conversations", "id", "CONV", 4, client);
            await client.query(
              `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
           VALUES ($1, $2, $3, 'Bot Active', 'Repair Notification')`,
              [convId, cleanContact, job.customer_name]
            );
          }
          let messageText = "";
          if (options.templateType === "intake") {
            messageText = buildIntakeConfirmationTemplate({
              job,
              requestedService: options.requestedService,
              isDiagnosis: options.isDiagnosis
            });
          } else if (options.templateType === "approval_request") {
            messageText = buildQuotationApprovalTemplate(job);
          } else if (options.templateType === "approval_confirmed") {
            messageText = buildApprovalConfirmationTemplate(job);
          } else if (options.templateType === "decline_confirmed") {
            messageText = buildDeclineConfirmationTemplate(job);
          } else if (options.templateType === "payment_receipt") {
            messageText = buildPaymentReceiptTemplate({
              job,
              amountPaid: options.amountPaid,
              newBalance: options.newBalance
            });
          } else if (options.templateType === "delivery_closed") {
            messageText = buildDeliveryClosedTemplate(job);
          } else if (typeof customMessageOrNote === "string" && customMessageOrNote.includes("\n")) {
            messageText = customMessageOrNote;
          } else {
            messageText = buildStatusUpdateTemplate({
              job,
              safeNote: customMessageOrNote
            });
          }
          await client.query(
            `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
         VALUES ($1, 'out', $2, 'tracking')`,
            [convId, messageText]
          );
          await client.query(
            `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [messageText, convId]
          );
          emitEvent("whatsapp.message_added", { conversationId: convId, text: messageText });
          try {
            const baileys = require_baileys_service();
            if (await baileys.isCurrentBranchConnected()) {
              await baileys.sendTextMessage(cleanContact, messageText);
              console.log(`[Baileys] Successfully sent automated WhatsApp message to ${cleanContact}`);
            } else {
              console.log(`[Baileys] WhatsApp device not currently connected; logged in CRM.`);
            }
          } catch (waErr) {
            console.error("[Baileys] Error sending WhatsApp message to customer:", waErr.message);
          }
        } catch (err) {
          console.error("[WhatsApp Auto Notify Error]:", err);
        }
      }
      /**
       * Create Repair Job (Service Job vs Diagnosis Job)
       */
      static async createJob(jobData, user) {
        return await db.withTransaction(async (client) => {
          const {
            jobType,
            technicianId,
            priority,
            date,
            expectedCompletion,
            customerName,
            contact,
            categoryId,
            categoryName: reqCatName,
            productType,
            brand,
            model,
            serial,
            problem,
            lines,
            extraEnabled,
            extraCharges,
            extraReason,
            paid: reqPaid,
            paymentMethod,
            paymentReference,
            remarks,
            duration,
            // Diagnosis specific fields
            diagnosisServiceId,
            diagnosisServiceName,
            diagnosisFee,
            diagnosisDuration
          } = jobData;
          if (!customerName || !contact || !problem || !String(customerName).trim() || !String(contact).trim() || !String(problem).trim()) {
            const error = new Error("Customer name, contact and reported problem are required.");
            error.status = 400;
            throw error;
          }
          if (!categoryId) {
            const error = new Error("Repair Category is required.");
            error.status = 400;
            throw error;
          }
          const catRes = await client.query("SELECT id, name FROM repair_categories WHERE id = $1", [categoryId]);
          if (catRes.rows.length === 0) {
            const error = new Error("Selected repair category does not exist in the database.");
            error.status = 400;
            throw error;
          }
          const categoryName = catRes.rows[0].name;
          const isDiag = jobType === "Diagnosis Job";
          let cleanLines = [];
          let total = 0;
          let extraAmt = 0;
          let diagFee = 0;
          if (isDiag) {
            let catalogDiagPrice = 1e3;
            if (diagnosisServiceId) {
              const srvRes = await client.query("SELECT charges, name, duration FROM repair_services WHERE id = $1", [diagnosisServiceId]);
              if (srvRes.rows.length > 0) {
                catalogDiagPrice = parseFloat(srvRes.rows[0].charges || 0);
              }
            }
            if (diagnosisFee !== void 0 && diagnosisFee !== null && diagnosisFee !== "") {
              diagFee = parseFloat(diagnosisFee);
            } else {
              diagFee = catalogDiagPrice;
            }
            if (isNaN(diagFee) || diagFee < 0) {
              const error = new Error("Diagnosis fee must be a valid non-negative number.");
              error.status = 400;
              throw error;
            }
            total = diagFee;
            cleanLines = [{
              serviceId: diagnosisServiceId || null,
              name: diagnosisServiceName ? diagnosisServiceName.trim() : "Standard Laptop Diagnosis & Inspection",
              catalogPriceSnapshot: catalogDiagPrice,
              charges: diagFee,
              quantity: 1,
              duration: diagnosisDuration ? diagnosisDuration.trim() : "1-2 Hours",
              condition: "Initial fault inspection & diagnostic testing",
              lineType: "diagnosis"
            }];
          } else {
            if (!lines || !Array.isArray(lines) || lines.length === 0) {
              const error = new Error("Service Job requires at least one repair service line.");
              error.status = 400;
              throw error;
            }
            for (const l of lines) {
              const lineName = (l.name || "").trim();
              const unitCharge = parseFloat(l.charges !== void 0 && l.charges !== null ? l.charges : l.charge || 0);
              const qty = parseInt(l.quantity || 1, 10);
              let catalogPrice = l.catalogPriceSnapshot !== void 0 ? parseFloat(l.catalogPriceSnapshot) : null;
              if (!lineName) {
                const error = new Error("All repair service lines must have a valid service name.");
                error.status = 400;
                throw error;
              }
              if (isNaN(unitCharge) || unitCharge < 0) {
                const error = new Error(`Invalid charged price for "${lineName}". Price must be a non-negative number.`);
                error.status = 400;
                throw error;
              }
              if (isNaN(qty) || qty <= 0) {
                const error = new Error(`Invalid quantity for "${lineName}". Quantity must be at least 1.`);
                error.status = 400;
                throw error;
              }
              if (l.serviceId && catalogPrice === null) {
                const srvRes = await client.query("SELECT charges FROM repair_services WHERE id = $1", [l.serviceId]);
                if (srvRes.rows.length > 0) {
                  catalogPrice = parseFloat(srvRes.rows[0].charges || 0);
                }
              }
              if (catalogPrice === null || isNaN(catalogPrice)) {
                catalogPrice = unitCharge;
              }
              cleanLines.push({
                serviceId: l.serviceId || null,
                name: lineName,
                catalogPriceSnapshot: catalogPrice,
                charges: unitCharge,
                quantity: qty,
                duration: (l.duration || "").trim(),
                condition: (l.condition || "").trim(),
                lineType: "repair"
              });
            }
            extraAmt = extraEnabled === "Yes" ? parseFloat(extraCharges || 0) : 0;
            if (extraEnabled === "Yes" && (isNaN(extraAmt) || extraAmt <= 0 || !extraReason || !String(extraReason).trim())) {
              const error = new Error("Valid extra charge amount and reason are required when extra charges are enabled.");
              error.status = 400;
              throw error;
            }
            const linesTotal = cleanLines.reduce((sum, l) => sum + l.charges * l.quantity, 0);
            total = linesTotal + extraAmt;
          }
          const numPaid = reqPaid === void 0 || reqPaid === null || reqPaid === "" ? 0 : parseFloat(reqPaid);
          if (isNaN(numPaid) || numPaid < 0) {
            const error = new Error("Paid advance cannot be negative.");
            error.status = 400;
            throw error;
          }
          if (numPaid > total + 5e-3) {
            const error = new Error(`Paid amount (PKR ${numPaid.toFixed(2)}) cannot exceed total bill amount of PKR ${total.toFixed(2)}.`);
            error.status = 400;
            throw error;
          }
          const paid = numPaid;
          const cleanName = customerName.trim();
          const cleanContact = contact.trim();
          let customerId = null;
          const custRes = await client.query(
            `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
            [cleanName, cleanContact]
          );
          if (custRes.rows.length > 0) {
            customerId = custRes.rows[0].id;
          } else {
            customerId = await getNextEntityId("customers", "id", "CUS", 4, client);
            await client.query(`INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`, [customerId, cleanName, cleanContact]);
          }
          let techName = "Unassigned";
          if (technicianId) {
            const techRes = await client.query("SELECT name FROM users WHERE id = $1", [technicianId]);
            if (techRes.rows.length > 0) {
              techName = techRes.rows[0].name;
            }
          }
          const trackingId = await getNextTrackingId(client);
          const numPart = trackingId.split("-")[1] || String(Date.now()).slice(-5);
          const repairId = `REP-${numPart}`;
          const initialStatus = isDiag ? "Diagnosis Received" : "Job Received";
          const creator = getCreator(user);
          const jobRes = await client.query(
            `INSERT INTO repair_jobs (
          id, tracking_id, job_type, origin_job_type, date, customer_id, customer_name, contact,
          technician_id, technician_name, priority, category_id, category_name, product_type, brand, model, serial, problem,
          extra_charges, extra_reason, total, paid, initial_paid, payment_method, payment_reference,
          remarks, status, duration, expected_completion, diagnosis_fee, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30, $31, $32
        ) RETURNING *`,
            [
              repairId,
              trackingId,
              isDiag ? "Diagnosis Job" : "Service Job",
              isDiag ? "Diagnosis Job" : "Service Job",
              date || /* @__PURE__ */ new Date(),
              customerId,
              cleanName,
              cleanContact,
              technicianId || null,
              techName,
              priority || "Normal",
              categoryId,
              categoryName,
              productType || categoryName,
              brand || null,
              model || null,
              serial || null,
              problem.trim(),
              extraAmt,
              isDiag ? null : extraReason ? extraReason.trim() : null,
              total,
              paid,
              paid,
              paymentMethod || "Cash",
              paymentReference ? paymentReference.trim() : null,
              remarks ? remarks.trim() : null,
              initialStatus,
              isDiag ? cleanLines[0]?.duration || "1-2 Hours" : duration || null,
              expectedCompletion || null,
              isDiag ? diagFee : 0,
              creator.id,
              creator.name
            ]
          );
          for (const line of cleanLines) {
            await client.query(
              `INSERT INTO repair_job_lines (repair_job_id, service_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [repairId, line.serviceId || null, line.name, line.catalogPriceSnapshot, line.charges, line.quantity, line.duration || null, line.condition || null, line.lineType || "repair"]
            );
          }
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [repairId, initialStatus, isDiag ? `Diagnosis Job received for ${categoryName} and assigned to ${techName}` : `Service Job created for ${categoryName} and assigned to ${techName}`, creator.id, creator.name]
          );
          if (paid > 0) {
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            await client.query(
              `INSERT INTO payments (
            id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes,
            affects_money, is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, 'Customer', $3, $4, 'Customer Receivable',
            'Received', $5, $6, $7, $8, $9,
            TRUE, TRUE, $10, $11
          )`,
              [
                payId,
                trackingId,
                customerId,
                cleanName,
                paid,
                date || /* @__PURE__ */ new Date(),
                paymentMethod || "Cash",
                paymentReference || null,
                isDiag ? "Diagnosis fee advance payment" : "Initial repair job advance payment",
                creator.id,
                creator.name
              ]
            );
          }
          await _RepairService.syncLinkedInvoice(repairId, client);
          const finalJobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          const createdJob = finalJobRes.rows[0];
          const requestedService = isDiag ? diagnosisServiceName || "Diagnostic Inspection & Fault Analysis" : lines && lines.length > 0 && lines[0].name ? lines.map((l) => l.name).join(", ") : problem || "Standard Hardware Service";
          await _RepairService.sendAutomatedWhatsapp(createdJob, "", client, {
            templateType: "intake",
            requestedService,
            isDiagnosis: isDiag
          });
          emitEvent("repair.created", createdJob);
          return createdJob;
        });
      }
      /**
       * Technician technical update
       */
      static async technicalUpdate(repairId, updateData, user) {
        return await db.withTransaction(async (client) => {
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          const {
            status: reqStatus,
            expectedCompletion,
            workProgress,
            quotationAmount,
            diagnosedIssue,
            recommendedSolution,
            technicalNotes,
            testingResult,
            warrantyDays,
            finalRemarks,
            updateNote,
            partId,
            partQty,
            partCharge
          } = updateData;
          let validUserId = null;
          if (user?.id) {
            const uCheck = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
          }
          let newStatus = reqStatus || job.status;
          const finalNote = updateNote && String(updateNote).trim() !== "" ? String(updateNote).trim() : finalRemarks && String(finalRemarks).trim() || technicalNotes && String(technicalNotes).trim() || `Technical update on workbench (${newStatus})`;
          const isOriginalDiag = job.origin_job_type === "Diagnosis Job" || job.job_type === "Diagnosis Job";
          const isApproved = job.approval_status === "Approved" || ["Repair Approved", "Work in Progress", "Waiting for Parts", "Work Completed", "Ready for Delivery", "Delivered & Closed"].includes(job.status);
          if (isOriginalDiag && !isApproved && ["Work in Progress", "Repair Approved", "Waiting for Parts", "Testing & Quality Check", "Work Completed", "Ready for Delivery", "Delivered & Closed"].includes(newStatus)) {
            const error = new Error("Customer quotation approval is required before repair work can begin.");
            error.status = 400;
            throw error;
          }
          if (newStatus === "Waiting for Customer Approval") {
            const issue = diagnosedIssue || job.diagnosed_issue;
            const solution = recommendedSolution || job.recommended_solution;
            const estimate = parseFloat(quotationAmount || job.quotation_amount || 0);
            if (!issue || !solution || isNaN(estimate) || estimate <= 0) {
              const error = new Error("Diagnosed issue, recommended solution, and valid quotation amount (> PKR 0) are required before requesting customer approval.");
              error.status = 400;
              throw error;
            }
          }
          if (partId && String(partId).trim() !== "") {
            if (isOriginalDiag && !isApproved) {
              const error = new Error("Spare parts cannot be issued or consumed before customer quotation approval.");
              error.status = 400;
              throw error;
            }
            const qty = parseInt(partQty || 1, 10);
            if (isNaN(qty) || qty <= 0) {
              const error = new Error("Issued spare part quantity must be at least 1.");
              error.status = 400;
              throw error;
            }
            let charge = parseFloat(partCharge || 0);
            if (isNaN(charge) || charge < 0) charge = 0;
            const partRes = await client.query("SELECT * FROM repair_parts WHERE id = $1 FOR UPDATE", [partId]);
            if (partRes.rows.length > 0) {
              const part = partRes.rows[0];
              if (qty > part.current_stock) {
                const error = new Error(`Insufficient stock for spare part ${part.code} (${part.name}). Available: ${part.current_stock}, Requested: ${qty}`);
                error.status = 400;
                error.code = "INSUFFICIENT_STOCK";
                throw error;
              }
              await client.query(
                "UPDATE repair_parts SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [qty, part.id]
              );
              if (charge === 0 && parseFloat(part.selling_price || 0) > 0) {
                charge = parseFloat(part.selling_price || 0);
              }
              await client.query(
                `INSERT INTO repair_parts_used (
              repair_job_id, part_id, product_code, name, quantity, customer_charge,
              cost_price_snapshot, added_by, added_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  job.id,
                  part.id,
                  part.code,
                  part.name,
                  qty,
                  charge,
                  parseFloat(part.cost_price || 0),
                  user.id,
                  user.name
                ]
              );
              try {
                await client.query(
                  `INSERT INTO repair_parts_movements (
                part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, balance_after, performed_by, performed_by_name
              ) VALUES ($1, $2, $3, 'OUT', $4, $5, 'Repair Job Issuance', $6, $7, $8, $9)`,
                  [
                    part.id,
                    part.code,
                    part.name,
                    qty,
                    `Issued to repair job ${job.id} (${job.customer_name})`,
                    job.id,
                    Math.max(0, parseInt(part.current_stock || 0, 10) - qty),
                    user.id,
                    user.name
                  ]
                );
              } catch (mErr) {
                console.error("[Spare Parts Movement] Issuance log error:", mErr.message);
              }
            } else {
              const prodRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [partId]);
              if (prodRes.rows.length === 0) {
                const error = new Error("Selected replacement spare part not found.");
                error.status = 404;
                throw error;
              }
              const product = prodRes.rows[0];
              if (qty > product.current_stock) {
                const error = new Error(`Insufficient stock for ${product.code}. Available: ${product.current_stock}, Requested: ${qty}`);
                error.status = 400;
                error.code = "INSUFFICIENT_STOCK";
                throw error;
              }
              await InventoryService.adjustStock({
                productId: product.id,
                direction: "OUT",
                quantity: qty,
                reason: `Repair part used \u2014 ${job.tracking_id}`,
                refType: "Repair Job",
                refId: job.id,
                date: /* @__PURE__ */ new Date(),
                user
              }, client);
              await client.query(
                `INSERT INTO repair_parts_used (
              repair_job_id, product_id, product_code, name, quantity, customer_charge,
              cost_price_snapshot, added_by, added_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  job.id,
                  product.id,
                  product.code,
                  `${product.brand} ${product.model || product.product_name || ""}`.trim(),
                  qty,
                  charge,
                  parseFloat(product.cost_price || 0),
                  user.id,
                  user.name
                ]
              );
            }
          }
          let approvalStatus = job.approval_status;
          let approvalRequestedAt = job.approval_requested_at;
          if (newStatus === "Waiting for Customer Approval") {
            approvalStatus = "Pending";
            approvalRequestedAt = /* @__PURE__ */ new Date();
          }
          let parsedExpectedDate = null;
          let durationStr = updateData.duration || null;
          if (expectedCompletion && String(expectedCompletion).trim() !== "") {
            const str = String(expectedCompletion).trim();
            if (!isNaN(Date.parse(str))) {
              parsedExpectedDate = new Date(str);
            } else {
              durationStr = str;
              const match = str.match(/([0-9]+)\s*(?:day|d)/i);
              if (match) {
                const days = parseInt(match[1], 10);
                parsedExpectedDate = new Date(Date.now() + days * 24 * 60 * 60 * 1e3);
              }
            }
          }
          const updateRes = await client.query(
            `UPDATE repair_jobs SET
          status = $1,
          expected_completion = COALESCE($2, expected_completion),
          work_progress = COALESCE($3, work_progress),
          quotation_amount = COALESCE($4, quotation_amount),
          diagnosed_issue = COALESCE($5, diagnosed_issue),
          recommended_solution = COALESCE($6, recommended_solution),
          technical_notes = COALESCE($7, technical_notes),
          testing_result = COALESCE($8, testing_result),
          warranty_days = COALESCE($9, warranty_days),
          final_remarks = COALESCE($10, final_remarks),
          approval_status = $11,
          approval_requested_at = $12,
          duration = COALESCE($14, duration),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $13
         RETURNING *`,
            [
              newStatus,
              parsedExpectedDate,
              workProgress !== void 0 ? parseInt(workProgress, 10) : null,
              quotationAmount !== void 0 && quotationAmount !== "" ? parseFloat(quotationAmount) : null,
              diagnosedIssue ? diagnosedIssue.trim() : null,
              recommendedSolution ? recommendedSolution.trim() : null,
              technicalNotes ? technicalNotes.trim() : null,
              testingResult || null,
              warrantyDays !== void 0 ? parseInt(warrantyDays, 10) : null,
              finalRemarks ? finalRemarks.trim() : null,
              approvalStatus,
              approvalRequestedAt,
              repairId,
              durationStr
            ]
          );
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [repairId, newStatus, finalNote, validUserId, user?.name || "Technician"]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const updatedJob = updateRes.rows[0];
          if (newStatus === "Waiting for Customer Approval") {
            await _RepairService.sendAutomatedWhatsapp(updatedJob, "", client, { templateType: "approval_request" });
          } else {
            await _RepairService.sendAutomatedWhatsapp(updatedJob, finalRemarks || finalNote, client);
          }
          emitEvent("repair.updated", updatedJob);
          return updatedJob;
        });
      }
      /**
       * Approve Diagnosis Job Quotation (Atomic & Idempotent)
       */
      static async approveQuote(repairId, user, approvalSource = "Admin") {
        return await db.withTransaction(async (client) => {
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          if (job.approval_status === "Approved") {
            const error = new Error("This quotation has already been approved.");
            error.status = 400;
            throw error;
          }
          if (job.approval_status === "Declined") {
            const error = new Error("This quotation has already been declined.");
            error.status = 400;
            throw error;
          }
          if (job.status !== "Waiting for Customer Approval" && job.approval_status !== "Pending") {
            const error = new Error("Repair job is not in a pending approval state.");
            error.status = 400;
            throw error;
          }
          const quoteAmt = parseFloat(job.quotation_amount || 0);
          let validUserId = null;
          if (user?.id) {
            const uCheck = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
          }
          await client.query(
            `UPDATE repair_jobs SET
          job_type = 'Service Job',
          status = 'Repair Approved',
          approval_status = 'Approved',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = $1,
          approval_source = $2,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
            [user?.name || approvalSource || "Customer", approvalSource, repairId]
          );
          if (quoteAmt > 0) {
            const checkLine = await client.query(
              "SELECT id FROM repair_job_lines WHERE repair_job_id = $1 AND (is_approved_repair_line = TRUE OR line_type = $2)",
              [repairId, "approved_repair"]
            );
            if (checkLine.rows.length === 0) {
              await client.query(
                `INSERT INTO repair_job_lines (
              repair_job_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type, is_approved_repair_line
            ) VALUES ($1, $2, $3, $3, 1, $4, 'Approved repair service after diagnosis', 'approved_repair', TRUE)`,
                [repairId, job.recommended_solution || "Approved Repair Work", quoteAmt, job.duration || "1-2 Days"]
              );
            }
          }
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Repair Approved', $2, $3, $4)`,
            [
              repairId,
              `Repair quotation approved via ${approvalSource}: ${job.recommended_solution || "Repair Work"} (PKR ${quoteAmt.toFixed(2)}). Hardware repair work may now proceed.`,
              validUserId,
              user?.name || approvalSource
            ]
          );
          const cleanContact = String(job.contact || "").trim();
          if (cleanContact) {
            await client.query(
              `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
              [cleanContact]
            );
          }
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await _RepairService.sendAutomatedWhatsapp(refreshed.rows[0], "", client, { templateType: "approval_confirmed" });
          emitEvent("repair.updated", refreshed.rows[0]);
          emitEvent("repair.approved", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Decline Diagnosis Job Quotation (Atomic & Idempotent)
       */
      static async declineQuote(repairId, user, approvalSource = "Admin") {
        return await db.withTransaction(async (client) => {
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          if (job.approval_status === "Declined") {
            const error = new Error("This quotation has already been declined.");
            error.status = 400;
            throw error;
          }
          if (job.approval_status === "Approved") {
            const error = new Error("This quotation has already been approved.");
            error.status = 400;
            throw error;
          }
          if (job.status !== "Waiting for Customer Approval" && job.approval_status !== "Pending") {
            const error = new Error("Repair job is not in a pending approval state.");
            error.status = 400;
            throw error;
          }
          let validUserId = null;
          if (user?.id) {
            const uCheck = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
          }
          await client.query(
            `UPDATE repair_jobs SET
          status = 'Repair Declined',
          approval_status = 'Declined',
          approval_source = $1,
          declined_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
            [approvalSource, repairId]
          );
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Repair Declined', $2, $3, $4)`,
            [
              repairId,
              `Repair quotation declined via ${approvalSource}. Only diagnostic inspection charges (if applicable) apply.`,
              validUserId,
              user?.name || approvalSource
            ]
          );
          const cleanContact = String(job.contact || "").trim();
          if (cleanContact) {
            await client.query(
              `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
              [cleanContact]
            );
          }
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await _RepairService.sendAutomatedWhatsapp(refreshed.rows[0], "", client, { templateType: "decline_confirmed" });
          emitEvent("repair.updated", refreshed.rows[0]);
          emitEvent("repair.declined", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Collect Repair Payment installment
       */
      static async collectPayment(repairId, paymentData, user) {
        return await db.withTransaction(async (client) => {
          const { amount, paymentMethod, reference, date, note } = paymentData;
          const payAmount = parseFloat(amount || 0);
          if (payAmount <= 0) {
            const error = new Error("Payment amount must be greater than zero.");
            error.status = 400;
            throw error;
          }
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          const remaining = Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0));
          if (payAmount > remaining + 5e-3) {
            const error = new Error(`Payment amount (PKR ${payAmount.toFixed(2)}) cannot exceed remaining balance (PKR ${remaining.toFixed(2)}).`);
            error.status = 400;
            throw error;
          }
          const pMethod = paymentMethod || "Cash";
          const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
          await client.query(
            `INSERT INTO payments (
          id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
          direction, amount, date, payment_method, reference_id, notes, affects_money,
          is_initial_settlement, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
          'Received', $6, $7, $8, $9, $10, TRUE, FALSE, $11, $12
        )`,
            [
              payId,
              job.invoice_id,
              job.tracking_id,
              job.customer_id,
              job.customer_name,
              payAmount,
              date || /* @__PURE__ */ new Date(),
              pMethod,
              reference || null,
              note || "Repair installment payment",
              user.id,
              user.name
            ]
          );
          const newPaid = parseFloat(job.paid || 0) + payAmount;
          const newRemaining = Math.max(0, parseFloat(job.total || 0) - newPaid);
          await client.query(
            `UPDATE repair_jobs SET paid = $1, payment_method = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [newPaid, pMethod, repairId]
          );
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              job.status,
              `Payment received: PKR ${payAmount.toLocaleString("en-PK", { maximumFractionDigits: 2 })} via ${pMethod}. Remaining: PKR ${newRemaining.toLocaleString("en-PK", { maximumFractionDigits: 2 })}.`,
              user.id,
              user.name
            ]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await _RepairService.sendAutomatedWhatsapp(refreshed.rows[0], "", client, {
            templateType: "payment_receipt",
            amountPaid: payAmount,
            newBalance: newRemaining
          });
          emitEvent("repair.updated", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Atomic Pay & Deliver Handover
       */
      static async payAndDeliver(repairId, paymentData, user) {
        return await db.withTransaction(async (client) => {
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          const remaining = Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0));
          if (remaining > 5e-3) {
            const payAmount = paymentData?.amount ? parseFloat(paymentData.amount) : remaining;
            if (payAmount < remaining - 5e-3) {
              const error = new Error(`Cannot deliver device with outstanding balance. Full payment of PKR ${remaining.toFixed(2)} is required.`);
              error.status = 400;
              throw error;
            }
            const pMethod = paymentData?.paymentMethod || "Cash";
            const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
            await client.query(
              `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
            'Received', $6, CURRENT_DATE, $7, $8, 'Final clearance payment before delivery', TRUE, FALSE, $9, $10
          )`,
              [
                payId,
                job.invoice_id,
                job.tracking_id,
                job.customer_id,
                job.customer_name,
                remaining,
                pMethod,
                paymentData?.reference || null,
                user.id,
                user.name
              ]
            );
            await client.query("UPDATE repair_jobs SET paid = total WHERE id = $1", [repairId]);
          }
          await client.query(
            `UPDATE repair_jobs SET status = 'Delivered & Closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [repairId]
          );
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, 'Delivered & Closed', 'Product handed over to customer. Payment balance fully cleared and repair closed.', $2, $3)`,
            [repairId, user.id, user.name]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await _RepairService.sendAutomatedWhatsapp(refreshed.rows[0], "", client, { templateType: "delivery_closed" });
          emitEvent("repair.updated", refreshed.rows[0]);
          if (refreshed.rows[0].invoice_id) {
            try {
              const InvoiceWhatsAppService = require_invoice_whatsapp_service();
              InvoiceWhatsAppService.sendInvoiceWhatsApp(refreshed.rows[0].invoice_id).catch((e) => {
                console.error("[deliverAndClose] WhatsApp repair invoice auto-send error:", e.message);
              });
            } catch (waErr) {
            }
          }
          return refreshed.rows[0];
        });
      }
      /**
       * Add / Issue a spare part to a repair job
       */
      static async addUsedPart(repairId, partData, user) {
        return await db.withTransaction(async (client) => {
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          const isOriginalDiag = job.origin_job_type === "Diagnosis Job";
          const isApproved = !isOriginalDiag || job.approval_status === "Approved" || ["Repair Approved", "Work in Progress", "Waiting for Parts", "Work Completed", "Ready for Delivery", "Delivered & Closed"].includes(job.status);
          if (isOriginalDiag && !isApproved) {
            const error = new Error("Spare parts cannot be issued or consumed before customer quotation approval.");
            error.status = 400;
            throw error;
          }
          const { partId, quantity, customerCharge } = partData;
          if (!partId) {
            const error = new Error("Spare part selection is required.");
            error.status = 400;
            throw error;
          }
          const qty = parseInt(quantity || 1, 10);
          if (isNaN(qty) || qty <= 0) {
            const error = new Error("Issued spare part quantity must be at least 1.");
            error.status = 400;
            throw error;
          }
          let charge = customerCharge !== void 0 && customerCharge !== null && customerCharge !== "" ? parseFloat(customerCharge) : 0;
          if (isNaN(charge) || charge < 0) charge = 0;
          const partRes = await client.query("SELECT * FROM repair_parts WHERE id = $1 FOR UPDATE", [partId]);
          if (partRes.rows.length > 0) {
            const part = partRes.rows[0];
            if (qty > part.current_stock) {
              const error = new Error(`Insufficient stock for spare part ${part.code} (${part.name}). In stock: ${part.current_stock}, Requested: ${qty}`);
              error.status = 400;
              throw error;
            }
            await client.query(
              "UPDATE repair_parts SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
              [qty, part.id]
            );
            if (charge === 0 && parseFloat(part.selling_price || 0) > 0) {
              charge = parseFloat(part.selling_price || 0);
            }
            await client.query(
              `INSERT INTO repair_parts_used (
            repair_job_id, part_id, product_code, name, quantity, customer_charge,
            cost_price_snapshot, added_by, added_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                job.id,
                part.id,
                part.code,
                part.name,
                qty,
                charge,
                parseFloat(part.cost_price || 0),
                user?.id || null,
                user?.name || "Technician"
              ]
            );
            try {
              await client.query(
                `INSERT INTO repair_parts_movements (
              part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, balance_after, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, 'OUT', $4, $5, 'Repair Job Issuance', $6, $7, $8, $9)`,
                [
                  part.id,
                  part.code,
                  part.name,
                  qty,
                  `Issued to repair job ${job.id} (${job.customer_name})`,
                  job.id,
                  Math.max(0, parseInt(part.current_stock || 0, 10) - qty),
                  user?.id || null,
                  user?.name || "Technician"
                ]
              );
            } catch (mErr) {
              console.error("[Spare Parts Movement] Issuance log error:", mErr.message);
            }
            await client.query(
              `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
           VALUES ($1, $2, $3, $4, $5)`,
              [
                repairId,
                job.status,
                `Spare part issued: ${part.name} (Qty: ${qty}, Charge: PKR ${charge.toFixed(2)})`,
                user?.id || null,
                user?.name || "Technician"
              ]
            );
          } else {
            const prodRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [partId]);
            if (prodRes.rows.length === 0) {
              const error = new Error("Spare part not found in inventory catalog.");
              error.status = 404;
              throw error;
            }
            const product = prodRes.rows[0];
            if (qty > product.current_stock) {
              const error = new Error(`Insufficient stock for ${product.code}. In stock: ${product.current_stock}, Requested: ${qty}`);
              error.status = 400;
              throw error;
            }
            await InventoryService.adjustStock({
              productId: product.id,
              direction: "OUT",
              quantity: qty,
              reason: `Repair part used \u2014 ${job.tracking_id}`,
              refType: "Repair Job",
              refId: job.id,
              date: /* @__PURE__ */ new Date(),
              user
            }, client);
            await client.query(
              `INSERT INTO repair_parts_used (
            repair_job_id, product_id, product_code, name, quantity, customer_charge,
            cost_price_snapshot, added_by, added_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                job.id,
                product.id,
                product.code,
                `${product.brand} ${product.model || product.product_name || ""}`.trim(),
                qty,
                charge,
                parseFloat(product.cost_price || 0),
                user?.id || null,
                user?.name || "Technician"
              ]
            );
          }
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          emitEvent("repair.updated", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Update an already-issued spare part (quantity or charge)
       */
      static async updateUsedPart(repairId, usedPartId, updateData, user) {
        return await db.withTransaction(async (client) => {
          const usedRes = await client.query(
            "SELECT * FROM repair_parts_used WHERE id = $1 AND repair_job_id = $2 FOR UPDATE",
            [usedPartId, repairId]
          );
          if (usedRes.rows.length === 0) {
            const error = new Error("Issued spare part record not found on this repair job.");
            error.status = 404;
            throw error;
          }
          const used = usedRes.rows[0];
          const oldQty = parseInt(used.quantity || 1, 10);
          const newQty = updateData.quantity !== void 0 ? parseInt(updateData.quantity, 10) : oldQty;
          const newCharge = updateData.customerCharge !== void 0 ? parseFloat(updateData.customerCharge) : parseFloat(used.customer_charge || 0);
          if (isNaN(newQty) || newQty <= 0) {
            const error = new Error("Part quantity must be at least 1.");
            error.status = 400;
            throw error;
          }
          if (isNaN(newCharge) || newCharge < 0) {
            const error = new Error("Customer charge must be a non-negative number.");
            error.status = 400;
            throw error;
          }
          const qtyDiff = newQty - oldQty;
          if (used.part_id) {
            if (qtyDiff > 0) {
              const partRes = await client.query("SELECT current_stock, name, code FROM repair_parts WHERE id = $1 FOR UPDATE", [used.part_id]);
              if (partRes.rows.length > 0 && partRes.rows[0].current_stock < qtyDiff) {
                const error = new Error(`Insufficient stock to add ${qtyDiff} more units. Available: ${partRes.rows[0].current_stock}`);
                error.status = 400;
                throw error;
              }
            }
            if (qtyDiff !== 0) {
              await client.query(
                "UPDATE repair_parts SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [qtyDiff, used.part_id]
              );
            }
          } else if (used.product_id && qtyDiff !== 0) {
            await InventoryService.adjustStock({
              productId: used.product_id,
              direction: qtyDiff > 0 ? "OUT" : "IN",
              quantity: Math.abs(qtyDiff),
              reason: `Repair part quantity adjustment on ${repairId}`,
              refType: "Repair Job",
              refId: repairId,
              date: /* @__PURE__ */ new Date(),
              user
            }, client);
          }
          await client.query(
            `UPDATE repair_parts_used SET quantity = $1, customer_charge = $2 WHERE id = $3`,
            [newQty, newCharge, usedPartId]
          );
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              jobRes.rows[0].status,
              `Spare part updated: ${used.name} (New Qty: ${newQty}, New Charge: PKR ${newCharge.toFixed(2)})`,
              user?.id || null,
              user?.name || "Technician"
            ]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          emitEvent("repair.updated", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Remove an issued spare part and restore stock
       */
      static async removeUsedPart(repairId, usedPartId, user) {
        return await db.withTransaction(async (client) => {
          const usedRes = await client.query(
            "SELECT * FROM repair_parts_used WHERE id = $1 AND repair_job_id = $2 FOR UPDATE",
            [usedPartId, repairId]
          );
          if (usedRes.rows.length === 0) {
            const error = new Error("Issued spare part record not found on this repair job.");
            error.status = 404;
            throw error;
          }
          const used = usedRes.rows[0];
          const returnQty = parseInt(used.quantity || 1, 10);
          if (used.part_id) {
            await client.query(
              "UPDATE repair_parts SET current_stock = current_stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
              [returnQty, used.part_id]
            );
            try {
              await client.query(
                `INSERT INTO repair_parts_movements (
              part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, 'IN', $4, $5, 'Repair Job Return', $6, $7, $8)`,
                [
                  used.part_id,
                  used.product_code,
                  used.name,
                  returnQty,
                  `Returned from repair job ${repairId}`,
                  repairId,
                  user?.id || null,
                  user?.name || "Technician"
                ]
              );
            } catch (mErr) {
              console.error("[Spare Parts Movement] Return log error:", mErr.message);
            }
          } else if (used.product_id) {
            await InventoryService.adjustStock({
              productId: used.product_id,
              direction: "IN",
              quantity: returnQty,
              reason: `Repair part returned from job ${repairId}`,
              refType: "Repair Job",
              refId: repairId,
              date: /* @__PURE__ */ new Date(),
              user
            }, client);
          }
          await client.query("DELETE FROM repair_parts_used WHERE id = $1", [usedPartId]);
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              jobRes.rows[0].status,
              `Spare part removed: ${used.name} (${returnQty} units returned to inventory)`,
              user?.id || null,
              user?.name || "Technician"
            ]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          emitEvent("repair.updated", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Get full repair job card details
       */
      static async getJobDetails(repairId, userRole = "admin") {
        const jobRes = await db.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
        if (jobRes.rows.length === 0) return null;
        const job = jobRes.rows[0];
        const linesRes = await db.query("SELECT * FROM repair_job_lines WHERE repair_job_id = $1 ORDER BY id ASC", [repairId]);
        const partsRes = await db.query(
          `SELECT 
        id, repair_job_id, part_id, product_id, product_code, name, quantity, customer_charge,
        ${userRole === "technician" ? "0.00 as cost_price_snapshot" : "cost_price_snapshot"},
        added_by, added_by_name, added_at
       FROM repair_parts_used 
       WHERE repair_job_id = $1 ORDER BY id ASC`,
          [repairId]
        );
        const historyRes = await db.query(
          `SELECT * FROM repair_status_history WHERE repair_job_id = $1 ORDER BY created_at DESC`,
          [repairId]
        );
        const paymentsRes = await db.query(
          `SELECT * FROM payments WHERE invoice_no = $1 OR invoice_id = $2 ORDER BY date ASC, created_at ASC`,
          [job.tracking_id, job.invoice_id]
        );
        const isTech = userRole === "technician";
        return {
          id: job.id,
          trackingId: job.tracking_id,
          jobType: job.job_type,
          originJobType: job.origin_job_type,
          date: job.date,
          customerId: job.customer_id,
          customerName: job.customer_name,
          contact: job.contact,
          technicianId: job.technician_id,
          technicianName: job.technician_name,
          priority: job.priority,
          categoryId: job.category_id,
          categoryName: job.category_name,
          productType: job.product_type,
          brand: job.brand,
          model: job.model,
          serial: job.serial,
          problem: job.problem,
          diagnosisFee: isTech ? null : parseFloat(job.diagnosis_fee || 0),
          extraCharges: isTech ? null : parseFloat(job.extra_charges || 0),
          extraReason: isTech ? null : job.extra_reason,
          total: isTech ? null : parseFloat(job.total || 0),
          paid: isTech ? null : parseFloat(job.paid || 0),
          remaining: isTech ? null : Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0)),
          paymentMethod: isTech ? null : job.payment_method,
          paymentReference: isTech ? null : job.payment_reference,
          remarks: job.remarks,
          finalRemarks: job.final_remarks,
          diagnosedIssue: job.diagnosed_issue,
          recommendedSolution: job.recommended_solution,
          technicalNotes: job.technical_notes,
          workProgress: parseInt(job.work_progress || 0, 10),
          quotationAmount: isTech ? null : parseFloat(job.quotation_amount || 0),
          approvalStatus: job.approval_status,
          approvalRequestedAt: job.approval_requested_at,
          approvedAt: job.approved_at,
          approvedBy: job.approved_by,
          testingResult: job.testing_result,
          warrantyDays: parseInt(job.warranty_days || 0, 10),
          status: job.status,
          simpleStatus: simpleRepairStatus(job.status),
          duration: job.duration,
          expectedCompletion: job.expected_completion,
          invoiceId: isTech ? null : job.invoice_id,
          createdAt: job.created_at,
          lines: linesRes.rows.map((line) => {
            const unitCharge = parseFloat(line.charges || 0);
            const qty = parseInt(line.quantity || 1, 10);
            return {
              id: line.id,
              serviceId: line.service_id,
              name: line.name,
              catalogPriceSnapshot: isTech ? null : parseFloat(line.catalog_price_snapshot !== null && line.catalog_price_snapshot !== void 0 ? line.catalog_price_snapshot : unitCharge),
              charges: isTech ? null : unitCharge,
              quantity: qty,
              lineTotal: isTech ? null : unitCharge * qty,
              duration: line.duration,
              condition: line.condition,
              lineType: line.line_type || "repair",
              isApprovedRepairLine: line.is_approved_repair_line
            };
          }),
          usedParts: partsRes.rows.map((part) => {
            const unitCharge = parseFloat(part.customer_charge || 0);
            const qty = parseInt(part.quantity || 1, 10);
            return {
              id: part.id,
              partId: part.part_id || part.product_id,
              productId: part.product_id,
              productCode: part.product_code,
              name: part.name,
              quantity: qty,
              customerCharge: isTech ? null : unitCharge,
              costPriceSnapshot: isTech ? null : parseFloat(part.cost_price_snapshot || 0),
              lineTotal: isTech ? null : unitCharge * qty,
              addedBy: part.added_by_name || part.added_by,
              addedAt: part.added_at
            };
          }),
          history: historyRes.rows.map((h) => ({
            id: h.id,
            status: h.status,
            note: h.note,
            by: h.performed_by_name || h.performed_by,
            at: h.created_at
          })),
          paymentHistory: isTech ? [] : paymentsRes.rows.map((p) => ({
            id: p.id,
            amount: parseFloat(p.amount),
            method: p.payment_method,
            reference: p.reference_id,
            date: p.date,
            at: p.created_at,
            by: p.created_by_name || p.created_by,
            notes: p.notes
          }))
        };
      }
      /**
       * Add an additional service line to an existing repair job
       */
      static async addServiceLine(repairId, lineData, user) {
        return await db.withTransaction(async (client) => {
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          const { serviceId, name, charges, quantity, duration, condition } = lineData;
          let lineName = (name || "").trim();
          let unitCharge = parseFloat(charges !== void 0 && charges !== null ? charges : 0);
          let qty = parseInt(quantity || 1, 10);
          let catalogPrice = unitCharge;
          if (serviceId) {
            const srvRes = await client.query("SELECT name, charges, duration FROM repair_services WHERE id = $1", [serviceId]);
            if (srvRes.rows.length > 0) {
              if (!lineName) lineName = srvRes.rows[0].name;
              catalogPrice = parseFloat(srvRes.rows[0].charges || 0);
              if (isNaN(unitCharge) || unitCharge === 0) unitCharge = catalogPrice;
            }
          }
          if (!lineName) {
            const error = new Error("Service name is required.");
            error.status = 400;
            throw error;
          }
          if (isNaN(unitCharge) || unitCharge < 0) unitCharge = 0;
          if (isNaN(qty) || qty <= 0) qty = 1;
          const insRes = await client.query(
            `INSERT INTO repair_job_lines (
          repair_job_id, service_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'repair')
        RETURNING *`,
            [
              repairId,
              serviceId || null,
              lineName,
              catalogPrice,
              unitCharge,
              qty,
              (duration || "").trim(),
              (condition || "").trim()
            ]
          );
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              job.status,
              `Additional service added: ${lineName} (Charge: PKR ${unitCharge.toFixed(2)}, Qty: ${qty})`,
              user?.id || null,
              user?.name || "Technician"
            ]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          emitEvent("repair.updated", refreshed.rows[0]);
          return {
            job: refreshed.rows[0],
            line: insRes.rows[0]
          };
        });
      }
      /**
       * Remove a service line from a repair job
       */
      static async removeServiceLine(repairId, lineId, user) {
        return await db.withTransaction(async (client) => {
          const lineRes = await client.query(
            "SELECT * FROM repair_job_lines WHERE id = $1 AND repair_job_id = $2 FOR UPDATE",
            [lineId, repairId]
          );
          if (lineRes.rows.length === 0) {
            const error = new Error("Service line not found on this repair job.");
            error.status = 404;
            throw error;
          }
          const line = lineRes.rows[0];
          await client.query("DELETE FROM repair_job_lines WHERE id = $1", [lineId]);
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              jobRes.rows[0].status,
              `Service line removed: ${line.name}`,
              user?.id || null,
              user?.name || "Technician"
            ]
          );
          await _RepairService.syncLinkedInvoice(repairId, client);
          const refreshed = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          emitEvent("repair.updated", refreshed.rows[0]);
          return refreshed.rows[0];
        });
      }
      /**
       * Create an Additional Work Request for a Service Job
       */
      static async createAdditionalWorkRequest(repairId, requestData, user) {
        return await db.withTransaction(async (client) => {
          const {
            faultFinding,
            recommendedService,
            serviceCharge,
            partsCharge,
            customerSafeNote,
            parts
          } = requestData;
          if (!faultFinding || !recommendedService) {
            const error = new Error("Fault finding and recommended service are required.");
            error.status = 400;
            throw error;
          }
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          const sCharge = parseFloat(serviceCharge || 0);
          const pCharge = parseFloat(partsCharge || 0);
          const totalQuotation = sCharge + pCharge;
          const reqId = await getNextEntityId("repair_additional_work_requests", "id", "AWR", 4, client);
          const partsPayload = Array.isArray(parts) ? parts : [];
          const snapshot = {
            faultFinding: faultFinding.trim(),
            recommendedService: recommendedService.trim(),
            serviceCharge: sCharge,
            partsCharge: pCharge,
            totalQuotation,
            customerSafeNote: customerSafeNote ? customerSafeNote.trim() : "",
            parts: partsPayload,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          let validUserId = null;
          if (user?.id) {
            const uCheck = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
          }
          const insRes = await client.query(
            `INSERT INTO repair_additional_work_requests (
          id, repair_job_id, tracking_id, fault_finding, recommended_service,
          service_charge, parts_charge, total_quotation, customer_safe_note,
          parts_payload, status, quotation_snapshot, created_by, created_by_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending Approval', $11, $12, $13)
        RETURNING *`,
            [
              reqId,
              repairId,
              job.tracking_id,
              faultFinding.trim(),
              recommendedService.trim(),
              sCharge,
              pCharge,
              totalQuotation,
              customerSafeNote ? customerSafeNote.trim() : null,
              JSON.stringify(partsPayload),
              JSON.stringify(snapshot),
              validUserId,
              user?.name || "Technician"
            ]
          );
          const createdRequest = insRes.rows[0];
          const cleanContact = String(job.contact || "").trim();
          if (cleanContact) {
            const convRes = await client.query("SELECT id FROM whatsapp_conversations WHERE contact = $1", [cleanContact]);
            let convId = null;
            if (convRes.rows.length > 0) {
              convId = convRes.rows[0].id;
            } else {
              convId = await getNextEntityId("whatsapp_conversations", "id", "CONV", 4, client);
              await client.query(
                `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
             VALUES ($1, $2, $3, 'Bot Active', 'Repair Notification')`,
                [convId, cleanContact, job.customer_name]
              );
            }
            await client.query(
              `UPDATE whatsapp_conversations 
           SET bot_state = 'additional_work_approval', approval_tracking_id = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
              [job.tracking_id, convId]
            );
            const approvalMsg = buildAdditionalWorkApprovalTemplate({
              job,
              workRequest: createdRequest
            });
            await client.query(
              `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
           VALUES ($1, 'out', $2, 'approval_request')`,
              [convId, approvalMsg]
            );
            await client.query(
              `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [approvalMsg, convId]
            );
            emitEvent("whatsapp.message_added", { conversationId: convId, text: approvalMsg });
            try {
              const baileys = require_baileys_service();
              if (await baileys.isCurrentBranchConnected()) {
                await baileys.sendTextMessage(job.contact, approvalMsg);
                console.log(`[Baileys] Sent additional work quote to customer ${job.contact}`);
              }
            } catch (waErr) {
              console.error("[Baileys] Error sending additional work approval WhatsApp:", waErr.message);
            }
          }
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              job.status,
              `Additional fault discovered: ${faultFinding.trim()}. Additional work quote: PKR ${totalQuotation.toFixed(2)} sent for customer approval.`,
              validUserId,
              user?.name || "Technician"
            ]
          );
          emitEvent("repair.additional_work_created", { repairId, request: createdRequest });
          emitEvent("repair.updated", job);
          return createdRequest;
        });
      }
      /**
       * Get all Additional Work Requests for a Repair Job
       */
      static async getAdditionalWorkRequests(repairId) {
        const res = await db.query(
          `SELECT * FROM repair_additional_work_requests 
       WHERE repair_job_id = $1 
       ORDER BY created_at DESC`,
          [repairId]
        );
        return res.rows;
      }
      /**
       * Approve an Additional Work Request (Idempotent)
       */
      static async approveAdditionalWorkRequest(repairId, requestId, user, approvalSource = "Admin", customerResponse = null) {
        return await db.withTransaction(async (client) => {
          const reqRes = await client.query(
            `SELECT * FROM repair_additional_work_requests 
         WHERE id = $1 AND repair_job_id = $2 FOR UPDATE`,
            [requestId, repairId]
          );
          if (reqRes.rows.length === 0) {
            const error = new Error("Additional work request not found.");
            error.status = 404;
            throw error;
          }
          const workRequest = reqRes.rows[0];
          if (workRequest.status !== "Pending Approval") {
            const error = new Error(`This additional work request has already been ${workRequest.status.toLowerCase()}.`);
            error.status = 400;
            throw error;
          }
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          let validUserId = null;
          if (user?.id) {
            const uCheck = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
          }
          const updReq = await client.query(
            `UPDATE repair_additional_work_requests SET
          status = 'Approved',
          approval_source = $1,
          approved_by = $2,
          approved_by_name = $3,
          customer_response = $4,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
            [
              approvalSource,
              validUserId,
              user?.name || approvalSource,
              customerResponse || `Approved via ${approvalSource}`,
              requestId
            ]
          );
          const approvedRequest = updReq.rows[0];
          const serviceCharge = parseFloat(workRequest.service_charge || 0);
          if (serviceCharge > 0 || workRequest.recommended_service) {
            await client.query(
              `INSERT INTO repair_job_lines (
            repair_job_id, name, catalog_price_snapshot, charges, quantity, duration, condition, line_type, is_approved_repair_line
          ) VALUES ($1, $2, $3, $3, 1, 'Approved Additional Service', $4, 'additional_approved', TRUE)`,
              [
                repairId,
                workRequest.recommended_service || "Approved Additional Service",
                serviceCharge,
                `Additional fault approval (${workRequest.fault_finding})`
              ]
            );
          }
          let partsList = [];
          try {
            let rawPayload = workRequest.parts_payload;
            if (typeof rawPayload === "string") {
              try {
                rawPayload = JSON.parse(rawPayload);
              } catch (_) {
              }
            }
            if (typeof rawPayload === "string") {
              try {
                rawPayload = JSON.parse(rawPayload);
              } catch (_) {
              }
            }
            if (Array.isArray(rawPayload)) {
              partsList = rawPayload;
            }
          } catch (e) {
            partsList = [];
          }
          for (const partItem of partsList) {
            if (!partItem.partId) continue;
            const partRes = await client.query("SELECT * FROM repair_parts WHERE id = $1 FOR UPDATE", [partItem.partId]);
            if (partRes.rows.length > 0) {
              const partObj = partRes.rows[0];
              const qty = parseInt(partItem.quantity || 1, 10);
              const sellingPrice = parseFloat(
                partItem.customerCharge !== void 0 && partItem.customerCharge !== null ? partItem.customerCharge : partItem.sellingPrice !== void 0 && partItem.sellingPrice !== null ? partItem.sellingPrice : partObj.selling_price || 0
              );
              const costPrice = parseFloat(partObj.cost_price || 0);
              const newStock = Math.max(0, partObj.current_stock - qty);
              await client.query("UPDATE repair_parts SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [newStock, partObj.id]);
              await client.query(
                `INSERT INTO repair_parts_used (
              repair_job_id, part_id, product_code, name, quantity, customer_charge, cost_price_snapshot, added_by, added_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  repairId,
                  partObj.id,
                  partObj.code,
                  partObj.name,
                  qty,
                  sellingPrice,
                  costPrice,
                  validUserId,
                  user?.name || approvalSource
                ]
              );
              await client.query(
                `INSERT INTO repair_parts_movements (
              part_id, part_code, part_name, direction, quantity, reason, reference_type, reference_id, balance_after, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, 'OUT', $4, $5, 'Additional Repair Job Usage', $6, $7, $8, $9)`,
                [
                  partObj.id,
                  partObj.code,
                  partObj.name,
                  qty,
                  `Consumed for repair ${job.tracking_id} via additional fault approval`,
                  job.tracking_id,
                  newStock,
                  validUserId,
                  user?.name || approvalSource
                ]
              );
            }
          }
          await _RepairService.syncLinkedInvoice(repairId, client);
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              job.status,
              `Additional work approved by ${approvalSource}: ${workRequest.recommended_service} (PKR ${parseFloat(workRequest.total_quotation || 0).toFixed(2)})`,
              validUserId,
              user?.name || approvalSource
            ]
          );
          const cleanContact = String(job.contact || "").trim();
          if (cleanContact) {
            await client.query(
              `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
              [cleanContact]
            );
            const convRes = await client.query("SELECT id FROM whatsapp_conversations WHERE contact = $1", [cleanContact]);
            if (convRes.rows.length > 0) {
              const convId = convRes.rows[0].id;
              const confMsg = buildAdditionalWorkApprovedTemplate({
                job,
                workRequest: approvedRequest
              });
              await client.query(
                `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
             VALUES ($1, 'out', $2, 'approval_confirmed')`,
                [convId, confMsg]
              );
              await client.query(
                `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [confMsg, convId]
              );
              emitEvent("whatsapp.message_added", { conversationId: convId, text: confMsg });
            }
          }
          const refreshedJob = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [repairId]);
          emitEvent("repair.additional_work_approved", { repairId, request: approvedRequest });
          emitEvent("repair.updated", refreshedJob.rows[0]);
          return {
            success: true,
            request: approvedRequest,
            job: refreshedJob.rows[0]
          };
        });
      }
      /**
       * Decline an Additional Work Request (Idempotent)
       */
      static async declineAdditionalWorkRequest(repairId, requestId, user, approvalSource = "Admin", customerResponse = null) {
        return await db.withTransaction(async (client) => {
          const reqRes = await client.query(
            `SELECT * FROM repair_additional_work_requests 
         WHERE id = $1 AND repair_job_id = $2 FOR UPDATE`,
            [requestId, repairId]
          );
          if (reqRes.rows.length === 0) {
            const error = new Error("Additional work request not found.");
            error.status = 404;
            throw error;
          }
          const workRequest = reqRes.rows[0];
          if (workRequest.status !== "Pending Approval") {
            const error = new Error(`This additional work request has already been ${workRequest.status.toLowerCase()}.`);
            error.status = 400;
            throw error;
          }
          const jobRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1 FOR UPDATE", [repairId]);
          if (jobRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          const job = jobRes.rows[0];
          let validUserId = null;
          if (user?.id) {
            const uCheck = await client.query("SELECT id FROM users WHERE id = $1", [user.id]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
          }
          const updReq = await client.query(
            `UPDATE repair_additional_work_requests SET
          status = 'Declined',
          approval_source = $1,
          approved_by = $2,
          approved_by_name = $3,
          customer_response = $4,
          declined_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
            [
              approvalSource,
              validUserId,
              user?.name || approvalSource,
              customerResponse || `Declined via ${approvalSource}`,
              requestId
            ]
          );
          const declinedRequest = updReq.rows[0];
          await client.query(
            `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
            [
              repairId,
              job.status,
              `Additional work declined by ${approvalSource}: ${workRequest.recommended_service}. Original service job proceeds normally without extra charges.`,
              validUserId,
              user?.name || approvalSource
            ]
          );
          const cleanContact = String(job.contact || "").trim();
          if (cleanContact) {
            await client.query(
              `UPDATE whatsapp_conversations 
           SET bot_state = NULL, approval_tracking_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE contact = $1`,
              [cleanContact]
            );
            const convRes = await client.query("SELECT id FROM whatsapp_conversations WHERE contact = $1", [cleanContact]);
            if (convRes.rows.length > 0) {
              const convId = convRes.rows[0].id;
              const declineMsg = buildAdditionalWorkDeclinedTemplate({
                job,
                workRequest: declinedRequest
              });
              await client.query(
                `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
             VALUES ($1, 'out', $2, 'approval_declined')`,
                [convId, declineMsg]
              );
              await client.query(
                `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [declineMsg, convId]
              );
              emitEvent("whatsapp.message_added", { conversationId: convId, text: declineMsg });
            }
          }
          emitEvent("repair.additional_work_declined", { repairId, request: declinedRequest });
          emitEvent("repair.updated", job);
          return {
            success: true,
            request: declinedRequest,
            job
          };
        });
      }
    };
    module2.exports = RepairService;
  }
});

// src/middleware/rbac.js
var require_rbac = __commonJS({
  "src/middleware/rbac.js"(exports2, module2) {
    var requireRole = (...allowedRoles) => {
      return (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            code: "UNAUTHORIZED",
            message: "Authentication required."
          });
        }
        if (req.user.role === "super_admin" || req.user.isSuperAdmin) {
          return next();
        }
        if (!allowedRoles.includes(req.user.role)) {
          return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: `Access denied. Requires one of the following roles: ${allowedRoles.join(", ")}.`
          });
        }
        next();
      };
    };
    module2.exports = {
      requireRole,
      requireAdmin: requireRole("admin", "super_admin"),
      requireSalesOrAdmin: requireRole("admin", "sales", "super_admin"),
      requireTechnicianOrAdmin: requireRole("admin", "technician", "super_admin"),
      requireAny: requireRole("admin", "sales", "technician", "super_admin")
    };
  }
});

// src/modules/whatsapp/whatsapp.routes.js
var require_whatsapp_routes = __commonJS({
  "src/modules/whatsapp/whatsapp.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireSalesOrAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    var RepairService = require_repairs_service();
    var {
      buildTrackingResponseTemplate,
      buildApprovalConfirmationTemplate,
      buildDeclineConfirmationTemplate,
      buildAdditionalWorkApprovedTemplate,
      buildAdditionalWorkDeclinedTemplate
    } = require_whatsapp_templates();
    router.use(authenticateToken);
    async function findRepairJob(queryStr, contact, client = db) {
      const raw = String(queryStr || "").trim();
      if (!raw) return null;
      let res = await client.query(
        `SELECT * FROM repair_jobs 
     WHERE UPPER(tracking_id) = UPPER($1) 
        OR UPPER(id) = UPPER($1) 
        OR UPPER(tracking_id) = UPPER($2) 
        OR UPPER(id) = UPPER($2)`,
        [raw, `RPR-${raw}`]
      );
      if (res.rows.length > 0) return res.rows[0];
      const match = raw.match(/(?:RPR|REP)[- ]?(?:2026[- ]?)?([0-9]+)/i);
      if (match) {
        const numPart = match[1];
        const padded5 = String(numPart).padStart(5, "0");
        res = await client.query(
          `SELECT * FROM repair_jobs 
       WHERE tracking_id = $1 OR id = $2 OR tracking_id = $3
       ORDER BY created_at DESC LIMIT 1`,
          [`RPR-${padded5}`, `REP-${padded5}`, `RPR-${numPart}`]
        );
        if (res.rows.length > 0) return res.rows[0];
      }
      const numOnly = raw.replace(/[^0-9]/g, "");
      if (numOnly && numOnly.length >= 1 && numOnly.length <= 6) {
        const padded5 = String(numOnly).padStart(5, "0");
        res = await client.query(
          `SELECT * FROM repair_jobs 
       WHERE tracking_id = $1 OR id = $2 OR tracking_id = $3
       ORDER BY created_at DESC LIMIT 1`,
          [`RPR-${padded5}`, `REP-${padded5}`, `RPR-${numOnly}`]
        );
        if (res.rows.length > 0) return res.rows[0];
      }
      if (contact) {
        const cleanPhone = String(contact).replace(/[^0-9]/g, "");
        if (cleanPhone.length >= 7) {
          res = await client.query(
            `SELECT * FROM repair_jobs 
         WHERE contact LIKE $1 OR contact LIKE $2 
         ORDER BY created_at DESC LIMIT 1`,
            [`%${cleanPhone}%`, `%${cleanPhone.slice(-7)}%`]
          );
          if (res.rows.length > 0) return res.rows[0];
        }
      }
      return null;
    }
    async function processBotReply(input, conv, client = db) {
      const raw = String(input || "").trim();
      const t = raw.toLowerCase();
      const isApproveCmd = /^(?:1|approve|approved|proceed|yes|haan|ok)\b/i.test(t) || t.startsWith("approve");
      const isDeclineCmd = /^(?:2|decline|declined|cancel|no|nahi)\b/i.test(t) || t.startsWith("decline");
      if (isApproveCmd || isDeclineCmd || conv.bot_state === "additional_work_approval" || conv.bot_state === "repair_approval") {
        let targetTrackingId = conv.approval_tracking_id;
        const matchedTrack = raw.match(/(?:RPR|REP)[- ]?[0-9]+/i);
        if (matchedTrack) targetTrackingId = matchedTrack[0];
        let pendingWorkReq = null;
        let jobForWorkReq = null;
        if (targetTrackingId) {
          const wrRes = await client.query(
            `SELECT * FROM repair_additional_work_requests 
         WHERE UPPER(tracking_id) = UPPER($1) AND status = 'Pending Approval' 
         ORDER BY created_at DESC LIMIT 1`,
            [targetTrackingId]
          );
          if (wrRes.rows.length > 0) {
            pendingWorkReq = wrRes.rows[0];
            const jRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [pendingWorkReq.repair_job_id]);
            if (jRes.rows.length > 0) jobForWorkReq = jRes.rows[0];
          }
        }
        if (!pendingWorkReq && conv.contact) {
          const cleanPhone = String(conv.contact).replace(/[^0-9]/g, "");
          const wrRes = await client.query(
            `SELECT awr.* FROM repair_additional_work_requests awr
         JOIN repair_jobs rj ON awr.repair_job_id = rj.id
         WHERE (rj.contact LIKE $1 OR rj.contact LIKE $2) AND awr.status = 'Pending Approval'
         ORDER BY awr.created_at DESC LIMIT 1`,
            [`%${cleanPhone}%`, `%${cleanPhone.slice(-7)}%`]
          );
          if (wrRes.rows.length > 0) {
            pendingWorkReq = wrRes.rows[0];
            const jRes = await client.query("SELECT * FROM repair_jobs WHERE id = $1", [pendingWorkReq.repair_job_id]);
            if (jRes.rows.length > 0) jobForWorkReq = jRes.rows[0];
          }
        }
        if (pendingWorkReq && jobForWorkReq) {
          if (isApproveCmd) {
            const result2 = await RepairService.approveAdditionalWorkRequest(
              pendingWorkReq.repair_job_id,
              pendingWorkReq.id,
              { name: "WhatsApp Customer" },
              "WhatsApp",
              "Customer approved additional work via WhatsApp"
            );
            await client.query("UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1", [conv.id]);
            return buildAdditionalWorkApprovedTemplate({ job: result2.job, workRequest: result2.request });
          }
          if (isDeclineCmd) {
            const result2 = await RepairService.declineAdditionalWorkRequest(
              pendingWorkReq.repair_job_id,
              pendingWorkReq.id,
              { name: "WhatsApp Customer" },
              "WhatsApp",
              "Customer declined additional work via WhatsApp"
            );
            await client.query("UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1", [conv.id]);
            return buildAdditionalWorkDeclinedTemplate({ job: result2.job, workRequest: result2.request });
          }
        }
        let job = null;
        if (targetTrackingId) {
          const jRes = await client.query("SELECT * FROM repair_jobs WHERE UPPER(tracking_id) = UPPER($1) OR id = $1", [targetTrackingId]);
          if (jRes.rows.length > 0) job = jRes.rows[0];
        }
        if (!job && conv.contact) {
          const cleanPhone = String(conv.contact).replace(/[^0-9]/g, "");
          const jRes = await client.query(
            `SELECT * FROM repair_jobs 
         WHERE (contact LIKE $1 OR contact LIKE $2) AND status = 'Waiting for Customer Approval' 
         ORDER BY created_at DESC LIMIT 1`,
            [`%${cleanPhone}%`, `%${cleanPhone.slice(-7)}%`]
          );
          if (jRes.rows.length > 0) job = jRes.rows[0];
        }
        if (job && job.status === "Waiting for Customer Approval") {
          if (isApproveCmd) {
            const approvedJob = await RepairService.approveQuote(job.id, { name: "WhatsApp Customer" }, "WhatsApp");
            await client.query("UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1", [conv.id]);
            return buildApprovalConfirmationTemplate(approvedJob);
          }
          if (isDeclineCmd) {
            const declinedJob = await RepairService.declineQuote(job.id, { name: "WhatsApp Customer" }, "WhatsApp");
            await client.query("UPDATE whatsapp_conversations SET bot_state = NULL, approval_tracking_id = NULL WHERE id = $1", [conv.id]);
            return buildDeclineConfirmationTemplate(declinedJob);
          }
        }
      }
      const isDirectTrackPattern = /^(?:rpr|rep)[- ]?[0-9]+/i.test(raw) || /\b(?:rpr|rep)[- ][0-9]+/i.test(raw) || /\btrack\b/i.test(raw) && /[0-9]+/.test(raw);
      if (conv.bot_state === "track_id" || isDirectTrackPattern) {
        const job = await findRepairJob(raw, conv.contact, client);
        if (!job) {
          await client.query("UPDATE whatsapp_conversations SET bot_state = NULL WHERE id = $1", [conv.id]);
          return `\u{1F4CB} Tracking ID Not Found

We could not find any active repair job matching "${raw}".

Please send your tracking ID (e.g. RPR-00001).`;
        }
        if (job.status === "Waiting for Customer Approval") {
          await client.query("UPDATE whatsapp_conversations SET bot_state = 'repair_approval', approval_tracking_id = $1 WHERE id = $2", [job.tracking_id, conv.id]);
        } else {
          await client.query("UPDATE whatsapp_conversations SET bot_state = NULL WHERE id = $1", [conv.id]);
        }
        return buildTrackingResponseTemplate({ job, safeNote: job.final_remarks });
      }
      if (t === "1" || t === "buy" || t.includes("buy laptop") || t.includes("inventory")) {
        const prodRes = await client.query(
          `SELECT brand, model, product_name, expected_sale_price, condition 
       FROM products WHERE current_stock > 0 ORDER BY date_added DESC LIMIT 6`
        );
        if (prodRes.rows.length === 0) return "No laptops or products are currently available in inventory.";
        return "\u{1F4F1} Available Laptops in Stock:\n\n" + prodRes.rows.map((p, i) => `${i + 1}. ${p.brand} ${p.model || p.product_name} \u2014 PKR ${parseFloat(p.expected_sale_price).toLocaleString("en-PK")} (${p.condition})`).join("\n") + "\n\nReply 4 to search by budget or 6 to speak with our sales agent.";
      }
      if (t === "2" || t.includes("repair service") || t.includes("repair issue")) {
        await client.query("UPDATE whatsapp_conversations SET bot_state = 'repair_problem', lead_type = 'Repair Lead' WHERE id = $1", [conv.id]);
        return "\u{1F527} Repair Service Booking\n\nPlease describe the issue with your laptop/device (e.g. No power, Display broken, Water damaged, Motherboard heating, Windows reinstall):";
      }
      if (conv.bot_state === "repair_problem") {
        await client.query("UPDATE whatsapp_conversations SET bot_state = NULL, status = 'Human Handoff', lead_type = 'Repair Lead' WHERE id = $1", [conv.id]);
        return "\u2705 Inquiry Received!\n\nThank you! Your repair inquiry has been logged. A customer service technician will assist you with pricing and drop-off instructions shortly.";
      }
      if (t === "3" || t === "track" || t.includes("track repair") || t.includes("track laptop") || t.includes("status")) {
        const existingJob = await findRepairJob(null, conv.contact, client);
        if (existingJob) {
          await client.query("UPDATE whatsapp_conversations SET bot_state = 'track_id' WHERE id = $1", [conv.id]);
          return buildTrackingResponseTemplate({ job: existingJob, safeNote: existingJob.final_remarks });
        }
        await client.query("UPDATE whatsapp_conversations SET bot_state = 'track_id' WHERE id = $1", [conv.id]);
        return "\u{1F4CB} Live Repair Tracking\n\nPlease enter your Repair Tracking ID (e.g. RPR-00001) to check real-time bench status:";
      }
      if (t === "4" || t.includes("quotation") || t.includes("budget")) {
        await client.query("UPDATE whatsapp_conversations SET bot_state = 'quote_budget', lead_type = 'Quotation' WHERE id = $1", [conv.id]);
        return "\u{1F4B0} *Get Laptop Quotation / Price Match*\n\nPlease enter your approximate budget in PKR (e.g. 50000 or 80000):";
      }
      if (conv.bot_state === "quote_budget") {
        const budget = parseFloat(raw.replace(/[^\d.]/g, "") || 0);
        const prodRes = await client.query(
          `SELECT brand, model, product_name, expected_sale_price, specifications 
       FROM products WHERE current_stock > 0 AND expected_sale_price <= $1 
       ORDER BY expected_sale_price DESC LIMIT 5`,
          [budget || 999999]
        );
        await client.query("UPDATE whatsapp_conversations SET bot_state = NULL WHERE id = $1", [conv.id]);
        if (prodRes.rows.length === 0) {
          return `No laptops matching your budget of PKR ${budget.toLocaleString("en-PK")} were found.

Reply *6* to talk to an agent for customized options.`;
        }
        return `\u{1F4BB} *Matching Laptops Within PKR ${budget.toLocaleString("en-PK")}:*

` + prodRes.rows.map((p, i) => `${i + 1}. *${p.brand} ${p.model || p.product_name}* \u2014 PKR ${parseFloat(p.expected_sale_price).toLocaleString("en-PK")}`).join("\n") + "\n\nReply *6* to reserve or talk to our sales agent.";
      }
      if (t === "5" || t.includes("location") || t.includes("address")) {
        const setRes = await client.query("SELECT shop_location FROM whatsapp_settings WHERE id = 1");
        const loc = setRes.rows.length > 0 ? setRes.rows[0].shop_location : null;
        return `\u{1F4CD} *Shop Location:*
${loc || "Main Boulevard Computer Plaza, Lahore."}

\u{1F552} *Timings:* Mon - Sat (11:00 AM - 9:00 PM)`;
      }
      if (t === "6" || t.includes("agent") || t.includes("human") || t.includes("help")) {
        await client.query("UPDATE whatsapp_conversations SET status = 'Human Handoff' WHERE id = $1", [conv.id]);
        return "\u{1F64B}\u200D\u2642\uFE0F *Human Agent Requested*\n\nOur customer support representative has been notified and will reply to you here shortly.";
      }
      const welcomeRes = await client.query("SELECT welcome_message FROM whatsapp_settings WHERE id = 1");
      const customWelcome = welcomeRes.rows.length > 0 && welcomeRes.rows[0].welcome_message ? welcomeRes.rows[0].welcome_message : null;
      return customWelcome || "\u{1F44B} *Welcome to Retail & Laptop Repair Management!*\n\nHow can we help you today? Please reply with a number:\n\n1\uFE0F\u20E3 *Buy Laptop* (Browse Inventory)\n2\uFE0F\u20E3 *Repair Service* (Book a Repair)\n3\uFE0F\u20E3 *Track Repair* (Live Status of your Laptop)\n4\uFE0F\u20E3 *Get Quotation* (Find by Budget)\n5\uFE0F\u20E3 *Shop Location & Hours*\n6\uFE0F\u20E3 *Talk to Human Agent*";
    }
    router.get("/settings", async (req, res, next) => {
      try {
        const result2 = await db.query("SELECT * FROM whatsapp_settings WHERE id = 1");
        return res.json({
          success: true,
          data: result2.rows[0] || {}
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/settings", async (req, res, next) => {
      try {
        const { connected, number, businessName, botEnabled, humanHandoff, salesAccess, autoStatusNotifications, welcomeMessage, shopLocation, autoInvoiceWhatsapp } = req.body;
        const updateRes = await db.query(
          `UPDATE whatsapp_settings SET
        connected = COALESCE($1, connected),
        number = COALESCE($2, number),
        business_name = COALESCE($3, business_name),
        bot_enabled = COALESCE($4, bot_enabled),
        human_handoff = COALESCE($5, human_handoff),
        sales_access = COALESCE($6, sales_access),
        auto_status_notifications = COALESCE($7, auto_status_notifications),
        welcome_message = COALESCE($8, welcome_message),
        shop_location = COALESCE($9, shop_location),
        auto_invoice_whatsapp = COALESCE($10, auto_invoice_whatsapp),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
          [connected, number, businessName, botEnabled, humanHandoff, salesAccess, autoStatusNotifications, welcomeMessage, shopLocation, autoInvoiceWhatsapp]
        );
        emitEvent("whatsapp.settings_updated", updateRes.rows[0]);
        return res.json({
          success: true,
          message: "WhatsApp settings updated successfully",
          data: updateRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/conversations", async (req, res, next) => {
      try {
        const convRes = await db.query("SELECT * FROM whatsapp_conversations ORDER BY updated_at DESC");
        const conversations = [];
        for (const conv of convRes.rows) {
          const msgRes = await db.query(
            "SELECT * FROM whatsapp_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
            [conv.id]
          );
          conversations.push({
            id: conv.id,
            contact: conv.contact,
            name: conv.name,
            status: conv.status,
            botState: conv.bot_state,
            leadType: conv.lead_type,
            lastMessage: conv.last_message,
            updatedAt: conv.updated_at,
            messages: msgRes.rows.map((m) => ({
              id: m.id,
              direction: m.direction,
              text: m.text,
              tag: m.tag,
              at: m.created_at
            }))
          });
        }
        return res.json({
          success: true,
          data: conversations
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/conversations/simulate", async (req, res, next) => {
      try {
        const { name, contact, message } = req.body;
        if (!name || !contact) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Name and contact are required."
          });
        }
        const cleanContact = String(contact).trim();
        const cleanName = String(name).trim();
        let conv = null;
        const existing = await db.query("SELECT * FROM whatsapp_conversations WHERE contact = $1", [cleanContact]);
        if (existing.rows.length > 0) {
          conv = existing.rows[0];
        } else {
          const convId = await getNextEntityId("whatsapp_conversations", "id", "CONV", 4);
          const ins = await db.query(
            `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
         VALUES ($1, $2, $3, 'Bot Active', 'General')
         RETURNING *`,
            [convId, cleanContact, cleanName]
          );
          conv = ins.rows[0];
        }
        const text = message || "Assalamualaikum";
        await db.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'in', $2, 'customer')`,
          [conv.id, text]
        );
        const replyText = await processBotReply(text, conv);
        if (replyText) {
          await db.query(
            `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, 'bot')`,
            [conv.id, replyText]
          );
          await db.query(
            `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [replyText, conv.id]
          );
        }
        emitEvent("whatsapp.conversation_updated", { conversationId: conv.id });
        return res.status(201).json({
          success: true,
          message: "Conversation simulated successfully",
          data: { conversationId: conv.id }
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/messages/send", async (req, res, next) => {
      try {
        const { conversationId, text, tag } = req.body;
        if (!conversationId || !text) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Conversation ID and message text are required."
          });
        }
        await db.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, $3)`,
          [conversationId, text.trim(), tag || "agent"]
        );
        const convRes = await db.query(
          `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING contact`,
          [text.trim(), conversationId]
        );
        emitEvent("whatsapp.message_added", { conversationId, text: text.trim() });
        if (convRes.rows.length > 0 && convRes.rows[0].contact) {
          const contactPhone = convRes.rows[0].contact;
          const branchId = req.branchId || req.user && req.user.branch_id || 1;
          try {
            if (await baileys.isBranchConnected(branchId)) {
              await baileys.sendTextMessage(branchId, contactPhone, text.trim());
              console.log(`[Baileys Branch ${branchId}] Agent message successfully dispatched to ${contactPhone}`);
            }
          } catch (waErr) {
            console.error(`[Baileys Branch ${branchId}] Error dispatching agent message to WhatsApp:`, waErr.message);
          }
        }
        return res.json({
          success: true,
          message: "Message sent"
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/messages/customer-input", async (req, res, next) => {
      try {
        const { conversationId, text } = req.body;
        if (!conversationId || !text) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Conversation ID and text are required."
          });
        }
        const convRes = await db.query("SELECT * FROM whatsapp_conversations WHERE id = $1", [conversationId]);
        if (convRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Conversation not found."
          });
        }
        const conv = convRes.rows[0];
        await db.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'in', $2, 'customer')`,
          [conversationId, text.trim()]
        );
        if (conv.status !== "Human Handoff") {
          const reply = await processBotReply(text, conv);
          if (reply) {
            await db.query(
              `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, 'bot')`,
              [conversationId, reply]
            );
            await db.query(
              `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [reply, conversationId]
            );
          }
        } else {
          await db.query(
            `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [text.trim(), conversationId]
          );
        }
        emitEvent("whatsapp.conversation_updated", { conversationId });
        return res.json({
          success: true,
          message: "Message processed"
        });
      } catch (error) {
        next(error);
      }
    });
    router.patch("/conversations/:id/handoff", async (req, res, next) => {
      try {
        const { id } = req.params;
        const convRes = await db.query("SELECT status FROM whatsapp_conversations WHERE id = $1", [id]);
        if (convRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Conversation not found."
          });
        }
        const currentStatus = convRes.rows[0].status;
        const newStatus = currentStatus === "Human Handoff" ? "Bot Active" : "Human Handoff";
        await db.query("UPDATE whatsapp_conversations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [newStatus, id]);
        emitEvent("whatsapp.conversation_updated", { conversationId: id, status: newStatus });
        return res.json({
          success: true,
          message: `Conversation switched to ${newStatus}`,
          data: { status: newStatus }
        });
      } catch (error) {
        next(error);
      }
    });
    var baileys = require_baileys_service();
    router.get("/status", async (req, res, next) => {
      try {
        const branchId = req.branchId || req.user && req.user.branch_id || 1;
        let status = await baileys.getStatus(branchId);
        if (!status.connected) {
          try {
            const branchManager = require_branchManager();
            const pool = await branchManager.getBranchPool(branchId);
            const { rows } = await pool.query(
              "SELECT connected, is_connected, number, business_name FROM whatsapp_settings WHERE id = $1",
              [branchId]
            );
            const settingsRow = rows[0];
            if (settingsRow && (settingsRow.connected || settingsRow.is_connected)) {
              status = {
                ...status,
                connected: true,
                authenticated: true,
                phone: settingsRow.number || status.phone,
                name: settingsRow.business_name || status.name
              };
              baileys.initWhatsAppIfSessionExists(branchId).catch(() => {
              });
            }
          } catch (_) {
          }
        }
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          success: true,
          data: status
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/connect", async (req, res, next) => {
      try {
        const branchId = req.branchId || req.user && req.user.branch_id || 1;
        const status = await baileys.waitForQrOrStatus(branchId, 15e3, true);
        return res.json({
          success: true,
          message: status.qr ? "WhatsApp QR code generated. Please scan with WhatsApp on your mobile device." : "WhatsApp connection initiated.",
          data: status
        });
      } catch (err) {
        next(err);
      }
    });
    router.post("/disconnect", async (req, res, next) => {
      try {
        const branchId = req.branchId || req.user && req.user.branch_id || 1;
        const result2 = await baileys.disconnect(branchId);
        return res.json({
          success: true,
          message: `WhatsApp session for Branch ${branchId} disconnected & logged out`,
          data: result2
        });
      } catch (err) {
        next(err);
      }
    });
    router.post("/send-test", async (req, res, next) => {
      try {
        const branchId = req.branchId || req.user && req.user.branch_id || 1;
        const { phone, message } = req.body;
        if (!phone || !message) {
          return res.status(400).json({ success: false, message: "Phone number and message text are required." });
        }
        await baileys.sendTextMessage(branchId, phone, message);
        return res.json({
          success: true,
          message: `Test WhatsApp message successfully sent to ${phone}!`
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: err.message || "Failed to send WhatsApp message. Is WhatsApp connected?"
        });
      }
    });
    router.processBotReply = processBotReply;
    module2.exports = router;
  }
});

// src/modules/whatsapp/baileys.service.js
var require_baileys_service = __commonJS({
  "src/modules/whatsapp/baileys.service.js"(exports2, module2) {
    var QRCode = require("qrcode");
    var pino = require("pino");
    var path2 = require("path");
    var fs2 = require("fs");
    var authStore = require_auth_store();
    var db = require_db();
    var { emitEvent } = require_socket();
    var { getNextEntityId } = require_codeGenerator();
    var origStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, encoding, callback) => {
      if (typeof chunk === "string" && chunk.includes("Closing session: SessionEntry")) {
        if (typeof callback === "function") callback();
        return true;
      }
      return origStdout(chunk, encoding, callback);
    };
    var baileysModule = null;
    async function getBaileys() {
      if (!baileysModule) {
        baileysModule = await import("@whiskeysockets/baileys");
      }
      return baileysModule;
    }
    var versionRequest = null;
    var versionExpiresAt = 0;
    async function getWhatsAppVersion() {
      if (!versionRequest || Date.now() >= versionExpiresAt) {
        versionExpiresAt = Date.now() + 15 * 60 * 1e3;
        versionRequest = (async () => {
          const b = await getBaileys();
          const result2 = await (b.fetchLatestWaWebVersion ? b.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(1e4) }) : b.fetchLatestBaileysVersion({ signal: AbortSignal.timeout(1e4) }));
          if (!result2?.version || result2.error || result2.isLatest === false) {
            throw new Error("Could not obtain the current WhatsApp Web version");
          }
          return result2.version;
        })().catch((error) => {
          versionRequest = null;
          throw error;
        });
      }
      return versionRequest;
    }
    function getAuthDir(branchId = 1) {
      const bId = parseInt(branchId, 10) || 1;
      const base = process.env.WHATSAPP_AUTH_DIR || path2.join(__dirname, "../../../.whatsapp_session");
      return path2.join(base, `branch_${bId}`);
    }
    var {
      buildTrackingResponseTemplate,
      buildApprovalConfirmationTemplate,
      buildDeclineConfirmationTemplate,
      buildAdditionalWorkApprovedTemplate,
      buildAdditionalWorkDeclinedTemplate
    } = require_whatsapp_templates();
    var RepairService = require_repairs_service();
    var BranchSession = class {
      constructor(branchId) {
        this.branchId = parseInt(branchId, 10) || 1;
        this.sock = null;
        this.qrCodeDataUrl = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.isLinking = false;
        this.connectedUser = null;
        this.reconnectTimer = null;
        this.generation = 0;
        this.auth = null;
        this.reuseAuth = false;
        this.updatedAt = Date.now();
        this.retryCount = 0;
        this.stopped = false;
        this.requiresRelink = false;
        this.lastError = null;
      }
    };
    var BaileysService = class {
      constructor() {
        this.sessions = /* @__PURE__ */ new Map();
        this.logger = pino({ level: "silent" });
      }
      getSession(branchId = 1) {
        const bId = parseInt(branchId, 10) || 1;
        if (!this.sessions.has(bId)) {
          this.sessions.set(bId, new BranchSession(bId));
        }
        return this.sessions.get(bId);
      }
      isBranchConnected(branchId = 1) {
        const session = this.getSession(branchId);
        return Boolean(session && session.isConnected);
      }
      get isConnected() {
        try {
          const { branchStorage } = require_branchContext();
          const store = branchStorage.getStore();
          const bId = store && store.branchId ? store.branchId : 1;
          return this.isBranchConnected(bId);
        } catch (e) {
          return this.isBranchConnected(1);
        }
      }
      formatPhoneJid(phone) {
        if (!phone) return null;
        let clean = String(phone).replace(/[^0-9]/g, "");
        if (clean.startsWith("0092")) {
          clean = clean.slice(2);
        } else if (clean.startsWith("03")) {
          clean = "92" + clean.slice(1);
        } else if (clean.length === 10 && clean.startsWith("3")) {
          clean = "92" + clean;
        }
        if (!clean) return null;
        return `${clean}@s.whatsapp.net`;
      }
      async hasSavedSession(branchId = 1) {
        const branchManager = require_branchManager();
        const pool = await branchManager.getBranchPool(branchId);
        const saved = await authStore.hasSavedSession(pool, branchId);
        if (saved !== null) return saved;
        try {
          const authDir = getAuthDir(branchId);
          const credsPath = path2.join(authDir, "creds.json");
          if (!fs2.existsSync(credsPath)) return false;
          const raw = fs2.readFileSync(credsPath, "utf8");
          const creds = JSON.parse(raw);
          return Boolean(creds && (creds.me?.id || creds.registered === true));
        } catch (e) {
          return false;
        }
      }
      async initWhatsAppIfSessionExists(targetBranchId = null) {
        if (targetBranchId) {
          const bId = parseInt(targetBranchId, 10);
          if (await this.hasSavedSession(bId)) {
            console.log(`[Baileys] Active WhatsApp session found for Branch ${bId}. Connecting...`);
            return this.initWhatsApp(bId, false);
          }
          return;
        }
        try {
          const branchManager = require_branchManager();
          const branches = await branchManager.listBranches();
          for (const b of branches) {
            if (this.getSession(b.id).stopped) continue;
            if (await this.hasSavedSession(b.id)) {
              console.log(`[Baileys] Active WhatsApp session found for Branch ${b.id} (${b.branch_name}). Connecting...`);
              await this.initWhatsApp(b.id, false);
            } else {
              console.log(`[Baileys] No active WhatsApp session for Branch ${b.id} (${b.branch_name}). Idle.`);
            }
          }
        } catch (e) {
          if (await this.hasSavedSession(1)) {
            await this.initWhatsApp(1, false);
          }
        }
      }
      initWhatsApp(branchId = 1, forceNew = false, forceAcquire = false) {
        const session = this.getSession(branchId);
        if (forceNew) {
          if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
          session.reconnectTimer = null;
          if (session.sock) this.retireSocket(session);
          session.isConnecting = false;
        }
        if (session.initializing) return session.initializing;
        session.initializing = this.initializeSocket(branchId, forceAcquire || forceNew).finally(() => {
          session.initializing = null;
        });
        return session.initializing;
      }
      async isCurrentBranchConnected() {
        return this.isConnected;
      }
      async initializeSocket(branchId = 1, force = false) {
        const bId = parseInt(branchId, 10) || 1;
        const session = this.getSession(bId);
        if (!force && (session.sock || session.isConnecting)) return;
        if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
        session.stopped = false;
        session.lastError = null;
        const generation = ++session.generation;
        const current = () => generation === session.generation && !session.stopped;
        session.isConnecting = true;
        this.emitStatus(bId);
        const authDir = getAuthDir(bId);
        try {
          const baileys = await getBaileys();
          const version = await getWhatsAppVersion();
          if (!current()) return;
          const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
          const {
            DisconnectReason,
            makeCacheableSignalKeyStore,
            Browsers
          } = baileys;
          const branchManager = require_branchManager();
          const pool = await branchManager.getBranchPool(bId);
          let auth = session.reuseAuth ? session.auth : null;
          if (!auth) auth = await authStore.openAuthStore(pool, bId, authDir, baileys, (error) => {
            if (session.stopped || session.auth !== auth) return;
            session.lastError = "Session storage unavailable; retrying safely.";
            console.error(`[Baileys] Branch ${bId} auth storage failure:`, error.message);
            this.retireSocket(session);
            this.scheduleReconnect(bId);
          }, true);
          if (!current()) {
            await auth.close();
            return;
          }
          session.auth = auth;
          session.reuseAuth = false;
          const { state, saveCreds } = auth;
          session.connectedUser = state.creds.me || null;
          await saveCreds();
          if (!current()) return;
          session.sock = makeWASocket({
            version,
            logger: this.logger,
            printQRInTerminal: false,
            auth: {
              creds: state.creds,
              keys: makeCacheableSignalKeyStore(state.keys, this.logger)
            },
            browser: Browsers.windows("Desktop"),
            syncFullHistory: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            connectTimeoutMs: 3e4,
            defaultQueryTimeoutMs: 3e4,
            keepAliveIntervalMs: 25e3,
            retryRequestDelayMs: 250,
            getMessage: async () => ({ conversation: "" })
          });
          const sock = session.sock;
          sock.ev.on("creds.update", () => {
            if (current()) saveCreds().catch((error) => console.error(`[Baileys] Credential save failed for ${bId}:`, error.message));
          });
          sock.ev.on("connection.update", (update) => {
            handleConnection(update).catch((error) => {
              if (!current()) return;
              console.error(`[Baileys] Branch ${bId} connection handler failed:`, error.message);
              this.retireSocket(session);
              this.scheduleReconnect(bId);
            });
          });
          const handleConnection = async (update) => {
            if (!current()) return;
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
              try {
                const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 5 });
                if (!current() || session.isConnected) return;
                session.qrCodeDataUrl = dataUrl;
                session.requiresRelink = false;
                session.isConnected = false;
                session.isConnecting = false;
                session.isLinking = false;
                this.emitStatus(bId);
                console.log(`[Baileys] \u26A1 Live WhatsApp QR Code ready for Branch ${bId}! Scan with mobile device.`);
              } catch (err) {
                console.error(`[Baileys] Error generating QR data URL for branch ${bId}:`, err);
              }
            }
            if (connection === "connecting") {
              session.isConnecting = true;
              this.emitStatus(bId);
            }
            if (connection === "open") {
              await saveCreds();
              if (!current()) return;
              session.retryCount = 0;
              session.requiresRelink = false;
              session.lastError = null;
              session.isConnected = true;
              session.isConnecting = false;
              session.isLinking = false;
              session.qrCodeDataUrl = null;
              session.connectedUser = session.sock.user;
              this.emitStatus(bId);
              console.log(`[Baileys] \u2705 WhatsApp Multi-Device connection established for Branch ${bId}:`, session.sock.user);
              const phone = session.sock.user?.id ? session.sock.user.id.split(":")[0].split("@")[0] : "";
              try {
                const branchManager2 = require_branchManager();
                const pool2 = await branchManager2.getBranchPool(bId);
                await pool2.query(
                  `UPDATE whatsapp_settings SET connected = TRUE, is_connected = TRUE, number = COALESCE(NULLIF(number, ''), $1), updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
                  [phone]
                );
              } catch (dbErr) {
                console.error(`[Baileys] DB update settings error for branch ${bId}:`, dbErr.message);
              }
              this.emitStatus(bId);
            }
            if (connection === "close") {
              const code = lastDisconnect?.error?.output?.statusCode;
              const registered = Boolean(state.creds.registered || state.creds.me?.id);
              const hadQr = Boolean(session.qrCodeDataUrl);
              const restart = code === DisconnectReason.restartRequired;
              console.log(`[Baileys] Branch ${bId} connection closed (Code: ${code})`);
              if (code === 428) {
                versionRequest = null;
                versionExpiresAt = 0;
              }
              this.retireSocket(session);
              const closingGeneration = session.generation;
              session.isConnecting = true;
              session.isLinking = restart;
              this.emitStatus(bId);
              await auth.flush();
              if (closingGeneration !== session.generation) return;
              if (restart) {
                session.reuseAuth = true;
                session.isConnecting = false;
                this.scheduleReconnect(bId, 0);
                return;
              }
              try {
                if (code === DisconnectReason.loggedOut) {
                  session.stopped = true;
                  session.requiresRelink = true;
                  session.connectedUser = null;
                  session.lastError = "WhatsApp revoked this linked session. Link the device again.";
                  await auth.clear();
                } else if ([
                  DisconnectReason.connectionReplaced,
                  DisconnectReason.badSession,
                  DisconnectReason.multideviceMismatch,
                  DisconnectReason.forbidden
                ].includes(code)) {
                  session.stopped = true;
                  session.requiresRelink = true;
                  session.lastError = `WhatsApp rejected the connection (${code}). Check linked devices before reconnecting.`;
                }
              } catch (error) {
                session.stopped = true;
                session.lastError = "Could not update session storage. Check the backend database before reconnecting.";
                console.error(`[Baileys] Branch ${bId} session cleanup failed:`, error.message);
              } finally {
                await auth.close();
              }
              if (closingGeneration !== session.generation) return;
              if (session.auth === auth) session.auth = null;
              session.isConnecting = false;
              session.isLinking = restart;
              if (!session.stopped && (registered || restart || !hadQr && session.retryCount < 4)) {
                this.scheduleReconnect(bId, restart ? 300 : void 0);
              } else if (!session.stopped && !hadQr) {
                session.lastError = "WhatsApp could not generate a QR. Check the backend connection and try Generate QR Code again.";
              }
              this.emitStatus(bId);
            }
          };
          sock.ev.on("messages.upsert", async ({ messages, type }) => {
            if (!current()) return;
            for (const msg of messages) {
              if (!msg.message) continue;
              const senderJid = msg.key.remoteJid;
              if (!senderJid || senderJid.endsWith("@g.us") || senderJid.endsWith("@broadcast") || senderJid.endsWith("@newsletter")) continue;
              const myPhone = session.connectedUser?.id ? session.connectedUser.id.split(":")[0].split("@")[0] : null;
              const myLid = session.connectedUser?.lid ? session.connectedUser.lid.split(":")[0].split("@")[0] : null;
              const isSelfChat = Boolean(
                myPhone && senderJid.includes(myPhone) || myLid && senderJid.includes(myLid)
              );
              const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "").trim();
              console.log(`[Baileys] \u{1F4E5} Message event received (Branch ${bId}):`, {
                fromMe: msg.key.fromMe,
                senderJid,
                isSelfChat,
                text: text.slice(0, 30)
              });
              if (msg.key.fromMe) {
                if (!isSelfChat) continue;
                if (session.lastBotReply && (session.lastBotReply === text || session.lastBotReply.includes(text.slice(0, 30)))) {
                  continue;
                }
              }
              await this.handleIncomingMessage(bId, msg);
            }
          });
        } catch (error) {
          if (!current()) return;
          this.retireSocket(session);
          if (session.auth) {
            await session.auth.close();
            session.auth = null;
          }
          session.lastError = error.code === "WA_SESSION_BUSY" ? `Waiting for the previous WhatsApp connection to release its lock. Retrying in ${Math.ceil((error.retryAfterMs || 5e3) / 1e3)} seconds.` : "Connection interrupted. Retrying with saved credentials.";
          console.error(`[Baileys] Branch ${bId} initialization failed:`, error.message);
          this.scheduleReconnect(bId, error.code === "WA_SESSION_BUSY" ? (error.retryAfterMs || 5e3) + 250 : void 0);
        }
      }
      retireSocket(session) {
        ++session.generation;
        const sock = session.sock;
        session.sock = null;
        session.isConnected = false;
        session.isConnecting = false;
        session.isLinking = false;
        session.qrCodeDataUrl = null;
        if (sock) {
          sock.ev?.removeAllListeners?.();
          try {
            sock.end?.(new Error("Socket retired"));
          } catch (_) {
          }
        }
      }
      scheduleReconnect(branchId, delay) {
        const session = this.getSession(branchId);
        if (session.stopped || session.reconnectTimer) return;
        session.isConnecting = true;
        const generation = session.generation;
        const wait = delay ?? Math.min(6e4, 1e3 * 2 ** Math.min(session.retryCount++, 6));
        session.reconnectTimer = setTimeout(async () => {
          session.reconnectTimer = null;
          if (session.stopped || generation !== session.generation) return;
          if (session.auth && !session.reuseAuth) {
            await session.auth.close();
            session.auth = null;
          }
          if (session.stopped || generation !== session.generation) return;
          session.isConnecting = false;
          await this.initWhatsApp(branchId);
        }, wait);
        this.emitStatus(branchId);
      }
      async shutdown() {
        await Promise.all([...this.sessions.values()].map(async (session) => {
          session.stopped = true;
          if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
          session.reconnectTimer = null;
          this.retireSocket(session);
          if (session.initializing) await session.initializing;
          if (session.auth) {
            await session.auth.close();
            session.auth = null;
          }
        }));
      }
      async handleIncomingMessage(arg1, arg2 = null) {
        try {
          const branchId = arg2 !== null ? parseInt(arg1, 10) || 1 : 1;
          const msg = arg2 !== null ? arg2 : arg1;
          if (!msg || !msg.key) return;
          const senderJid = msg.key.remoteJid;
          if (!senderJid || senderJid.endsWith("@g.us") || senderJid.endsWith("@broadcast") || senderJid.endsWith("@newsletter")) return;
          const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || msg.message?.templateButtonReplyMessage?.selectedId || "";
          const text = rawText.trim();
          if (!text) return;
          let cleanPhone = senderJid.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
          if (senderJid.endsWith("@lid") && msg.key.participant) {
            cleanPhone = msg.key.participant.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
          }
          console.log(`[Baileys] \u{1F4E9} Received WhatsApp message from ${cleanPhone || senderJid}: "${text}"`);
          const [jidUser, jidServer] = senderJid.split("@");
          const cleanUser = (jidUser || "").split(":")[0].replace(/[^0-9]/g, "");
          const replyJid = cleanUser && jidServer ? `${cleanUser}@${jidServer}` : senderJid;
          const branchManager = require_branchManager();
          const { branchStorage } = require_branchContext();
          const pool = await branchManager.getBranchPool(branchId);
          await branchStorage.run({ branchId, pool }, async () => {
            const sRes = await pool.query("SELECT * FROM whatsapp_settings WHERE id = 1");
            const settings = sRes.rows[0] || {};
            if (settings.bot_enabled === false) {
              console.log("[Baileys] WhatsApp bot is disabled in settings. Skipping automated reply.");
              return;
            }
            let conv = null;
            const convRes = await pool.query(
              "SELECT * FROM whatsapp_conversations WHERE contact = $1 OR contact LIKE $2 ORDER BY updated_at DESC LIMIT 1",
              [cleanPhone, `%${cleanPhone.slice(-10)}%`]
            );
            if (convRes.rows.length > 0) {
              conv = convRes.rows[0];
            } else {
              const convId = await getNextEntityId("whatsapp_conversations", "id", "CONV", 4, pool);
              const insRes = await pool.query(
                `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
             VALUES ($1, $2, $3, 'Bot Active', 'General') RETURNING *`,
                [convId, cleanPhone || "WhatsApp User", msg.pushName || "WhatsApp Customer"]
              );
              conv = insRes.rows[0];
            }
            await pool.query(
              `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'in', $2, 'customer')`,
              [conv.id, text]
            );
            await pool.query(
              `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [text, conv.id]
            );
            emitEvent("whatsapp.message_added", { conversationId: conv.id, text, direction: "in" });
            emitEvent("whatsapp.conversation_updated", { conversationId: conv.id });
            if (conv.status === "Human Handoff" && text !== "1" && text !== "2" && text !== "3" && text !== "4" && text !== "5" && text.toLowerCase() !== "menu") {
              console.log(`[Baileys] Conversation ${conv.id} is in Human Handoff mode. Message logged in CRM for staff.`);
              return;
            }
            const whatsappRoutes = require_whatsapp_routes();
            let replyText = null;
            if (typeof whatsappRoutes.processBotReply === "function") {
              replyText = await whatsappRoutes.processBotReply(text, conv, pool);
            }
            if (!replyText) {
              replyText = settings.welcome_message || `\u{1F44B} Welcome to *${settings.business_name || "Retail & Repair Management"}*!

How can we help you today? Please reply with a number:

1\uFE0F\u20E3 *Buy Laptop* (Browse Inventory)
2\uFE0F\u20E3 *Repair Service* (Book a Repair)
3\uFE0F\u20E3 *Track Repair* (Live Status of your Laptop)
4\uFE0F\u20E3 *Get Quotation* (Find by Budget)
5\uFE0F\u20E3 *Shop Location & Hours*
6\uFE0F\u20E3 *Talk to Human Agent*`;
            }
            const session = this.getSession(branchId);
            session.lastBotReply = replyText.trim();
            await this.sendRawMessage(replyJid, replyText, branchId);
            console.log(`[Baileys] \u{1F916} Successfully sent automated reply to ${replyJid}: "${replyText.slice(0, 40)}..."`);
            await pool.query(
              `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag) VALUES ($1, 'out', $2, 'bot')`,
              [conv.id, replyText]
            );
            await pool.query(
              `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [replyText, conv.id]
            );
            emitEvent("whatsapp.message_added", { conversationId: conv.id, text: replyText, direction: "out" });
            emitEvent("whatsapp.conversation_updated", { conversationId: conv.id });
          });
        } catch (err) {
          console.error("[Baileys] Error handling incoming WhatsApp message:", err);
        }
      }
      async ensureConnected(branchId = 1, timeoutMs = 12e3) {
        const bId = parseInt(branchId, 10) || 1;
        const session = this.getSession(bId);
        if (session.sock && session.isConnected) return true;
        const hasSaved = await this.hasSavedSession(bId);
        if (!hasSaved) return false;
        if (!session.sock && !session.isConnecting) {
          this.initWhatsApp(bId, false).catch((err) => {
            console.warn(`[Baileys] Auto-connect for Branch ${bId} failed:`, err.message);
          });
        }
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (session.sock && session.isConnected) return true;
          if (session.stopped || session.requiresRelink) return false;
          await new Promise((r) => setTimeout(r, 250));
        }
        return Boolean(session.sock && session.isConnected);
      }
      async sendRawMessage(jid, text, branchId = 1) {
        await this.ensureConnected(branchId);
        const session = this.getSession(branchId);
        if (!session.sock || !session.isConnected) {
          throw new Error(`WhatsApp is connecting or not paired for Branch ${branchId}. Please ensure the device is linked in WhatsApp Settings.`);
        }
        let targetJid = jid;
        if (targetJid && !targetJid.includes("@g.us") && !targetJid.includes("@lid")) {
          const clean = targetJid.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
          if (clean) {
            targetJid = `${clean}@s.whatsapp.net`;
          }
        }
        return await session.sock.sendMessage(targetJid, { text });
      }
      async sendTextMessage(arg1, arg2, arg3 = null) {
        let branchId = 1;
        let phone = null;
        let text = null;
        if (arg3 !== null) {
          branchId = parseInt(arg1, 10) || 1;
          phone = arg2;
          text = arg3;
        } else {
          phone = arg1;
          text = arg2;
          try {
            const { branchStorage } = require_branchContext();
            const store = branchStorage.getStore();
            if (store && store.branchId) {
              branchId = parseInt(store.branchId, 10) || 1;
            }
          } catch (e) {
          }
        }
        await this.ensureConnected(branchId);
        const session = this.getSession(branchId);
        if (!session.sock || !session.isConnected) {
          throw new Error(`WhatsApp is not connected for Branch ${branchId}. Please scan QR code in Branch ${branchId} settings first.`);
        }
        const jid = this.formatPhoneJid(phone);
        if (!jid) throw new Error(`Invalid phone number: "${phone}"`);
        return await session.sock.sendMessage(jid, { text });
      }
      /**
       * Send PDF or document attachment with optional caption via Baileys WhatsApp
       */
      async sendDocumentMessage(arg1, arg2, arg3 = null, arg4 = "", arg5 = null) {
        let branchId = 1;
        let phone = null;
        let documentBuffer = null;
        let fileName = "Document.pdf";
        let caption = "";
        if (arg5 !== null) {
          branchId = parseInt(arg1, 10) || 1;
          phone = arg2;
          documentBuffer = arg3;
          fileName = arg4 || "Invoice.pdf";
          caption = arg5 || "";
        } else {
          phone = arg1;
          documentBuffer = arg2;
          fileName = arg3 || "Invoice.pdf";
          caption = arg4 || "";
          try {
            const { branchStorage } = require_branchContext();
            const store = branchStorage.getStore();
            if (store && store.branchId) {
              branchId = parseInt(store.branchId, 10) || 1;
            }
          } catch (e) {
          }
        }
        await this.ensureConnected(branchId);
        const session = this.getSession(branchId);
        if (!session.sock || !session.isConnected) {
          throw new Error(`WhatsApp is not connected for Branch ${branchId}. Please scan QR code first.`);
        }
        const jid = this.formatPhoneJid(phone);
        if (!jid) throw new Error(`Invalid phone number: "${phone}"`);
        return await session.sock.sendMessage(jid, {
          document: documentBuffer,
          mimetype: "application/pdf",
          fileName,
          caption: caption || void 0
        });
      }
      getStatus(branchId = 1) {
        const session = this.getSession(branchId);
        const phone = session.connectedUser?.id ? session.connectedUser.id.split(":")[0].split("@")[0] : null;
        return {
          branchId: session.branchId,
          updatedAt: session.updatedAt,
          connected: session.isConnected,
          connecting: session.isConnecting,
          linking: Boolean(session.isLinking),
          qr: session.qrCodeDataUrl,
          phone,
          name: session.connectedUser?.name || "Connected WhatsApp Multi-Device",
          authenticated: !session.requiresRelink && Boolean(session.isConnected || session.auth?.state.creds.registered || session.connectedUser),
          reconnecting: session.isConnecting && !session.isLinking && Boolean(session.connectedUser || session.auth?.state.creds.registered),
          requiresRelink: session.requiresRelink,
          error: session.lastError
        };
      }
      emitStatus(branchId = 1) {
        const bId = parseInt(branchId, 10) || 1;
        const session = this.getSession(bId);
        session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
        const status = this.getStatus(bId);
        if (this.publishWorkerStatus) this.publishWorkerStatus(bId, status);
        try {
          const { getIO } = require_socket();
          const io = getIO();
          if (io) {
            io.to(`branch_${bId}`).emit("whatsapp:status", status);
            io.emit("whatsapp:status", status);
            if (status.qr) {
              io.to(`branch_${bId}`).emit("whatsapp:qr", { qr: status.qr, branchId: bId });
              io.emit("whatsapp:qr", { qr: status.qr, branchId: bId });
            }
          }
        } catch (e) {
        }
        emitEvent("whatsapp:status", status);
      }
      async waitForQrOrStatus(branchId = 1, timeoutMs = 15e3, force = true) {
        const bId = parseInt(branchId, 10) || 1;
        const session = this.getSession(bId);
        if (!force && session.isConnected) return this.getStatus(bId);
        if (!force && session.isLinking) return this.getStatus(bId);
        if (force || !session.sock && !session.isConnecting) {
          session.retryCount = 0;
          await this.initWhatsApp(bId, force, force);
        }
        if (session.qrCodeDataUrl) return this.getStatus(bId);
        return new Promise((resolve) => {
          const startTime = Date.now();
          const interval = setInterval(() => {
            if (session.qrCodeDataUrl || session.isConnected || session.isLinking || session.lastError || Date.now() - startTime > timeoutMs) {
              clearInterval(interval);
              resolve(this.getStatus(bId));
            }
          }, 300);
        });
      }
      clearAuthSession(branchId = 1) {
        const bId = parseInt(branchId, 10) || 1;
        const authDir = getAuthDir(bId);
        try {
          if (fs2.existsSync(authDir)) {
            fs2.rmSync(authDir, { recursive: true, force: true });
          }
        } catch (err) {
          console.error(`[Baileys] Error removing auth directory for branch ${bId}:`, err);
        }
        const session = this.getSession(bId);
        session.isConnected = false;
        session.isConnecting = false;
        session.isLinking = false;
        session.connectedUser = null;
        session.qrCodeDataUrl = null;
        if (session.reconnectTimer) {
          clearTimeout(session.reconnectTimer);
          session.reconnectTimer = null;
        }
      }
      async disconnect(branchId = 1) {
        const bId = parseInt(branchId, 10) || 1;
        const session = this.getSession(bId);
        session.stopped = true;
        ++session.generation;
        if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
        if (session.initializing) await session.initializing;
        let auth = session.auth;
        if (!auth) {
          try {
            const branchManager = require_branchManager();
            const pool = await branchManager.getBranchPool(bId);
            auth = await authStore.openAuthStore(pool, bId, getAuthDir(bId), await getBaileys(), () => {
            }, true);
          } catch (_) {
          }
        }
        const sock = session.sock;
        if (sock) {
          sock.ev?.removeAllListeners?.();
          try {
            await sock.logout();
          } catch (error) {
            console.warn(`[Baileys] Logout error for ${bId}:`, error.message);
          }
        }
        this.retireSocket(session);
        if (auth) {
          try {
            await auth.clear();
          } catch (_) {
          }
          try {
            await auth.close();
          } catch (_) {
          }
          if (session.auth === auth) session.auth = null;
        }
        this.clearAuthSession(bId);
        try {
          const branchManager = require_branchManager();
          const pool = await branchManager.getBranchPool(bId);
          await pool.query("DELETE FROM whatsapp_auth_state WHERE branch_id = $1", [bId]);
          await pool.query("DELETE FROM whatsapp_auth_leases WHERE branch_id = $1", [bId]);
          await pool.query(
            `UPDATE whatsapp_settings 
         SET connected = FALSE, is_connected = FALSE, number = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
            [bId]
          );
        } catch (dbErr) {
          console.error("[Baileys] Error resetting whatsapp_settings on disconnect:", dbErr.message);
        }
        session.requiresRelink = false;
        session.lastError = null;
        session.isConnected = false;
        session.isConnecting = false;
        session.qrCodeDataUrl = null;
        session.connectedUser = null;
        this.emitStatus(bId);
        return { success: true, message: `WhatsApp session for Branch ${bId} disconnected & logged out` };
      }
    };
    var baileysInstance = new BaileysService();
    module2.exports = baileysInstance;
  }
});

// src/modules/super-admin/super-admin.routes.js
var require_super_admin_routes = __commonJS({
  "src/modules/super-admin/super-admin.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var bcrypt = require("bcryptjs");
    var jwt = require("jsonwebtoken");
    var branchManager = require_branchManager();
    var identityRegistry = require_identityRegistry();
    var { getAvailableBalance } = require_financialFormulas();
    var { CacheService, cacheRoute } = require_cache();
    function r2(v) {
      return Math.round((parseFloat(v) || 0) * 100) / 100;
    }
    var requireSuperAdmin = async (req, res, next) => {
      try {
        let token = null;
        if (req.cookies && req.cookies.token) {
          token = req.cookies.token;
        } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
          token = req.headers.authorization.split(" ")[1];
        }
        if (!token) {
          return res.status(401).json({
            success: false,
            message: "Authentication required. Please login as Super Admin."
          });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026");
        if (decoded.role !== "super_admin") {
          return res.status(403).json({
            success: false,
            message: "Access denied. Super Admin privileges required."
          });
        }
        req.user = decoded;
        next();
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired Super Admin token."
        });
      }
    };
    async function computeBranchMetrics(pool, branchMeta = {}, from = null, to = null) {
      let dateFilterInv = "";
      let dateFilterRep = "";
      let dateFilterExp = "";
      const invParams = [];
      const repParams = [];
      const expParams = [];
      if (from) {
        invParams.push(from);
        dateFilterInv += ` AND date >= $${invParams.length}`;
        repParams.push(from);
        dateFilterRep += ` AND date >= $${repParams.length}`;
        expParams.push(from);
        dateFilterExp += ` AND date >= $${expParams.length}`;
      }
      if (to) {
        invParams.push(to);
        dateFilterInv += ` AND date <= $${invParams.length}`;
        repParams.push(to);
        dateFilterRep += ` AND date <= $${repParams.length}`;
        expParams.push(to);
        dateFilterExp += ` AND date <= $${expParams.length}`;
      }
      const [
        salesRes,
        repairsRes,
        cogsRes,
        expRes,
        accountsRes,
        stockRes,
        cashInDrawer,
        onlineBalance,
        staffRes
      ] = await Promise.all([
        // 1. Sales & Purchases
        pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_sales,
        COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN 1 END) AS sales_count,
        COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN balance ELSE 0 END), 0) AS sales_unpaid,
        COALESCE(SUM(CASE WHEN (type = 'Purchase Invoice' OR type = 'Vendor Purchase') AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_purchases,
        COALESCE(SUM(CASE WHEN type = 'Buyback Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_buybacks,
        COALESCE(SUM(CASE WHEN type = 'Exchange Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_exchanges,
        COALESCE(SUM(CASE WHEN type = 'Return Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) AS total_returns
      FROM invoices WHERE 1=1 ${dateFilterInv}
    `, invParams),
        // 2. Repairs
        pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'Delivered & Closed' THEN total ELSE 0 END), 0) AS repair_revenue,
        COUNT(CASE WHEN status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) AS active_repairs,
        COUNT(CASE WHEN status = 'Delivered & Closed' THEN 1 END) AS completed_repairs,
        COUNT(*) AS total_repairs_count
      FROM repair_jobs WHERE 1=1 ${dateFilterRep}
    `, repParams),
        // 3. COGS (Cost of Goods Sold)
        pool.query(`
      SELECT COALESCE(SUM(ii.quantity * COALESCE(ii.cost_price_snapshot, p.cost_price, 0)), 0) AS total_cogs
      FROM invoice_items ii
      JOIN invoices inv ON ii.invoice_id = inv.id
      LEFT JOIN products p ON ii.product_id = p.id
      WHERE inv.type = 'Sales Invoice' AND inv.is_voided = FALSE ${dateFilterInv.replace(/date/g, "inv.date")}
    `, invParams),
        // 4. Expenses
        pool.query(`
      SELECT 
        COALESCE(SUM(amount), 0) AS total_expenses,
        COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN amount ELSE 0 END), 0) AS cash_expenses,
        COALESCE(SUM(CASE WHEN payment_method = 'Online' THEN amount ELSE 0 END), 0) AS online_expenses
      FROM expenses WHERE 1=1 ${dateFilterExp}
    `, expParams),
        // 5. Accounts (Receivables & Payables)
        pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'Customer Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS customer_receivable,
        COALESCE(SUM(CASE WHEN type = 'Customer Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS customer_payable,
        COALESCE(SUM(CASE WHEN type = 'Vendor Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS vendor_payable,
        COALESCE(SUM(CASE WHEN type = 'Vendor Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) AS vendor_receivable
      FROM accounts
    `),
        // 6. Inventory Valuation
        pool.query(`
      SELECT 
        COALESCE(SUM(current_stock * cost_price), 0) AS stock_cost_value,
        COALESCE(SUM(current_stock * expected_sale_price), 0) AS stock_sale_value,
        COALESCE(SUM(current_stock), 0) AS total_stock_items,
        COUNT(*) AS total_sku_count,
        COUNT(CASE WHEN current_stock <= low_stock_alert THEN 1 END) AS low_stock_count
      FROM products
    `),
        // 7. Cash Drawer & Online Liquidity
        getAvailableBalance("Cash", pool),
        getAvailableBalance("Online", pool),
        // 8. Staff Count
        pool.query(`SELECT COUNT(*) AS total_staff FROM users WHERE status = 'Active'`)
      ]);
      const sRow = salesRes.rows[0] || {};
      const rRow = repairsRes.rows[0] || {};
      const eRow = expRes.rows[0] || {};
      const aRow = accountsRes.rows[0] || {};
      const stRow = stockRes.rows[0] || {};
      const totalSales = parseFloat(sRow.total_sales || 0);
      const repairRevenue = parseFloat(rRow.repair_revenue || 0);
      const totalGrossRevenue = totalSales + repairRevenue;
      const totalCogs = parseFloat(cogsRes.rows[0]?.total_cogs || 0);
      const grossProfit = totalGrossRevenue - totalCogs;
      const totalExpenses = parseFloat(eRow.total_expenses || 0);
      const netProfit = grossProfit - totalExpenses;
      const custReceivable = parseFloat(aRow.customer_receivable || 0);
      const custPayable = parseFloat(aRow.customer_payable || 0);
      const vendPayable = parseFloat(aRow.vendor_payable || 0);
      const vendReceivable = parseFloat(aRow.vendor_receivable || 0);
      const stockCostValue = parseFloat(stRow.stock_cost_value || 0);
      const stockSaleValue = parseFloat(stRow.stock_sale_value || 0);
      return {
        branchId: branchMeta.id,
        branchCode: branchMeta.branch_code,
        branchName: branchMeta.branch_name,
        status: branchMeta.status || "Active",
        city: branchMeta.city || "",
        phone: branchMeta.phone || "",
        email: branchMeta.email || "",
        address: branchMeta.address || "",
        adminName: branchMeta.admin_name || "",
        adminUsername: branchMeta.admin_username || "",
        dbName: branchMeta.db_name,
        dbHost: branchMeta.db_host,
        schemaVersion: branchMeta.schema_version,
        createdAt: branchMeta.created_at,
        updatedAt: branchMeta.updated_at,
        isHealthy: true,
        // Core Financial Metrics
        totalSales: r2(totalSales),
        salesCount: parseInt(sRow.sales_count || 0, 10),
        salesUnpaidBalance: r2(sRow.sales_unpaid || 0),
        totalPurchases: r2(sRow.total_purchases || 0),
        totalBuybacks: r2(sRow.total_buybacks || 0),
        totalExchanges: r2(sRow.total_exchanges || 0),
        totalReturns: r2(sRow.total_returns || 0),
        // Repairs
        repairRevenue: r2(repairRevenue),
        activeRepairs: parseInt(rRow.active_repairs || 0, 10),
        completedRepairs: parseInt(rRow.completed_repairs || 0, 10),
        totalRepairsCount: parseInt(rRow.total_repairs_count || 0, 10),
        // Profitability
        totalGrossRevenue: r2(totalGrossRevenue),
        totalCogs: r2(totalCogs),
        grossProfit: r2(grossProfit),
        grossMarginPercent: totalGrossRevenue > 0 ? r2(grossProfit / totalGrossRevenue * 100) : 0,
        totalExpenses: r2(totalExpenses),
        cashExpenses: r2(eRow.cash_expenses || 0),
        onlineExpenses: r2(eRow.online_expenses || 0),
        netProfit: r2(netProfit),
        netMarginPercent: totalGrossRevenue > 0 ? r2(netProfit / totalGrossRevenue * 100) : 0,
        // Balances & Liquidity
        cashInDrawer: r2(cashInDrawer),
        onlineBalance: r2(onlineBalance),
        totalLiquidity: r2(cashInDrawer + onlineBalance),
        // Credit & Accounts
        customerReceivables: r2(custReceivable),
        customerPayables: r2(custPayable),
        vendorPayables: r2(vendPayable),
        vendorReceivables: r2(vendReceivable),
        netReceivables: r2(custReceivable - custPayable),
        netPayables: r2(vendPayable - vendReceivable),
        // Inventory
        stockCostValue: r2(stockCostValue),
        stockSaleValue: r2(stockSaleValue),
        totalStockItems: parseInt(stRow.total_stock_items || 0, 10),
        totalSkuCount: parseInt(stRow.total_sku_count || 0, 10),
        lowStockCount: parseInt(stRow.low_stock_count || 0, 10),
        // Staff
        staffCount: parseInt(staffRes.rows[0]?.total_staff || 0, 10)
      };
    }
    router.post("/login", async (req, res, next) => {
      try {
        const { username, password } = req.body;
        if (!username || !password) {
          return res.status(400).json({
            success: false,
            message: "Username and password are required."
          });
        }
        const cleanUser = String(username).trim().toLowerCase();
        const result2 = await branchManager.masterPool.query(
          `SELECT id, username, password_hash, name, email, status FROM master_super_admins WHERE LOWER(username) = $1 LIMIT 1`,
          [cleanUser]
        );
        if (result2.rows.length === 0) {
          return res.status(401).json({
            success: false,
            message: "Invalid Super Admin credentials."
          });
        }
        const admin = result2.rows[0];
        if (admin.status === "Inactive") {
          return res.status(403).json({
            success: false,
            message: "This Super Admin account is inactive."
          });
        }
        const isMatch = await bcrypt.compare(password, admin.password_hash);
        if (!isMatch) {
          return res.status(401).json({
            success: false,
            message: "Invalid Super Admin credentials."
          });
        }
        const token = jwt.sign(
          {
            id: admin.id,
            username: admin.username,
            name: admin.name,
            role: "super_admin",
            isSuperAdmin: true
          },
          process.env.JWT_SECRET || "retail_repair_jwt_super_secure_secret_key_2026",
          { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
        );
        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60 * 1e3
        });
        return res.json({
          success: true,
          message: "Super Admin authenticated successfully",
          data: {
            token,
            user: {
              id: admin.id,
              username: admin.username,
              name: admin.name,
              email: admin.email,
              role: "super_admin",
              isSuperAdmin: true
            }
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get(["/dashboard", "/reports/consolidated"], requireSuperAdmin, cacheRoute(30), async (req, res, next) => {
      try {
        const { branchId = "all", from, to } = req.query;
        const branches = await branchManager.listBranches();
        let targetBranches = branches;
        if (branchId !== "all") {
          const selectedId = parseInt(branchId, 10);
          targetBranches = branches.filter((b) => b.id === selectedId);
          if (targetBranches.length === 0) {
            return res.status(404).json({
              success: false,
              message: `Branch with ID ${branchId} not found.`
            });
          }
        }
        const branchReports = await Promise.all(targetBranches.map(async (b) => {
          try {
            const pool = await branchManager.getBranchPool(b.id, true);
            return await computeBranchMetrics(pool, b, from, to);
          } catch (err) {
            console.error(`[SuperAdmin Reporting] Error processing branch ${b.id}:`, err.message);
            return {
              branchId: b.id,
              branchCode: b.branch_code,
              branchName: b.branch_name,
              status: b.status,
              city: b.city,
              dbName: b.db_name,
              dbHost: b.db_host,
              isHealthy: false,
              error: err.message,
              totalSales: 0,
              repairRevenue: 0,
              totalExpenses: 0,
              grossProfit: 0,
              netProfit: 0,
              cashInDrawer: 0,
              onlineBalance: 0,
              totalLiquidity: 0,
              stockCostValue: 0,
              activeRepairs: 0,
              customerReceivables: 0,
              vendorPayables: 0,
              staffCount: 0
            };
          }
        }));
        const combined = {
          totalSales: r2(branchReports.reduce((sum, b) => sum + (b.totalSales || 0), 0)),
          salesCount: branchReports.reduce((sum, b) => sum + (b.salesCount || 0), 0),
          salesUnpaidBalance: r2(branchReports.reduce((sum, b) => sum + (b.salesUnpaidBalance || 0), 0)),
          totalPurchases: r2(branchReports.reduce((sum, b) => sum + (b.totalPurchases || 0), 0)),
          totalBuybacks: r2(branchReports.reduce((sum, b) => sum + (b.totalBuybacks || 0), 0)),
          totalExchanges: r2(branchReports.reduce((sum, b) => sum + (b.totalExchanges || 0), 0)),
          totalReturns: r2(branchReports.reduce((sum, b) => sum + (b.totalReturns || 0), 0)),
          repairRevenue: r2(branchReports.reduce((sum, b) => sum + (b.repairRevenue || 0), 0)),
          activeRepairs: branchReports.reduce((sum, b) => sum + (b.activeRepairs || 0), 0),
          completedRepairs: branchReports.reduce((sum, b) => sum + (b.completedRepairs || 0), 0),
          totalRepairsCount: branchReports.reduce((sum, b) => sum + (b.totalRepairsCount || 0), 0),
          totalGrossRevenue: r2(branchReports.reduce((sum, b) => sum + (b.totalGrossRevenue || 0), 0)),
          totalCogs: r2(branchReports.reduce((sum, b) => sum + (b.totalCogs || 0), 0)),
          grossProfit: r2(branchReports.reduce((sum, b) => sum + (b.grossProfit || 0), 0)),
          totalExpenses: r2(branchReports.reduce((sum, b) => sum + (b.totalExpenses || 0), 0)),
          cashExpenses: r2(branchReports.reduce((sum, b) => sum + (b.cashExpenses || 0), 0)),
          onlineExpenses: r2(branchReports.reduce((sum, b) => sum + (b.onlineExpenses || 0), 0)),
          netProfit: r2(branchReports.reduce((sum, b) => sum + (b.netProfit || 0), 0)),
          cashInDrawer: r2(branchReports.reduce((sum, b) => sum + (b.cashInDrawer || 0), 0)),
          onlineBalance: r2(branchReports.reduce((sum, b) => sum + (b.onlineBalance || 0), 0)),
          totalLiquidity: r2(branchReports.reduce((sum, b) => sum + (b.totalLiquidity || 0), 0)),
          customerReceivables: r2(branchReports.reduce((sum, b) => sum + (b.customerReceivables || 0), 0)),
          customerPayables: r2(branchReports.reduce((sum, b) => sum + (b.customerPayables || 0), 0)),
          vendorPayables: r2(branchReports.reduce((sum, b) => sum + (b.vendorPayables || 0), 0)),
          vendorReceivables: r2(branchReports.reduce((sum, b) => sum + (b.vendorReceivables || 0), 0)),
          netReceivables: r2(branchReports.reduce((sum, b) => sum + (b.netReceivables || 0), 0)),
          netPayables: r2(branchReports.reduce((sum, b) => sum + (b.netPayables || 0), 0)),
          stockCostValue: r2(branchReports.reduce((sum, b) => sum + (b.stockCostValue || 0), 0)),
          stockSaleValue: r2(branchReports.reduce((sum, b) => sum + (b.stockSaleValue || 0), 0)),
          totalStockItems: branchReports.reduce((sum, b) => sum + (b.totalStockItems || 0), 0),
          totalSkuCount: branchReports.reduce((sum, b) => sum + (b.totalSkuCount || 0), 0),
          lowStockCount: branchReports.reduce((sum, b) => sum + (b.lowStockCount || 0), 0),
          staffCount: branchReports.reduce((sum, b) => sum + (b.staffCount || 0), 0),
          activeBranchesCount: branchReports.filter((b) => b.status === "Active").length,
          totalRegisteredBranches: branches.length,
          maxAllowed: 2
        };
        combined.grossMarginPercent = combined.totalGrossRevenue > 0 ? r2(combined.grossProfit / combined.totalGrossRevenue * 100) : 0;
        combined.netMarginPercent = combined.totalGrossRevenue > 0 ? r2(combined.netProfit / combined.totalGrossRevenue * 100) : 0;
        return res.json({
          success: true,
          filter: {
            branchId,
            from: from || null,
            to: to || null
          },
          data: {
            combined,
            branches: branchReports,
            allBranches: branches.map((b) => ({
              branchId: b.id,
              branchCode: b.branch_code,
              branchName: b.branch_name,
              city: b.city,
              address: b.address,
              phone: b.phone,
              email: b.email,
              status: b.status,
              adminName: b.admin_name,
              adminUsername: b.admin_username,
              createdAt: b.created_at
            }))
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/branches", requireSuperAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const branches = await branchManager.listBranches();
        return res.json({
          success: true,
          data: branches,
          totalBranches: branches.length,
          maxAllowed: 2,
          canAddMore: branches.length < 2
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/branches/:id", requireSuperAdmin, async (req, res, next) => {
      try {
        const branchId = parseInt(req.params.id, 10);
        if (isNaN(branchId)) {
          return res.status(400).json({ success: false, message: "Invalid branch ID." });
        }
        const branch = await branchManager.getBranchById(branchId);
        if (!branch) {
          return res.status(404).json({ success: false, message: `Branch with ID ${branchId} not found.` });
        }
        let branchSettings = null;
        let branchAdmin = null;
        try {
          const pool = await branchManager.getBranchPool(branchId, true);
          const settingsRes = await pool.query(`
        SELECT company_name, tagline, invoice_subtitle, phone, email, address, tax_number, ntn, strn, pos_id, updated_at
        FROM business_settings
        WHERE id = 1
        LIMIT 1
      `);
          if (settingsRes.rows.length > 0) {
            branchSettings = settingsRes.rows[0];
          }
          const adminRes = await pool.query(`
        SELECT name, username
        FROM users
        WHERE role = 'admin'
        ORDER BY created_at ASC
        LIMIT 1
      `);
          if (adminRes.rows.length > 0) {
            branchAdmin = adminRes.rows[0];
          }
        } catch (poolErr) {
          console.warn(`[SuperAdmin] Could not query branch ${branchId} settings:`, poolErr.message);
        }
        const effectiveBranch = {
          id: branch.id,
          branch_code: branch.branch_code,
          branch_name: branchSettings?.company_name || branch.branch_name,
          tagline: branchSettings?.tagline || "",
          invoice_subtitle: branchSettings?.invoice_subtitle || "",
          admin_name: branchAdmin?.name || branch.admin_name,
          admin_username: branchAdmin?.username || branch.admin_username,
          status: branch.status || "Active",
          city: branch.city,
          phone: branchSettings?.phone || branch.phone,
          email: branchSettings?.email || branch.email,
          address: branchSettings?.address || branch.address,
          tax_number: branchSettings?.tax_number || branchSettings?.ntn || "",
          ntn: branchSettings?.ntn || branchSettings?.tax_number || "",
          strn: branchSettings?.strn || "",
          pos_id: branchSettings?.pos_id || "",
          created_at: branch.created_at,
          updated_at: branchSettings?.updated_at || branch.updated_at
        };
        return res.json({
          success: true,
          data: effectiveBranch
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/branches/:id", requireSuperAdmin, async (req, res, next) => {
      try {
        const branchId = parseInt(req.params.id, 10);
        if (isNaN(branchId)) {
          return res.status(400).json({ success: false, message: "Invalid branch ID." });
        }
        const { branch_name, phone, email, city, address, admin_name } = req.body;
        if (!branch_name) {
          return res.status(400).json({
            success: false,
            message: "Branch name is required."
          });
        }
        const updated = await branchManager.updateBranch(branchId, {
          branch_name,
          phone,
          email,
          city,
          address,
          admin_name
        });
        if (!updated) {
          return res.status(404).json({
            success: false,
            message: "Branch not found."
          });
        }
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_METADATA_UPDATED', $2, $3)
    `, [
          branchId,
          JSON.stringify({ branch_name, phone, email, city, address }),
          req.user.username
        ]);
        await CacheService.invalidatePattern("route:*:/api/super-admin*");
        return res.json({
          success: true,
          message: "Branch details updated successfully.",
          data: updated
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/branches/provision", requireSuperAdmin, async (req, res, next) => {
      try {
        const {
          branchName,
          branchCode,
          address,
          phone,
          email,
          city,
          adminName,
          adminUsername,
          adminPassword,
          adminContact,
          openingCash,
          openingOnline
        } = req.body;
        if (!branchName) {
          return res.status(400).json({
            success: false,
            message: "Branch name is required."
          });
        }
        if (!adminUsername || !adminPassword) {
          return res.status(400).json({
            success: false,
            message: "Branch Admin username and password are required."
          });
        }
        const createdBranch = await branchManager.provisionBranch2Database(
          {
            branchName,
            branchCode: branchCode || "BR-02",
            address,
            phone,
            email,
            city: city || "Karachi",
            adminName: adminName || "Branch 2 Manager",
            adminUsername,
            adminPassword,
            adminContact: adminContact || phone || "",
            openingCash: parseFloat(openingCash || 0),
            openingOnline: parseFloat(openingOnline || 0)
          },
          req.user?.username || "superadmin"
        );
        await CacheService.invalidatePattern("route:*:/api/super-admin*");
        return res.status(201).json({
          success: true,
          message: "Branch 2 database provisioned, schema migrated, and activated successfully!",
          data: createdBranch
        });
      } catch (error) {
        if (error.code === "MAX_BRANCHES_REACHED") {
          return res.status(400).json({
            success: false,
            code: "MAX_BRANCHES_REACHED",
            message: "Maximum branch limit reached. Only 2 branches are allowed."
          });
        }
        next(error);
      }
    });
    router.patch("/branches/:id/status", requireSuperAdmin, async (req, res, next) => {
      try {
        const { status } = req.body;
        if (!["Active", "Inactive", "Maintenance"].includes(status)) {
          return res.status(400).json({
            success: false,
            message: "Invalid status. Must be Active, Inactive, or Maintenance."
          });
        }
        const updated = await branchManager.updateBranch(req.params.id, { status });
        if (!updated) {
          return res.status(404).json({
            success: false,
            message: "Branch not found."
          });
        }
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_STATUS_CHANGED', $2, $3)
    `, [
          parseInt(req.params.id, 10),
          JSON.stringify({ new_status: status }),
          req.user.username
        ]);
        await CacheService.invalidatePattern("route:*:/api/super-admin*");
        return res.json({
          success: true,
          message: `Branch status updated to ${status}.`,
          data: updated
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/branches/:id/admin/reset-password", requireSuperAdmin, async (req, res, next) => {
      try {
        const branchId = parseInt(req.params.id, 10);
        const { newPassword, adminUsername } = req.body;
        if (!newPassword || newPassword.length < 6) {
          return res.status(400).json({
            success: false,
            message: "Password must be at least 6 characters long."
          });
        }
        const branch = await branchManager.getBranchById(branchId);
        if (!branch) {
          return res.status(404).json({
            success: false,
            message: "Branch not found."
          });
        }
        const branchPool = await branchManager.getBranchPool(branchId);
        const salt = await bcrypt.genSalt(10);
        const passHash = await bcrypt.hash(newPassword, salt);
        const targetUser = adminUsername ? String(adminUsername).toLowerCase().trim() : branch.admin_username || "admin";
        const updateRes = await branchPool.query(`
      UPDATE users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE LOWER(username) = $2 OR role = 'admin'
      RETURNING id, name, username, role
    `, [passHash, targetUser]);
        if (updateRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: `Admin user not found in Branch ${branchId} database.`
          });
        }
        return res.json({
          success: true,
          message: `Admin password for Branch ${branch.branch_code} reset successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/audit-logs", requireSuperAdmin, async (req, res, next) => {
      try {
        const limit = parseInt(req.query.limit || "50", 10);
        const offset = parseInt(req.query.offset || "0", 10);
        const logsRes = await branchManager.masterPool.query(`
      SELECT l.*, b.branch_code, b.branch_name
      FROM master_audit_logs l
      LEFT JOIN master_branches b ON l.branch_id = b.id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
        const countRes = await branchManager.masterPool.query(`SELECT COUNT(*) as total FROM master_audit_logs`);
        return res.json({
          success: true,
          data: logsRes.rows,
          total: parseInt(countRes.rows[0]?.total || 0, 10),
          limit,
          offset
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/audit-logs", requireSuperAdmin, async (req, res, next) => {
      try {
        await branchManager.masterPool.query("DELETE FROM master_audit_logs");
        if (global.routeCache && typeof global.routeCache.flushAll === "function") {
          global.routeCache.flushAll();
        }
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (action, details, performed_by)
      VALUES ($1, $2, $3)
    `, [
          "AUDIT_LOGS_PURGED",
          JSON.stringify({ note: "Audit log history cleared by Super Admin." }),
          req.user?.username || "superadmin"
        ]);
        return res.json({
          success: true,
          message: "Audit logs cleared successfully."
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/branch-admins", requireSuperAdmin, async (req, res, next) => {
      try {
        const branches = await branchManager.listBranches();
        const branchAdmins = [];
        for (const b of branches) {
          try {
            const pool = await branchManager.getBranchPool(b.id, true);
            const usersRes = await pool.query(`
          SELECT id, name, contact, designation, role, username, status, created_at, updated_at
          FROM users
          WHERE role = 'admin'
          ORDER BY created_at ASC
        `);
            branchAdmins.push({
              branchId: b.id,
              branchCode: b.branch_code,
              branchName: b.branch_name,
              branchStatus: b.status,
              admins: usersRes.rows
            });
          } catch (err) {
            branchAdmins.push({
              branchId: b.id,
              branchCode: b.branch_code,
              branchName: b.branch_name,
              branchStatus: b.status,
              admins: [],
              error: err.message
            });
          }
        }
        return res.json({
          success: true,
          data: branchAdmins
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/branches/:id/reset-admin-password", requireSuperAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const branchId = parseInt(id, 10);
        const { newPassword, username } = req.body;
        if (!newPassword || newPassword.length < 4) {
          return res.status(400).json({
            success: false,
            message: "New password must be at least 4 characters."
          });
        }
        const bRes = await branchManager.masterPool.query("SELECT * FROM master_branches WHERE id = $1", [branchId]);
        if (bRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Branch not found." });
        }
        const branch = bRes.rows[0];
        const pool = await branchManager.getBranchPool(branchId);
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);
        if (username) {
          await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER($2)`,
            [newHash, String(username).trim()]
          );
        } else {
          await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE role = 'admin'`,
            [newHash]
          );
        }
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_ADMIN_PASSWORD_RESET', $2::jsonb, $3)
    `, [
          branchId,
          JSON.stringify({ branchCode: branch.branch_code, branchName: branch.branch_name }),
          req.user.username || "superadmin"
        ]);
        return res.json({
          success: true,
          message: `Administrator password for branch ${branch.branch_code} has been reset successfully!`
        });
      } catch (error) {
        next(error);
      }
    });
    async function handleDeleteBranchAdmin(req, res, next) {
      try {
        const { branchId, adminId } = req.params;
        const bId = parseInt(branchId, 10);
        const { superAdminPassword } = req.body;
        if (!superAdminPassword) {
          return res.status(400).json({
            success: false,
            message: "Super Admin password is required to authorize administrator deletion."
          });
        }
        const saRes = await branchManager.masterPool.query(
          `SELECT id, password_hash FROM master_super_admins WHERE id = $1 LIMIT 1`,
          [req.user.id]
        );
        if (saRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Super Admin account not found." });
        }
        const isMatch = await bcrypt.compare(superAdminPassword, saRes.rows[0].password_hash);
        if (!isMatch) {
          return res.status(400).json({
            success: false,
            message: "Incorrect Super Admin password. Administrator deletion rejected."
          });
        }
        const bRes = await branchManager.masterPool.query("SELECT * FROM master_branches WHERE id = $1", [bId]);
        if (bRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Branch not found." });
        }
        const branch = bRes.rows[0];
        const pool = await branchManager.getBranchPool(bId, true);
        const userRes = await pool.query(
          `SELECT id, name, username, role, contact FROM users WHERE id = $1 OR LOWER(username) = LOWER($1)`,
          [adminId]
        );
        if (userRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: `User "${adminId}" not found in Branch ${branch.branch_code}.`
          });
        }
        const adminUser = userRes.rows[0];
        if (adminUser.role !== "admin") {
          return res.status(400).json({
            success: false,
            message: `User "${adminUser.username}" is not an administrator (Role: ${adminUser.role}).`
          });
        }
        await pool.query("DELETE FROM users WHERE id = $1", [adminUser.id]);
        await branchManager.masterPool.query(
          `DELETE FROM master_staff_identities 
       WHERE branch_id = $1 AND (branch_user_id = $2 OR LOWER(normalized_username) = LOWER($3))`,
          [bId, adminUser.id, adminUser.username]
        );
        await branchManager.masterPool.query(
          `UPDATE master_branches 
       SET admin_name = NULL, admin_username = NULL 
       WHERE id = $1 AND LOWER(admin_username) = LOWER($2)`,
          [bId, adminUser.username]
        );
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES ($1, 'BRANCH_ADMIN_DELETED', $2::jsonb, $3)
    `, [
          bId,
          JSON.stringify({
            branchCode: branch.branch_code,
            branchName: branch.branch_name,
            adminId: adminUser.id,
            adminName: adminUser.name,
            adminUsername: adminUser.username,
            deletedAt: (/* @__PURE__ */ new Date()).toISOString()
          }),
          req.user.username || "superadmin"
        ]);
        await CacheService.invalidatePattern("route:*:/api/super-admin*");
        await CacheService.invalidateBranchPattern(bId, "/api/staff*");
        return res.json({
          success: true,
          message: `Administrator "${adminUser.name}" (${adminUser.username}) of Branch ${branch.branch_code} has been permanently deleted.`
        });
      } catch (error) {
        next(error);
      }
    }
    router.post("/branches/:branchId/admins/:adminId/delete", requireSuperAdmin, handleDeleteBranchAdmin);
    router.delete("/branches/:branchId/admins/:adminId", requireSuperAdmin, handleDeleteBranchAdmin);
    async function handleToggleBranchAdminStatus(req, res, next) {
      try {
        const { branchId, adminId } = req.params;
        const { status } = req.body;
        const branch = await branchManager.getBranchById(branchId);
        if (!branch) {
          return res.status(404).json({
            success: false,
            code: "BRANCH_NOT_FOUND",
            message: "Branch not found."
          });
        }
        const pool = await branchManager.getBranchPool(branchId, true);
        const userRes = await pool.query(
          `SELECT id, name, username, status, role FROM users WHERE id = $1 LIMIT 1`,
          [adminId]
        );
        if (userRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "ADMIN_NOT_FOUND",
            message: "Administrator account not found in branch database."
          });
        }
        const adminUser = userRes.rows[0];
        const newStatus = status ? status : adminUser.status === "Active" ? "Inactive" : "Active";
        await pool.query(
          `UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newStatus, adminId]
        );
        try {
          await identityRegistry.setIdentityStatus({
            branchId,
            branchUserId: adminId,
            status: newStatus
          });
        } catch (regErr) {
          console.warn(`[SUPER_ADMIN] Identity status sync note: ${regErr.message}`);
        }
        await CacheService.invalidateBranchPattern(branchId, "/api/staff*");
        await CacheService.invalidatePattern("*branch-admins*");
        await CacheService.invalidatePattern("*audit-logs*");
        await branchManager.masterPool.query(
          `INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
       VALUES ($1, $2, $3::jsonb, $4)`,
          [
            branchId,
            "BRANCH_ADMIN_STATUS_CHANGED",
            JSON.stringify({
              adminId,
              adminName: adminUser.name,
              adminUsername: adminUser.username,
              previousStatus: adminUser.status,
              newStatus,
              branchCode: branch.branch_code,
              branchName: branch.branch_name
            }),
            req.user?.username || "superadmin"
          ]
        );
        return res.json({
          success: true,
          message: `Administrator "${adminUser.name}" (${adminUser.username}) is now ${newStatus}.`,
          data: {
            adminId,
            username: adminUser.username,
            status: newStatus
          }
        });
      } catch (error) {
        next(error);
      }
    }
    router.patch("/branches/:branchId/admins/:adminId/status", requireSuperAdmin, handleToggleBranchAdminStatus);
    router.post("/branches/:branchId/admins/:adminId/status", requireSuperAdmin, handleToggleBranchAdminStatus);
    router.put("/security/password", requireSuperAdmin, async (req, res, next) => {
      try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword || newPassword.length < 8) {
          return res.status(400).json({
            success: false,
            message: "Current password and new password (min 8 characters) are required."
          });
        }
        const saRes = await branchManager.masterPool.query(
          `SELECT id, password_hash FROM master_super_admins WHERE id = $1 LIMIT 1`,
          [req.user.id]
        );
        if (saRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Super Admin account not found." });
        }
        const isMatch = await bcrypt.compare(currentPassword, saRes.rows[0].password_hash);
        if (!isMatch) {
          return res.status(400).json({ success: false, message: "Incorrect current password." });
        }
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);
        await branchManager.masterPool.query(
          `UPDATE master_super_admins SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newHash, req.user.id]
        );
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (NULL, 'SUPER_ADMIN_PASSWORD_CHANGED', '{"action":"master_password_updated"}'::jsonb, $1)
    `, [req.user.username]);
        return res.json({
          success: true,
          message: "Super Admin master password updated successfully!"
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/branches/:id/safety-check", requireSuperAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const branchId = parseInt(id, 10);
        const bRes = await branchManager.masterPool.query("SELECT * FROM master_branches WHERE id = $1", [branchId]);
        if (bRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Branch not found." });
        }
        const branch = bRes.rows[0];
        let counts = {
          invoicesCount: 0,
          repairsCount: 0,
          paymentsCount: 0,
          expensesCount: 0,
          productsCount: 0,
          customersCount: 0
        };
        try {
          const pool = await branchManager.getBranchPool(branchId);
          const invRes = await pool.query("SELECT COUNT(*) AS total FROM invoices WHERE is_voided = FALSE");
          const repRes = await pool.query("SELECT COUNT(*) AS total FROM repair_jobs");
          const payRes = await pool.query("SELECT COUNT(*) AS total FROM payments");
          const expRes = await pool.query("SELECT COUNT(*) AS total FROM expenses");
          const prodRes = await pool.query("SELECT COUNT(*) AS total FROM products");
          const custRes = await pool.query("SELECT COUNT(*) AS total FROM customers");
          counts = {
            invoicesCount: parseInt(invRes.rows[0]?.total || 0, 10),
            repairsCount: parseInt(repRes.rows[0]?.total || 0, 10),
            paymentsCount: parseInt(payRes.rows[0]?.total || 0, 10),
            expensesCount: parseInt(expRes.rows[0]?.total || 0, 10),
            productsCount: parseInt(prodRes.rows[0]?.total || 0, 10),
            customersCount: parseInt(custRes.rows[0]?.total || 0, 10)
          };
        } catch (dbErr) {
          console.warn(`[Branch Safety Check] Could not inspect branch DB:`, dbErr.message);
        }
        const hasFinancialRecords = counts.invoicesCount + counts.repairsCount + counts.paymentsCount + counts.expensesCount > 0;
        return res.json({
          success: true,
          data: {
            branchId: branch.id,
            branchCode: branch.branch_code,
            branchName: branch.branch_name,
            counts,
            hasFinancialRecords
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/branches/:id/delete", requireSuperAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const branchId = parseInt(id, 10);
        const { superAdminPassword, confirmBranchCode, action } = req.body;
        if (!superAdminPassword || !confirmBranchCode) {
          return res.status(400).json({
            success: false,
            message: "Super Admin password and confirmation branch code are required."
          });
        }
        const bRes = await branchManager.masterPool.query("SELECT * FROM master_branches WHERE id = $1", [branchId]);
        if (bRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Branch not found." });
        }
        const branch = bRes.rows[0];
        const countRes = await branchManager.masterPool.query(`SELECT COUNT(*) AS total FROM master_branches WHERE status != 'Deleted'`);
        const totalActive = parseInt(countRes.rows[0]?.total || 0, 10);
        if (totalActive <= 1) {
          return res.status(400).json({
            success: false,
            message: "Cannot delete the only registered branch on the platform. At least one branch must remain active."
          });
        }
        if (String(confirmBranchCode).trim().toUpperCase() !== String(branch.branch_code).trim().toUpperCase()) {
          return res.status(400).json({
            success: false,
            message: `Branch code confirmation failed. You typed "${confirmBranchCode}", but the branch code is "${branch.branch_code}".`
          });
        }
        const saRes = await branchManager.masterPool.query(
          `SELECT id, password_hash FROM master_super_admins WHERE id = $1 LIMIT 1`,
          [req.user.id]
        );
        if (saRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Super Admin account not found." });
        }
        const isMatch = await bcrypt.compare(superAdminPassword, saRes.rows[0].password_hash);
        if (!isMatch) {
          return res.status(400).json({ success: false, message: "Incorrect Super Admin password. Deletion aborted." });
        }
        if (action === "archive") {
          await branchManager.masterPool.query(
            `UPDATE master_branches SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [branchId]
          );
          await branchManager.masterPool.query(`
        INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
        VALUES ($1, 'BRANCH_ARCHIVED', $2::jsonb, $3)
      `, [branchId, JSON.stringify({ branchCode: branch.branch_code, branchName: branch.branch_name }), req.user.username || "superadmin"]);
          return res.json({
            success: true,
            message: `Branch ${branch.branch_code} has been deactivated and archived safely.`
          });
        }
        try {
          await branchManager.closeBranchPool(branchId);
        } catch (poolErr) {
          console.warn(`[Branch Deletion] Pool teardown notice:`, poolErr.message);
        }
        try {
          const baileys = require_baileys_service();
          await baileys.clearAuthSession(branchId);
        } catch (waErr) {
        }
        await branchManager.masterPool.query("DELETE FROM master_staff_identities WHERE branch_id = $1", [branchId]);
        await branchManager.masterPool.query("DELETE FROM master_branches WHERE id = $1", [branchId]);
        await branchManager.masterPool.query(`
      INSERT INTO master_audit_logs (branch_id, action, details, performed_by)
      VALUES (NULL, 'BRANCH_PERMANENTLY_DELETED', $1::jsonb, $2)
    `, [
          JSON.stringify({
            branchId: branch.id,
            branchCode: branch.branch_code,
            branchName: branch.branch_name,
            dbName: branch.db_name,
            deletedAt: (/* @__PURE__ */ new Date()).toISOString()
          }),
          req.user.username || "superadmin"
        ]);
        await CacheService.invalidatePattern("route:*:/api/super-admin*");
        return res.json({
          success: true,
          message: `Branch ${branch.branch_code} (${branch.branch_name}) has been permanently deleted from the platform.`
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/staff/staff.routes.js
var require_staff_routes = __commonJS({
  "src/modules/staff/staff.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var bcrypt = require("bcryptjs");
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    var identityRegistry = require_identityRegistry();
    var { normalizeUsername, normalizePhone, isValidPhone } = require_phoneHelper();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.use(authenticateToken);
    router.get("/", cacheRoute(120), async (req, res, next) => {
      try {
        const { role } = req.query;
        let queryText = "SELECT id, name, contact, designation, role, username, status, created_at FROM users";
        const params = [];
        if (role) {
          queryText += " WHERE role = $1";
          params.push(role);
        } else if (req.user.role !== "admin" && req.user.role !== "super_admin") {
          queryText += " WHERE role = 'technician' AND status = 'Active'";
        }
        queryText += " ORDER BY created_at ASC";
        const result2 = await db.query(queryText, params);
        return res.json({
          success: true,
          data: result2.rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/", requireAdmin, async (req, res, next) => {
      let reservation = null;
      try {
        const { name, contact, phone, designation, role, username, password, status } = req.body;
        const staffContact = contact !== void 0 ? contact : phone;
        if (!name || !username || !password || !role) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Name, role, username and password are required."
          });
        }
        const cleanUsername = normalizeUsername(username);
        if (!cleanUsername) {
          return res.status(400).json({
            success: false,
            code: "INVALID_USERNAME",
            message: "Valid username is required."
          });
        }
        if (staffContact && !isValidPhone(staffContact)) {
          return res.status(400).json({
            success: false,
            code: "INVALID_PHONE",
            message: "Please provide a valid phone number (e.g. 03001234567)."
          });
        }
        const branchId = req.user?.branchId || req.branchId || 1;
        const localConflict = await db.query(
          `SELECT id, username, contact FROM users 
       WHERE LOWER(username) = $1 
          OR (contact IS NOT NULL AND contact != '' AND contact = $2)
       LIMIT 1`,
          [cleanUsername, staffContact ? String(staffContact).trim() : "___NO_PHONE___"]
        );
        if (localConflict.rows.length > 0) {
          const match = localConflict.rows[0];
          if (match.username && match.username.toLowerCase() === cleanUsername) {
            return res.status(409).json({
              success: false,
              code: "USERNAME_ALREADY_EXISTS",
              message: "This user already exists: Username is already taken. Please choose a different username."
            });
          }
          if (staffContact && match.contact && match.contact === String(staffContact).trim()) {
            return res.status(409).json({
              success: false,
              code: "PHONE_ALREADY_EXISTS",
              message: "This user already exists: Phone number is already registered with another staff member."
            });
          }
        }
        try {
          reservation = await identityRegistry.reserveIdentity({
            branchId,
            username: cleanUsername,
            phone: staffContact,
            role,
            status: status || "Active"
          });
        } catch (regErr) {
          if (regErr.statusCode === 409) {
            return res.status(409).json({
              success: false,
              code: regErr.code,
              message: regErr.message || (regErr.code === "PHONE_ALREADY_EXISTS" ? "This user already exists: Phone number is already registered with another staff member." : "This user already exists: Username is already taken. Please choose a different username.")
            });
          }
          throw regErr;
        }
        try {
          const staffId = await getNextEntityId("users", "id", "EMP", 4);
          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(password, salt);
          const insertRes = await db.query(
            `INSERT INTO users (id, name, contact, designation, role, username, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, contact, designation, role, username, status, created_at`,
            [
              staffId,
              name.trim(),
              reservation.normalizedPhone || (staffContact ? String(staffContact).trim() : null),
              designation ? designation.trim() : null,
              role,
              cleanUsername,
              passwordHash,
              status || "Active"
            ]
          );
          await identityRegistry.finalizeIdentity({
            reservationId: reservation.reservationId,
            reservationToken: reservation.reservationToken,
            branchUserId: staffId
          });
          await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/staff*");
          emitEvent("staff.created", insertRes.rows[0]);
          return res.status(201).json({
            success: true,
            message: "Staff user created successfully",
            data: insertRes.rows[0]
          });
        } catch (branchDbErr) {
          if (reservation) {
            await identityRegistry.releaseReservation({
              reservationId: reservation.reservationId,
              reservationToken: reservation.reservationToken
            });
          }
          if (branchDbErr.code === "23505") {
            const detail = String(branchDbErr.detail || branchDbErr.message || "");
            if (detail.includes("contact") || branchDbErr.constraint?.includes("contact")) {
              return res.status(409).json({
                success: false,
                code: "PHONE_ALREADY_EXISTS",
                message: "This user already exists: Phone number is already registered with another staff member."
              });
            }
            return res.status(409).json({
              success: false,
              code: "USERNAME_ALREADY_EXISTS",
              message: "This user already exists: Username is already taken. Please choose a different username."
            });
          }
          throw branchDbErr;
        }
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id", requireAdmin, async (req, res, next) => {
      let updateResult = null;
      const branchId = req.user?.branchId || req.branchId || 1;
      const { id } = req.params;
      try {
        const { name, contact, phone, designation, role, username, password, status } = req.body;
        const existing = await db.query("SELECT id, role, username, contact, status, designation FROM users WHERE id = $1", [id]);
        if (existing.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Staff member not found."
          });
        }
        const isSelf = String(id).trim() === String(req.user?.id).trim();
        if (isSelf && status && String(status).toLowerCase() === "inactive") {
          return res.status(400).json({
            success: false,
            code: "CANNOT_DEACTIVATE_SELF",
            message: "You cannot deactivate your own account."
          });
        }
        if ((existing.rows[0].role === "admin" || existing.rows[0].designation === "System Administrator" || existing.rows[0].username?.toLowerCase() === "admin") && status && String(status).toLowerCase() === "inactive") {
          return res.status(400).json({
            success: false,
            code: "CANNOT_DEACTIVATE_ADMIN",
            message: "Branch Administrator accounts can only be deactivated by Platform Super Admin."
          });
        }
        const cleanUsername = username ? normalizeUsername(username) : existing.rows[0].username;
        const targetContact = contact !== void 0 ? contact : phone !== void 0 ? phone : existing.rows[0].contact;
        if (targetContact && !isValidPhone(targetContact)) {
          return res.status(400).json({
            success: false,
            code: "INVALID_PHONE",
            message: "Please provide a valid phone number."
          });
        }
        try {
          updateResult = await identityRegistry.updateIdentity({
            branchId,
            branchUserId: id,
            currentUsername: existing.rows[0].username,
            username: cleanUsername,
            phone: targetContact,
            role: role || existing.rows[0].role,
            status: status || existing.rows[0].status || "Active"
          });
        } catch (regErr) {
          if (regErr.statusCode === 409) {
            return res.status(409).json({
              success: false,
              code: regErr.code,
              message: regErr.message
            });
          }
          throw regErr;
        }
        try {
          let updateQuery = `
        UPDATE users
        SET name = $1, contact = $2, designation = $3, role = $4, username = $5, status = $6, updated_at = CURRENT_TIMESTAMP
      `;
          const params = [
            name ? name.trim() : existing.rows[0].name,
            updateResult.updatedIdentity.normalized_phone || (targetContact ? targetContact.trim() : null),
            designation ? designation.trim() : null,
            role || existing.rows[0].role,
            cleanUsername,
            status || existing.rows[0].status || "Active"
          ];
          if (password && String(password).trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password.trim(), salt);
            params.push(passwordHash);
            updateQuery += `, password_hash = $${params.length}`;
          }
          params.push(id);
          updateQuery += ` WHERE id = $${params.length} RETURNING id, name, contact, designation, role, username, status, created_at, updated_at`;
          const result2 = await db.query(updateQuery, params);
          await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/staff*");
          emitEvent("staff.updated", result2.rows[0]);
          return res.json({
            success: true,
            message: "Staff updated successfully",
            data: result2.rows[0]
          });
        } catch (branchDbErr) {
          if (updateResult && updateResult.previousIdentity) {
            await identityRegistry.restoreIdentity({
              branchId,
              branchUserId: id,
              previousIdentity: updateResult.previousIdentity
            });
          }
          throw branchDbErr;
        }
      } catch (error) {
        next(error);
      }
    });
    router.patch("/:id/status", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        const branchId = req.user?.branchId || req.branchId || 1;
        const loggedInUserId = req.user?.id;
        if (String(id).trim() === String(loggedInUserId).trim()) {
          return res.status(400).json({
            success: false,
            code: "CANNOT_DEACTIVATE_SELF",
            message: "You cannot deactivate your own account."
          });
        }
        const userRes = await db.query("SELECT id, username, designation, role FROM users WHERE id = $1", [id]);
        if (userRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Staff member not found."
          });
        }
        const targetUser = userRes.rows[0];
        if (targetUser.role === "admin" || targetUser.designation === "System Administrator" || String(targetUser.username).toLowerCase() === "admin") {
          return res.status(400).json({
            success: false,
            code: "CANNOT_DEACTIVATE_ADMIN",
            message: "Branch Administrator accounts can only be activated or deactivated by Platform Super Admin."
          });
        }
        const newStatus = status || "Inactive";
        const result2 = await db.query(
          "UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, status",
          [newStatus, id]
        );
        await identityRegistry.setIdentityStatus({
          branchId,
          branchUserId: id,
          status: newStatus
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/staff*");
        emitEvent("staff.status_changed", result2.rows[0]);
        return res.json({
          success: true,
          message: `Staff member ${newStatus.toLowerCase()}`,
          data: result2.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const branchId = req.user?.branchId || req.branchId || 1;
        const loggedInUserId = req.user?.id;
        if (String(id).trim() === String(loggedInUserId).trim()) {
          return res.status(400).json({
            success: false,
            code: "SELF_DELETION_PROHIBITED",
            message: "You cannot delete your own account."
          });
        }
        const userRes = await db.query("SELECT id, username, designation, role FROM users WHERE id = $1", [id]);
        if (userRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Staff member not found."
          });
        }
        const targetUser = userRes.rows[0];
        if (targetUser.designation === "System Administrator" || targetUser.role === "admin" || String(targetUser.username).toLowerCase() === "admin") {
          return res.status(400).json({
            success: false,
            code: "CANNOT_DELETE_ADMIN",
            message: "Branch Administrator accounts cannot be deleted from staff portal. Only Super Admin has authority to delete administrators."
          });
        }
        await db.query("DELETE FROM users WHERE id = $1", [id]);
        await identityRegistry.setIdentityStatus({
          branchId,
          branchUserId: id,
          status: "Deleted"
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/staff*");
        emitEvent("staff.deleted", { id });
        return res.json({
          success: true,
          message: "Staff user deleted successfully"
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/branches/branches.routes.js
var require_branches_routes = __commonJS({
  "src/modules/branches/branches.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var branchManager = require_branchManager();
    var authenticateToken = require_auth();
    router.get("/", async (req, res, next) => {
      try {
        const branches = await branchManager.listBranches();
        return res.json({
          success: true,
          data: branches,
          totalBranches: branches.length,
          maxAllowed: 2,
          canAddMore: branches.length < 2
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/current", async (req, res, next) => {
      try {
        const branchId = req.branchId || req.user?.branchId || 1;
        const branch = await branchManager.getBranchById(branchId);
        if (!branch) {
          return res.status(404).json({
            success: false,
            message: "Branch not found."
          });
        }
        return res.json({
          success: true,
          data: branch
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id", authenticateToken, async (req, res, next) => {
      try {
        const branchId = parseInt(req.params.id, 10);
        if (req.user?.role !== "super_admin" && req.user?.branchId !== branchId) {
          return res.status(403).json({
            success: false,
            message: "Access denied. You can only view your assigned branch."
          });
        }
        const branch = await branchManager.getBranchById(branchId);
        if (!branch) {
          return res.status(404).json({
            success: false,
            message: "Branch not found."
          });
        }
        return res.json({
          success: true,
          data: branch
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/categories/categories.routes.js
var require_categories_routes = __commonJS({
  "src/modules/categories/categories.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireAdmin, requireSalesOrAdmin } = require_rbac();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.get("/", cacheRoute(300), async (req, res, next) => {
      try {
        const [prodRes, expRes, accRes, repRes] = await Promise.all([
          db.query(`
        SELECT pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at,
               COUNT(p.id)::int AS product_count
        FROM product_categories pc
        LEFT JOIN products p ON (p.category_id = pc.id OR LOWER(p.category_name) = LOWER(pc.name))
        GROUP BY pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at
        ORDER BY pc.id ASC
      `),
          db.query("SELECT id, name FROM expense_categories ORDER BY id ASC"),
          db.query("SELECT id, name FROM accessory_categories ORDER BY name ASC"),
          db.query(`
        SELECT rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at,
               COUNT(rj.id)::int AS repair_count
        FROM repair_categories rc
        LEFT JOIN repair_jobs rj ON rj.category_id = rc.id
        GROUP BY rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at
        ORDER BY rc.id ASC
      `)
        ]);
        return res.json({
          success: true,
          data: {
            productCategories: prodRes.rows,
            expenseCategories: expRes.rows,
            accessoryCategories: accRes.rows,
            repairCategories: repRes.rows
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/product", cacheRoute(300), async (req, res, next) => {
      try {
        const result2 = await db.query(`
      SELECT pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at,
             COUNT(p.id)::int AS product_count
      FROM product_categories pc
      LEFT JOIN products p ON (p.category_id = pc.id OR LOWER(p.category_name) = LOWER(pc.name))
      GROUP BY pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at
      ORDER BY pc.id ASC
    `);
        return res.json({
          success: true,
          data: result2.rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/product", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { name, codePrefix, customFields } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Category name is required."
          });
        }
        const cleanName = String(name).trim();
        const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "PRD";
        const fieldsJson = JSON.stringify(Array.isArray(customFields) ? customFields : []);
        const existing = await db.query("SELECT id, name FROM product_categories WHERE LOWER(name) = LOWER($1)", [cleanName]);
        if (existing.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_EXISTS",
            message: `Category "${cleanName}" already exists in the database.`
          });
        }
        const insertRes = await db.query(
          `INSERT INTO product_categories (name, code_prefix, is_system, custom_fields) VALUES ($1, $2, FALSE, $3::jsonb) RETURNING id, name, code_prefix, is_system, custom_fields`,
          [cleanName, prefix, fieldsJson]
        );
        const newCategory = { ...insertRes.rows[0], product_count: 0 };
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        emitEvent("categories.product_added", newCategory);
        return res.status(201).json({
          success: true,
          message: `Category "${cleanName}" created and saved to database successfully`,
          data: newCategory
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/product/:id", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { name, codePrefix, customFields } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Category name is required."
          });
        }
        const cleanName = String(name).trim();
        const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "PRD";
        const existing = await db.query("SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1) AND id != $2", [cleanName, id]);
        if (existing.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_EXISTS",
            message: `Category "${cleanName}" already exists.`
          });
        }
        let updated;
        if (customFields !== void 0) {
          const fieldsJson = JSON.stringify(Array.isArray(customFields) ? customFields : []);
          updated = await db.query(
            `UPDATE product_categories SET name = $1, code_prefix = $2, custom_fields = $3::jsonb WHERE id = $4 RETURNING id, name, code_prefix, is_system, custom_fields`,
            [cleanName, prefix, fieldsJson, id]
          );
        } else {
          updated = await db.query(
            `UPDATE product_categories SET name = $1, code_prefix = $2 WHERE id = $3 RETURNING id, name, code_prefix, is_system, custom_fields`,
            [cleanName, prefix, id]
          );
        }
        if (updated.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Category not found."
          });
        }
        await db.query("UPDATE products SET category_name = $1 WHERE category_id = $2", [cleanName, id]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        emitEvent("categories.product_updated", updated.rows[0]);
        return res.json({
          success: true,
          message: "Category updated successfully",
          data: updated.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/product/:id", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const catRes = await db.query("SELECT * FROM product_categories WHERE id = $1", [id]);
        if (catRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Category not found."
          });
        }
        const category = catRes.rows[0];
        const inUse = await db.query(
          "SELECT COUNT(*)::int as count FROM products WHERE category_id = $1 OR LOWER(category_name) = LOWER($2)",
          [id, category.name]
        );
        const count = inUse.rows[0].count;
        if (count > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_IN_USE",
            message: `Cannot delete "${category.name}" because it is currently assigned to ${count} product(s).`
          });
        }
        await db.query("DELETE FROM product_categories WHERE id = $1", [id]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        emitEvent("categories.product_deleted", { id: parseInt(id, 10), name: category.name });
        return res.json({
          success: true,
          message: `Category "${category.name}" deleted successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/spare-parts", cacheRoute(300), async (req, res, next) => {
      try {
        const result2 = await db.query(`
      SELECT spc.id, spc.name, spc.code_prefix, spc.is_system, spc.created_at,
             COUNT(rp.id)::int AS part_count
      FROM spare_part_categories spc
      LEFT JOIN repair_parts rp ON LOWER(rp.category) = LOWER(spc.name)
      GROUP BY spc.id, spc.name, spc.code_prefix, spc.is_system, spc.created_at
      ORDER BY spc.id ASC
    `);
        return res.json({
          success: true,
          data: result2.rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/spare-parts", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { name, codePrefix } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Spare part category name is required."
          });
        }
        const cleanName = String(name).trim();
        const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "PRT";
        const existing = await db.query("SELECT id, name FROM spare_part_categories WHERE LOWER(name) = LOWER($1)", [cleanName]);
        if (existing.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_EXISTS",
            message: `Category "${cleanName}" already exists.`
          });
        }
        const insertRes = await db.query(
          `INSERT INTO spare_part_categories (name, code_prefix, is_system) VALUES ($1, $2, FALSE) RETURNING id, name, code_prefix, is_system`,
          [cleanName, prefix]
        );
        const newCategory = { ...insertRes.rows[0], part_count: 0 };
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        emitEvent("categories.spare_part_added", newCategory);
        return res.status(201).json({
          success: true,
          message: `Spare part category "${cleanName}" created successfully`,
          data: newCategory
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/spare-parts/:id", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const catRes = await db.query("SELECT * FROM spare_part_categories WHERE id = $1", [id]);
        if (catRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Spare part category not found."
          });
        }
        const category = catRes.rows[0];
        const inUse = await db.query("SELECT COUNT(*)::int as count FROM repair_parts WHERE LOWER(category) = LOWER($1)", [category.name]);
        const count = inUse.rows[0].count;
        if (count > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_IN_USE",
            message: `Cannot delete category "${category.name}" because it is linked to ${count} spare part(s).`
          });
        }
        await db.query("DELETE FROM spare_part_categories WHERE id = $1", [id]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        emitEvent("categories.spare_part_deleted", { id: parseInt(id, 10), name: category.name });
        return res.json({
          success: true,
          message: `Spare part category "${category.name}" deleted successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/expense", cacheRoute(300), async (req, res, next) => {
      try {
        const result2 = await db.query("SELECT id, name FROM expense_categories ORDER BY id ASC");
        return res.json({
          success: true,
          data: result2.rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/expense", authenticateToken, requireAdmin, async (req, res, next) => {
      try {
        const { name } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Expense category name is required."
          });
        }
        const cleanName = String(name).trim();
        const insertRes = await db.query(
          `INSERT INTO expense_categories (name) VALUES ($1) RETURNING id, name`,
          [cleanName]
        );
        emitEvent("categories.expense_added", insertRes.rows[0]);
        return res.status(201).json({
          success: true,
          message: "Expense category added successfully",
          data: insertRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/expense/:id", authenticateToken, requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const inUse = await db.query("SELECT id FROM expenses WHERE category_id = $1 LIMIT 1", [id]);
        if (inUse.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_IN_USE",
            message: "This category is already referenced by recorded expenses."
          });
        }
        await db.query("DELETE FROM expense_categories WHERE id = $1", [id]);
        emitEvent("categories.expense_deleted", { id: parseInt(id, 10) });
        return res.json({
          success: true,
          message: "Expense category deleted successfully"
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/accessory", cacheRoute(300), async (req, res, next) => {
      try {
        const result2 = await db.query("SELECT id, name FROM accessory_categories ORDER BY name ASC");
        return res.json({
          success: true,
          data: result2.rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/repair", cacheRoute(120), async (req, res, next) => {
      try {
        const { activeOnly } = req.query;
        let queryText = `
      SELECT rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at,
             COUNT(rj.id)::int AS repair_count
      FROM repair_categories rc
      LEFT JOIN repair_jobs rj ON rj.category_id = rc.id
      WHERE 1=1
    `;
        const params = [];
        if (activeOnly === "true" || activeOnly === true) {
          params.push(true);
          queryText += ` AND rc.is_active = $${params.length}`;
        }
        queryText += `
      GROUP BY rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at
      ORDER BY rc.id ASC
    `;
        const result2 = await db.query(queryText, params);
        return res.json({
          success: true,
          data: result2.rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            isActive: r.is_active,
            repairCount: parseInt(r.repair_count || 0, 10),
            createdAt: r.created_at,
            updatedAt: r.updated_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/repair", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { name, description, isActive } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Repair category name is required."
          });
        }
        const cleanName = String(name).trim();
        const cleanDesc = description ? String(description).trim() : null;
        const active = isActive !== void 0 ? Boolean(isActive) : true;
        const existing = await db.query("SELECT id, name FROM repair_categories WHERE LOWER(name) = LOWER($1)", [cleanName]);
        if (existing.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_EXISTS",
            message: `Repair category "${cleanName}" already exists in the database.`
          });
        }
        const insertRes = await db.query(
          `INSERT INTO repair_categories (name, description, is_active)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, is_active, created_at, updated_at`,
          [cleanName, cleanDesc, active]
        );
        const newCategory = {
          id: insertRes.rows[0].id,
          name: insertRes.rows[0].name,
          description: insertRes.rows[0].description,
          isActive: insertRes.rows[0].is_active,
          repairCount: 0,
          createdAt: insertRes.rows[0].created_at,
          updatedAt: insertRes.rows[0].updated_at
        };
        emitEvent("categories.repair_added", newCategory);
        return res.status(201).json({
          success: true,
          message: `Repair category "${cleanName}" created successfully`,
          data: newCategory
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/repair/:id", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { name, description, isActive } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Repair category name is required."
          });
        }
        const cleanName = String(name).trim();
        const cleanDesc = description !== void 0 ? description ? String(description).trim() : null : void 0;
        const active = isActive !== void 0 ? Boolean(isActive) : void 0;
        const existing = await db.query("SELECT id FROM repair_categories WHERE LOWER(name) = LOWER($1) AND id != $2", [cleanName, id]);
        if (existing.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_EXISTS",
            message: `Repair category "${cleanName}" already exists.`
          });
        }
        const updateRes = await db.query(
          `UPDATE repair_categories SET
        name = $1,
        description = COALESCE($2, description),
        is_active = COALESCE($3, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, name, description, is_active, created_at, updated_at`,
          [cleanName, cleanDesc, active, id]
        );
        if (updateRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Repair category not found."
          });
        }
        await db.query("UPDATE repair_jobs SET category_name = $1 WHERE category_id = $2", [cleanName, id]);
        const updatedCat = {
          id: updateRes.rows[0].id,
          name: updateRes.rows[0].name,
          description: updateRes.rows[0].description,
          isActive: updateRes.rows[0].is_active,
          createdAt: updateRes.rows[0].created_at,
          updatedAt: updateRes.rows[0].updated_at
        };
        emitEvent("categories.repair_updated", updatedCat);
        return res.json({
          success: true,
          message: "Repair category updated successfully",
          data: updatedCat
        });
      } catch (error) {
        next(error);
      }
    });
    router.patch("/repair/:id/toggle", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const catRes = await db.query("SELECT id, is_active FROM repair_categories WHERE id = $1", [id]);
        if (catRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Repair category not found."
          });
        }
        const newStatus = !catRes.rows[0].is_active;
        const updateRes = await db.query(
          `UPDATE repair_categories SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
          [newStatus, id]
        );
        const updatedCat = {
          id: updateRes.rows[0].id,
          name: updateRes.rows[0].name,
          description: updateRes.rows[0].description,
          isActive: updateRes.rows[0].is_active,
          createdAt: updateRes.rows[0].created_at,
          updatedAt: updateRes.rows[0].updated_at
        };
        emitEvent("categories.repair_updated", updatedCat);
        return res.json({
          success: true,
          message: `Repair category marked ${newStatus ? "active" : "inactive"}`,
          data: updatedCat
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/repair/:id", authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const catRes = await db.query("SELECT * FROM repair_categories WHERE id = $1", [id]);
        if (catRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Repair category not found."
          });
        }
        const category = catRes.rows[0];
        const inUse = await db.query("SELECT COUNT(*)::int as count FROM repair_jobs WHERE category_id = $1", [id]);
        const count = inUse.rows[0].count;
        if (count > 0) {
          return res.status(400).json({
            success: false,
            code: "CATEGORY_IN_USE",
            message: `Cannot delete category "${category.name}" because it is assigned to ${count} repair job(s). You can mark it inactive instead.`
          });
        }
        await db.query("DELETE FROM repair_categories WHERE id = $1", [id]);
        emitEvent("categories.repair_deleted", { id: parseInt(id, 10) });
        return res.json({
          success: true,
          message: `Repair category "${category.name}" deleted successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/settings/settings.routes.js
var require_settings_routes = __commonJS({
  "src/modules/settings/settings.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireAdmin } = require_rbac();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.get("/company", (req, res, next) => {
      res.setHeader("Cache-Control", "public, max-age=600, stale-while-revalidate=86400");
      res.setHeader("Vary", "X-Branch-Id");
      next();
    }, cacheRoute(300), async (req, res, next) => {
      try {
        const result2 = await db.query(`
      SELECT id, company_name, tagline, invoice_subtitle, phone, email, tax_number, address, invoice_footer, logo_data, ntn, strn, pos_id, fbr_pos_id, updated_at
      FROM business_settings
      WHERE id = 1
    `);
        if (result2.rows.length === 0) {
          return res.json({
            success: true,
            data: {
              company_name: "Retail & Repair Management",
              tagline: "POS, Inventory Management, Sales & Purchases",
              invoice_subtitle: "Retail \u2022 Inventory \u2022 Repair",
              phone: "",
              email: "",
              tax_number: "",
              ntn: "",
              strn: "",
              pos_id: "",
              fbr_pos_id: "",
              address: "",
              invoice_footer: "Thank you for choosing us. We appreciate your business.",
              logo_data: null
            }
          });
        }
        const row = result2.rows[0];
        return res.json({
          success: true,
          data: {
            ...row,
            ntn: row.ntn || row.tax_number || "",
            strn: row.strn || "",
            pos_id: row.pos_id || row.fbr_pos_id || ""
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/company", authenticateToken, requireAdmin, async (req, res, next) => {
      try {
        const { companyName, tagline, invoiceSubtitle, phone, email, taxNumber, ntn, strn, posId, address, invoiceFooter, logoData } = req.body;
        if (!companyName || String(companyName).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_COMPANY_NAME",
            message: "Company name is required."
          });
        }
        const finalNtn = ntn !== void 0 ? ntn ? String(ntn).trim() : null : taxNumber ? String(taxNumber).trim() : null;
        const finalTaxNumber = taxNumber ? String(taxNumber).trim() : ntn ? String(ntn).trim() : null;
        const updateRes = await db.query(`
      INSERT INTO business_settings (id, company_name, tagline, invoice_subtitle, phone, email, tax_number, ntn, strn, pos_id, address, invoice_footer, logo_data, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        tagline = EXCLUDED.tagline,
        invoice_subtitle = EXCLUDED.invoice_subtitle,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        tax_number = EXCLUDED.tax_number,
        ntn = EXCLUDED.ntn,
        strn = EXCLUDED.strn,
        pos_id = EXCLUDED.pos_id,
        address = EXCLUDED.address,
        invoice_footer = EXCLUDED.invoice_footer,
        logo_data = EXCLUDED.logo_data,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
          companyName.trim(),
          tagline ? tagline.trim() : null,
          invoiceSubtitle ? invoiceSubtitle.trim() : null,
          phone ? phone.trim() : null,
          email ? email.trim() : null,
          finalTaxNumber,
          // $6 = tax_number
          finalNtn,
          // $7 = ntn
          strn ? strn.trim() : null,
          // $8 = strn
          posId ? posId.trim() : null,
          // $9 = pos_id
          address ? address.trim() : null,
          // $10 = address
          invoiceFooter ? invoiceFooter.trim() : null,
          // $11 = invoice_footer
          logoData || null
          // $12 = logo_data
        ]);
        try {
          const branchManager = require_branchManager();
          const bId = getBranchIdFromReq(req);
          await branchManager.masterPool.query(`
        UPDATE master_branches 
        SET branch_name = $1, phone = COALESCE($2, phone), email = COALESCE($3, email), address = COALESCE($4, address), updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
      `, [companyName.trim(), phone ? phone.trim() : null, email ? email.trim() : null, address ? address.trim() : null, bId]);
        } catch (syncErr) {
          console.warn("[Settings] Failed to sync to master_branches:", syncErr.message);
        }
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/settings*");
        emitEvent("settings.company_updated", updateRes.rows[0]);
        return res.json({
          success: true,
          message: "Company branding updated successfully",
          data: updateRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/opening-balances", authenticateToken, requireAdmin, cacheRoute(120), async (req, res, next) => {
      try {
        const result2 = await db.query("SELECT opening_cash, opening_online FROM business_settings WHERE id = 1");
        const cash = result2.rows.length > 0 ? parseFloat(result2.rows[0].opening_cash || 0) : 0;
        const online = result2.rows.length > 0 ? parseFloat(result2.rows[0].opening_online || 0) : 0;
        return res.json({
          success: true,
          data: {
            openingCash: cash,
            openingOnline: online
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/opening-balances", authenticateToken, requireAdmin, async (req, res, next) => {
      try {
        const rawCash = req.body.openingCash !== void 0 ? req.body.openingCash : req.body.openingCashBalance;
        const rawOnline = req.body.openingOnline !== void 0 ? req.body.openingOnline : req.body.openingOnlineBalance;
        const cash = Math.max(0, parseFloat(rawCash || 0));
        const online = Math.max(0, parseFloat(rawOnline || 0));
        await db.query(`
      INSERT INTO business_settings (id, opening_cash, opening_online, updated_at)
      VALUES (1, $1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        opening_cash = EXCLUDED.opening_cash,
        opening_online = EXCLUDED.opening_online,
        updated_at = CURRENT_TIMESTAMP
    `, [cash, online]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/settings*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("settings.balances_updated", { openingCash: cash, openingOnline: online });
        return res.json({
          success: true,
          message: "Opening cash and online balances saved successfully",
          data: { openingCash: cash, openingOnline: online }
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/reset-database", authenticateToken, requireAdmin, async (req, res, next) => {
      try {
        await db.withTransaction(async (client) => {
          await client.query("TRUNCATE TABLE invoice_items CASCADE");
          await client.query("TRUNCATE TABLE invoices CASCADE");
          await client.query("TRUNCATE TABLE payments CASCADE");
          await client.query("TRUNCATE TABLE accounts CASCADE");
          await client.query("TRUNCATE TABLE vendor_returns CASCADE");
          await client.query("TRUNCATE TABLE held_bills CASCADE");
          await client.query("TRUNCATE TABLE repair_parts_used CASCADE");
          await client.query("TRUNCATE TABLE repair_job_lines CASCADE");
          await client.query("TRUNCATE TABLE repair_status_history CASCADE");
          await client.query("TRUNCATE TABLE repair_jobs CASCADE");
          await client.query("TRUNCATE TABLE inventory_movements CASCADE");
          await client.query("TRUNCATE TABLE products CASCADE");
          await client.query("TRUNCATE TABLE repair_parts_movements CASCADE");
          await client.query("TRUNCATE TABLE repair_parts CASCADE");
          await client.query("TRUNCATE TABLE expenses CASCADE");
          await client.query("TRUNCATE TABLE audit_logs CASCADE");
          await client.query("TRUNCATE TABLE whatsapp_messages CASCADE");
          await client.query("TRUNCATE TABLE whatsapp_conversations CASCADE");
          await client.query("TRUNCATE TABLE customers CASCADE");
          await client.query("TRUNCATE TABLE vendors CASCADE");
          await client.query(`
        UPDATE business_settings 
        SET opening_cash = 0.00, opening_online = 0.00 
        WHERE id = 1
      `);
        });
        await CacheService.flush();
        emitEvent("database.reset", { timestamp: /* @__PURE__ */ new Date() });
        return res.json({
          success: true,
          message: "All records, inventory, invoices, repairs, accounts and contacts have been reset to fresh empty state."
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/customers/customers.routes.js
var require_customers_routes = __commonJS({
  "src/modules/customers/customers.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireSalesOrAdmin, requireAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.use(authenticateToken);
    router.get("/", requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { search, balance } = req.query;
        let whereClause = "";
        const params = [];
        if (search && search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          whereClause = `WHERE (LOWER(c.name) LIKE $${params.length} OR LOWER(COALESCE(c.contact, '')) LIKE $${params.length} OR LOWER(COALESCE(c.address, '')) LIKE $${params.length} OR LOWER(c.id) LIKE $${params.length})`;
        }
        let havingClause = "";
        if (balance === "receivable") {
          havingClause = `HAVING COALESCE(SUM(CASE WHEN a.type = 'Customer Receivable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) > 0`;
        } else if (balance === "payable") {
          havingClause = `HAVING COALESCE(SUM(CASE WHEN a.type = 'Customer Payable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) > 0`;
        } else if (balance === "zero") {
          havingClause = `HAVING COALESCE(SUM(CASE WHEN a.type = 'Customer Receivable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) = 0 AND COALESCE(SUM(CASE WHEN a.type = 'Customer Payable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) = 0`;
        }
        const query = `
      SELECT 
        c.id, c.name, c.contact, c.address, c.notes, c.created_at, c.updated_at,
        COALESCE(SUM(CASE WHEN a.type = 'Customer Receivable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) as receivable,
        COALESCE(SUM(CASE WHEN a.type = 'Customer Payable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) as payable
      FROM customers c
      LEFT JOIN accounts a ON a.party_id = c.id
      ${whereClause}
      GROUP BY c.id
      ${havingClause}
      ORDER BY c.created_at DESC
    `;
        const result2 = await db.query(query, params);
        const customers = result2.rows.map((row) => ({
          id: row.id,
          name: row.name,
          contact: row.contact,
          address: row.address,
          notes: row.notes,
          receivable: parseFloat(row.receivable || 0),
          payable: parseFloat(row.payable || 0),
          openReceivable: parseFloat(row.receivable || 0),
          openPayable: parseFloat(row.payable || 0),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        return res.json({
          success: true,
          data: customers
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { name, contact, address, notes } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Customer name is required."
          });
        }
        const cleanName = String(name).trim();
        const cleanContact = contact ? String(contact).trim() : null;
        const cleanAddress = address ? String(address).trim() : null;
        const cleanNotes = notes ? String(notes).trim() : null;
        const existing = await db.query(
          `SELECT id, name, contact, address, notes FROM customers WHERE LOWER(name) = $1 AND ($2::varchar IS NULL OR contact = $2)`,
          [cleanName.toLowerCase(), cleanContact]
        );
        if (existing.rows.length > 0) {
          if (cleanAddress && !existing.rows[0].address) {
            await db.query(`UPDATE customers SET address = $1 WHERE id = $2`, [cleanAddress, existing.rows[0].id]);
            existing.rows[0].address = cleanAddress;
          }
          return res.json({
            success: true,
            message: "Existing customer found",
            data: existing.rows[0]
          });
        }
        const customerId = await getNextEntityId("customers", "id", "CUS", 4);
        const insertRes = await db.query(
          `INSERT INTO customers (id, name, contact, address, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [customerId, cleanName, cleanContact, cleanAddress, cleanNotes]
        );
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/customers*");
        emitEvent("customers.created", insertRes.rows[0]);
        return res.status(201).json({
          success: true,
          message: "Customer created successfully",
          data: insertRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { name, contact, address, notes } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Customer name is required."
          });
        }
        const cleanName = String(name).trim();
        const cleanContact = contact ? String(contact).trim() : null;
        const cleanAddress = address ? String(address).trim() : null;
        const cleanNotes = notes ? String(notes).trim() : null;
        const result2 = await db.withTransaction(async (client) => {
          const updateRes = await client.query(
            `UPDATE customers SET name = $1, contact = $2, address = $3, notes = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *`,
            [cleanName, cleanContact, cleanAddress, cleanNotes, id]
          );
          if (updateRes.rows.length === 0) {
            const error = new Error("Customer not found");
            error.status = 404;
            throw error;
          }
          await client.query(`UPDATE invoices SET party_name = $1, contact = $2 WHERE party_id = $3`, [cleanName, cleanContact, id]);
          await client.query(`UPDATE accounts SET party_name = $1 WHERE party_id = $2`, [cleanName, id]);
          await client.query(`UPDATE payments SET party_name = $1 WHERE party_id = $2`, [cleanName, id]);
          return updateRes.rows[0];
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/customers*");
        emitEvent("customers.updated", result2);
        return res.json({
          success: true,
          message: "Customer updated successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const invCheck = await db.query("SELECT id FROM invoices WHERE party_id = $1 LIMIT 1", [id]);
        const repairCheck = await db.query("SELECT id FROM repair_jobs WHERE customer_id = $1 LIMIT 1", [id]);
        const accCheck = await db.query("SELECT id FROM accounts WHERE party_id = $1 LIMIT 1", [id]);
        if (invCheck.rows.length > 0 || repairCheck.rows.length > 0 || accCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "HAS_TRANSACTION_HISTORY",
            message: "This customer has transaction history and cannot be deleted. You may edit their profile instead."
          });
        }
        await db.query("DELETE FROM customers WHERE id = $1", [id]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/customers*");
        emitEvent("customers.deleted", { id });
        return res.json({
          success: true,
          message: "Customer profile deleted successfully"
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/vendors/vendors.routes.js
var require_vendors_routes = __commonJS({
  "src/modules/vendors/vendors.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireAdmin, requireSalesOrAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute } = require_cache();
    router.use(authenticateToken);
    router.get(
      "/",
      requireSalesOrAdmin,
      cacheRoute(60),
      async (req, res, next) => {
        try {
          const { search } = req.query;
          let whereClause = "";
          const params = [];
          if (search && search.trim()) {
            params.push(`%${search.trim().toLowerCase()}%`);
            whereClause = `
          WHERE
            LOWER(v.name) LIKE $${params.length}
            OR LOWER(COALESCE(v.contact, '')) LIKE $${params.length}
            OR LOWER(COALESCE(v.address, '')) LIKE $${params.length}
            OR LOWER(v.id) LIKE $${params.length}
        `;
          }
          const query = `
        SELECT
          v.id,
          v.name,
          v.contact,
          v.address,
          v.notes,
          v.created_at,
          v.updated_at,

          COALESCE(
            SUM(
              CASE
                WHEN a.type = 'Vendor Payable'
                  AND a.status = 'Open'
                THEN a.remaining
                ELSE 0
              END
            ),
            0
          ) AS payable,

          COALESCE(
            SUM(
              CASE
                WHEN a.type = 'Vendor Receivable'
                  AND a.status = 'Open'
                THEN a.remaining
                ELSE 0
              END
            ),
            0
          ) AS receivable

        FROM vendors v

        LEFT JOIN accounts a
          ON a.party_id = v.id

        ${whereClause}

        GROUP BY v.id

        ORDER BY v.created_at DESC
      `;
          const result2 = await db.query(
            query,
            params
          );
          const vendors = result2.rows.map((row) => ({
            id: row.id,
            name: row.name,
            contact: row.contact,
            address: row.address,
            notes: row.notes,
            payable: parseFloat(
              row.payable || 0
            ),
            receivable: parseFloat(
              row.receivable || 0
            ),
            openPayable: parseFloat(
              row.payable || 0
            ),
            openReceivable: parseFloat(
              row.receivable || 0
            ),
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }));
          return res.json({
            success: true,
            data: vendors
          });
        } catch (error) {
          next(error);
        }
      }
    );
    router.post(
      "/",
      requireSalesOrAdmin,
      async (req, res, next) => {
        try {
          const {
            name,
            contact,
            address,
            notes
          } = req.body;
          if (!name || String(name).trim() === "") {
            return res.status(400).json({
              success: false,
              code: "MISSING_NAME",
              message: "Vendor name is required."
            });
          }
          const cleanName = String(name).trim();
          const cleanContact = contact ? String(contact).trim() : null;
          const cleanAddress = address ? String(address).trim() : null;
          const cleanNotes = notes ? String(notes).trim() : null;
          const existing = await db.query(
            `
        SELECT
          id,
          name,
          contact,
          address,
          notes

        FROM vendors

        WHERE LOWER(name) = $1
          AND (
            $2::varchar IS NULL
            OR contact = $2
          )
        `,
            [
              cleanName.toLowerCase(),
              cleanContact
            ]
          );
          if (existing.rows.length > 0) {
            if (cleanAddress && !existing.rows[0].address) {
              await db.query(
                `
            UPDATE vendors

            SET address = $1

            WHERE id = $2
            `,
                [
                  cleanAddress,
                  existing.rows[0].id
                ]
              );
              existing.rows[0].address = cleanAddress;
              await CacheService.invalidatePattern(
                "route:*:/api/vendors*"
              );
            }
            return res.json({
              success: true,
              message: "Existing vendor found",
              data: existing.rows[0]
            });
          }
          const vendorId = await getNextEntityId(
            "vendors",
            "id",
            "VND",
            4
          );
          const insertRes = await db.query(
            `
        INSERT INTO vendors (
          id,
          name,
          contact,
          address,
          notes
        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )

        RETURNING *
        `,
            [
              vendorId,
              cleanName,
              cleanContact,
              cleanAddress,
              cleanNotes
            ]
          );
          await CacheService.invalidatePattern(
            "route:*:/api/vendors*"
          );
          emitEvent(
            "vendors.created",
            insertRes.rows[0]
          );
          return res.status(201).json({
            success: true,
            message: "Vendor created successfully",
            data: insertRes.rows[0]
          });
        } catch (error) {
          next(error);
        }
      }
    );
    router.put(
      "/:id",
      requireAdmin,
      async (req, res, next) => {
        try {
          const { id } = req.params;
          const {
            name,
            contact,
            address,
            notes
          } = req.body;
          if (!name || String(name).trim() === "") {
            return res.status(400).json({
              success: false,
              code: "MISSING_NAME",
              message: "Vendor name is required."
            });
          }
          const cleanName = String(name).trim();
          const cleanContact = contact ? String(contact).trim() : null;
          const cleanAddress = address ? String(address).trim() : null;
          const cleanNotes = notes ? String(notes).trim() : null;
          const result2 = await db.withTransaction(
            async (client) => {
              const updateRes = await client.query(
                `
              UPDATE vendors

              SET
                name = $1,
                contact = $2,
                address = $3,
                notes = $4,
                updated_at = CURRENT_TIMESTAMP

              WHERE id = $5

              RETURNING *
              `,
                [
                  cleanName,
                  cleanContact,
                  cleanAddress,
                  cleanNotes,
                  id
                ]
              );
              if (updateRes.rows.length === 0) {
                const error = new Error(
                  "Vendor not found"
                );
                error.status = 404;
                throw error;
              }
              await client.query(
                `
            UPDATE invoices

            SET
              party_name = $1,
              contact = $2

            WHERE party_id = $3
            `,
                [
                  cleanName,
                  cleanContact,
                  id
                ]
              );
              await client.query(
                `
            UPDATE accounts

            SET party_name = $1

            WHERE party_id = $2
            `,
                [
                  cleanName,
                  id
                ]
              );
              await client.query(
                `
            UPDATE payments

            SET party_name = $1

            WHERE party_id = $2
            `,
                [
                  cleanName,
                  id
                ]
              );
              await client.query(
                `
            UPDATE vendor_returns

            SET vendor_name = $1

            WHERE vendor_id = $2
            `,
                [
                  cleanName,
                  id
                ]
              );
              return updateRes.rows[0];
            }
          );
          await CacheService.invalidatePattern(
            "route:*:/api/vendors*"
          );
          emitEvent(
            "vendors.updated",
            result2
          );
          return res.json({
            success: true,
            message: "Vendor updated successfully",
            data: result2
          });
        } catch (error) {
          next(error);
        }
      }
    );
    router.delete(
      "/:id",
      requireAdmin,
      async (req, res, next) => {
        try {
          const { id } = req.params;
          const invCheck = await db.query(
            `
          SELECT id

          FROM invoices

          WHERE party_id = $1

          LIMIT 1
          `,
            [id]
          );
          const returnCheck = await db.query(
            `
          SELECT id

          FROM vendor_returns

          WHERE vendor_id = $1

          LIMIT 1
          `,
            [id]
          );
          const accCheck = await db.query(
            `
          SELECT id

          FROM accounts

          WHERE party_id = $1

          LIMIT 1
          `,
            [id]
          );
          if (invCheck.rows.length > 0 || returnCheck.rows.length > 0 || accCheck.rows.length > 0) {
            return res.status(400).json({
              success: false,
              code: "HAS_TRANSACTION_HISTORY",
              message: "This vendor has transaction history and cannot be deleted. You may edit their profile instead."
            });
          }
          await db.query(
            `
        DELETE FROM vendors

        WHERE id = $1
        `,
            [id]
          );
          await CacheService.invalidatePattern(
            "route:*:/api/vendors*"
          );
          emitEvent(
            "vendors.deleted",
            { id }
          );
          return res.json({
            success: true,
            message: "Vendor profile deleted successfully"
          });
        } catch (error) {
          next(error);
        }
      }
    );
    module2.exports = router;
  }
});

// src/utils/userHelper.js
var require_userHelper = __commonJS({
  "src/utils/userHelper.js"(exports2, module2) {
    function getCreator(user) {
      const isSuper = user?.role === "super_admin" || user?.isSuperAdmin;
      return {
        id: isSuper ? null : user?.id || null,
        name: user?.name || (isSuper ? "Platform Super Admin" : user?.username || "Staff")
      };
    }
    module2.exports = {
      getCreator
    };
  }
});

// src/modules/inventory/inventory.routes.js
var require_inventory_routes = __commonJS({
  "src/modules/inventory/inventory.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var InventoryService = require_inventory_service();
    var authenticateToken = require_auth();
    var { requireAdmin, requireSalesOrAdmin } = require_rbac();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    var { getCreator } = require_userHelper();
    router.use(authenticateToken);
    router.get("/", cacheRoute(60), async (req, res, next) => {
      try {
        const products = await InventoryService.getProducts(req.query, req.user.role);
        return res.json({
          success: true,
          data: products
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/ledger", cacheRoute(60), async (req, res, next) => {
      try {
        const query = `
      SELECT m.*, u.name as performed_by_name
      FROM inventory_movements m
      LEFT JOIN users u ON u.id = m.performed_by
      ORDER BY m.date DESC, m.created_at DESC
      LIMIT 100
    `;
        const result2 = await db.query(query);
        return res.json({
          success: true,
          data: result2.rows.map((m) => ({
            id: m.id,
            productId: m.product_id,
            productCode: m.product_code,
            direction: m.direction,
            quantity: m.quantity,
            reason: m.reason,
            referenceType: m.reference_type,
            referenceId: m.reference_id,
            performedBy: m.performed_by_name || m.performed_by,
            date: m.date,
            createdAt: m.created_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id/history", cacheRoute(60), async (req, res, next) => {
      try {
        const result2 = await InventoryService.getProductById(req.params.id, req.user.role);
        if (!result2) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Product not found."
          });
        }
        return res.json({
          success: true,
          data: result2.movements.map((m) => ({
            id: m.id,
            date: m.date,
            ref_type: m.referenceType || (m.direction === "IN" ? "Stock IN" : "Stock OUT"),
            ref_id: m.referenceId,
            reason: m.reason,
            change_amount: m.direction === "IN" ? m.quantity : -m.quantity,
            balance_after: null,
            created_by_name: m.performedBy
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/export-csv", requireSalesOrAdmin, async (req, res, next) => {
      try {
        let escapeCsvCell2 = function(val) {
          if (val === null || val === void 0) return "";
          let str = String(val);
          if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };
        var escapeCsvCell = escapeCsvCell2;
        const products = await InventoryService.getProducts({}, req.user.role);
        const headers = [
          "Product Code",
          "Category",
          "Brand",
          "Model",
          "Specifications",
          "Condition",
          "Current Stock",
          ...req.user.role !== "technician" ? ["Cost Price"] : [],
          "Expected Sale Price",
          "Low Stock Alert",
          "Source / Supplier"
        ];
        const rows = [headers.map(escapeCsvCell2).join(",")];
        for (const p of products) {
          const row = [
            p.code,
            p.category,
            p.brand,
            p.model,
            p.specifications || "",
            p.condition || "Used",
            p.currentStock || 0,
            ...req.user.role !== "technician" ? [p.costPrice || 0] : [],
            p.expectedSalePrice || 0,
            p.lowStockAlert || 1,
            p.sourceName || ""
          ];
          rows.push(row.map(escapeCsvCell2).join(","));
        }
        const csvContent = "\uFEFF" + rows.join("\r\n");
        const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="inventory-export-${dateStr}.csv"`);
        return res.send(csvContent);
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id", cacheRoute(60), async (req, res, next) => {
      try {
        const result2 = await InventoryService.getProductById(req.params.id, req.user.role);
        if (!result2) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Product not found."
          });
        }
        return res.json({
          success: true,
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    var { getNextInvoiceNo, getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    function paymentStatus(total, paid) {
      const t = parseFloat(total || 0);
      const p = parseFloat(paid || 0);
      if (t <= 0 || p >= t) return "Paid";
      if (p > 0) return "Partial";
      return "Unpaid";
    }
    router.post("/", requireAdmin, async (req, res, next) => {
      try {
        const category = req.body.category || req.body.categoryName;
        const { quantity } = req.body;
        if (!category || !quantity) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Category and Quantity are required."
          });
        }
        const firstCustomVal = req.body.customFields && typeof req.body.customFields === "object" ? Object.values(req.body.customFields).find((v) => v && String(v).trim()) : null;
        const brand = req.body.brand || req.body.customFields?.Brand || req.body.customFields?.brand || category;
        const model = req.body.model || req.body.productName || req.body.customFields?.Model || req.body.customFields?.["Model / Product Name"] || firstCustomVal || category;
        req.body.brand = brand;
        req.body.model = model;
        req.body.category = category;
        req.body.categoryName = category;
        const qty = parseInt(quantity || 1, 10);
        const costPrice = parseFloat(req.body.costPrice || 0);
        const totalCost = qty * costPrice;
        let vendorName = req.body.vendorName || req.body.supplierName || req.body.sourceName || null;
        let vendorId = req.body.vendorId || req.body.supplierId || req.body.sourceId || null;
        let purchaseInvoiceNo = req.body.purchaseInvoiceNo || req.body.invoiceNo || null;
        const purchaseDate = req.body.purchaseDate || req.body.date || /* @__PURE__ */ new Date();
        const paymentMethod = req.body.paymentMethod || "Cash";
        const referenceId = req.body.referenceId || req.body.paymentReferenceId || null;
        const hasVendor = vendorId && vendorId !== "MANUAL" || vendorName && vendorName.trim() !== "" && vendorName !== "Manual Entry";
        const result2 = await db.withTransaction(async (client) => {
          if (!vendorId && vendorName && vendorName.trim() !== "" && vendorName !== "Manual Entry") {
            const vRes = await client.query("SELECT id, name, contact FROM vendors WHERE LOWER(name) = LOWER($1)", [vendorName.trim()]);
            if (vRes.rows.length > 0) {
              vendorId = vRes.rows[0].id;
              vendorName = vRes.rows[0].name;
            } else {
              vendorId = await getNextEntityId("vendors", "id", "VND", 4, client);
              await client.query("INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)", [
                vendorId,
                vendorName.trim(),
                req.body.vendorContact || req.body.contact || null
              ]);
            }
          } else if (!vendorId && (!vendorName || vendorName.trim() === "" || vendorName === "Manual Entry")) {
            const vRes = await client.query(`SELECT id, name FROM vendors WHERE LOWER(name) = 'direct purchase' OR LOWER(name) = 'cash vendor' LIMIT 1`);
            if (vRes.rows.length > 0) {
              vendorId = vRes.rows[0].id;
              vendorName = vRes.rows[0].name;
            } else {
              vendorId = await getNextEntityId("vendors", "id", "VND", 4, client);
              vendorName = "Cash Vendor / Direct Purchase";
              await client.query("INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)", [
                vendorId,
                vendorName,
                null
              ]);
            }
          }
          let generatedInvoiceNo = purchaseInvoiceNo;
          let generatedInvoiceId = null;
          if (totalCost > 0) {
            if (!generatedInvoiceNo || generatedInvoiceNo === "MANUAL") {
              generatedInvoiceNo = await getNextInvoiceNo("vendor_purchase", client);
            }
            generatedInvoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
          }
          const sourceData = {
            sourceName: vendorName || "Direct Purchase",
            sourceId: vendorId || "MANUAL",
            invoiceNo: generatedInvoiceNo || "MANUAL",
            date: purchaseDate,
            reason: req.body.reason || (vendorName ? `Stock purchased from ${vendorName}` : "Stock Purchase"),
            refType: "Vendor Purchase",
            refId: generatedInvoiceId || vendorId || "MANUAL"
          };
          const productResult = await InventoryService.addOrMergeProduct(req.body, sourceData, req.user, client);
          const product = productResult.product;
          if (totalCost > 0) {
            let reqPaid = req.body.paid !== void 0 ? req.body.paid : req.body.vendorPaid;
            const paidAmount = reqPaid === void 0 || reqPaid === "" ? totalCost : Math.min(Math.max(0, parseFloat(reqPaid || 0)), totalCost);
            const balance = Math.max(0, totalCost - paidAmount);
            const pStatus = paymentStatus(totalCost, paidAmount);
            let vendorContact = req.body.vendorContact || req.body.contact || null;
            if (!vendorContact && vendorId) {
              const vRow = await client.query("SELECT contact FROM vendors WHERE id = $1", [vendorId]);
              if (vRow.rows.length > 0) vendorContact = vRow.rows[0].contact;
            }
            let validUserId = null;
            if (req.user?.id) {
              const uRes = await client.query("SELECT id FROM users WHERE id = $1", [req.user.id]);
              if (uRes.rows.length > 0) validUserId = uRes.rows[0].id;
            }
            const invRes = await client.query(
              `INSERT INTO invoices (
            id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
            product_total, service_total, total, paid, initial_paid, balance, payment_method,
            reference_id, payment_status, is_voided, created_by, created_by_name
          ) VALUES (
            $1, $2, 'Vendor Purchase', 'vendor_purchase', $3, 'Vendor', $4, $5, $6,
            $7, 0, $7, $8, $8, $9, $10,
            $11, $12, FALSE, $13, $14
          ) RETURNING *`,
              [
                generatedInvoiceId,
                generatedInvoiceNo,
                purchaseDate,
                vendorId,
                vendorName,
                vendorContact,
                totalCost,
                paidAmount,
                balance,
                paymentMethod,
                referenceId,
                pStatus,
                validUserId,
                req.user.name || "Platform Super Admin"
              ]
            );
            await client.query(
              `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                generatedInvoiceId,
                product.id,
                product.code,
                `${product.brand} ${product.model}`.trim(),
                `${product.category_name} \u2014 ${product.brand} ${product.model}`,
                qty,
                costPrice,
                costPrice,
                totalCost
              ]
            );
            if (paidAmount > 0) {
              const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
              await client.query(
                `INSERT INTO payments (
              id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
              direction, amount, date, payment_method, reference_id, notes, affects_money,
              is_initial_settlement, created_by, created_by_name
            ) VALUES (
              $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
              'Paid', $6, $7, $8, $9, 'Inventory Add Product Vendor Payment', TRUE,
              TRUE, $10, $11
            )`,
                [
                  payId,
                  generatedInvoiceId,
                  generatedInvoiceNo,
                  vendorId,
                  vendorName,
                  paidAmount,
                  purchaseDate,
                  paymentMethod,
                  referenceId,
                  validUserId,
                  req.user.name || "Platform Super Admin"
                ]
              );
            }
            if (balance > 0) {
              const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
              await client.query(
                `INSERT INTO accounts (
              id, type, party_type, party_id, party_name, invoice_id, invoice_no,
              amount, remaining, status, date
            ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
                [accId, vendorId, vendorName, generatedInvoiceId, generatedInvoiceNo, balance, balance, purchaseDate]
              );
            }
            emitEvent("invoice.created", invRes.rows[0]);
            try {
              const InvoiceWhatsAppService = require_invoice_whatsapp_service();
              InvoiceWhatsAppService.sendInvoiceWhatsApp(invRes.rows[0].id).catch((e) => {
                console.error("[inventory.routes] WhatsApp invoice auto-send error:", e.message);
              });
            } catch (waErr) {
            }
          }
          return productResult;
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/accounts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        return res.status(201).json({
          success: true,
          message: result2.isNew ? "Product created with new code" : "Quantity merged into existing product",
          data: result2.product,
          isNew: result2.isNew
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const cat = req.body.category || req.body.categoryName;
        const {
          inventoryType,
          brand,
          model,
          screenSize,
          processor,
          ram,
          romSsd,
          hardDrive,
          graphicsCard,
          accessoryCategory,
          description,
          others,
          condition,
          costPrice,
          expectedSalePrice,
          lowStockAlert,
          remarks,
          dateAdded,
          vendorId,
          supplierId,
          sourceId,
          vendorName,
          supplierName,
          sourceName,
          purchaseInvoiceNo,
          invoiceNo,
          purchaseDate,
          paymentMethod = "Cash",
          referenceId = null,
          paid
        } = req.body;
        const category = cat;
        const result2 = await db.withTransaction(async (client) => {
          const existingRes = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [id]);
          if (existingRes.rows.length === 0) {
            const error = new Error("Product not found.");
            error.status = 404;
            throw error;
          }
          const existingProd = existingRes.rows[0];
          const specifications = [
            screenSize ? `Screen/Size: ${screenSize}` : null,
            processor ? `Processor: ${processor}` : null,
            ram ? `RAM: ${ram}` : null,
            romSsd ? `ROM/SSD: ${romSsd}` : null,
            hardDrive ? `Hard Drive: ${hardDrive}` : null,
            graphicsCard ? `Graphics: ${graphicsCard}` : null,
            accessoryCategory ? `Accessory Category: ${accessoryCategory}` : null,
            description ? `Description: ${description}` : null,
            others ? `Others: ${others}` : null
          ].filter(Boolean).join(" | ");
          let vId = vendorId !== void 0 ? vendorId : supplierId !== void 0 ? supplierId : sourceId !== void 0 ? sourceId : existingProd.source_id;
          let vName = vendorName !== void 0 ? vendorName : supplierName !== void 0 ? supplierName : sourceName !== void 0 ? sourceName : existingProd.source_name;
          let invNo = purchaseInvoiceNo !== void 0 ? purchaseInvoiceNo : invoiceNo !== void 0 ? invoiceNo : existingProd.purchase_invoice_no;
          const hasVendor = vId && vId !== "MANUAL" || vName && vName.trim() !== "" && vName !== "Manual Entry";
          if (hasVendor) {
            if (vId && (!vName || vName === "Manual Entry")) {
              const vRes = await client.query("SELECT id, name, contact FROM vendors WHERE id = $1", [vId]);
              if (vRes.rows.length > 0) {
                vName = vRes.rows[0].name;
              }
            } else if (vName && (!vId || vId === "MANUAL")) {
              const vRes = await client.query("SELECT id, name, contact FROM vendors WHERE LOWER(name) = LOWER($1)", [vName.trim()]);
              if (vRes.rows.length > 0) {
                vId = vRes.rows[0].id;
                vName = vRes.rows[0].name;
              } else {
                vId = await getNextEntityId("vendors", "id", "VND", 4, client);
                await client.query("INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)", [
                  vId,
                  vName.trim(),
                  req.body.vendorContact || req.body.contact || null
                ]);
              }
            }
          }
          const effectiveCostPrice = costPrice !== void 0 ? parseFloat(costPrice || 0) : parseFloat(existingProd.cost_price || 0);
          const effectiveQty = parseInt(req.body.quantity || existingProd.current_stock || existingProd.stock_in || 1, 10);
          const totalCost = effectiveQty * effectiveCostPrice;
          const updateRes = await client.query(
            `UPDATE products SET
          inventory_type = COALESCE($1, inventory_type),
          category_name = COALESCE($2, category_name),
          brand = COALESCE($3, brand),
          model = COALESCE($4, model),
          product_name = COALESCE($4, product_name),
          screen_size = $5,
          processor = $6,
          ram = $7,
          rom_ssd = $8,
          hard_drive = $9,
          graphics_card = $10,
          accessory_category = $11,
          description = $12,
          others = $13,
          specifications = $14,
          condition = COALESCE($15, condition),
          cost_price = COALESCE($16, cost_price),
          expected_sale_price = COALESCE($17, expected_sale_price),
          low_stock_alert = COALESCE($18, low_stock_alert),
          remarks = $19,
          date_added = COALESCE($20, date_added),
          source_id = CASE WHEN $21::varchar IS NOT NULL THEN $21 ELSE source_id END,
          source_name = CASE WHEN $22::varchar IS NOT NULL THEN $22 ELSE source_name END,
          purchase_invoice_no = CASE WHEN $23::varchar IS NOT NULL THEN $23 ELSE purchase_invoice_no END,
          current_stock = CASE WHEN $24::integer IS NOT NULL THEN $24 ELSE current_stock END,
          stock_in = CASE WHEN $24::integer IS NOT NULL THEN $24 ELSE stock_in END,
          custom_fields = CASE WHEN $26::jsonb IS NOT NULL THEN $26::jsonb ELSE custom_fields END,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $25
         RETURNING *`,
            [
              inventoryType,
              category,
              brand,
              model,
              screenSize,
              processor,
              ram,
              romSsd,
              hardDrive,
              graphicsCard,
              accessoryCategory,
              description,
              others,
              specifications,
              condition,
              costPrice,
              expectedSalePrice,
              lowStockAlert,
              remarks,
              dateAdded,
              vId !== void 0 ? vId : null,
              vName !== void 0 ? vName : null,
              invNo !== void 0 ? invNo : null,
              req.body.quantity !== void 0 ? effectiveQty : null,
              id,
              req.body.customFields ? JSON.stringify(req.body.customFields) : null
            ]
          );
          const updatedProduct = updateRes.rows[0];
          if (hasVendor && totalCost > 0) {
            let reqPaid = paid !== void 0 ? paid : req.body.vendorPaid;
            const paidAmount = reqPaid === void 0 || reqPaid === "" ? totalCost : Math.min(Math.max(0, parseFloat(reqPaid || 0)), totalCost);
            const balance = Math.max(0, totalCost - paidAmount);
            const pStatus = paymentStatus(totalCost, paidAmount);
            const pDate = purchaseDate || req.body.date || updatedProduct.date_added || /* @__PURE__ */ new Date();
            let vendorContact = req.body.vendorContact || req.body.contact || null;
            if (!vendorContact && vId) {
              const vRow = await client.query("SELECT contact FROM vendors WHERE id = $1", [vId]);
              if (vRow.rows.length > 0) vendorContact = vRow.rows[0].contact;
            }
            let existingInvRes = await client.query(
              `SELECT i.id, i.invoice_no 
           FROM invoices i 
           JOIN invoice_items ii ON ii.invoice_id = i.id 
           WHERE ii.product_id = $1 AND i.type_key = 'vendor_purchase' 
           LIMIT 1`,
              [id]
            );
            if (existingInvRes.rows.length === 0 && invNo && invNo !== "MANUAL") {
              const invMatch = await client.query(
                `SELECT id, invoice_no FROM invoices WHERE invoice_no = $1 AND type_key = 'vendor_purchase' LIMIT 1`,
                [invNo]
              );
              if (invMatch.rows.length > 0) {
                existingInvRes = invMatch;
              }
            }
            let targetInvoiceId;
            let targetInvoiceNo;
            if (existingInvRes.rows.length > 0) {
              targetInvoiceId = existingInvRes.rows[0].id;
              targetInvoiceNo = existingInvRes.rows[0].invoice_no;
              await client.query(
                `UPDATE invoices 
             SET party_id = $1, party_name = $2, contact = $3,
                 product_total = $4, total = $4, paid = $5, initial_paid = $5, balance = $6,
                 payment_status = $7, payment_method = $8, reference_id = $9, date = $10,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $11`,
                [
                  vId,
                  vName,
                  vendorContact,
                  totalCost,
                  paidAmount,
                  balance,
                  pStatus,
                  paymentMethod,
                  referenceId,
                  pDate,
                  targetInvoiceId
                ]
              );
              const itemCheck = await client.query("SELECT id FROM invoice_items WHERE invoice_id = $1 AND product_id = $2", [targetInvoiceId, id]);
              if (itemCheck.rows.length > 0) {
                await client.query(
                  `UPDATE invoice_items 
               SET code = $1, name = $2, description = $3, quantity = $4,
                   unit_price = $5, cost_price_snapshot = $5, line_total = $6
               WHERE invoice_id = $7 AND product_id = $8`,
                  [
                    updatedProduct.code,
                    `${updatedProduct.brand} ${updatedProduct.model}`.trim(),
                    `${updatedProduct.category_name} \u2014 ${updatedProduct.brand} ${updatedProduct.model}`,
                    effectiveQty,
                    effectiveCostPrice,
                    totalCost,
                    targetInvoiceId,
                    id
                  ]
                );
              } else {
                await client.query(
                  `INSERT INTO invoice_items (
                invoice_id, item_type, product_id, code, name, description, quantity,
                unit_price, cost_price_snapshot, line_total
              ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
                  [
                    targetInvoiceId,
                    id,
                    updatedProduct.code,
                    `${updatedProduct.brand} ${updatedProduct.model}`.trim(),
                    `${updatedProduct.category_name} \u2014 ${updatedProduct.brand} ${updatedProduct.model}`,
                    effectiveQty,
                    effectiveCostPrice,
                    effectiveCostPrice,
                    totalCost
                  ]
                );
              }
              const existingPayRes = await client.query("SELECT id FROM payments WHERE invoice_id = $1 LIMIT 1", [targetInvoiceId]);
              if (paidAmount > 0) {
                const creator = getCreator(req.user);
                if (existingPayRes.rows.length > 0) {
                  await client.query(
                    `UPDATE payments 
                 SET party_id = $1, party_name = $2, amount = $3, date = $4,
                     payment_method = $5, reference_id = $6
                 WHERE id = $7`,
                    [vId, vName, paidAmount, pDate, paymentMethod, referenceId, existingPayRes.rows[0].id]
                  );
                } else {
                  const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
                  await client.query(
                    `INSERT INTO payments (
                  id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
                  direction, amount, date, payment_method, reference_id, notes, affects_money,
                  is_initial_settlement, created_by, created_by_name
                ) VALUES (
                  $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
                  'Paid', $6, $7, $8, $9, 'Inventory Product Vendor Payment', TRUE,
                  TRUE, $10, $11
                )`,
                    [
                      payId,
                      targetInvoiceId,
                      targetInvoiceNo,
                      vId,
                      vName,
                      paidAmount,
                      pDate,
                      paymentMethod,
                      referenceId,
                      creator.id,
                      creator.name
                    ]
                  );
                }
              } else if (existingPayRes.rows.length > 0) {
                await client.query("DELETE FROM payments WHERE id = $1", [existingPayRes.rows[0].id]);
              }
              const existingAccRes = await client.query("SELECT id FROM accounts WHERE invoice_id = $1 LIMIT 1", [targetInvoiceId]);
              if (balance > 0) {
                if (existingAccRes.rows.length > 0) {
                  await client.query(
                    `UPDATE accounts 
                 SET party_id = $1, party_name = $2, amount = $3, remaining = $3, status = 'Open', date = $4
                 WHERE id = $5`,
                    [vId, vName, balance, pDate, existingAccRes.rows[0].id]
                  );
                } else {
                  const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
                  await client.query(
                    `INSERT INTO accounts (
                  id, type, party_type, party_id, party_name, invoice_id, invoice_no,
                  amount, remaining, status, date
                ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
                    [accId, vId, vName, targetInvoiceId, targetInvoiceNo, balance, balance, pDate]
                  );
                }
              } else if (existingAccRes.rows.length > 0) {
                await client.query("DELETE FROM accounts WHERE id = $1", [existingAccRes.rows[0].id]);
              }
            } else {
              let candidateInvNo = invNo && invNo !== "MANUAL" ? invNo : await getNextInvoiceNo("vendor_purchase", client);
              const invExistsCheck = await client.query("SELECT 1 FROM invoices WHERE invoice_no = $1", [candidateInvNo]);
              if (invExistsCheck.rows.length > 0) {
                candidateInvNo = await getNextInvoiceNo("vendor_purchase", client);
              }
              targetInvoiceNo = candidateInvNo;
              targetInvoiceId = await getNextEntityId("invoices", "id", "INV", 5, client);
              const creator = getCreator(req.user);
              const invRes = await client.query(
                `INSERT INTO invoices (
              id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
              product_total, service_total, total, paid, initial_paid, balance, payment_method,
              reference_id, payment_status, is_voided, created_by, created_by_name
            ) VALUES (
              $1, $2, 'Vendor Purchase', 'vendor_purchase', $3, 'Vendor', $4, $5, $6,
              $7, 0, $7, $8, $8, $9, $10,
              $11, $12, FALSE, $13, $14
            ) RETURNING *`,
                [
                  targetInvoiceId,
                  targetInvoiceNo,
                  pDate,
                  vId,
                  vName,
                  vendorContact,
                  totalCost,
                  paidAmount,
                  balance,
                  paymentMethod,
                  referenceId,
                  pStatus,
                  creator.id,
                  creator.name
                ]
              );
              await client.query(
                `INSERT INTO invoice_items (
              invoice_id, item_type, product_id, code, name, description, quantity,
              unit_price, cost_price_snapshot, line_total
            ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  targetInvoiceId,
                  id,
                  updatedProduct.code,
                  `${updatedProduct.brand} ${updatedProduct.model}`.trim(),
                  `${updatedProduct.category_name} \u2014 ${updatedProduct.brand} ${updatedProduct.model}`,
                  effectiveQty,
                  effectiveCostPrice,
                  effectiveCostPrice,
                  totalCost
                ]
              );
              if (paidAmount > 0) {
                const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
                await client.query(
                  `INSERT INTO payments (
                id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
                direction, amount, date, payment_method, reference_id, notes, affects_money,
                is_initial_settlement, created_by, created_by_name
              ) VALUES (
                $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
                'Paid', $6, $7, $8, $9, 'Inventory Product Vendor Payment', TRUE,
                TRUE, $10, $11
              )`,
                  [
                    payId,
                    targetInvoiceId,
                    targetInvoiceNo,
                    vId,
                    vName,
                    paidAmount,
                    pDate,
                    paymentMethod,
                    referenceId,
                    creator.id,
                    creator.name
                  ]
                );
              }
              if (balance > 0) {
                const accId = await getNextEntityId("accounts", "id", "ACC", 4, client);
                await client.query(
                  `INSERT INTO accounts (
                id, type, party_type, party_id, party_name, invoice_id, invoice_no,
                amount, remaining, status, date
              ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
                  [accId, vId, vName, targetInvoiceId, targetInvoiceNo, balance, balance, pDate]
                );
              }
              await client.query(
                `UPDATE products SET purchase_invoice_no = $1, source_id = $2, source_name = $3 WHERE id = $4`,
                [targetInvoiceNo, vId, vName, id]
              );
              emitEvent("invoice.created", invRes.rows[0]);
              try {
                const InvoiceWhatsAppService = require_invoice_whatsapp_service();
                InvoiceWhatsAppService.sendInvoiceWhatsApp(invRes.rows[0].id).catch((e) => {
                  console.error("[inventory.routes] WhatsApp invoice auto-send error:", e.message);
                });
              } catch (waErr) {
              }
            }
          }
          emitEvent("inventory.updated", { productId: id, currentStock: updatedProduct.current_stock });
          emitEvent("products.updated", updatedProduct);
          return updatedProduct;
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/vendors*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/accounts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        return res.json({
          success: true,
          message: "Product and vendor ledger updated successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/adjust", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const {
          direction,
          quantity,
          reason,
          date,
          vendorId,
          vendorName,
          vendorContact,
          costPrice,
          purchaseInvoiceNo,
          paid,
          paymentMethod,
          referenceId
        } = req.body;
        if (!direction || !quantity) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Direction and Quantity are required."
          });
        }
        const result2 = await db.withTransaction(async (client) => {
          return await InventoryService.adjustStock({
            productId: id,
            direction,
            quantity,
            reason: reason || `Manual ${direction} adjustment`,
            refType: "Manual Adjustment",
            refId: "MANUAL",
            date: date || /* @__PURE__ */ new Date(),
            user: req.user,
            vendorId,
            vendorName,
            vendorContact,
            costPrice,
            purchaseInvoiceNo,
            paid,
            paymentMethod,
            referenceId
          }, client);
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/vendors*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Stock adjusted successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/adjustments", requireAdmin, async (req, res, next) => {
      try {
        const {
          productId,
          direction,
          quantity,
          reason,
          date,
          vendorId,
          vendorName,
          vendorContact,
          costPrice,
          purchaseInvoiceNo,
          paid,
          paymentMethod,
          referenceId
        } = req.body;
        if (!productId || !direction || !quantity || !reason) {
          return res.status(400).json({
            success: false,
            code: "MISSING_FIELDS",
            message: "Product, Direction, Quantity, and Reason are required."
          });
        }
        const result2 = await db.withTransaction(async (client) => {
          return await InventoryService.adjustStock({
            productId,
            direction,
            quantity,
            reason,
            refType: "Manual Adjustment",
            refId: "MANUAL",
            date: date || /* @__PURE__ */ new Date(),
            user: req.user,
            vendorId,
            vendorName,
            vendorContact,
            costPrice,
            purchaseInvoiceNo,
            paid,
            paymentMethod,
            referenceId
          }, client);
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/vendors*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Stock adjustment applied successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    function parseCsvText(text) {
      if (!text || typeof text !== "string") return [];
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) return [];
      function splitCsvLine(line) {
        const result2 = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (c === "," && !inQuotes) {
            result2.push(cur.trim());
            cur = "";
          } else {
            cur += c;
          }
        }
        result2.push(cur.trim());
        return result2;
      }
      const rawHeaders = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
      const headerMap = {
        category: ["category", "categoryname", "cat"],
        brand: ["brand", "make"],
        model: ["model", "modelname", "productname"],
        specifications: ["specifications", "specs", "specification", "details", "description"],
        condition: ["condition", "state"],
        quantity: ["quantity", "qty", "stock", "initialstock", "count"],
        costPrice: ["costprice", "cost", "purchaseprice", "buyprice"],
        expectedSalePrice: ["expectedsaleprice", "saleprice", "price", "sellprice", "sellingprice"],
        lowStockAlert: ["lowstockalert", "lowstock", "alert", "minstock"]
      };
      const resolvedIndices = {};
      for (const [field, aliases] of Object.entries(headerMap)) {
        const idx = rawHeaders.findIndex((h) => aliases.includes(h));
        if (idx !== -1) resolvedIndices[field] = idx;
      }
      const products = [];
      for (let i = 1; i < lines.length; i++) {
        const values = splitCsvLine(lines[i]);
        if (values.length === 0 || values.every((v) => v === "")) continue;
        const row = {};
        for (const [field, idx] of Object.entries(resolvedIndices)) {
          row[field] = values[idx] !== void 0 ? values[idx] : "";
        }
        if (!row.category && values[0]) row.category = values[0];
        if (!row.brand && values[1]) row.brand = values[1];
        if (!row.model && values[2]) row.model = values[2];
        if (!row.specifications && values[3]) row.specifications = values[3];
        if (!row.condition && values[4]) row.condition = values[4] || "Used";
        if (!row.quantity && values[5]) row.quantity = values[5];
        if (!row.costPrice && values[6]) row.costPrice = values[6];
        if (!row.expectedSalePrice && values[7]) row.expectedSalePrice = values[7];
        if (!row.lowStockAlert && values[8]) row.lowStockAlert = values[8];
        const qty = parseInt(row.quantity, 10);
        if (row.category && row.brand && row.model && !isNaN(qty) && qty > 0) {
          products.push({
            category: row.category,
            brand: row.brand,
            model: row.model,
            specifications: row.specifications || "",
            condition: row.condition || "Used",
            quantity: qty,
            costPrice: parseFloat(row.costPrice) || 0,
            expectedSalePrice: parseFloat(row.expectedSalePrice) || 0,
            lowStockAlert: parseInt(row.lowStockAlert, 10) || 1
          });
        }
      }
      return products;
    }
    router.post("/bulk-csv", requireAdmin, async (req, res, next) => {
      try {
        let productList = req.body.products;
        if (!Array.isArray(productList) || productList.length === 0) {
          if (req.body.csvText && typeof req.body.csvText === "string") {
            productList = parseCsvText(req.body.csvText);
          }
        }
        if (!Array.isArray(productList) || productList.length === 0) {
          return res.status(400).json({
            success: false,
            code: "EMPTY_LIST",
            message: "No valid product rows could be extracted from CSV. Please check headers and formatting."
          });
        }
        const imported = [];
        await db.withTransaction(async (client) => {
          for (const p of productList) {
            if (p.category && p.brand && p.model && p.quantity > 0) {
              const sourceData = {
                sourceName: p.sourceName || "CSV Bulk Import",
                invoiceNo: `CSV-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
                date: /* @__PURE__ */ new Date(),
                reason: "CSV Bulk Inventory Import",
                refType: "CSV Import",
                refId: `CSV-${Date.now()}`
              };
              const result2 = await InventoryService.addOrMergeProduct(p, sourceData, req.user, client);
              imported.push(result2.product);
            }
          }
        });
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/products*",
          "/api/categories*",
          "/api/dashboard*"
        ]);
        return res.json({
          success: true,
          message: `${imported.length} product row(s) imported and merged successfully!`,
          data: { count: imported.length, imported: imported.length }
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const prodRes = await db.query("SELECT * FROM products WHERE id = $1", [id]);
        if (prodRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Product not found in inventory."
          });
        }
        const product = prodRes.rows[0];
        await db.withTransaction(async (client) => {
          await client.query("DELETE FROM inventory_movements WHERE product_id = $1", [id]);
          await client.query("UPDATE invoice_items SET product_id = NULL WHERE product_id = $1", [id]);
          await client.query("UPDATE repair_parts_used SET product_id = NULL WHERE product_id = $1", [id]);
          await client.query("DELETE FROM products WHERE id = $1", [id]);
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/categories*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        emitEvent("products.deleted", { id, code: product.code });
        return res.json({
          success: true,
          message: `Product ${product.code} (${product.brand} ${product.model}) deleted from inventory successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/invoices/invoices.routes.js
var require_invoices_routes = __commonJS({
  "src/modules/invoices/invoices.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var InvoiceService = require_invoices_service();
    var authenticateToken = require_auth();
    var { requireAdmin, requireSalesOrAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { getCreator } = require_userHelper();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.get("/:id/pdf", async (req, res, next) => {
      try {
        const invoice = await InvoiceService.getInvoiceById(req.params.id);
        if (!invoice) {
          return res.status(404).json({
            success: false,
            message: "Invoice not found."
          });
        }
        const { generateInvoicePdf } = require_invoice_pdf_service();
        const pdfBuffer = await generateInvoicePdf(invoice);
        const filename = `Invoice-${invoice.invoiceNo || invoice.id}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        return res.end(pdfBuffer);
      } catch (error) {
        next(error);
      }
    });
    router.use(authenticateToken);
    router.get("/", cacheRoute(60), async (req, res, next) => {
      try {
        const { search, type, status, from, to, page, limit } = req.query;
        let queryText = "SELECT * FROM invoices WHERE 1=1";
        const params = [];
        if (req.user.role === "sales") {
          params.push(req.user.id);
          queryText += ` AND created_by = $${params.length}`;
        }
        if (search && String(search).trim() !== "") {
          params.push(`%${search.trim().toLowerCase()}%`);
          queryText += ` AND (
        LOWER(invoice_no) LIKE $${params.length} OR
        LOWER(party_name) LIKE $${params.length} OR
        LOWER(COALESCE(contact, '')) LIKE $${params.length}
      )`;
        }
        if (type) {
          params.push(type);
          queryText += ` AND (type = $${params.length} OR type_key = $${params.length})`;
        }
        if (status) {
          params.push(status);
          if (status === "Voided") {
            queryText += ` AND is_voided = TRUE`;
          } else {
            queryText += ` AND payment_status = $${params.length} AND is_voided = FALSE`;
          }
        }
        if (from) {
          params.push(from);
          queryText += ` AND date >= $${params.length}`;
        }
        if (to) {
          params.push(to);
          queryText += ` AND date <= $${params.length}`;
        }
        queryText += " ORDER BY date DESC, created_at DESC";
        if (limit) {
          const pageNum = parseInt(page || "1", 10);
          const limitNum = parseInt(limit, 10);
          const offset = (pageNum - 1) * limitNum;
          params.push(limitNum);
          queryText += ` LIMIT $${params.length}`;
          params.push(offset);
          queryText += ` OFFSET $${params.length}`;
        }
        const result2 = await db.query(queryText, params);
        return res.json({
          success: true,
          data: result2.rows.map((inv) => ({
            id: inv.id,
            invoiceNo: inv.invoice_no,
            type: inv.type,
            typeKey: inv.type_key,
            date: inv.date,
            partyType: inv.party_type,
            partyId: inv.party_id,
            partyName: inv.party_name,
            contact: inv.contact,
            exchangeCase: inv.exchange_case,
            productTotal: parseFloat(inv.product_total || 0),
            serviceTotal: parseFloat(inv.service_total || 0),
            total: parseFloat(inv.total || 0),
            paid: parseFloat(inv.paid || 0),
            initialPaid: parseFloat(inv.initial_paid || 0),
            creditAdjusted: parseFloat(inv.credit_adjusted || 0),
            balance: parseFloat(inv.balance || 0),
            paymentMethod: inv.payment_method,
            referenceId: inv.reference_id,
            paymentStatus: inv.payment_status,
            isVoided: inv.is_voided,
            voidDate: inv.void_date,
            voidReason: inv.void_reason,
            refundAmount: parseFloat(inv.refund_amount || 0),
            createdById: inv.created_by,
            createdByName: inv.created_by_name,
            createdAt: inv.created_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/sale", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const result2 = await InvoiceService.createSale(req.body, req.user);
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/invoices*",
          "/api/dashboard*",
          "/api/products*",
          "/api/customers*"
        ]);
        return res.status(201).json({
          success: true,
          message: "Sales invoice completed successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/customer-purchase", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const result2 = await InvoiceService.createCustomerPurchase(req.body, req.user);
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/invoices*",
          "/api/dashboard*",
          "/api/products*",
          "/api/customers*"
        ]);
        return res.status(201).json({
          success: true,
          message: "Customer purchase invoice completed successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/vendor-purchase", requireAdmin, async (req, res, next) => {
      try {
        const result2 = await InvoiceService.createVendorPurchase(req.body, req.user);
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/invoices*",
          "/api/dashboard*",
          "/api/products*",
          "/api/vendors*"
        ]);
        return res.status(201).json({
          success: true,
          message: "Vendor purchase completed successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/exchange", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const result2 = await InvoiceService.createExchange(req.body, req.user);
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/invoices*",
          "/api/dashboard*",
          "/api/products*",
          "/api/customers*"
        ]);
        return res.status(201).json({
          success: true,
          message: "Product exchange completed successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/vendor-return", requireAdmin, async (req, res, next) => {
      try {
        const result2 = await InvoiceService.createVendorReturn(req.body, req.user);
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/invoices*",
          "/api/dashboard*",
          "/api/products*",
          "/api/vendors*",
          "/api/accounts*",
          "/api/reports*"
        ]);
        return res.status(201).json({
          success: true,
          message: "Vendor return recorded successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/held-bills", requireSalesOrAdmin, async (req, res, next) => {
      try {
        let query = `SELECT * FROM held_bills`;
        const params = [];
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin" || req.user.isSuperAdmin;
        if (!isAdmin) {
          query += ` WHERE created_by = $1`;
          params.push(req.user.id);
        }
        query += ` ORDER BY updated_at DESC`;
        const result2 = await db.query(query, params);
        return res.json({
          success: true,
          data: result2.rows.map((b) => ({
            id: b.id,
            type: b.type,
            label: b.label,
            partyName: b.party_name,
            total: parseFloat(b.total || 0),
            payload: b.payload,
            createdById: b.created_by,
            createdByName: b.created_by_name,
            createdAt: b.created_at,
            updatedAt: b.updated_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/held-bills", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id, type, label, partyName, total, payload } = req.body;
        let holdId = id;
        const creator = getCreator(req.user);
        if (!holdId) {
          holdId = await getNextEntityId("held_bills", "id", "HLD", 5);
          await db.query(
            `INSERT INTO held_bills (id, type, label, party_name, total, payload, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [holdId, type, label, partyName || "Walk-in", parseFloat(total || 0), payload || {}, creator.id, creator.name]
          );
        } else {
          await db.query(
            `UPDATE held_bills
         SET type = $1, label = $2, party_name = $3, total = $4, payload = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
            [type, label, partyName || "Walk-in", parseFloat(total || 0), payload || {}, holdId]
          );
        }
        emitEvent("held_bills.updated", { id: holdId });
        return res.json({
          success: true,
          message: `${holdId} saved to Held Bills`,
          data: { id: holdId }
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/held-bills/:id", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        let delQuery = "DELETE FROM held_bills WHERE id = $1";
        const params = [id];
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin" || req.user.isSuperAdmin;
        if (!isAdmin) {
          delQuery += " AND created_by = $2";
          params.push(req.user.id);
        }
        await db.query(delQuery, params);
        emitEvent("held_bills.deleted", { id });
        return res.json({
          success: true,
          message: "Held bill discarded"
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id", cacheRoute(60), async (req, res, next) => {
      try {
        const invoice = await InvoiceService.getInvoiceById(req.params.id);
        if (!invoice) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Invoice not found."
          });
        }
        if (req.user.role === "sales" && invoice.createdById !== req.user.id && invoice.created_by !== req.user.id) {
          return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: "Access restricted to your own sales invoices."
          });
        }
        return res.json({
          success: true,
          data: invoice
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/void", requireAdmin, async (req, res, next) => {
      try {
        const result2 = await InvoiceService.voidSale(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
          "/api/invoices*",
          "/api/dashboard*",
          "/api/products*",
          "/api/customers*",
          "/api/vendors*",
          "/api/accounts*",
          "/api/reports*"
        ]);
        return res.json({
          success: true,
          message: "Sales invoice voided and inventory restored successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/send-whatsapp", async (req, res, next) => {
      try {
        const InvoiceWhatsAppService = require_invoice_whatsapp_service();
        const branchId = getBranchIdFromReq(req);
        const result2 = await InvoiceWhatsAppService.sendInvoiceWhatsApp(req.params.id, {
          branchId,
          isManual: true,
          customNote: req.body?.customNote
        });
        if (!result2.success) {
          return res.status(400).json({
            success: false,
            message: result2.message || result2.error || "Failed to dispatch WhatsApp invoice",
            reason: result2.reason
          });
        }
        return res.json({
          success: true,
          delivered: result2.delivered,
          wa_not_connected: result2.wa_not_connected || false,
          contact: result2.contact,
          message: result2.message || "Invoice PDF sent via WhatsApp"
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/accounts/accounts.routes.js
var require_accounts_routes = __commonJS({
  "src/modules/accounts/accounts.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireSalesOrAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { getAvailableBalance, validateOutflow } = require_financialFormulas();
    var { getCreator } = require_userHelper();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.use(authenticateToken);
    router.get("/drawer-balance", requireSalesOrAdmin, cacheRoute(30), async (req, res, next) => {
      try {
        const cash = await getAvailableBalance("Cash");
        const online = await getAvailableBalance("Online");
        return res.json({
          success: true,
          data: {
            cash: parseFloat(cash || 0),
            online: parseFloat(online || 0)
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/drawer-transaction", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { type, method, amount: reqAmount, notes, date } = req.body;
        const amount = parseFloat(reqAmount || 0);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({
            success: false,
            code: "INVALID_AMOUNT",
            message: "Amount must be greater than zero."
          });
        }
        const pMethod = method === "Online" ? "Online" : "Cash";
        const isDeposit = type === "Deposit" || type === "Cash In" || type === "Add";
        const direction = isDeposit ? "Received" : "Paid";
        const creator = getCreator(req.user);
        const payId = await getNextEntityId("payments", "id", "PAY", 5);
        const result2 = await db.query(`
      INSERT INTO payments (
        id, party_type, party_id, party_name, account_type,
        direction, amount, date, payment_method, reference_id, notes, affects_money,
        is_initial_settlement, created_by, created_by_name
      ) VALUES (
        $1, 'Business', 'TREASURY', 'Cash Drawer / Treasury', $2,
        $3, $4, $5, $6, $7, $8, TRUE,
        FALSE, $9, $10
      ) RETURNING *
    `, [
          payId,
          isDeposit ? "Drawer Deposit" : "Drawer Withdrawal",
          direction,
          amount,
          date || /* @__PURE__ */ new Date(),
          pMethod,
          null,
          notes ? notes.trim() : isDeposit ? `${pMethod} Drawer Deposit / Cash In` : `${pMethod} Drawer Withdrawal / Cash Out`,
          creator.id,
          creator.name
        ]);
        const newCash = await getAvailableBalance("Cash");
        const newOnline = await getAvailableBalance("Online");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/accounts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("settings.balances_updated", { cash: newCash, online: newOnline });
        return res.status(201).json({
          success: true,
          message: `${pMethod} ${isDeposit ? "deposited" : "withdrawn"} successfully!`,
          data: {
            payment: result2.rows[0],
            liveCash: newCash,
            liveOnline: newOnline
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/drawer-transactions", requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const result2 = await db.query(`
      SELECT p.*, u.name as performed_by_name
      FROM payments p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.account_type IN ('Drawer Deposit', 'Drawer Withdrawal')
      ORDER BY p.date DESC, p.created_at DESC
      LIMIT 20
    `);
        return res.json({
          success: true,
          data: result2.rows.map((r) => ({
            id: r.id,
            type: r.account_type,
            direction: r.direction,
            amount: parseFloat(r.amount || 0),
            paymentMethod: r.payment_method,
            notes: r.notes,
            date: r.date,
            performedBy: r.created_by_name || r.performed_by_name || "Admin",
            createdAt: r.created_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/", requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { type, partyType, partyId, status } = req.query;
        let queryText = "SELECT * FROM accounts WHERE 1=1";
        const params = [];
        if (type) {
          params.push(type);
          queryText += ` AND type = $${params.length}`;
        }
        if (partyType) {
          params.push(partyType);
          queryText += ` AND party_type = $${params.length}`;
        }
        if (partyId) {
          params.push(partyId);
          queryText += ` AND party_id = $${params.length}`;
        }
        if (status) {
          params.push(status);
          queryText += ` AND status = $${params.length}`;
        }
        queryText += " ORDER BY date DESC, created_at DESC";
        const result2 = await db.query(queryText, params);
        return res.json({
          success: true,
          data: result2.rows.map((acc) => ({
            id: acc.id,
            type: acc.type,
            partyType: acc.party_type,
            partyId: acc.party_id,
            partyName: acc.party_name,
            invoiceId: acc.invoice_id,
            invoiceNo: acc.invoice_no,
            amount: parseFloat(acc.amount || 0),
            remaining: parseFloat(acc.remaining || 0),
            status: acc.status,
            date: acc.date,
            createdAt: acc.created_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/payment", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { amount: reqAmount, paymentMethod, referenceId, notes, date } = req.body;
        const payAmount = parseFloat(reqAmount || 0);
        if (isNaN(payAmount) || payAmount <= 0) {
          return res.status(400).json({
            success: false,
            code: "INVALID_AMOUNT",
            message: "Payment amount must be greater than zero."
          });
        }
        const pMethod = paymentMethod || "Cash";
        const result2 = await db.withTransaction(async (client) => {
          const accRes = await client.query("SELECT * FROM accounts WHERE id = $1 FOR UPDATE", [id]);
          if (accRes.rows.length === 0) {
            const error = new Error("Account not found.");
            error.status = 404;
            throw error;
          }
          const account = accRes.rows[0];
          if (account.status !== "Open") {
            const error = new Error("This account is already settled or cancelled.");
            error.status = 400;
            throw error;
          }
          const accRemaining = parseFloat(account.remaining || 0);
          if (payAmount > accRemaining + 5e-3) {
            const error = new Error(`Payment cannot exceed remaining balance of PKR ${accRemaining.toFixed(2)}.`);
            error.status = 400;
            throw error;
          }
          if (account.type.includes("Payable")) {
            await validateOutflow(pMethod, payAmount, `${account.type} Settlement`, client);
          }
          const newRemaining = Math.max(0, accRemaining - payAmount);
          const newStatus = newRemaining <= 5e-3 ? "Settled" : "Open";
          await client.query(
            `UPDATE accounts SET remaining = $1, status = $2 WHERE id = $3`,
            [newRemaining, newStatus, id]
          );
          if (account.invoice_id) {
            const invRes = await client.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [account.invoice_id]);
            if (invRes.rows.length > 0) {
              const inv = invRes.rows[0];
              const newPaid = parseFloat(inv.paid || 0) + payAmount;
              const newBal = Math.max(0, parseFloat(inv.total || 0) - newPaid - parseFloat(inv.credit_adjusted || 0));
              const newPayStatus = newBal <= 5e-3 ? "Paid" : "Partial";
              await client.query(
                `UPDATE invoices SET paid = $1, balance = $2, payment_status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
                [newPaid, newBal, newPayStatus, inv.id]
              );
            }
            const repairRes = await client.query("SELECT * FROM repair_jobs WHERE invoice_id = $1 OR tracking_id = $2 FOR UPDATE", [account.invoice_id, account.invoice_no]);
            if (repairRes.rows.length > 0) {
              const job = repairRes.rows[0];
              const jobNewPaid = Math.min(parseFloat(job.total || 0), parseFloat(job.paid || 0) + payAmount);
              await client.query(
                `UPDATE repair_jobs SET paid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [jobNewPaid, job.id]
              );
              const creator2 = getCreator(req.user);
              await client.query(
                `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
             VALUES ($1, $2, $3, $4, $5)`,
                [
                  job.id,
                  job.status,
                  `Payment received: PKR ${payAmount.toLocaleString("en-PK", { maximumFractionDigits: 2 })} via ${pMethod}. Remaining: PKR ${newRemaining.toLocaleString("en-PK", { maximumFractionDigits: 2 })}.`,
                  creator2.id,
                  creator2.name
                ]
              );
            }
            const vrRes = await client.query("SELECT * FROM vendor_returns WHERE id = $1 FOR UPDATE", [account.invoice_id]);
            if (vrRes.rows.length > 0) {
              const vr = vrRes.rows[0];
              const vrPaid = parseFloat(vr.actual_money_received || 0) + payAmount;
              const vrBal = Math.max(0, parseFloat(vr.amount || 0) - vrPaid - parseFloat(vr.exchange_value || 0) - parseFloat(vr.payable_adjustment || 0));
              const vrStatus = vrBal <= 5e-3 ? "Paid" : "Partial";
              await client.query(
                `UPDATE vendor_returns SET actual_money_received = $1, balance = $2, status = $3 WHERE id = $4`,
                [vrPaid, vrBal, vrStatus, vr.id]
              );
            }
          }
          const creator = getCreator(req.user);
          const payId = await getNextEntityId("payments", "id", "PAY", 5, client);
          const direction = account.type.includes("Receivable") ? "Received" : "Paid";
          const payRes = await client.query(
            `INSERT INTO payments (
          id, account_id, invoice_id, invoice_no, party_type, party_id, party_name,
          account_type, direction, amount, date, payment_method, reference_id, notes,
          affects_money, is_initial_settlement, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          TRUE, FALSE, $15, $16
        ) RETURNING *`,
            [
              payId,
              id,
              account.invoice_id,
              account.invoice_no,
              account.party_type,
              account.party_id,
              account.party_name,
              account.type,
              direction,
              payAmount,
              date || /* @__PURE__ */ new Date(),
              pMethod,
              referenceId ? referenceId.trim() : null,
              notes ? notes.trim() : null,
              creator.id,
              creator.name
            ]
          );
          return {
            payment: payRes.rows[0],
            remaining: newRemaining,
            status: newStatus
          };
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/accounts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/customers*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/vendors*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("payment.recorded", result2);
        return res.status(201).json({
          success: true,
          message: "Payment recorded successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/ledger/ledger.routes.js
var require_ledger_routes = __commonJS({
  "src/modules/ledger/ledger.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireSalesOrAdmin } = require_rbac();
    var { CacheService, cacheRoute } = require_cache();
    router.use(authenticateToken);
    router.get("/party/:partyType/:partyId", requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { partyType, partyId } = req.params;
        const isVendor = partyType.toLowerCase() === "vendor";
        const partyTable = isVendor ? "vendors" : "customers";
        const partyRes = await db.query(`SELECT * FROM ${partyTable} WHERE id = $1`, [partyId]);
        if (partyRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Party profile not found."
          });
        }
        const party = partyRes.rows[0];
        const invoicesRes = await db.query(
          `SELECT * FROM invoices WHERE party_id = $1 ORDER BY date ASC, created_at ASC`,
          [partyId]
        );
        const paymentsRes = await db.query(
          `SELECT * FROM payments WHERE party_id = $1 ORDER BY date ASC, created_at ASC`,
          [partyId]
        );
        let returnsRes = { rows: [] };
        if (isVendor) {
          returnsRes = await db.query(
            `SELECT * FROM vendor_returns WHERE vendor_id = $1 ORDER BY date ASC, created_at ASC`,
            [partyId]
          );
        }
        const accountsRes = await db.query(
          `SELECT * FROM accounts WHERE party_id = $1`,
          [partyId]
        );
        const groupedBills = [];
        for (const inv of invoicesRes.rows) {
          const laterPayments = paymentsRes.rows.filter((p) => p.invoice_id === inv.id && !p.is_initial_settlement);
          const total = parseFloat(inv.total || 0);
          const paid = parseFloat(inv.paid || 0);
          const balance = parseFloat(inv.balance || 0);
          const initialPaid = parseFloat(inv.initial_paid || 0);
          const creditAdjusted = parseFloat(inv.credit_adjusted || 0);
          const account = accountsRes.rows.find((a) => a.invoice_id === inv.id && a.status !== "Cancelled");
          groupedBills.push({
            kind: "invoice",
            id: inv.id,
            invoiceNo: inv.invoice_no,
            type: inv.type,
            exchangeCase: inv.exchange_case,
            date: inv.date,
            total,
            initialPaid,
            paidToDate: paid,
            creditAdjusted,
            remaining: balance,
            status: balance <= 5e-3 ? "settled" : paid > 0 ? "partial" : "unpaid",
            paymentMethod: inv.payment_method,
            referenceId: inv.reference_id,
            accountId: account?.id || null,
            accountStatus: account?.status || "Settled",
            installments: [
              ...initialPaid > 0 ? [{
                type: "Initial Payment",
                date: inv.date,
                method: inv.payment_method,
                reference: inv.reference_id,
                amount: initialPaid
              }] : [],
              ...laterPayments.map((p, idx) => ({
                type: `Installment #${idx + 1}`,
                date: p.date,
                method: p.payment_method,
                reference: p.reference_id,
                notes: p.notes,
                amount: parseFloat(p.amount)
              }))
            ]
          });
        }
        if (isVendor) {
          for (const ret of returnsRes.rows) {
            const retPayments = paymentsRes.rows.filter((p) => p.invoice_id === ret.id || p.invoice_no === ret.id);
            const total = parseFloat(ret.amount || 0);
            const initial = parseFloat(ret.initial_settlement || 0);
            const actualMoney = parseFloat(ret.actual_money_received || 0);
            const exchangeVal = parseFloat(ret.exchange_value || 0);
            const payableAdj = parseFloat(ret.payable_adjustment || 0);
            const balance = parseFloat(ret.balance || 0);
            const account = accountsRes.rows.find((a) => (a.invoice_id === ret.id || a.invoice_no === ret.id) && a.type === "Vendor Receivable");
            groupedBills.push({
              kind: "return",
              id: ret.id,
              invoiceNo: ret.id,
              type: "Vendor Return Credit",
              date: ret.date,
              productCode: ret.product_code,
              returnedProductName: ret.returned_product_name,
              total,
              initialPaid: initial,
              actualMoneyReceived: actualMoney,
              exchangeValue: exchangeVal,
              payableAdjustment: payableAdj,
              remaining: balance,
              status: balance <= 5e-3 ? "settled" : actualMoney > 0 || exchangeVal > 0 || payableAdj > 0 ? "partial" : "unpaid",
              settlementMethod: ret.settlement_method,
              referenceId: ret.reference_id,
              reason: ret.reason,
              accountId: account?.id || null,
              accountStatus: account?.status || "Settled",
              installments: retPayments.map((p, idx) => ({
                type: p.is_initial_settlement ? "Initial Settlement" : `Receipt #${idx + 1}`,
                date: p.date,
                method: p.payment_method,
                reference: p.reference_id,
                notes: p.notes,
                amount: parseFloat(p.amount)
              }))
            });
          }
        }
        groupedBills.sort((a, b) => new Date(b.date) - new Date(a.date));
        const rawEntries = [];
        invoicesRes.rows.forEach((inv) => {
          const total = parseFloat(inv.total || 0);
          const base = {
            id: inv.id,
            date: inv.date,
            createdAt: inv.created_at,
            reference: inv.invoice_no,
            invoiceId: inv.id,
            entryType: "invoice",
            billAmount: total,
            paymentMethod: inv.payment_method
          };
          if (isVendor) {
            rawEntries.push({
              ...base,
              order: 1,
              description: `Vendor Purchase (${inv.invoice_no})`,
              paid: 0,
              received: 0,
              effect: total,
              balanceNature: "Vendor Payable"
            });
          } else if (["Sales Invoice", "Service Invoice", "Repair Invoice", "Diagnosis Invoice"].includes(inv.type) || inv.type === "Exchange Invoice" && inv.exchange_case === "Customer Pays Shop") {
            rawEntries.push({
              ...base,
              order: 1,
              description: `${inv.type} (${inv.invoice_no})`,
              paid: 0,
              received: 0,
              effect: total,
              balanceNature: "Customer Receivable"
            });
          } else if (inv.type === "Customer Purchase" || inv.type === "Exchange Invoice" && inv.exchange_case === "Shop Pays Customer") {
            rawEntries.push({
              ...base,
              order: 1,
              description: `${inv.type} (${inv.invoice_no})`,
              paid: 0,
              received: 0,
              effect: -total,
              balanceNature: "Customer Payable"
            });
          } else if (inv.type === "Exchange Invoice") {
            rawEntries.push({
              ...base,
              order: 1,
              description: `Even Exchange (${inv.invoice_no})`,
              billAmount: 0,
              paid: 0,
              received: 0,
              effect: 0,
              balanceNature: "Settled"
            });
          }
        });
        if (isVendor) {
          returnsRes.rows.forEach((r) => {
            const retAmount = parseFloat(r.amount || 0);
            rawEntries.push({
              id: r.id,
              date: r.date,
              createdAt: r.created_at,
              order: 2,
              reference: r.id,
              invoiceId: r.id,
              entryType: "return",
              description: `Vendor Return / Refund Credit (${r.id})`,
              billAmount: retAmount,
              paid: 0,
              received: 0,
              effect: -retAmount,
              balanceNature: "Vendor Receivable"
            });
          });
        }
        paymentsRes.rows.forEach((p) => {
          const amt = parseFloat(p.amount || 0);
          let effect = 0;
          const isInitial = p.is_initial_settlement;
          const prefix = isInitial ? "Initial Settlement" : "Payment";
          if (isVendor) {
            if (p.account_type === "Vendor Payable") {
              effect = p.direction === "Paid" ? -amt : amt;
            } else if (p.account_type === "Vendor Receivable") {
              effect = p.direction === "Received" ? amt : -amt;
            } else {
              effect = p.direction === "Paid" ? -amt : amt;
            }
          } else {
            if (p.account_type === "Customer Receivable") {
              effect = p.direction === "Received" || p.direction === "Adjusted" ? -amt : amt;
            } else if (p.account_type === "Customer Payable") {
              effect = p.direction === "Paid" ? amt : -amt;
            } else {
              effect = p.direction === "Received" || p.direction === "Adjusted" ? -amt : amt;
            }
          }
          rawEntries.push({
            id: p.id,
            date: p.date,
            createdAt: p.created_at,
            order: 3,
            reference: p.invoice_no || p.id,
            paymentId: p.id,
            invoiceId: p.invoice_id,
            entryType: "payment",
            description: `${prefix} ${p.direction === "Paid" ? "Made" : "Received"} \u2014 ${p.payment_method}${p.reference_id ? " \xB7 Ref: " + p.reference_id : ""}${p.notes ? " \xB7 " + p.notes : ""}`,
            paid: p.direction === "Paid" ? amt : 0,
            received: p.direction === "Received" || p.direction === "Adjusted" ? amt : 0,
            effect,
            balanceNature: p.account_type
          });
        });
        rawEntries.sort((a, b) => {
          const dDiff = new Date(a.date) - new Date(b.date);
          if (dDiff !== 0) return dDiff;
          const oDiff = (a.order || 0) - (b.order || 0);
          if (oDiff !== 0) return oDiff;
          const cDiff = new Date(a.createdAt) - new Date(b.createdAt);
          if (cDiff !== 0) return cDiff;
          return String(a.id || "").localeCompare(String(b.id || ""));
        });
        let running = 0;
        const transactionLog = rawEntries.map((e) => {
          running += e.effect;
          return {
            ...e,
            running: Math.round(running * 100) / 100
          };
        });
        const openReceivables = accountsRes.rows.filter((a) => a.status === "Open" && a.type.includes("Receivable")).reduce((s, a) => s + parseFloat(a.remaining), 0);
        const openPayables = accountsRes.rows.filter((a) => a.status === "Open" && a.type.includes("Payable")).reduce((s, a) => s + parseFloat(a.remaining), 0);
        const netBalance = isVendor ? openPayables - openReceivables : openReceivables - openPayables;
        const totalPurchases = isVendor ? invoicesRes.rows.reduce((s, i) => s + parseFloat(i.total || 0), 0) : 0;
        const totalSales = !isVendor ? invoicesRes.rows.reduce((s, i) => s + parseFloat(i.total || 0), 0) : 0;
        const paymentsMade = paymentsRes.rows.filter((p) => p.direction === "Paid").reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        const receivedFromParty = paymentsRes.rows.filter((p) => p.direction === "Received" || p.direction === "Adjusted").reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        const totalReturns = isVendor ? returnsRes.rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0) : 0;
        const totalCustomerCredits = !isVendor ? invoicesRes.rows.filter((i) => i.type === "Customer Purchase" || i.type === "Exchange Invoice" && i.exchange_case === "Shop Pays Customer").reduce((s, i) => s + parseFloat(i.total || 0), 0) : 0;
        return res.json({
          success: true,
          data: {
            party: {
              id: party.id,
              name: party.name,
              contact: party.contact,
              notes: party.notes,
              type: isVendor ? "vendor" : "customer"
            },
            summary: {
              totalPurchases,
              totalSales,
              paymentsMade,
              receivedFromParty,
              totalReturns,
              totalCustomerCredits,
              openReceivable: openReceivables,
              openPayable: openPayables,
              netBalance,
              netBalanceLabel: Math.abs(netBalance) < 5e-3 ? "Settled" : isVendor ? netBalance > 0 ? `Payable PKR ${netBalance.toFixed(2)}` : `Receivable PKR ${Math.abs(netBalance).toFixed(2)}` : netBalance > 0 ? `Receivable PKR ${netBalance.toFixed(2)}` : `Payable PKR ${Math.abs(netBalance).toFixed(2)}`
            },
            groupedBills,
            transactionLog: transactionLog.reverse()
          }
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/expenses/expenses.routes.js
var require_expenses_routes = __commonJS({
  "src/modules/expenses/expenses.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { getNextEntityId } = require_codeGenerator();
    var { validateOutflow } = require_financialFormulas();
    var { emitEvent } = require_socket();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.use(authenticateToken);
    router.get("/", cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to, categoryId, categoryName, paymentMethod, staffId } = req.query;
        let queryText = `
      SELECT e.*, ec.name as category_name_rel
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE 1=1
    `;
        const params = [];
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin" || req.user.isSuperAdmin;
        if (!isAdmin) {
          params.push(req.user.id);
          queryText += ` AND e.created_by = $${params.length}`;
        } else if (staffId) {
          params.push(staffId);
          queryText += ` AND e.created_by = $${params.length}`;
        }
        if (from) {
          params.push(from);
          queryText += ` AND e.date >= $${params.length}`;
        }
        if (to) {
          params.push(to);
          queryText += ` AND e.date <= $${params.length}`;
        }
        if (categoryId) {
          params.push(categoryId);
          queryText += ` AND e.category_id = $${params.length}`;
        } else if (categoryName) {
          params.push(categoryName);
          queryText += ` AND e.category_name = $${params.length}`;
        }
        if (paymentMethod) {
          params.push(paymentMethod);
          queryText += ` AND e.payment_method = $${params.length}`;
        }
        queryText += " ORDER BY e.date DESC, e.created_at DESC";
        const result2 = await db.query(queryText, params);
        return res.json({
          success: true,
          data: result2.rows.map((exp) => ({
            id: exp.id,
            date: exp.date,
            categoryId: exp.category_id,
            category: exp.category_name,
            description: exp.description,
            amount: parseFloat(exp.amount || 0),
            paymentMethod: exp.payment_method,
            referenceId: exp.reference_id,
            linkedTrackingId: exp.linked_tracking_id,
            createdById: exp.created_by,
            createdByName: exp.created_by_name,
            createdAt: exp.created_at,
            updatedAt: exp.updated_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/", async (req, res, next) => {
      try {
        const { category, categoryId: reqCatId, description, amount: reqAmount, paymentMethod, referenceId, linkedTrackingId, date } = req.body;
        const amount = parseFloat(reqAmount || 0);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({
            success: false,
            code: "INVALID_AMOUNT",
            message: "Expense amount must be greater than zero."
          });
        }
        if (!description || String(description).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_DESCRIPTION",
            message: "Expense description is required."
          });
        }
        const pMethod = paymentMethod || "Cash";
        await validateOutflow(pMethod, amount, "Operating Expense");
        let categoryId = reqCatId;
        let categoryName = category;
        if (!categoryId && categoryName) {
          const catRes = await db.query("SELECT id, name FROM expense_categories WHERE LOWER(name) = LOWER($1)", [categoryName.trim()]);
          if (catRes.rows.length > 0) {
            categoryId = catRes.rows[0].id;
            categoryName = catRes.rows[0].name;
          }
        } else if (categoryId && !categoryName) {
          const catRes = await db.query("SELECT name FROM expense_categories WHERE id = $1", [categoryId]);
          if (catRes.rows.length > 0) {
            categoryName = catRes.rows[0].name;
          }
        }
        const expId = await getNextEntityId("expenses", "id", "EXP", 5);
        const creatorId = req.user.role === "super_admin" || req.user.isSuperAdmin ? null : req.user.id;
        const creatorName = req.user.name || (req.user.role === "super_admin" ? "Platform Super Admin" : req.user.username || "Staff");
        const insertRes = await db.query(
          `INSERT INTO expenses (
        id, date, category_id, category_name, description, amount, payment_method,
        reference_id, linked_tracking_id, created_by, created_by_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
          [
            expId,
            date || /* @__PURE__ */ new Date(),
            categoryId || null,
            categoryName || "Other",
            description.trim(),
            amount,
            pMethod,
            referenceId ? referenceId.trim() : null,
            linkedTrackingId ? linkedTrackingId.trim() : null,
            creatorId,
            creatorName
          ]
        );
        const bid = getBranchIdFromReq(req);
        await CacheService.invalidateBranchPattern(bid, "/api/expenses*");
        await CacheService.invalidateBranchPattern(bid, "/api/reports*");
        emitEvent("expense.created", insertRes.rows[0]);
        return res.status(201).json({
          success: true,
          message: "Expense recorded successfully",
          data: insertRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id", async (req, res, next) => {
      try {
        const { id } = req.params;
        const { category, categoryId: reqCatId, description, amount: reqAmount, paymentMethod, referenceId, linkedTrackingId, date } = req.body;
        const existingRes = await db.query("SELECT * FROM expenses WHERE id = $1", [id]);
        if (existingRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Expense not found."
          });
        }
        const existing = existingRes.rows[0];
        if (req.user.role !== "admin" && req.user.role !== "super_admin" && existing.created_by !== req.user.id) {
          return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: "You can only edit your own expense entries."
          });
        }
        const amount = parseFloat(reqAmount || existing.amount);
        const pMethod = paymentMethod || existing.payment_method;
        let categoryId = reqCatId || existing.category_id;
        let categoryName = category || existing.category_name;
        const updateRes = await db.query(
          `UPDATE expenses SET
        date = COALESCE($1, date),
        category_id = $2,
        category_name = $3,
        description = COALESCE($4, description),
        amount = $5,
        payment_method = $6,
        reference_id = $7,
        linked_tracking_id = $8,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
          [
            date || null,
            categoryId,
            categoryName,
            description ? description.trim() : null,
            amount,
            pMethod,
            referenceId !== void 0 ? referenceId ? referenceId.trim() : null : existing.reference_id,
            linkedTrackingId !== void 0 ? linkedTrackingId ? linkedTrackingId.trim() : null : existing.linked_tracking_id,
            id
          ]
        );
        const bid = getBranchIdFromReq(req);
        await CacheService.invalidateBranchPattern(bid, "/api/expenses*");
        await CacheService.invalidateBranchPattern(bid, "/api/reports*");
        emitEvent("expense.updated", updateRes.rows[0]);
        return res.json({
          success: true,
          message: "Expense updated successfully",
          data: updateRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id", async (req, res, next) => {
      try {
        const { id } = req.params;
        const existingRes = await db.query("SELECT * FROM expenses WHERE id = $1", [id]);
        if (existingRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Expense not found."
          });
        }
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin" || req.user.isSuperAdmin;
        if (!isAdmin && existingRes.rows[0].created_by !== req.user.id) {
          return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: "You can only delete your own expense entries."
          });
        }
        await db.query("DELETE FROM expenses WHERE id = $1", [id]);
        const bid = getBranchIdFromReq(req);
        await CacheService.invalidateBranchPattern(bid, "/api/expenses*");
        await CacheService.invalidateBranchPattern(bid, "/api/reports*");
        emitEvent("expense.deleted", { id });
        return res.json({
          success: true,
          message: "Expense deleted successfully"
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/repair-services/repair-services.routes.js
var require_repair_services_routes = __commonJS({
  "src/modules/repair-services/repair-services.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireAdmin } = require_rbac();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    router.use(authenticateToken);
    router.get("/", async (req, res, next) => {
      try {
        const { status, type } = req.query;
        let queryText = "SELECT * FROM repair_services WHERE 1=1";
        const params = [];
        if (status) {
          params.push(status);
          queryText += ` AND status = $${params.length}`;
        } else if (req.user.role !== "admin" && req.user.role !== "super_admin" && !req.user.isSuperAdmin) {
          queryText += " AND status = 'Active'";
        }
        if (type) {
          params.push(type.toLowerCase());
          queryText += ` AND LOWER(COALESCE(service_type, 'repair')) = $${params.length}`;
        }
        queryText += " ORDER BY id ASC";
        const result2 = await db.query(queryText, params);
        return res.json({
          success: true,
          data: result2.rows.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            charges: parseFloat(s.charges || 0),
            duration: s.duration,
            conditions: s.conditions,
            status: s.status,
            serviceType: s.service_type || "repair",
            createdAt: s.created_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/", async (req, res, next) => {
      try {
        const { name, charges, duration, conditions, status, serviceType } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Service name is required."
          });
        }
        const srvId = await getNextEntityId("repair_services", "id", "SRV", 4);
        const cost = parseFloat(charges || 0);
        const sType = serviceType && String(serviceType).toLowerCase() === "diagnosis" ? "diagnosis" : "repair";
        const insertRes = await db.query(
          `INSERT INTO repair_services (id, code, name, charges, duration, conditions, status, service_type)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
          [
            srvId,
            name.trim(),
            cost,
            duration ? duration.trim() : null,
            conditions ? conditions.trim() : null,
            status || "Active",
            sType
          ]
        );
        emitEvent("repair_services.created", insertRes.rows[0]);
        return res.status(201).json({
          success: true,
          message: "Repair service added successfully",
          data: {
            ...insertRes.rows[0],
            charges: parseFloat(insertRes.rows[0].charges || 0),
            serviceType: insertRes.rows[0].service_type || "repair"
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { name, charges, duration, conditions, status, serviceType } = req.body;
        if (!name || String(name).trim() === "") {
          return res.status(400).json({
            success: false,
            code: "MISSING_NAME",
            message: "Service name is required."
          });
        }
        const sType = serviceType ? String(serviceType).toLowerCase() === "diagnosis" ? "diagnosis" : "repair" : null;
        const updateRes = await db.query(
          `UPDATE repair_services SET
        name = $1,
        charges = $2,
        duration = $3,
        conditions = $4,
        status = COALESCE($5, status),
        service_type = COALESCE($6, service_type)
       WHERE id = $7
       RETURNING *`,
          [
            name.trim(),
            parseFloat(charges || 0),
            duration ? duration.trim() : null,
            conditions ? conditions.trim() : null,
            status || "Active",
            sType,
            id
          ]
        );
        if (updateRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Repair service not found."
          });
        }
        emitEvent("repair_services.updated", updateRes.rows[0]);
        return res.json({
          success: true,
          message: "Repair service updated successfully",
          data: {
            ...updateRes.rows[0],
            charges: parseFloat(updateRes.rows[0].charges || 0),
            serviceType: updateRes.rows[0].service_type || "repair"
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.patch("/:id/toggle", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const srvRes = await db.query("SELECT status FROM repair_services WHERE id = $1", [id]);
        if (srvRes.rows.length === 0) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Repair service not found."
          });
        }
        const currentStatus = srvRes.rows[0].status;
        const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
        const updateRes = await db.query(
          "UPDATE repair_services SET status = $1 WHERE id = $2 RETURNING *",
          [newStatus, id]
        );
        emitEvent("repair_services.status_changed", updateRes.rows[0]);
        return res.json({
          success: true,
          message: `Repair service marked ${newStatus.toLowerCase()}`,
          data: updateRes.rows[0]
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id", requireAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const inUse = await db.query("SELECT id FROM repair_job_lines WHERE service_id = $1 LIMIT 1", [id]);
        if (inUse.rows.length > 0) {
          return res.status(400).json({
            success: false,
            code: "SERVICE_IN_USE",
            message: "This repair service is used in historical repair jobs and cannot be deleted. Deactivate it instead."
          });
        }
        await db.query("DELETE FROM repair_services WHERE id = $1", [id]);
        emitEvent("repair_services.deleted", { id });
        return res.json({
          success: true,
          message: "Repair service deleted successfully"
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/repair-parts/repair-parts.routes.js
var require_repair_parts_routes = __commonJS({
  "src/modules/repair-parts/repair-parts.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var { getNextEntityId } = require_codeGenerator();
    var { emitEvent } = require_socket();
    var authenticateToken = require_auth();
    var { requireAdmin } = require_rbac();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.use(authenticateToken);
    router.get("/", cacheRoute(60), async (req, res, next) => {
      try {
        const { search, category, status, inStockOnly, lowStockOnly } = req.query;
        let queryText = "SELECT * FROM repair_parts WHERE 1=1";
        const params = [];
        if (category && String(category).trim() !== "") {
          params.push(category.trim());
          queryText += ` AND LOWER(category) = LOWER($${params.length})`;
        }
        if (status && String(status).trim() !== "") {
          params.push(status.trim());
          queryText += ` AND status = $${params.length}`;
        }
        if (inStockOnly === "true" || inStockOnly === true) {
          queryText += " AND current_stock > 0";
        }
        if (lowStockOnly === "true" || lowStockOnly === true) {
          queryText += " AND current_stock <= min_stock_alert";
        }
        if (search && String(search).trim() !== "") {
          params.push(`%${search.trim().toLowerCase()}%`);
          queryText += ` AND (
        LOWER(code) LIKE $${params.length} OR
        LOWER(name) LIKE $${params.length} OR
        LOWER(category) LIKE $${params.length} OR
        LOWER(COALESCE(compatible_models, '')) LIKE $${params.length}
      )`;
        }
        queryText += " ORDER BY category ASC, name ASC";
        const result2 = await db.query(queryText, params);
        const isTech = req.user && req.user.role === "technician";
        return res.json({
          success: true,
          data: result2.rows.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            category: p.category,
            compatibleModels: p.compatible_models,
            costPrice: isTech ? 0 : parseFloat(p.cost_price || 0),
            sellingPrice: parseFloat(p.selling_price || 0),
            currentStock: parseInt(p.current_stock || 0, 10),
            minStockAlert: parseInt(p.min_stock_alert || 2, 10),
            status: p.status,
            createdAt: p.created_at,
            updatedAt: p.updated_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/categories", cacheRoute(300), async (req, res, next) => {
      try {
        const result2 = await db.query(
          `SELECT name FROM spare_part_categories ORDER BY id ASC`
        );
        const catList = result2.rows.map((r) => r.name.trim());
        return res.json({
          success: true,
          data: catList
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id", cacheRoute(60), async (req, res, next) => {
      try {
        const result2 = await db.query("SELECT * FROM repair_parts WHERE id = $1", [req.params.id]);
        if (result2.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Repair spare part not found." });
        }
        const p = result2.rows[0];
        const isTech = req.user && req.user.role === "technician";
        return res.json({
          success: true,
          data: {
            id: p.id,
            code: p.code,
            name: p.name,
            category: p.category,
            compatibleModels: p.compatible_models,
            costPrice: isTech ? 0 : parseFloat(p.cost_price || 0),
            sellingPrice: parseFloat(p.selling_price || 0),
            currentStock: parseInt(p.current_stock || 0, 10),
            minStockAlert: parseInt(p.min_stock_alert || 2, 10),
            status: p.status,
            createdAt: p.created_at,
            updatedAt: p.updated_at
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/", async (req, res, next) => {
      try {
        const { code, name, category, compatibleModels, costPrice, sellingPrice, currentStock, minStockAlert, status } = req.body;
        if (!name || !String(name).trim()) {
          return res.status(400).json({ success: false, message: "Spare part name is required." });
        }
        const cleanName = name.trim();
        const cleanCategory = category ? category.trim() : "General";
        const cleanModels = compatibleModels ? compatibleModels.trim() : null;
        const numCost = costPrice !== void 0 && costPrice !== null && costPrice !== "" ? parseFloat(costPrice) : 0;
        const numSelling = sellingPrice !== void 0 && sellingPrice !== null && sellingPrice !== "" ? parseFloat(sellingPrice) : 0;
        const numStock = currentStock !== void 0 && currentStock !== null && currentStock !== "" ? parseInt(currentStock, 10) : 0;
        const numAlert = minStockAlert !== void 0 && minStockAlert !== null && minStockAlert !== "" ? parseInt(minStockAlert, 10) : 2;
        const partStatus = status || "Active";
        if (isNaN(numCost) || numCost < 0) {
          return res.status(400).json({ success: false, message: "Cost price must be a valid non-negative number." });
        }
        if (isNaN(numSelling) || numSelling < 0) {
          return res.status(400).json({ success: false, message: "Selling price must be a valid non-negative number." });
        }
        if (isNaN(numStock) || numStock < 0) {
          return res.status(400).json({ success: false, message: "Initial stock must be a non-negative integer." });
        }
        let partCode = code ? code.trim() : "";
        if (!partCode) {
          const countRes = await db.query("SELECT COUNT(*) FROM repair_parts");
          const nextNum = parseInt(countRes.rows[0].count, 10) + 1;
          partCode = `PRT-${String(nextNum).padStart(4, "0")}`;
        }
        const dupRes = await db.query("SELECT id FROM repair_parts WHERE LOWER(code) = LOWER($1)", [partCode]);
        if (dupRes.rows.length > 0) {
          return res.status(400).json({ success: false, message: `Part code "${partCode}" already exists. Please choose a unique SKU code.` });
        }
        const partId = await getNextEntityId("repair_parts", "id", "PRT", 4);
        const insertRes = await db.query(
          `INSERT INTO repair_parts (
        id, code, name, category, compatible_models, cost_price, selling_price, current_stock, min_stock_alert, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
          [partId, partCode, cleanName, cleanCategory, cleanModels, numCost, numSelling, numStock, numAlert, partStatus]
        );
        const created = insertRes.rows[0];
        if (numStock > 0) {
          try {
            await db.query(
              `INSERT INTO repair_parts_movements (
            part_id, part_code, part_name, direction, quantity, reason, reference_type, balance_after, performed_by, performed_by_name
          ) VALUES ($1, $2, $3, 'IN', $4, 'Initial Catalog Stock Creation', 'Initial Setup', $4, $5, $6)`,
              [created.id, created.code, created.name, numStock, req.user?.id || null, req.user?.name || "Admin"]
            );
          } catch (logErr) {
            console.error("[Spare Parts Movement] Error logging initial stock:", logErr.message);
          }
        }
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        emitEvent("repairPart.created", created);
        return res.status(201).json({
          success: true,
          message: "Repair spare part created successfully.",
          data: {
            id: created.id,
            code: created.code,
            name: created.name,
            category: created.category,
            compatibleModels: created.compatible_models,
            costPrice: parseFloat(created.cost_price || 0),
            sellingPrice: parseFloat(created.selling_price || 0),
            currentStock: parseInt(created.current_stock || 0, 10),
            minStockAlert: parseInt(created.min_stock_alert || 2, 10),
            status: created.status,
            createdAt: created.created_at,
            updatedAt: created.updated_at
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id/history", cacheRoute(60), async (req, res, next) => {
      try {
        const partId = req.params.id;
        const partRes = await db.query("SELECT * FROM repair_parts WHERE id = $1", [partId]);
        if (partRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Repair spare part not found." });
        }
        const movementsRes = await db.query(
          `SELECT 
        m.id,
        m.created_at as date,
        m.direction,
        m.quantity,
        (CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END) as change_amount,
        m.reason,
        m.reference_type as ref_type,
        m.reference_id as ref_id,
        m.balance_after,
        m.performed_by_name as created_by_name
       FROM repair_parts_movements m
       WHERE m.part_id = $1
       ORDER BY m.created_at DESC`,
          [partId]
        );
        return res.json({
          success: true,
          data: movementsRes.rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id", async (req, res, next) => {
      try {
        const { code, name, category, compatibleModels, costPrice, sellingPrice, currentStock, minStockAlert, status } = req.body;
        const partId = req.params.id;
        const checkRes = await db.query("SELECT * FROM repair_parts WHERE id = $1", [partId]);
        if (checkRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Repair spare part not found." });
        }
        if (!name || !String(name).trim()) {
          return res.status(400).json({ success: false, message: "Spare part name is required." });
        }
        const cleanName = name.trim();
        const cleanCategory = category ? category.trim() : "General";
        const cleanModels = compatibleModels ? compatibleModels.trim() : null;
        const numCost = costPrice !== void 0 && costPrice !== null && costPrice !== "" ? parseFloat(costPrice) : parseFloat(checkRes.rows[0].cost_price || 0);
        const numSelling = sellingPrice !== void 0 && sellingPrice !== null && sellingPrice !== "" ? parseFloat(sellingPrice) : parseFloat(checkRes.rows[0].selling_price || 0);
        const numStock = currentStock !== void 0 && currentStock !== null && currentStock !== "" ? parseInt(currentStock, 10) : parseInt(checkRes.rows[0].current_stock || 0, 10);
        const numAlert = minStockAlert !== void 0 && minStockAlert !== null && minStockAlert !== "" ? parseInt(minStockAlert, 10) : parseInt(checkRes.rows[0].min_stock_alert || 2, 10);
        const partStatus = status || checkRes.rows[0].status;
        let partCode = code ? code.trim() : checkRes.rows[0].code;
        if (partCode && partCode.toLowerCase() !== checkRes.rows[0].code.toLowerCase()) {
          const dupRes = await db.query("SELECT id FROM repair_parts WHERE LOWER(code) = LOWER($1) AND id != $2", [partCode, partId]);
          if (dupRes.rows.length > 0) {
            return res.status(400).json({ success: false, message: `Part code "${partCode}" is already in use by another part.` });
          }
        }
        const updateRes = await db.query(
          `UPDATE repair_parts SET
        code = $1,
        name = $2,
        category = $3,
        compatible_models = $4,
        cost_price = $5,
        selling_price = $6,
        current_stock = $7,
        min_stock_alert = $8,
        status = $9,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
          [partCode, cleanName, cleanCategory, cleanModels, numCost, numSelling, numStock, numAlert, partStatus, partId]
        );
        const updated = updateRes.rows[0];
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("repairPart.updated", updated);
        return res.json({
          success: true,
          message: "Repair spare part updated successfully.",
          data: {
            id: updated.id,
            code: updated.code,
            name: updated.name,
            category: updated.category,
            compatibleModels: updated.compatible_models,
            costPrice: parseFloat(updated.cost_price || 0),
            sellingPrice: parseFloat(updated.selling_price || 0),
            currentStock: parseInt(updated.current_stock || 0, 10),
            minStockAlert: parseInt(updated.min_stock_alert || 2, 10),
            status: updated.status,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.patch("/:id/stock", async (req, res, next) => {
      try {
        const { quantity, direction, reason } = req.body;
        const partId = req.params.id;
        const qty = parseInt(quantity || 0, 10);
        if (isNaN(qty) || qty <= 0) {
          return res.status(400).json({ success: false, message: "Valid adjustment quantity greater than 0 is required." });
        }
        const partRes = await db.query("SELECT * FROM repair_parts WHERE id = $1", [partId]);
        if (partRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Repair spare part not found." });
        }
        const currentStock = parseInt(partRes.rows[0].current_stock || 0, 10);
        let newStock = currentStock;
        const dirUpper = (direction || "").toUpperCase();
        if (dirUpper === "IN" || dirUpper === "ADD") {
          newStock += qty;
        } else if (dirUpper === "OUT" || dirUpper === "DEDUCT") {
          if (qty > currentStock) {
            return res.status(400).json({ success: false, message: `Cannot deduct ${qty} units. Current stock is only ${currentStock}.` });
          }
          newStock -= qty;
        } else {
          return res.status(400).json({ success: false, message: "Direction must be IN or OUT." });
        }
        const updateRes = await db.query(
          `UPDATE repair_parts SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
          [newStock, partId]
        );
        const updated = updateRes.rows[0];
        try {
          await db.query(
            `INSERT INTO repair_parts_movements (
          part_id, part_code, part_name, direction, quantity, reason, reference_type, balance_after, performed_by, performed_by_name
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Stock Adjustment', $7, $8, $9)`,
            [
              updated.id,
              updated.code,
              updated.name,
              dirUpper,
              qty,
              reason || (dirUpper === "IN" ? "Stock Added / Restocked" : "Stock Deducted / Written off"),
              newStock,
              req.user?.id || null,
              req.user?.name || "Staff"
            ]
          );
        } catch (logErr) {
          console.error("[Spare Parts Movement] Error logging stock adjustment:", logErr.message);
        }
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("repairPart.updated", updated);
        return res.json({
          success: true,
          message: `Stock adjusted to ${newStock} units.`,
          data: updated
        });
      } catch (error) {
        next(error);
      }
    });
    router.patch("/:id/toggle", async (req, res, next) => {
      try {
        const partId = req.params.id;
        const partRes = await db.query("SELECT * FROM repair_parts WHERE id = $1", [partId]);
        if (partRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Repair spare part not found." });
        }
        const newStatus = partRes.rows[0].status === "Active" ? "Inactive" : "Active";
        const updateRes = await db.query(
          `UPDATE repair_parts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
          [newStatus, partId]
        );
        const updated = updateRes.rows[0];
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        emitEvent("repairPart.updated", updated);
        return res.json({
          success: true,
          message: `Spare part status set to ${newStatus}.`,
          data: updated
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/bulk-delete", requireAdmin, async (req, res, next) => {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ success: false, message: "Please select at least one spare part to delete." });
        }
        await db.query("UPDATE repair_parts_used SET part_id = NULL WHERE part_id = ANY($1::varchar[])", [ids]);
        await db.query("DELETE FROM repair_parts_movements WHERE part_id = ANY($1::varchar[])", [ids]);
        const delRes = await db.query("DELETE FROM repair_parts WHERE id = ANY($1::varchar[]) RETURNING id", [ids]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("repairPart.bulkDeleted", { ids });
        return res.json({
          success: true,
          message: `${delRes.rowCount || 0} spare parts deleted successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/all/wipe", requireAdmin, async (req, res, next) => {
      try {
        await db.query("UPDATE repair_parts_used SET part_id = NULL");
        await db.query("TRUNCATE TABLE repair_parts_movements CASCADE");
        const delRes = await db.query("DELETE FROM repair_parts RETURNING id");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("repairPart.allDeleted", {});
        return res.json({
          success: true,
          message: `All ${delRes.rowCount || 0} spare parts have been deleted from catalog.`
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id", async (req, res, next) => {
      try {
        const partId = req.params.id;
        const partRes = await db.query("SELECT * FROM repair_parts WHERE id = $1", [partId]);
        if (partRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Repair spare part not found." });
        }
        const partName = partRes.rows[0].name;
        await db.query("UPDATE repair_parts_used SET part_id = NULL WHERE part_id = $1", [partId]);
        await db.query("DELETE FROM repair_parts_movements WHERE part_id = $1", [partId]);
        await db.query("DELETE FROM repair_parts WHERE id = $1", [partId]);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repair-parts*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/reports*");
        emitEvent("repairPart.deleted", { id: partId });
        return res.json({
          success: true,
          message: `Spare part "${partName}" deleted successfully.`
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/repairs/repairs.routes.js
var require_repairs_routes = __commonJS({
  "src/modules/repairs/repairs.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var RepairService = require_repairs_service();
    var authenticateToken = require_auth();
    var { requireSalesOrAdmin, requireTechnicianOrAdmin } = require_rbac();
    var { CacheService, cacheRoute, getBranchIdFromReq } = require_cache();
    router.use(authenticateToken);
    router.get("/", cacheRoute(60), async (req, res, next) => {
      try {
        const { search, status, technicianId, customerId, jobType, categoryId, from, to } = req.query;
        let queryText = "SELECT * FROM repair_jobs WHERE 1=1";
        const params = [];
        if (req.user.role === "technician") {
          params.push(req.user.id);
          queryText += ` AND technician_id = $${params.length}`;
        } else if (technicianId) {
          params.push(technicianId);
          queryText += ` AND technician_id = $${params.length}`;
        }
        if (customerId) {
          params.push(customerId);
          queryText += ` AND customer_id = $${params.length}`;
        }
        if (jobType) {
          params.push(jobType);
          queryText += ` AND job_type = $${params.length}`;
        }
        if (categoryId) {
          params.push(categoryId);
          queryText += ` AND category_id = $${params.length}`;
        }
        if (status) {
          params.push(status);
          queryText += ` AND status = $${params.length}`;
        }
        if (from) {
          params.push(from);
          queryText += ` AND date >= $${params.length}`;
        }
        if (to) {
          params.push(to);
          queryText += ` AND date <= $${params.length}`;
        }
        if (search && String(search).trim() !== "") {
          params.push(`%${search.trim().toLowerCase()}%`);
          queryText += ` AND (
        LOWER(tracking_id) LIKE $${params.length} OR
        LOWER(customer_name) LIKE $${params.length} OR
        LOWER(contact) LIKE $${params.length} OR
        LOWER(COALESCE(category_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(brand, '')) LIKE $${params.length} OR
        LOWER(COALESCE(model, '')) LIKE $${params.length} OR
        LOWER(problem) LIKE $${params.length}
      )`;
        }
        queryText += " ORDER BY date DESC, created_at DESC";
        const result2 = await db.query(queryText, params);
        const isTech = req.user.role === "technician";
        return res.json({
          success: true,
          data: result2.rows.map((job) => ({
            id: job.id,
            trackingId: job.tracking_id,
            jobType: job.job_type,
            originJobType: job.origin_job_type,
            date: job.date,
            customerId: job.customer_id,
            customerName: job.customer_name,
            contact: job.contact,
            technicianId: job.technician_id,
            technicianName: job.technician_name || "Unassigned",
            priority: job.priority,
            categoryId: job.category_id,
            categoryName: job.category_name,
            productType: job.product_type,
            brand: job.brand,
            model: job.model,
            serial: job.serial,
            problem: job.problem,
            diagnosisFee: isTech ? null : parseFloat(job.diagnosis_fee || 0),
            extraCharges: isTech ? null : parseFloat(job.extra_charges || 0),
            total: isTech ? null : parseFloat(job.total || 0),
            paid: isTech ? null : parseFloat(job.paid || 0),
            remaining: isTech ? null : Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0)),
            paymentMethod: isTech ? null : job.payment_method,
            status: job.status,
            duration: job.duration,
            expectedCompletion: job.expected_completion,
            approvalStatus: job.approval_status,
            quotationAmount: isTech ? null : parseFloat(job.quotation_amount || 0),
            diagnosedIssue: job.diagnosed_issue,
            recommendedSolution: job.recommended_solution,
            technicalNotes: job.technical_notes,
            finalRemarks: job.final_remarks,
            workProgress: parseInt(job.work_progress || 0, 10),
            invoiceId: isTech ? null : job.invoice_id,
            createdAt: job.created_at
          }))
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id", cacheRoute(60), async (req, res, next) => {
      try {
        const jobDetails = await RepairService.getJobDetails(req.params.id, req.user.role);
        if (!jobDetails) {
          return res.status(404).json({
            success: false,
            code: "NOT_FOUND",
            message: "Repair job not found."
          });
        }
        if (req.user.role === "technician" && jobDetails.technicianId !== req.user.id) {
          return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: "You can only view repair jobs assigned to you."
          });
        }
        return res.json({
          success: true,
          data: jobDetails
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const result2 = await RepairService.createJob(req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/customers*");
        return res.status(201).json({
          success: true,
          message: "Repair job created successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id/technical-update", requireTechnicianOrAdmin, async (req, res, next) => {
      try {
        const result2 = await RepairService.technicalUpdate(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.json({
          success: true,
          message: "Technical update saved successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id/admin-update", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const { id } = req.params;
        const { status, technicianId, expectedCompletion, priority, finalRemarks, updateNote } = req.body;
        const result2 = await db.withTransaction(async (client) => {
          let techName = null;
          if (technicianId) {
            const tRes = await client.query("SELECT name FROM users WHERE id = $1", [technicianId]);
            if (tRes.rows.length > 0) techName = tRes.rows[0].name;
          }
          const updateRes = await client.query(
            `UPDATE repair_jobs SET
          status = COALESCE($1, status),
          technician_id = COALESCE($2, technician_id),
          technician_name = COALESCE($3, technician_name),
          expected_completion = COALESCE($4, expected_completion),
          priority = COALESCE($5, priority),
          final_remarks = COALESCE($6, final_remarks),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
            [status || null, technicianId || null, techName, expectedCompletion || null, priority || null, finalRemarks ? finalRemarks.trim() : null, id]
          );
          if (updateRes.rows.length === 0) {
            const error = new Error("Repair job not found.");
            error.status = 404;
            throw error;
          }
          if (updateNote) {
            await client.query(
              `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
           VALUES ($1, $2, $3, $4, $5)`,
              [id, updateRes.rows[0].status, updateNote.trim(), req.user.id, req.user.name]
            );
          }
          await RepairService.syncLinkedInvoice(id, client);
          await RepairService.sendAutomatedWhatsapp(updateRes.rows[0], finalRemarks || updateNote || "Job status updated", client);
          return updateRes.rows[0];
        });
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.json({
          success: true,
          message: "Repair job updated successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/approve", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const approvalSource = req.user?.role === "sales" ? "Sales" : "Admin";
        const result2 = await RepairService.approveQuote(req.params.id, req.user, approvalSource);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Quotation approved and repair started",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/decline", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const approvalSource = req.user?.role === "sales" ? "Sales" : "Admin";
        const result2 = await RepairService.declineQuote(req.params.id, req.user, approvalSource);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.json({
          success: true,
          message: "Quotation declined",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/collect-payment", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const result2 = await RepairService.collectPayment(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Payment collected successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/deliver", requireSalesOrAdmin, async (req, res, next) => {
      try {
        const result2 = await RepairService.payAndDeliver(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Product delivered and repair closed",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/parts", async (req, res, next) => {
      try {
        const result2 = await RepairService.addUsedPart(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.json({
          success: true,
          message: "Spare part issued successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.put("/:id/parts/:partUsedId", async (req, res, next) => {
      try {
        const result2 = await RepairService.updateUsedPart(req.params.id, req.params.partUsedId, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        return res.json({
          success: true,
          message: "Issued spare part updated successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id/parts/:partUsedId", async (req, res, next) => {
      try {
        const result2 = await RepairService.removeUsedPart(req.params.id, req.params.partUsedId, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/products*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.json({
          success: true,
          message: "Spare part removed and stock restored to inventory",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/services", async (req, res, next) => {
      try {
        const result2 = await RepairService.addServiceLine(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Additional service added successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.delete("/:id/services/:lineId", async (req, res, next) => {
      try {
        const result2 = await RepairService.removeServiceLine(req.params.id, req.params.lineId, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Service line removed from job",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/:id/additional-work", async (req, res, next) => {
      try {
        const list = await RepairService.getAdditionalWorkRequests(req.params.id);
        return res.json({
          success: true,
          data: list
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/additional-work", async (req, res, next) => {
      try {
        const request = await RepairService.createAdditionalWorkRequest(req.params.id, req.body, req.user);
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.status(201).json({
          success: true,
          message: "Additional fault work request created and sent to customer WhatsApp for approval",
          data: request
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/additional-work/:requestId/approve", async (req, res, next) => {
      try {
        const approvalSource = req.user?.role === "admin" ? "Admin" : req.user?.role === "sales" ? "Sales" : "Admin";
        const result2 = await RepairService.approveAdditionalWorkRequest(
          req.params.id,
          req.params.requestId,
          req.user,
          approvalSource,
          req.body?.customerResponse || `Approved manually by ${approvalSource} (${req.user?.name || "Staff"})`
        );
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/invoices*");
        return res.json({
          success: true,
          message: "Additional work request approved successfully",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/:id/additional-work/:requestId/decline", async (req, res, next) => {
      try {
        const approvalSource = req.user?.role === "admin" ? "Admin" : req.user?.role === "sales" ? "Sales" : "Admin";
        const result2 = await RepairService.declineAdditionalWorkRequest(
          req.params.id,
          req.params.requestId,
          req.user,
          approvalSource,
          req.body?.customerResponse || `Declined manually by ${approvalSource} (${req.user?.name || "Staff"})`
        );
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/repairs*");
        await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), "/api/dashboard*");
        return res.json({
          success: true,
          message: "Additional work request declined",
          data: result2
        });
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/modules/reports/reports.routes.js
var require_reports_routes = __commonJS({
  "src/modules/reports/reports.routes.js"(exports2, module2) {
    var express = require("express");
    var router = express.Router();
    var db = require_db();
    var authenticateToken = require_auth();
    var { requireAdmin } = require_rbac();
    var { CacheService, cacheRoute } = require_cache();
    var { getAvailableBalance } = require_financialFormulas();
    router.use(authenticateToken);
    function r2(v) {
      return Math.round((parseFloat(v) || 0) * 100) / 100;
    }
    var EPSILON = 5e-3;
    function applyDateFilter(queryText, params, from, to, dateCol = "date") {
      if (from) {
        params.push(from);
        queryText += ` AND ${dateCol} >= $${params.length}`;
      }
      if (to) {
        params.push(to);
        queryText += ` AND ${dateCol} <= $${params.length}`;
      }
      return queryText;
    }
    function toCSV(rows, headers) {
      if (!rows || rows.length === 0) return headers.map((h) => h.label).join(",") + "\n";
      const csvHeaders = headers.map((h) => `"${h.label}"`).join(",");
      const csvRows = rows.map(
        (row) => headers.map((h) => {
          const val = row[h.key] ?? "";
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(",")
      );
      return [csvHeaders, ...csvRows].join("\n");
    }
    router.get("/dashboard", cacheRoute(30), async (req, res, next) => {
      try {
        const role = req.user.role;
        const userId = req.user.id;
        if (role === "technician") {
          const assignedRes = await db.query(
            `SELECT 
          COUNT(CASE WHEN status IN ('Job Received', 'Diagnosis Received') THEN 1 END) as new_jobs,
          COUNT(CASE WHEN status IN ('Diagnosis in Progress', 'Diagnosis Completed', 'Waiting for Customer Approval') THEN 1 END) as checking_jobs,
          COUNT(CASE WHEN status IN ('Repair Approved', 'Work in Progress', 'Waiting for Parts') THEN 1 END) as active_jobs,
          COUNT(CASE WHEN status IN ('Work Completed', 'Ready for Delivery', 'Delivered & Closed') THEN 1 END) as completed_jobs
         FROM repair_jobs WHERE technician_id = $1`,
            [userId]
          );
          const dueRes = await db.query(
            `SELECT id, tracking_id, customer_name, status, expected_completion, priority, brand, model
         FROM repair_jobs 
         WHERE technician_id = $1 AND status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair')
           AND expected_completion <= CURRENT_DATE
         ORDER BY expected_completion ASC LIMIT 10`,
            [userId]
          );
          const recentJobsRes = await db.query(
            `SELECT id, tracking_id, customer_name, status, expected_completion, priority, brand, model, problem
         FROM repair_jobs 
         WHERE technician_id = $1 AND status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair')
         ORDER BY date DESC, created_at DESC LIMIT 8`,
            [userId]
          );
          return res.json({
            success: true,
            data: {
              role: "technician",
              counts: {
                newJobs: parseInt(assignedRes.rows[0].new_jobs || 0, 10),
                checkingJobs: parseInt(assignedRes.rows[0].checking_jobs || 0, 10),
                activeJobs: parseInt(assignedRes.rows[0].active_jobs || 0, 10),
                completedJobs: parseInt(assignedRes.rows[0].completed_jobs || 0, 10)
              },
              dueJobs: dueRes.rows,
              recentJobs: recentJobsRes.rows
            }
          });
        }
        if (role === "sales") {
          const salesRes2 = await db.query(
            `SELECT 
          COALESCE(SUM(total), 0) as billing,
          COUNT(*) as count,
          COALESCE(SUM(balance), 0) as balance,
          COUNT(CASE WHEN balance > 0.005 THEN 1 END) as pending_count
         FROM invoices 
         WHERE created_by = $1 AND type = 'Sales Invoice' AND is_voided = FALSE`,
            [userId]
          );
          const paymentsRes = await db.query(
            `SELECT 
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' AND direction = 'Received' THEN amount WHEN payment_method = 'Cash' AND direction = 'Paid' THEN -amount ELSE 0 END), 0) as cash_in,
          COALESCE(SUM(CASE WHEN payment_method = 'Online' AND direction = 'Received' THEN amount WHEN payment_method = 'Online' AND direction = 'Paid' THEN -amount ELSE 0 END), 0) as online_in
         FROM payments WHERE created_by = $1`,
            [userId]
          );
          const recentInvRes = await db.query(
            `SELECT id, invoice_no, type, date, party_name, total, paid, balance, payment_status, is_voided
         FROM invoices WHERE created_by = $1 ORDER BY date DESC, created_at DESC LIMIT 5`,
            [userId]
          );
          const lowStockRes2 = await db.query(
            `SELECT code, brand, model, current_stock, low_stock_alert FROM products WHERE current_stock <= low_stock_alert ORDER BY current_stock ASC LIMIT 6`
          );
          return res.json({
            success: true,
            data: {
              role: "sales",
              stats: {
                cashCollected: r2(paymentsRes.rows[0].cash_in),
                onlineCollected: r2(paymentsRes.rows[0].online_in),
                retailBilling: r2(salesRes2.rows[0].billing),
                retailCount: parseInt(salesRes2.rows[0].count || 0, 10),
                pendingInvoices: parseInt(salesRes2.rows[0].pending_count || 0, 10),
                outstandingBalance: r2(salesRes2.rows[0].balance)
              },
              recentInvoices: recentInvRes.rows,
              lowStock: lowStockRes2.rows
            }
          });
        }
        const [
          prodRes,
          salesRes,
          accountsRes,
          repairRes,
          expenseRes,
          cashInHand,
          onlineBalance,
          recentInvoicesRes,
          recentRepairsRes,
          recentExpensesRes,
          lowStockRes
        ] = await Promise.all([
          db.query(`
        SELECT 
          COUNT(*) as total_products,
          COALESCE(SUM(current_stock), 0) as current_stock,
          COUNT(CASE WHEN current_stock <= low_stock_alert THEN 1 END) as low_stock,
          COALESCE(SUM(current_stock * cost_price), 0) as stock_cost_value,
          COALESCE(SUM(current_stock * expected_sale_price), 0) as stock_sale_value
        FROM products
      `),
          // Net Sales = non-voided Sales Invoice totals (formula: gross - credit_adjusted)
          db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN total ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE AND date = CURRENT_DATE THEN total ELSE 0 END), 0) as today_sales,
          COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE THEN 1 END) as total_sales_count,
          COUNT(CASE WHEN type = 'Sales Invoice' AND is_voided = FALSE AND date = CURRENT_DATE THEN 1 END) as today_sales_count
        FROM invoices
      `),
          db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'Customer Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as customer_receivable,
          COALESCE(SUM(CASE WHEN type = 'Customer Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as customer_payable,
          COALESCE(SUM(CASE WHEN type = 'Vendor Payable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as vendor_payable,
          COALESCE(SUM(CASE WHEN type = 'Vendor Receivable' AND status = 'Open' THEN remaining ELSE 0 END), 0) as vendor_receivable
        FROM accounts
      `),
          db.query(`
        SELECT 
          COUNT(CASE WHEN status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) as active_repairs,
          COUNT(CASE WHEN status = 'Waiting for Customer Approval' THEN 1 END) as waiting_approval,
          COUNT(CASE WHEN status IN ('Job Received', 'Diagnosis in Progress', 'Work in Progress', 'Waiting for Parts') THEN 1 END) as in_progress,
          COUNT(CASE WHEN status IN ('Ready for Delivery', 'Work Completed') THEN 1 END) as ready_delivery,
          COUNT(CASE WHEN status = 'Delivered & Closed' THEN 1 END) as completed_repairs,
          COALESCE(SUM(CASE WHEN status = 'Delivered & Closed' THEN total ELSE 0 END), 0) as repair_revenue,
          COUNT(CASE WHEN expected_completion < CURRENT_DATE AND status NOT IN ('Delivered & Closed', 'Cancelled', 'Returned Without Repair') THEN 1 END) as overdue
        FROM repair_jobs
      `),
          db.query(`
        SELECT 
          COALESCE(SUM(amount), 0) as total_expenses,
          COALESCE(SUM(CASE WHEN date = CURRENT_DATE THEN amount ELSE 0 END), 0) as today_expenses
        FROM expenses
      `),
          getAvailableBalance("Cash"),
          getAvailableBalance("Online"),
          db.query(`
        SELECT id, invoice_no, type, date, party_name, total, paid, balance, payment_status, is_voided, created_by_name
        FROM invoices ORDER BY date DESC, created_at DESC LIMIT 6
      `),
          db.query(`
        SELECT id, tracking_id, customer_name, contact as customer_contact, category_name as category, brand, model, status, priority, total, date, expected_completion
        FROM repair_jobs ORDER BY date DESC, created_at DESC LIMIT 6
      `),
          db.query(`
        SELECT id, date, description as title, category_name as category, amount, payment_method
        FROM expenses ORDER BY date DESC, created_at DESC LIMIT 5
      `),
          db.query(`
        SELECT code, brand, model, category_name as category, current_stock, low_stock_alert, cost_price, expected_sale_price as sale_price
        FROM products WHERE current_stock <= low_stock_alert ORDER BY current_stock ASC LIMIT 6
      `)
        ]);
        return res.json({
          success: true,
          data: {
            role: "admin",
            stats: {
              totalProducts: parseInt(prodRes.rows[0].total_products || 0, 10),
              currentStock: parseInt(prodRes.rows[0].current_stock || 0, 10),
              lowStock: parseInt(prodRes.rows[0].low_stock || 0, 10),
              stockCostValue: r2(prodRes.rows[0].stock_cost_value),
              stockSaleValue: r2(prodRes.rows[0].stock_sale_value),
              totalSales: r2(salesRes.rows[0].total_sales),
              todaySales: r2(salesRes.rows[0].today_sales),
              totalSalesCount: parseInt(salesRes.rows[0].total_sales_count || 0, 10),
              todaySalesCount: parseInt(salesRes.rows[0].today_sales_count || 0, 10),
              customerReceivables: r2(accountsRes.rows[0].customer_receivable),
              customerPayables: r2(accountsRes.rows[0].customer_payable),
              vendorPayables: r2(accountsRes.rows[0].vendor_payable),
              vendorReceivables: r2(accountsRes.rows[0].vendor_receivable),
              openBalance: r2(accountsRes.rows[0].customer_receivable),
              cashInHand,
              onlineBalance,
              totalExpenses: r2(expenseRes.rows[0].total_expenses),
              todayExpenses: r2(expenseRes.rows[0].today_expenses),
              activeRepairs: parseInt(repairRes.rows[0].active_repairs || 0, 10),
              waitingApproval: parseInt(repairRes.rows[0].waiting_approval || 0, 10),
              inProgress: parseInt(repairRes.rows[0].in_progress || 0, 10),
              readyDelivery: parseInt(repairRes.rows[0].ready_delivery || 0, 10),
              completedRepairs: parseInt(repairRes.rows[0].completed_repairs || 0, 10),
              repairRevenue: r2(repairRes.rows[0].repair_revenue),
              overdueRepairs: parseInt(repairRes.rows[0].overdue || 0, 10)
            },
            recentInvoices: recentInvoicesRes.rows,
            recentRepairs: recentRepairsRes.rows,
            recentExpenses: recentExpensesRes.rows,
            lowStock: lowStockRes.rows
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/sales", cacheRoute(30), async (req, res, next) => {
      try {
        const { from, to, staffId, paymentMethod, type } = req.query;
        let queryText = `
      SELECT 
        i.id, i.invoice_no, i.type, i.date, i.party_name,
        i.product_total, i.service_total, i.total,
        i.paid, i.credit_adjusted, i.balance,
        i.payment_method, i.reference_id, i.payment_status,
        i.is_voided, i.exchange_case,
        i.created_by_name,
        COALESCE((
          SELECT SUM(ii.quantity * ii.cost_price_snapshot)
          FROM invoice_items ii
          WHERE ii.invoice_id = i.id AND ii.item_type IN ('product', 'custom_product')
        ), 0) as cogs
      FROM invoices i
      WHERE i.is_voided = FALSE
        AND i.type IN ('Sales Invoice', 'Exchange Invoice', 'Custom Sale Invoice')
    `;
        const params = [];
        if (req.user.role === "sales") {
          params.push(req.user.id);
          queryText += ` AND i.created_by = $${params.length}`;
        } else if (staffId) {
          params.push(staffId);
          queryText += ` AND i.created_by = $${params.length}`;
        }
        if (paymentMethod) {
          params.push(paymentMethod);
          queryText += ` AND i.payment_method = $${params.length}`;
        }
        if (type) {
          params.push(type);
          queryText += ` AND i.type = $${params.length}`;
        }
        queryText = applyDateFilter(queryText, params, from, to, "i.date");
        queryText += " ORDER BY i.date DESC, i.created_at DESC";
        const result2 = await db.query(queryText, params);
        let grossSales = 0, totalCogs = 0, totalPaid = 0, totalBalance = 0;
        const rows = result2.rows.map((row) => {
          const total = r2(row.total);
          const paid = r2(row.paid);
          const isPrivileged = req.user.role === "admin" || req.user.role === "super_admin" || req.user.isSuperAdmin;
          const cogs = isPrivileged ? r2(row.cogs) : 0;
          const remaining = Math.max(0, r2(total - paid));
          const settled = remaining <= EPSILON;
          grossSales += total;
          totalCogs += cogs;
          totalPaid += paid;
          totalBalance += remaining;
          return {
            id: row.id,
            invoiceNo: row.invoice_no,
            type: row.type,
            date: row.date,
            customerName: row.party_name,
            productTotal: r2(row.product_total),
            serviceTotal: r2(row.service_total),
            total,
            cogs,
            paid,
            creditAdjusted: r2(row.credit_adjusted),
            remaining: settled ? 0 : remaining,
            paymentMethod: row.payment_method,
            paymentStatus: settled ? "Paid" : row.payment_status,
            exchangeCase: row.exchange_case,
            soldBy: row.created_by_name
          };
        });
        return res.json({
          success: true,
          summary: {
            grossSales: r2(grossSales),
            totalCogs: r2(totalCogs),
            grossProfit: r2(grossSales - totalCogs),
            totalPaid: r2(totalPaid),
            totalOutstanding: r2(totalBalance),
            count: rows.length
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/returns", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to } = req.query;
        let voidQuery = `
      SELECT 
        i.id, i.invoice_no, i.date, i.party_name,
        i.total as return_amount, i.paid as was_paid,
        i.refund_amount, i.refund_method, i.void_date, i.void_reason,
        'Full Void' as return_type,
        COALESCE((
          SELECT SUM(ii.quantity * ii.cost_price_snapshot)
          FROM invoice_items ii
          WHERE ii.invoice_id = i.id AND ii.item_type IN ('product', 'custom_product')
        ), 0) as cogs_reversed
      FROM invoices i
      WHERE i.type IN ('Sales Invoice', 'Exchange Invoice', 'Custom Sale Invoice')
        AND i.is_voided = TRUE
    `;
        const voidParams = [];
        voidQuery = applyDateFilter(voidQuery, voidParams, from, to, "i.void_date");
        voidQuery += " ORDER BY i.void_date DESC NULLS LAST, i.created_at DESC";
        let partialQuery = `
      SELECT 
        i.id, i.invoice_no, i.date, i.party_name,
        i.credit_adjusted as return_amount, i.paid as was_paid,
        i.credit_adjusted as refund_amount, i.refund_method, i.date as void_date, NULL as void_reason,
        'Partial Return' as return_type,
        0 as cogs_reversed
      FROM invoices i
      WHERE i.type IN ('Sales Invoice', 'Exchange Invoice', 'Custom Sale Invoice')
        AND i.is_voided = FALSE
        AND i.credit_adjusted > 0.005
    `;
        const partialParams = [];
        partialQuery = applyDateFilter(partialQuery, partialParams, from, to, "i.date");
        partialQuery += " ORDER BY i.date DESC, i.created_at DESC";
        const [voidRes, partialRes] = await Promise.all([
          db.query(voidQuery, voidParams),
          db.query(partialQuery, partialParams)
        ]);
        let totalReturnAmount = 0, totalCogsReversed = 0, totalRefunded = 0;
        const formatRow = (row) => {
          const returnAmount = r2(row.return_amount);
          const refundAmount = r2(Math.min(r2(row.refund_amount), r2(row.was_paid)));
          const cogsReversed = r2(row.cogs_reversed);
          totalReturnAmount += returnAmount;
          totalCogsReversed += cogsReversed;
          totalRefunded += refundAmount;
          return {
            id: row.id,
            invoiceNo: row.invoice_no,
            date: row.date,
            voidDate: row.void_date,
            customerName: row.party_name,
            returnType: row.return_type,
            returnAmount,
            wasPaid: r2(row.was_paid),
            refundAmount,
            refundMethod: row.refund_method || "\u2014",
            voidReason: row.void_reason || "\u2014",
            cogsReversed
          };
        };
        const data = [
          ...voidRes.rows.map(formatRow),
          ...partialRes.rows.map(formatRow)
        ].sort((a, b) => new Date(b.voidDate || b.date) - new Date(a.voidDate || a.date));
        return res.json({
          success: true,
          summary: {
            totalReturns: data.length,
            totalReturnAmount: r2(totalReturnAmount),
            totalRefunded: r2(totalRefunded),
            totalCogsReversed: r2(totalCogsReversed)
          },
          data
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/purchases", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to, paymentMethod, staffId, type } = req.query;
        let queryText = `
      SELECT 
        i.id, i.invoice_no, i.type, i.date, i.party_name, i.party_type,
        i.total, i.paid, i.credit_adjusted, i.balance,
        i.payment_method, i.payment_status, i.is_voided,
        i.created_by_name
      FROM invoices i
      WHERE i.type IN ('Vendor Purchase', 'Customer Purchase', 'Buyback Invoice')
    `;
        const params = [];
        if (staffId) {
          params.push(staffId);
          queryText += ` AND i.created_by = $${params.length}`;
        }
        if (paymentMethod) {
          params.push(paymentMethod);
          queryText += ` AND i.payment_method = $${params.length}`;
        }
        if (type) {
          params.push(type);
          queryText += ` AND i.type = $${params.length}`;
        }
        queryText = applyDateFilter(queryText, params, from, to, "i.date");
        queryText += " ORDER BY i.date DESC, i.created_at DESC";
        const result2 = await db.query(queryText, params);
        let totalPurchases = 0, totalPaid = 0, totalOutstanding = 0;
        const rows = result2.rows.map((row) => {
          const total = r2(row.total);
          const paid = r2(row.paid);
          const creditAdj = r2(row.credit_adjusted);
          const remaining = Math.max(0, r2(total - paid - creditAdj));
          const settled = remaining <= EPSILON;
          totalPurchases += total;
          totalPaid += paid;
          totalOutstanding += remaining;
          return {
            id: row.id,
            invoiceNo: row.invoice_no,
            type: row.type,
            date: row.date,
            partyName: row.party_name,
            partyType: row.party_type,
            total,
            paid,
            creditAdjusted: creditAdj,
            remaining: settled ? 0 : remaining,
            paymentMethod: row.payment_method,
            paymentStatus: settled ? "Paid" : row.payment_status,
            isVoided: row.is_voided,
            createdBy: row.created_by_name
          };
        });
        return res.json({
          success: true,
          summary: {
            totalPurchases: r2(totalPurchases),
            totalPaid: r2(totalPaid),
            totalOutstanding: r2(totalOutstanding),
            count: rows.length
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/vendor-returns", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to, staffId, paymentMethod } = req.query;
        let queryText = `
      SELECT 
        vr.id, vr.date, vr.vendor_name, vr.product_code,
        vr.returned_product_name, vr.quantity, vr.amount,
        vr.actual_money_received, vr.exchange_value,
        vr.payable_adjustment, vr.replacement_mode,
        vr.replacement_product_name, vr.replacement_qty,
        vr.payment_method, vr.settlement_method, vr.reason,
        vr.status, vr.created_by_name
      FROM vendor_returns vr
      WHERE 1=1
    `;
        const params = [];
        if (staffId) {
          params.push(staffId);
          queryText += ` AND vr.created_by = $${params.length}`;
        }
        if (paymentMethod) {
          params.push(paymentMethod);
          queryText += ` AND (vr.payment_method = $${params.length} OR vr.settlement_method = $${params.length})`;
        }
        queryText = applyDateFilter(queryText, params, from, to, "vr.date");
        queryText += " ORDER BY vr.date DESC, vr.created_at DESC";
        const result2 = await db.query(queryText, params);
        let totalReturned = 0, totalCashReceived = 0, totalExchange = 0, totalAdjustment = 0;
        const rows = result2.rows.map((row) => {
          const amount = r2(row.amount);
          const cashReceived = r2(row.actual_money_received);
          const exchange = r2(row.exchange_value);
          const adjustment = r2(row.payable_adjustment);
          totalReturned += amount;
          totalCashReceived += cashReceived;
          totalExchange += exchange;
          totalAdjustment += adjustment;
          return {
            id: row.id,
            date: row.date,
            vendorName: row.vendor_name,
            productCode: row.product_code,
            productName: row.returned_product_name,
            quantity: row.quantity,
            amount,
            actualMoneyReceived: cashReceived,
            exchangeValue: exchange,
            payableAdjustment: adjustment,
            settlementMethod: row.settlement_method,
            replacementMode: row.replacement_mode,
            replacementProduct: row.replacement_product_name,
            replacementQty: row.replacement_qty,
            paymentMethod: row.payment_method,
            reason: row.reason,
            status: row.status,
            createdBy: row.created_by_name
          };
        });
        return res.json({
          success: true,
          summary: {
            count: rows.length,
            totalReturned: r2(totalReturned),
            totalCashReceived: r2(totalCashReceived),
            totalExchangeValue: r2(totalExchange),
            totalPayableAdjustment: r2(totalAdjustment)
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/inventory", requireAdmin, cacheRoute(120), async (req, res, next) => {
      try {
        const { from, to, category } = req.query;
        let queryText = `
      SELECT 
        p.id, p.code, p.inventory_type, p.category_name, p.brand, p.model,
        p.condition,
        p.initial_stock, p.stock_in, p.stock_out, p.current_stock,
        p.cost_price, p.expected_sale_price,
        p.low_stock_alert, p.date_added,
        (p.current_stock * p.cost_price) as cost_value,
        (p.current_stock * p.expected_sale_price) as sale_value,
        ((p.current_stock * p.expected_sale_price) - (p.current_stock * p.cost_price)) as unrealised_margin
      FROM products p
      WHERE 1=1
    `;
        const params = [];
        if (category) {
          params.push(category);
          queryText += ` AND p.category_name = $${params.length}`;
        }
        queryText += " ORDER BY p.category_name, p.brand, p.model";
        const result2 = await db.query(queryText, params);
        let totalCostValue = 0, totalSaleValue = 0, totalUnits = 0;
        const rows = result2.rows.map((row) => {
          const costValue = r2(row.cost_value);
          const saleValue = r2(row.sale_value);
          totalCostValue += costValue;
          totalSaleValue += saleValue;
          totalUnits += parseInt(row.current_stock || 0, 10);
          return {
            id: row.id,
            code: row.code,
            inventoryType: row.inventory_type,
            category: row.category_name,
            brand: row.brand,
            model: row.model,
            condition: row.condition,
            initialStock: parseInt(row.initial_stock || 0, 10),
            stockIn: parseInt(row.stock_in || 0, 10),
            stockOut: parseInt(row.stock_out || 0, 10),
            currentStock: parseInt(row.current_stock || 0, 10),
            costPrice: r2(row.cost_price),
            salePriceEP: r2(row.expected_sale_price),
            costValue,
            saleValue,
            unrealisedMargin: r2(row.unrealised_margin),
            lowStockAlert: row.low_stock_alert,
            isLowStock: parseInt(row.current_stock || 0, 10) <= parseInt(row.low_stock_alert || 0, 10),
            dateAdded: row.date_added
          };
        });
        return res.json({
          success: true,
          summary: {
            totalProducts: rows.length,
            totalUnits,
            totalCostValue: r2(totalCostValue),
            totalSaleValue: r2(totalSaleValue),
            totalUnrealisedMargin: r2(totalSaleValue - totalCostValue),
            lowStockCount: rows.filter((r) => r.isLowStock).length
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/spare-parts", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { category, search, status } = req.query;
        let queryText = `
      SELECT 
        p.id, p.code, p.name, p.category, p.compatible_models,
        p.cost_price, p.selling_price, p.current_stock, p.min_stock_alert,
        p.status, p.created_at,
        (p.current_stock * p.cost_price) as stock_cost_value,
        (p.current_stock * p.selling_price) as stock_sale_value,
        COALESCE(SUM(rpu.quantity), 0) as total_used_qty,
        COALESCE(SUM(rpu.quantity * rpu.cost_price_snapshot), 0) as total_cogs_consumed,
        COALESCE(SUM(rpu.customer_charge), 0) as total_revenue_generated
      FROM repair_parts p
      LEFT JOIN repair_parts_used rpu ON rpu.part_id = p.id
      WHERE 1=1
    `;
        const params = [];
        if (category) {
          params.push(category);
          queryText += ` AND p.category = $${params.length}`;
        }
        if (status) {
          if (status === "In Stock") {
            queryText += ` AND p.current_stock > 0`;
          } else if (status === "Low Stock") {
            queryText += ` AND p.current_stock <= p.min_stock_alert`;
          } else if (status === "Out of Stock") {
            queryText += ` AND p.current_stock = 0`;
          } else {
            params.push(status);
            queryText += ` AND p.status = $${params.length}`;
          }
        }
        if (search) {
          params.push(`%${search.trim().toLowerCase()}%`);
          queryText += ` AND (LOWER(p.code) LIKE $${params.length} OR LOWER(p.name) LIKE $${params.length} OR LOWER(p.category) LIKE $${params.length})`;
        }
        queryText += " GROUP BY p.id ORDER BY p.category, p.name";
        const result2 = await db.query(queryText, params);
        let totalParts = result2.rows.length;
        let totalStockUnits = 0;
        let totalCostValue = 0;
        let totalSaleValue = 0;
        let totalUsedUnits = 0;
        let totalCogsConsumed = 0;
        let totalRevenueGenerated = 0;
        const rows = result2.rows.map((row) => {
          const stock = parseInt(row.current_stock || 0, 10);
          const usedQty = parseInt(row.total_used_qty || 0, 10);
          const costVal = r2(row.stock_cost_value);
          const saleVal = r2(row.stock_sale_value);
          const cogs = r2(row.total_cogs_consumed);
          const rev = r2(row.total_revenue_generated);
          const isLow = stock <= parseInt(row.min_stock_alert || 2, 10);
          totalStockUnits += stock;
          totalCostValue += costVal;
          totalSaleValue += saleVal;
          totalUsedUnits += usedQty;
          totalCogsConsumed += cogs;
          totalRevenueGenerated += rev;
          return {
            id: row.id,
            code: row.code,
            name: row.name,
            category: row.category,
            compatibleModels: row.compatible_models || "\u2014",
            currentStock: stock,
            minStockAlert: parseInt(row.min_stock_alert || 2, 10),
            costPrice: r2(row.cost_price),
            sellingPrice: r2(row.selling_price),
            stockCostValue: costVal,
            stockSaleValue: saleVal,
            usedUnits: usedQty,
            cogsConsumed: cogs,
            revenueGenerated: rev,
            profitEarned: r2(rev - cogs),
            isLowStock: isLow,
            status: row.status
          };
        });
        return res.json({
          success: true,
          summary: {
            totalParts,
            totalStockUnits,
            totalCostValue: r2(totalCostValue),
            totalSaleValue: r2(totalSaleValue),
            totalUsedUnits,
            totalCogsConsumed: r2(totalCogsConsumed),
            totalRevenueGenerated: r2(totalRevenueGenerated),
            totalPartProfit: r2(totalRevenueGenerated - totalCogsConsumed),
            lowStockCount: rows.filter((r) => r.isLowStock).length
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/expenses", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to, category, paymentMethod } = req.query;
        let queryText = `
      SELECT 
        e.id, e.date, e.category_name, e.description,
        e.amount, e.payment_method, e.reference_id,
        e.created_by_name
      FROM expenses e
      WHERE 1=1
    `;
        const params = [];
        if (category) {
          params.push(category);
          queryText += ` AND e.category_name = $${params.length}`;
        }
        if (paymentMethod) {
          params.push(paymentMethod);
          queryText += ` AND e.payment_method = $${params.length}`;
        }
        queryText = applyDateFilter(queryText, params, from, to, "e.date");
        queryText += " ORDER BY e.date DESC, e.created_at DESC";
        const result2 = await db.query(queryText, params);
        const byCategory = {};
        let totalAmount = 0, totalCash = 0, totalOnline = 0;
        const rows = result2.rows.map((row) => {
          const amount = r2(row.amount);
          totalAmount += amount;
          if (row.payment_method === "Cash") totalCash += amount;
          else totalOnline += amount;
          byCategory[row.category_name] = r2((byCategory[row.category_name] || 0) + amount);
          return {
            id: row.id,
            date: row.date,
            category: row.category_name,
            description: row.description,
            amount,
            paymentMethod: row.payment_method,
            referenceId: row.reference_id || "\u2014",
            createdBy: row.created_by_name
          };
        });
        return res.json({
          success: true,
          summary: {
            totalAmount: r2(totalAmount),
            totalCash: r2(totalCash),
            totalOnline: r2(totalOnline),
            count: rows.length,
            byCategory
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/repairs", cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to, staffId, status } = req.query;
        let queryText = "SELECT * FROM repair_jobs WHERE 1=1";
        const params = [];
        if (req.user.role === "technician") {
          params.push(req.user.id);
          queryText += ` AND technician_id = $${params.length}`;
        } else if (staffId) {
          params.push(staffId);
          queryText += ` AND (technician_id = $${params.length} OR created_by = $${params.length})`;
        }
        if (status) {
          params.push(status);
          queryText += ` AND status = $${params.length}`;
        }
        queryText = applyDateFilter(queryText, params, from, to, "date");
        queryText += " ORDER BY date DESC, created_at DESC";
        const result2 = await db.query(queryText, params);
        let totalRevenue = 0, totalPaid = 0, totalRemaining = 0;
        const rows = result2.rows.map((job) => {
          const total = r2(job.total);
          const paid = r2(job.paid);
          const remaining = Math.max(0, r2(total - paid));
          const settled = remaining <= EPSILON;
          if (job.status === "Delivered & Closed") totalRevenue += total;
          totalPaid += paid;
          totalRemaining += settled ? 0 : remaining;
          return {
            id: job.id,
            trackingId: job.tracking_id,
            date: job.date,
            customerName: job.customer_name,
            jobType: job.job_type,
            categoryId: job.category_id,
            categoryName: job.category_name,
            technicianName: job.technician_name || "Unassigned",
            status: job.status,
            priority: job.priority,
            total,
            paid,
            remaining: settled ? 0 : remaining,
            paymentStatus: settled ? "Paid" : paid > 0 ? "Partial" : "Unpaid",
            approvalStatus: job.approval_status,
            expectedCompletion: job.expected_completion
          };
        });
        return res.json({
          success: true,
          summary: {
            count: rows.length,
            deliveredRevenue: r2(totalRevenue),
            totalPaid: r2(totalPaid),
            totalOutstanding: r2(totalRemaining)
          },
          data: rows
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/cash-balance", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to } = req.query;
        const settingsRes = await db.query(`SELECT opening_cash, opening_online FROM business_settings WHERE id = 1`);
        const openingCash = r2(settingsRes.rows[0]?.opening_cash || 0);
        const openingOnline = r2(settingsRes.rows[0]?.opening_online || 0);
        let cashQuery = `
      SELECT 
        payment_method,
        SUM(CASE WHEN direction = 'Received' THEN amount ELSE 0 END) as received,
        SUM(CASE WHEN direction = 'Paid' THEN amount ELSE 0 END) as paid_out
      FROM payments
      WHERE affects_money = TRUE
        AND payment_method IN ('Cash', 'Online')
    `;
        const cashParams = [];
        cashQuery = applyDateFilter(cashQuery, cashParams, from, to, "date");
        cashQuery += " GROUP BY payment_method";
        let expQuery = `
      SELECT 
        payment_method,
        SUM(amount) as total_expenses
      FROM expenses
      WHERE 1=1
    `;
        const expParams = [];
        expQuery = applyDateFilter(expQuery, expParams, from, to, "date");
        expQuery += " GROUP BY payment_method";
        let dailyQuery = `
      SELECT 
        date,
        payment_method,
        SUM(CASE WHEN direction = 'Received' THEN amount ELSE 0 END) as received,
        SUM(CASE WHEN direction = 'Paid' THEN amount ELSE 0 END) as paid_out
      FROM payments
      WHERE affects_money = TRUE AND payment_method IN ('Cash', 'Online')
    `;
        const dailyParams = [];
        dailyQuery = applyDateFilter(dailyQuery, dailyParams, from, to, "date");
        dailyQuery += " GROUP BY date, payment_method ORDER BY date ASC";
        const [cashRes, expRes, dailyRes] = await Promise.all([
          db.query(cashQuery, cashParams),
          db.query(expQuery, expParams),
          db.query(dailyQuery, dailyParams)
        ]);
        const flows = { Cash: { received: 0, paidOut: 0, expenses: 0 }, Online: { received: 0, paidOut: 0, expenses: 0 } };
        cashRes.rows.forEach((row) => {
          if (flows[row.payment_method]) {
            flows[row.payment_method].received = r2(row.received);
            flows[row.payment_method].paidOut = r2(row.paid_out);
          }
        });
        expRes.rows.forEach((row) => {
          if (flows[row.payment_method]) {
            flows[row.payment_method].expenses = r2(row.total_expenses);
          }
        });
        const cashBalance = r2(openingCash + flows.Cash.received - flows.Cash.paidOut - flows.Cash.expenses);
        const onlineBalance = r2(openingOnline + flows.Online.received - flows.Online.paidOut - flows.Online.expenses);
        return res.json({
          success: true,
          data: {
            cash: {
              opening: openingCash,
              received: flows.Cash.received,
              paidOut: flows.Cash.paidOut,
              expenses: flows.Cash.expenses,
              balance: cashBalance
            },
            online: {
              opening: openingOnline,
              received: flows.Online.received,
              paidOut: flows.Online.paidOut,
              expenses: flows.Online.expenses,
              balance: onlineBalance
            },
            totalLiquidity: r2(cashBalance + onlineBalance),
            dailyMovements: dailyRes.rows
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/profit-loss", requireAdmin, cacheRoute(60), async (req, res, next) => {
      try {
        const { from, to } = req.query;
        let retailQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN product_total ELSE 0 END), 0) as gross_product_sales,
        COALESCE(SUM(CASE WHEN is_voided = TRUE  THEN product_total ELSE 0 END), 0) as voided_product_sales,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN service_total ELSE 0 END), 0) as gross_service_sales,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN credit_adjusted ELSE 0 END), 0) as partial_return_adj
      FROM invoices 
      WHERE type = 'Sales Invoice'
    `;
        const retailParams = [];
        retailQuery = applyDateFilter(retailQuery, retailParams, from, to, "date");
        let repairQuery = `
      SELECT 
        COALESCE(SUM(i.total), 0) as repair_revenue
      FROM invoices i
      WHERE i.type IN ('Repair Invoice', 'Diagnosis Invoice') AND i.is_voided = FALSE
    `;
        const repairParams = [];
        repairQuery = applyDateFilter(repairQuery, repairParams, from, to, "i.date");
        let exchangeQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN exchange_case = 'Customer Pays Shop' THEN total ELSE 0 END), 0) as exchange_income,
        COALESCE(SUM(CASE WHEN exchange_case = 'Shop Pays Customer'  THEN total ELSE 0 END), 0) as exchange_cost
      FROM invoices
      WHERE type = 'Exchange Invoice' AND is_voided = FALSE
    `;
        const exParams = [];
        exchangeQuery = applyDateFilter(exchangeQuery, exParams, from, to, "date");
        let customSaleQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN product_total ELSE 0 END), 0) as custom_sale_revenue,
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN service_total ELSE 0 END), 0) as custom_service_revenue
      FROM invoices
      WHERE type = 'Custom Sale Invoice'
    `;
        const csParams = [];
        customSaleQuery = applyDateFilter(customSaleQuery, csParams, from, to, "date");
        let buybackQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_voided = FALSE THEN total ELSE 0 END), 0) as buyback_cost
      FROM invoices
      WHERE type IN ('Customer Purchase', 'Buyback Invoice')
    `;
        const bbParams = [];
        buybackQuery = applyDateFilter(buybackQuery, bbParams, from, to, "date");
        let retailCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as retail_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Sales Invoice' AND i.is_voided = FALSE 
        AND ii.item_type IN ('product', 'custom_product')
    `;
        const retailCogsParams = [];
        retailCogsQuery = applyDateFilter(retailCogsQuery, retailCogsParams, from, to, "i.date");
        let voidCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as voided_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Sales Invoice' AND i.is_voided = TRUE 
        AND ii.item_type IN ('product', 'custom_product')
    `;
        const voidCogsParams = [];
        voidCogsQuery = applyDateFilter(voidCogsQuery, voidCogsParams, from, to, "i.date");
        let repairCogsQuery = `
      SELECT COALESCE(SUM(rpu.quantity * rpu.cost_price_snapshot), 0) as repair_cogs
      FROM repair_parts_used rpu
      JOIN repair_jobs rj ON rj.id = rpu.repair_job_id
      WHERE rj.status = 'Delivered & Closed'
    `;
        const repCogsParams = [];
        if (from) {
          repCogsParams.push(from);
          repairCogsQuery += ` AND rj.date >= $${repCogsParams.length}`;
        }
        if (to) {
          repCogsParams.push(to);
          repairCogsQuery += ` AND rj.date <= $${repCogsParams.length}`;
        }
        let repairInvCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as repair_inv_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type IN ('Repair Invoice', 'Diagnosis Invoice') 
        AND i.is_voided = FALSE AND ii.item_type = 'product'
    `;
        const repInvCogsParams = [];
        repairInvCogsQuery = applyDateFilter(repairInvCogsQuery, repInvCogsParams, from, to, "i.date");
        let csCogsQuery = `
      SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) as custom_cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.type = 'Custom Sale Invoice' AND i.is_voided = FALSE
        AND ii.item_type IN ('product', 'custom_product')
    `;
        const csCogsParams = [];
        csCogsQuery = applyDateFilter(csCogsQuery, csCogsParams, from, to, "i.date");
        let expQuery = `SELECT COALESCE(SUM(amount), 0) as expenses FROM expenses WHERE 1=1`;
        const expParams = [];
        expQuery = applyDateFilter(expQuery, expParams, from, to, "date");
        const [
          retailRes,
          repairRes,
          exRes,
          csRes,
          bbRes,
          retailCogsRes,
          voidCogsRes,
          repairCogsRes,
          repairInvCogsRes,
          csCogsRes,
          expRes
        ] = await Promise.all([
          db.query(retailQuery, retailParams),
          db.query(repairQuery, repairParams),
          db.query(exchangeQuery, exParams),
          db.query(customSaleQuery, csParams),
          db.query(buybackQuery, bbParams),
          db.query(retailCogsQuery, retailCogsParams),
          db.query(voidCogsQuery, voidCogsParams),
          db.query(repairCogsQuery, repCogsParams),
          db.query(repairInvCogsQuery, repInvCogsParams),
          db.query(csCogsQuery, csCogsParams),
          db.query(expQuery, expParams)
        ]);
        const grossProductSales = r2(retailRes.rows[0].gross_product_sales);
        const voidedProductSales = r2(retailRes.rows[0].voided_product_sales);
        const partialReturnAdj = r2(retailRes.rows[0].partial_return_adj);
        const netProductSales = r2(grossProductSales - voidedProductSales - partialReturnAdj);
        const serviceSales = r2(retailRes.rows[0].gross_service_sales);
        const repairRevenue = r2(repairRes.rows[0].repair_revenue);
        const exchangeIncome = r2(exRes.rows[0].exchange_income);
        const exchangeCost = r2(exRes.rows[0].exchange_cost);
        const exchangeNetIncome = r2(exchangeIncome - exchangeCost);
        const customSaleRevenue = r2(parseFloat(csRes.rows[0].custom_sale_revenue) + parseFloat(csRes.rows[0].custom_service_revenue));
        const buybackCost = r2(bbRes.rows[0].buyback_cost);
        const totalRevenue = r2(netProductSales + serviceSales + repairRevenue + exchangeNetIncome + customSaleRevenue);
        const retailCogs = r2(retailCogsRes.rows[0].retail_cogs);
        const voidedCogs = r2(voidCogsRes.rows[0].voided_cogs);
        const netRetailCogs = r2(retailCogs - voidedCogs);
        const repairPartsCogs = r2(repairCogsRes.rows[0].repair_cogs);
        const repairInvPartsCogs = r2(repairInvCogsRes.rows[0].repair_inv_cogs);
        const repairCogs = repairPartsCogs > 0 ? repairPartsCogs : repairInvPartsCogs;
        const customSaleCogs = r2(csCogsRes.rows[0].custom_cogs);
        const totalCogs = r2(netRetailCogs + repairCogs + customSaleCogs);
        const grossProfit = r2(totalRevenue - totalCogs);
        const operatingExpenses = r2(expRes.rows[0].expenses);
        const netProfit = r2(grossProfit - operatingExpenses);
        return res.json({
          success: true,
          data: {
            // Revenue breakdown
            grossProductSales,
            voidedProductSales,
            partialReturnAdj,
            netProductSales,
            serviceSales,
            repairRevenue,
            exchangeIncome,
            exchangeCost,
            exchangeNetIncome,
            customSaleRevenue,
            buybackCost,
            // informational: total paid out for buybacks
            totalRevenue,
            // COGS breakdown
            retailCogs,
            voidedCogs,
            netRetailCogs,
            repairPartsCogs,
            repairInvPartsCogs,
            repairCogs,
            customSaleCogs,
            totalCogs,
            // Bottom line
            grossProfit,
            operatingExpenses,
            netProfit,
            // Margin %
            grossMarginPct: totalRevenue > 0 ? r2(grossProfit / totalRevenue * 100) : 0,
            netMarginPct: totalRevenue > 0 ? r2(netProfit / totalRevenue * 100) : 0
          }
        });
      } catch (error) {
        next(error);
      }
    });
    router.get("/csv/:type", requireAdmin, async (req, res, next) => {
      try {
        const { type } = req.params;
        const { from, to } = req.query;
        const dateTag = [from, to].filter(Boolean).join("_to_") || "all-time";
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${type}-report-${dateTag}.csv"`);
        let csv = "";
        if (type === "sales") {
          let q = `
        SELECT i.invoice_no, i.date, i.party_name, i.type, i.payment_method,
               i.product_total, i.service_total, i.total, i.paid, i.credit_adjusted,
               GREATEST(0, i.total - i.paid) as remaining, i.payment_status, i.created_by_name
        FROM invoices i
        WHERE i.is_voided = FALSE AND i.type IN ('Sales Invoice','Exchange Invoice','Custom Sale Invoice')
      `;
          const p = [];
          q = applyDateFilter(q, p, from, to, "i.date");
          q += " ORDER BY i.date DESC";
          const r = await db.query(q, p);
          csv = toCSV(r.rows, [
            { key: "invoice_no", label: "Invoice No" },
            { key: "date", label: "Date" },
            { key: "party_name", label: "Customer" },
            { key: "type", label: "Type" },
            { key: "payment_method", label: "Payment Method" },
            { key: "product_total", label: "Product Total (PKR)" },
            { key: "service_total", label: "Service Total (PKR)" },
            { key: "total", label: "Invoice Total (PKR)" },
            { key: "paid", label: "Amount Paid (PKR)" },
            { key: "credit_adjusted", label: "Credit Adjusted (PKR)" },
            { key: "remaining", label: "Outstanding (PKR)" },
            { key: "payment_status", label: "Status" },
            { key: "created_by_name", label: "Sold By" }
          ]);
        } else if (type === "returns") {
          let q = `
        SELECT i.invoice_no, i.void_date as date, i.party_name,
               i.total as return_amount, i.paid as was_paid,
               i.refund_amount, i.refund_method, i.void_reason,
               'Full Void' as return_type
        FROM invoices i
        WHERE i.type IN ('Sales Invoice','Exchange Invoice','Custom Sale Invoice') AND i.is_voided = TRUE
      `;
          const p = [];
          q = applyDateFilter(q, p, from, to, "i.void_date");
          q += " UNION ALL SELECT i.invoice_no, i.date, i.party_name, i.credit_adjusted, i.paid, i.credit_adjusted, i.refund_method, NULL, 'Partial Return' FROM invoices i WHERE i.type IN ('Sales Invoice','Exchange Invoice','Custom Sale Invoice') AND i.is_voided = FALSE AND i.credit_adjusted > 0.005";
          q += " ORDER BY date DESC NULLS LAST";
          const r = await db.query(q, p);
          csv = toCSV(r.rows, [
            { key: "invoice_no", label: "Invoice No" },
            { key: "date", label: "Return Date" },
            { key: "party_name", label: "Customer" },
            { key: "return_type", label: "Return Type" },
            { key: "return_amount", label: "Return Amount (PKR)" },
            { key: "was_paid", label: "Was Paid (PKR)" },
            { key: "refund_amount", label: "Refunded (PKR)" },
            { key: "refund_method", label: "Refund Method" },
            { key: "void_reason", label: "Reason" }
          ]);
        } else if (type === "purchases") {
          let q = `
        SELECT i.invoice_no, i.date, i.party_name, i.type, i.payment_method,
               i.total, i.paid, i.credit_adjusted,
               GREATEST(0, i.total - i.paid - i.credit_adjusted) as remaining,
               i.payment_status, i.created_by_name
        FROM invoices i
        WHERE i.type IN ('Vendor Purchase','Customer Purchase','Buyback Invoice')
      `;
          const p = [];
          q = applyDateFilter(q, p, from, to, "i.date");
          q += " ORDER BY i.date DESC";
          const r = await db.query(q, p);
          csv = toCSV(r.rows, [
            { key: "invoice_no", label: "Invoice No" },
            { key: "date", label: "Date" },
            { key: "party_name", label: "Party" },
            { key: "type", label: "Type" },
            { key: "payment_method", label: "Payment Method" },
            { key: "total", label: "Total (PKR)" },
            { key: "paid", label: "Paid (PKR)" },
            { key: "credit_adjusted", label: "Credit Adjusted (PKR)" },
            { key: "remaining", label: "Outstanding (PKR)" },
            { key: "payment_status", label: "Status" },
            { key: "created_by_name", label: "Recorded By" }
          ]);
        } else if (type === "vendor-returns") {
          const { staffId, paymentMethod } = req.query;
          let q = `
        SELECT vr.date, vr.vendor_name, vr.product_code, vr.returned_product_name,
               vr.quantity, vr.amount, vr.actual_money_received, vr.exchange_value,
               vr.payable_adjustment, vr.settlement_method, vr.replacement_product_name,
               vr.replacement_qty, vr.reason, vr.status
        FROM vendor_returns vr WHERE 1=1
      `;
          const p = [];
          if (staffId) {
            p.push(staffId);
            q += ` AND vr.created_by = $${p.length}`;
          }
          if (paymentMethod) {
            p.push(paymentMethod);
            q += ` AND (vr.payment_method = $${p.length} OR vr.settlement_method = $${p.length})`;
          }
          q = applyDateFilter(q, p, from, to, "vr.date");
          q += " ORDER BY vr.date DESC";
          const r = await db.query(q, p);
          csv = toCSV(r.rows, [
            { key: "date", label: "Date" },
            { key: "vendor_name", label: "Vendor" },
            { key: "product_code", label: "Product Code" },
            { key: "returned_product_name", label: "Product Name" },
            { key: "quantity", label: "Qty Returned" },
            { key: "amount", label: "Return Amount (PKR)" },
            { key: "actual_money_received", label: "Cash Received (PKR)" },
            { key: "exchange_value", label: "Exchange Value (PKR)" },
            { key: "payable_adjustment", label: "Payable Adj (PKR)" },
            { key: "settlement_method", label: "Settlement" },
            { key: "replacement_product_name", label: "Replacement Product" },
            { key: "replacement_qty", label: "Replacement Qty" },
            { key: "reason", label: "Reason" },
            { key: "status", label: "Status" }
          ]);
        } else if (type === "inventory") {
          const r = await db.query(`
        SELECT p.code, p.inventory_type, p.category_name, p.brand, p.model, p.condition,
               p.initial_stock, p.stock_in, p.stock_out, p.current_stock,
               p.cost_price, p.expected_sale_price,
               (p.current_stock * p.cost_price) as cost_value,
               (p.current_stock * p.expected_sale_price) as sale_value,
               p.low_stock_alert, p.date_added
        FROM products p ORDER BY p.category_name, p.brand
      `);
          csv = toCSV(r.rows, [
            { key: "code", label: "Product Code" },
            { key: "inventory_type", label: "Type" },
            { key: "category_name", label: "Category" },
            { key: "brand", label: "Brand" },
            { key: "model", label: "Model" },
            { key: "condition", label: "Condition" },
            { key: "initial_stock", label: "Opening Stock" },
            { key: "stock_in", label: "Stock IN" },
            { key: "stock_out", label: "Stock OUT" },
            { key: "current_stock", label: "Current Stock" },
            { key: "cost_price", label: "Cost Price (PKR)" },
            { key: "expected_sale_price", label: "Sale Price EP (PKR)" },
            { key: "cost_value", label: "Stock Cost Value (PKR)" },
            { key: "sale_value", label: "Stock Sale Value (PKR)" },
            { key: "low_stock_alert", label: "Low Stock Alert" },
            { key: "date_added", label: "Date Added" }
          ]);
        } else if (type === "expenses") {
          let q = `
        SELECT e.date, e.category_name, e.description, e.amount, e.payment_method,
               e.reference_id, e.created_by_name
        FROM expenses e WHERE 1=1
      `;
          const p = [];
          q = applyDateFilter(q, p, from, to, "e.date");
          q += " ORDER BY e.date DESC";
          const r = await db.query(q, p);
          csv = toCSV(r.rows, [
            { key: "date", label: "Date" },
            { key: "category_name", label: "Category" },
            { key: "description", label: "Description" },
            { key: "amount", label: "Amount (PKR)" },
            { key: "payment_method", label: "Payment Method" },
            { key: "reference_id", label: "Reference ID" },
            { key: "created_by_name", label: "Recorded By" }
          ]);
        } else if (type === "repairs") {
          let q = `
        SELECT tracking_id, date, customer_name, category_name, brand, model,
               technician_name, status, total, paid,
               GREATEST(0, total - paid) as remaining,
               expected_completion
        FROM repair_jobs WHERE 1=1
      `;
          const p = [];
          q = applyDateFilter(q, p, from, to, "date");
          q += " ORDER BY date DESC";
          const r = await db.query(q, p);
          csv = toCSV(r.rows, [
            { key: "tracking_id", label: "Tracking ID" },
            { key: "date", label: "Date" },
            { key: "customer_name", label: "Customer" },
            { key: "category_name", label: "Category" },
            { key: "brand", label: "Brand" },
            { key: "model", label: "Model" },
            { key: "technician_name", label: "Technician" },
            { key: "status", label: "Status" },
            { key: "total", label: "Total (PKR)" },
            { key: "paid", label: "Paid (PKR)" },
            { key: "remaining", label: "Remaining (PKR)" },
            { key: "expected_completion", label: "Expected Date" }
          ]);
        } else if (type === "spare-parts") {
          const r = await db.query(`
        SELECT 
          p.code, p.name, p.category, p.compatible_models,
          p.current_stock, p.cost_price, p.selling_price,
          (p.current_stock * p.cost_price) as stock_cost_value,
          (p.current_stock * p.selling_price) as stock_sale_value,
          COALESCE(SUM(rpu.quantity), 0) as total_used_qty,
          COALESCE(SUM(rpu.customer_charge), 0) as total_revenue,
          p.status
        FROM repair_parts p
        LEFT JOIN repair_parts_used rpu ON rpu.part_id = p.id
        GROUP BY p.id
        ORDER BY p.category, p.name
      `);
          csv = toCSV(r.rows, [
            { key: "code", label: "Part SKU / Code" },
            { key: "category", label: "Category" },
            { key: "name", label: "Part Name" },
            { key: "compatible_models", label: "Compatible Models" },
            { key: "current_stock", label: "Current Stock Qty" },
            { key: "cost_price", label: "Unit Cost Price (PKR)" },
            { key: "selling_price", label: "Customer Billing Price (PKR)" },
            { key: "stock_cost_value", label: "Stock Cost Value (PKR)" },
            { key: "stock_sale_value", label: "Stock Sale Value (PKR)" },
            { key: "total_used_qty", label: "Consumed in Jobs (Qty)" },
            { key: "total_revenue", label: "Revenue Generated (PKR)" },
            { key: "status", label: "Status" }
          ]);
        } else {
          return res.status(400).json({ success: false, message: "Unknown report type for CSV export." });
        }
        return res.send(csv);
      } catch (error) {
        next(error);
      }
    });
    module2.exports = router;
  }
});

// src/app.js
var require_app = __commonJS({
  "src/app.js"(exports2, module2) {
    var express = require("express");
    var cors = require("cors");
    var cookieParser = require("cookie-parser");
    var errorHandler = require_errorHandler();
    var { branchContextMiddleware } = require_branchContext();
    var authRoutes = require_auth_routes();
    var superAdminRoutes = require_super_admin_routes();
    var staffRoutes = require_staff_routes();
    var branchesRoutes = require_branches_routes();
    var categoriesRoutes = require_categories_routes();
    var settingsRoutes = require_settings_routes();
    var customersRoutes = require_customers_routes();
    var vendorsRoutes = require_vendors_routes();
    var inventoryRoutes = require_inventory_routes();
    var invoiceRoutes = require_invoices_routes();
    var accountsRoutes = require_accounts_routes();
    var ledgerRoutes = require_ledger_routes();
    var expensesRoutes = require_expenses_routes();
    var repairServicesRoutes = require_repair_services_routes();
    var repairPartsRoutes = require_repair_parts_routes();
    var repairsRoutes = require_repairs_routes();
    var reportsRoutes = require_reports_routes();
    var whatsappRoutes = require_whatsapp_routes();
    var app2 = express();
    var allowedOriginsList = [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "https://laptop-frontend-nine.vercel.app"
    ];
    var corsOptions = {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin) || /^http:\/\/192\.168\.[0-9]+\.[0-9]+(:[0-9]+)?$/.test(origin);
        const isVercel = /\.vercel\.app$/.test(origin);
        const isWhitelisted = allowedOriginsList.some((item) => origin.replace(/\/+$/, "") === item.replace(/\/+$/, ""));
        const isConfigured = process.env.CORS_ORIGIN && (process.env.CORS_ORIGIN === "*" || process.env.CORS_ORIGIN.split(",").map((s) => s.trim().replace(/\/+$/, "")).includes(origin.replace(/\/+$/, "")));
        if (isLocal || isVercel || isWhitelisted || isConfigured || !process.env.CORS_ORIGIN) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Branch-Id",
        "Accept",
        "Origin",
        "Cache-Control",
        "Pragma",
        "X-Cache-Control",
        "nocache",
        "noCache"
      ],
      exposedHeaders: ["Content-Length", "X-Request-Id", "X-Branch-Id"],
      optionsSuccessStatus: 200
    };
    app2.use(cors(corsOptions));
    app2.options("*", cors(corsOptions));
    app2.use(express.json({ limit: "10mb" }));
    app2.use(express.urlencoded({ extended: true, limit: "10mb" }));
    app2.use(cookieParser());
    app2.use(branchContextMiddleware);
    app2.use("/api/auth", authRoutes);
    app2.use("/api/super-admin", superAdminRoutes);
    app2.use("/api/branches", branchesRoutes);
    app2.use("/api/staff", staffRoutes);
    app2.use("/api/categories", categoriesRoutes);
    app2.use("/api/settings", settingsRoutes);
    app2.use("/api/customers", customersRoutes);
    app2.use("/api/vendors", vendorsRoutes);
    app2.use("/api/products", inventoryRoutes);
    app2.use("/api/inventory", inventoryRoutes);
    app2.use("/api/pos", invoiceRoutes);
    app2.use("/api/invoices", invoiceRoutes);
    app2.use("/api/accounts", accountsRoutes);
    app2.use("/api/ledger", ledgerRoutes);
    app2.use("/api/expenses", expensesRoutes);
    app2.use("/api/repair-services", repairServicesRoutes);
    app2.use("/api/repair-parts", repairPartsRoutes);
    app2.use("/api/repairs", repairsRoutes);
    app2.use("/api/reports", reportsRoutes);
    app2.use("/api/whatsapp", whatsappRoutes);
    app2.get("/", (req, res) => {
      res.json({
        status: "ok",
        message: "Retail & Repair Management API is running",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        service: "Retail & Repair Management API"
      });
    });
    app2.get("/favicon.ico", (req, res) => res.status(204).end());
    app2.get("/api/health", (req, res) => {
      res.json({
        status: "ok",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        service: "Retail & Repair Management API"
      });
    });
    app2.use(errorHandler);
    try {
      const baileys = require_baileys_service();
      baileys.initWhatsAppIfSessionExists().catch((e) => {
        console.warn("[Baileys] Auto-init on app boot:", e.message);
      });
    } catch (_) {
    }
    module2.exports = app2;
  }
});

// src/server.js
var fs = require("fs");
var path = require("path");
var envCandidates = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "..", ".env"),
  path.join(process.cwd(), ".env"),
  path.join(__dirname, ".env.cpanel"),
  path.join(__dirname, "..", ".env.cpanel"),
  "/home/isywouhn/api.saadcomm.isywarecloud.com/.env",
  "/home/isywouhn/api.saadcomm.isywarecloud.com/.env.cpanel"
];
for (const p of envCandidates) {
  try {
    if (fs.existsSync(p)) {
      require("dotenv").config({ path: p });
    }
  } catch (_) {
  }
}
require("dotenv").config();
var http = require("http");
var app = require_app();
var { initSocket } = require_socket();
var PORT = process.env.PORT || 5e3;
var server = http.createServer(app);
initSocket(server, process.env.CORS_ORIGIN || "http://localhost:3000");
var baileysService = require_baileys_service();
var startupRetry;
var stopping = false;
async function restoreWhatsApp() {
  try {
    await baileysService.initWhatsAppIfSessionExists();
  } catch (err) {
    console.error("[Baileys] Session recovery failed; retrying in 10s:", err.message);
    if (!stopping) startupRetry = setTimeout(restoreWhatsApp, 1e4);
  }
}
restoreWhatsApp();
server.listen(PORT, () => {
  console.log(`[Express API Server] Running on http://localhost:${PORT}`);
});
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(startupRetry);
  server.close();
  const deadline = setTimeout(() => process.exit(1), 15e3);
  deadline.unref();
  try {
    await baileysService.shutdown();
    process.exit(0);
  } catch (error) {
    console.error("[Baileys] Shutdown failed:", error.message);
    process.exit(1);
  }
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
