const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');

const dbConfig = {
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'admin123',
  database: 'retail_repair_db'
};

async function main() {
  console.log('=== Migrating to Local PostgreSQL (retail_repair_db) ===\n');

  const client = new Client(dbConfig);
  await client.connect();
  console.log('Connected to local retail_repair_db.');

  // Step 1: Execute cpanel_full_schema.sql
  console.log('Step 1: Applying full schema...');
  const schemaSql = fs.readFileSync(path.join(root, 'seeds', 'cpanel_full_schema.sql'), 'utf8');
  await client.query(schemaSql);
  console.log('✔ Full schema applied successfully.');

  // Step 2: Execute cpanel_quick_fix.sql
  console.log('Step 2: Applying operational columns quick fixes...');
  const fixSql = fs.readFileSync(path.join(root, 'seeds', 'cpanel_quick_fix.sql'), 'utf8');
  await client.query(fixSql);
  console.log('✔ Operational quick fixes applied.');

  // Step 3: Execute cpanel_fix_category_unique.sql
  console.log('Step 3: Applying per-branch uniqueness constraints...');
  const catFixSql = fs.readFileSync(path.join(root, 'seeds', 'cpanel_fix_category_unique.sql'), 'utf8');
  await client.query(catFixSql);
  console.log('✔ Category uniqueness indexes created.');

  // Step 4: Multi-tenant sequences and counters
  console.log('Step 4: Ensuring sequences and multi-tenant tables...');
  await client.query(`
    CREATE SEQUENCE IF NOT EXISTS public.entity_id_sequence START 1000000000;
    CREATE TABLE IF NOT EXISTS branch_counters (branch_id INTEGER NOT NULL, key TEXT NOT NULL, value BIGINT NOT NULL, PRIMARY KEY(branch_id,key));
    CREATE TABLE IF NOT EXISTS whatsapp_auth_state (branch_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(branch_id,key));
    CREATE TABLE IF NOT EXISTS whatsapp_auth_leases (branch_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
  `);
  console.log('✔ Multi-tenant infrastructure tables verified.');

  // Step 5: Password Hash generation
  console.log('Step 5: Generating bcrypt hash for password "admin123"...');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('admin123', salt);

  // Step 6: Master Branches
  console.log('Step 6: Seeding Master Branches (Branch 1 & Branch 2)...');
  await client.query(`
    INSERT INTO master_branches (
      id, branch_code, branch_name, db_name, db_host, db_port, db_user,
      db_ssl, schema_version, status, phone, email, city, address, admin_name, admin_username
    ) VALUES 
    (1, 'BR-01', 'Isysware Main Branch', 'retail_repair_db', '127.0.0.1', 5432, 'postgres', false, '2.1.0', 'Active', '0300-1234567', 'main@isysware.pk', 'Lahore', 'Shop #12, Computer Plaza, Main Boulevard', 'Store Manager', 'admin'),
    (2, 'BR-02', 'Saddar Branch', 'retail_repair_db', '127.0.0.1', 5432, 'postgres', false, '2.1.0', 'Active', '0300-7654321', 'saddar@isysware.pk', 'Rawalpindi', 'Shop #4, City Center, Saddar', 'Asim Khan', 'asim')
    ON CONFLICT (id) DO UPDATE SET 
      branch_code = EXCLUDED.branch_code,
      branch_name = EXCLUDED.branch_name,
      db_name = EXCLUDED.db_name,
      db_host = EXCLUDED.db_host,
      status = 'Active';
  `);
  // Sync branch sequence
  await client.query(`SELECT setval('master_branches_id_seq', (SELECT MAX(id) FROM master_branches));`);
  console.log('✔ Master branches seeded.');

  // Step 7: Master Super Admin
  console.log('Step 7: Seeding Super Admin (superadmin / admin123)...');
  await client.query(`
    INSERT INTO master_super_admins (id, username, password_hash, name, email, status)
    VALUES (1, 'superadmin', $1, 'Global Super Administrator', 'superadmin@isysware.pk', 'Active')
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'Active';
  `, [passwordHash]);
  console.log('✔ Super Admin ready.');

  // Step 8: Branch Users & Master Staff Identities
  console.log('Step 8: Seeding branch users with password "admin123"...');
  const usersToSeed = [
    { id: 'EMP-0001', name: 'Branch Admin', contact: '03343964852', designation: 'Branch Administrator', role: 'admin', username: 'admin', branchId: 1 },
    { id: 'EMP-0002', name: 'Ali Faisal', contact: '03148843707', designation: 'Sales Executive', role: 'sales', username: 'sales', branchId: 1 },
    { id: 'EMP-0003', name: 'Nabeel Faisal', contact: '03001234001', designation: 'Senior Technician', role: 'technician', username: 'tech', branchId: 1 },
    { id: 'EMP-0004', name: 'Farhan Technician', contact: '03001234002', designation: 'Workshop Specialist', role: 'technician', username: 'techfarhan', branchId: 1 },
    { id: 'EMP-0005', name: 'Asim Admin', contact: '03335559988', designation: 'Saddar Branch Administrator', role: 'admin', username: 'asim', branchId: 2 }
  ];

  for (const u of usersToSeed) {
    await client.query(`
      INSERT INTO users (id, branch_id, name, contact, designation, role, username, password_hash, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')
      ON CONFLICT (username) DO UPDATE SET 
        id = EXCLUDED.id,
        branch_id = EXCLUDED.branch_id,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash,
        status = 'Active';
    `, [u.id, u.branchId, u.name, u.contact, u.designation, u.role, u.username, passwordHash]);

    await client.query(`
      INSERT INTO master_staff_identities (branch_id, branch_user_id, normalized_username, role, status, reservation_status)
      VALUES ($1, $2, $3, $4, 'Active', 'active')
      ON CONFLICT DO NOTHING;
    `, [u.branchId, u.id, u.username.toLowerCase(), u.role]);
  }
  console.log('✔ Branch users and identities registered.');

  // Step 9: Seed Product Categories
  console.log('Step 9: Seeding product categories...');
  const categories = [
    { name: 'Laptop', code_prefix: 'LPT', is_system: true },
    { name: 'PC', code_prefix: 'PC', is_system: true },
    { name: 'LCD / Screen', code_prefix: 'LCD', is_system: true },
    { name: 'Accessories', code_prefix: 'ACC', is_system: true }
  ];
  for (const cat of categories) {
    for (const bId of [1, 2]) {
      await client.query(`
        INSERT INTO product_categories (branch_id, name, code_prefix, is_system)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING;
      `, [bId, cat.name, cat.code_prefix, cat.is_system]);
    }
  }
  console.log('✔ Product categories seeded.');

  // Step 10: Seed Baseline Products
  console.log('Step 10: Seeding demo stock products...');
  const products = [
    ['PRD-0001', 'LPT-0001', 'Vendor Purchased', 'Laptop', 'Dell', 'Latitude 5400', 'Core i5 8th Gen • 16GB DDR4 • 256GB M.2 SSD • 14.0 FHD IPS', 'Used', 6, 6, 1, 48000, 56000, 'Excellent condition, back-lit keyboard, 4-hour battery', 1],
    ['PRD-0002', 'LPT-0002', 'Vendor Purchased', 'Laptop', 'HP', 'EliteBook 840 G5', 'Core i5 8th Gen • 8GB DDR4 • 256GB NVMe SSD • 14.0 FHD Slim', 'Used', 4, 4, 1, 52000, 60000, 'Silver aluminum chassis, Type-C charging', 1],
    ['PRD-0003', 'LPT-0003', 'Vendor Purchased', 'Laptop', 'Lenovo', 'ThinkPad T480', 'Core i7 8th Gen • 16GB DDR4 • 512GB SSD • Dual Battery', 'Used', 3, 3, 1, 62000, 72000, 'Legendary keyboard, extended battery backup', 1],
    ['PRD-0004', 'ACC-0001', 'Vendor Purchased', 'Accessories', 'Dell', '65W Type-C Original Adapter', '65W USB Type-C Fast Charger • 3-Pin Pakistan Power Cord', 'New', 15, 15, 3, 2200, 3500, 'Genuine OEM tested power supply', 1],
    ['PRD-0005', 'ACC-0002', 'Vendor Purchased', 'Accessories', 'Logitech', 'M185 Wireless Optical Mouse', '2.4GHz Wireless Nano Receiver • 12-Month Battery Life', 'New', 12, 12, 3, 1200, 1800, 'Original retail pack with 1-year warranty', 1],
    ['PRD-0006', 'ACC-0003', 'Vendor Purchased', 'Accessories', 'Kingston', 'NV2 256GB M.2 NVMe SSD', 'PCIe 4.0 Gen 4x4 • Read up to 3000MB/s • Ultra Fast', 'New', 10, 10, 2, 4500, 6200, 'Brand new boxed storage upgrade', 1]
  ];
  for (const p of products) {
    await client.query(`
      INSERT INTO products (
        id, code, inventory_type, category_name, brand, model,
        specifications, condition, initial_stock, current_stock, low_stock_alert,
        cost_price, expected_sale_price, remarks, branch_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO NOTHING;
    `, p);
  }
  console.log('✔ Products seeded.');

  // Step 11: Seed Customers & Vendors
  console.log('Step 11: Seeding initial customers and vendors...');
  await client.query(`
    INSERT INTO vendors (id, name, contact, notes, branch_id) VALUES
    ('VND-0001', 'Hafiz Center Wholesale Suppliers', '03214567890', 'Authorized supplier for Dell & HP used corporate stock', 1),
    ('VND-0002', 'Dubai Laptop Traders', '03009876543', 'Direct import container lots for Lenovo ThinkPad & MacBooks', 1)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO customers (id, name, contact, notes, branch_id) VALUES
    ('CUS-0001', 'Muhammad Bilal', '03001234567', 'Regular client - Freelance Web Developer', 1),
    ('CUS-0002', 'Dr. Kamran Ahmed', '03219876543', 'Hospital Medical Officer', 1)
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('✔ Customers and vendors seeded.');

  await client.end();
  console.log('\n=== Local Database Migration Completed Successfully ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

