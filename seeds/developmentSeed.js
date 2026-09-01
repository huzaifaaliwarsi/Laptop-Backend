const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');


async function runSeed() {
  const client = await pool.connect();
  try {
    console.log('--- Running Schema Migration ---');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schemaSql);
    console.log('Schema created successfully.');

    console.log('--- Seeding Baseline Master Data ---');

    // 1. Product Categories
    const productCategories = [
      { name: 'Laptop', code_prefix: 'LPT', is_system: true },
      { name: 'PC', code_prefix: 'PC', is_system: true },
      { name: 'LCD / Screen', code_prefix: 'LCD', is_system: true },
      { name: 'All-in-One', code_prefix: 'AIO', is_system: true },
      { name: 'Accessories', code_prefix: 'ACC', is_system: true }
    ];
    for (const cat of productCategories) {
      await client.query(
        `INSERT INTO product_categories (name, code_prefix, is_system) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
        [cat.name, cat.code_prefix, cat.is_system]
      );
    }

    // 2. Accessory Categories
    const accessoryCategories = ['Mouse', 'Keyboard', 'Charger', 'SSD', 'RAM', 'Laptop Bag', 'Cable'];
    for (const acc of accessoryCategories) {
      await client.query(
        `INSERT INTO accessory_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [acc]
      );
    }

    // 3. Expense Categories
    const expenseCategories = [
      'Rent', 'Salary', 'Utilities', 'Transport', 'Repair / Maintenance',
      'Marketing', 'Office Expense', 'Internet', 'Tea / Refreshment', 'Other'
    ];
    for (const exp of expenseCategories) {
      await client.query(
        `INSERT INTO expense_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [exp]
      );
    }

    // 4. Default Repair Services
    const repairServices = [
      { id: 'SRV-0001', code: 'SRV-0001', name: 'Screen Replacement', charges: 2500.00, duration: '1 day', conditions: 'Replacement screen warranty subject to supplier terms' },
      { id: 'SRV-0002', code: 'SRV-0002', name: 'Windows Installation & Optimization', charges: 1200.00, duration: '2 hours', conditions: 'Customer data backup is verified' },
      { id: 'SRV-0003', code: 'SRV-0003', name: 'Motherboard Chip-level Repair', charges: 5500.00, duration: '3 days', conditions: 'Inspection and IC replacement under microscope' },
      { id: 'SRV-0004', code: 'SRV-0004', name: 'RAM / SSD Upgrade & Cloning', charges: 1000.00, duration: '2 hours', conditions: 'Excluding hardware part price' },
      { id: 'SRV-0005', code: 'SRV-0005', name: 'Hinges Repair & Casing Fabrication', charges: 2000.00, duration: '2 days', conditions: 'Structural warranty 30 days' },
      { id: 'SRV-0006', code: 'SRV-0006', name: 'Fan Cleaning & Thermal Paste Service', charges: 1500.00, duration: '3 hours', conditions: 'Using Arctic MX-4 compound' }
    ];
    for (const srv of repairServices) {
      await client.query(
        `INSERT INTO repair_services (id, code, name, charges, duration, conditions, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Active')
         ON CONFLICT (code) DO UPDATE SET charges = EXCLUDED.charges, duration = EXCLUDED.duration, conditions = EXCLUDED.conditions`,
        [srv.id, srv.code, srv.name, srv.charges, srv.duration, srv.conditions]
      );
    }

    // 5. Default Staff Users (hashed passwords)
    const salt = await bcrypt.genSalt(10);
    const users = [
      { id: 'EMP-0001', name: 'Admin', contact: '03343964852', designation: 'Branch Administrator', role: 'admin', username: 'admin', password: 'admin' },
      { id: 'EMP-0002', name: 'Ali Faisal', contact: '03148843707', designation: 'Sales Executive', role: 'sales', username: 'sales', password: 'sales123' },
      { id: 'EMP-0003', name: 'Nabeel Faisal', contact: '03001234001', designation: 'Senior Technician', role: 'technician', username: 'tech', password: 'tech123' },
      { id: 'EMP-0004', name: 'Hamza Ahmed', contact: '03001234002', designation: 'Repair Technician', role: 'technician', username: 'tech2', password: 'tech456' }
    ];
    for (const user of users) {
      const hash = await bcrypt.hash(user.password, salt);
      await client.query(
        `INSERT INTO users (id, name, contact, designation, role, username, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active')
         ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name, designation = EXCLUDED.designation, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
        [user.id, user.name, user.contact, user.designation, user.role, user.username, hash]
      );
    }

    // 6. Default Settings
    await client.query(`
      INSERT INTO business_settings (id, company_name, tagline, invoice_subtitle, phone, email, tax_number, address, invoice_footer, opening_cash, opening_online)
      VALUES (1, 'Retail & Repair Management', 'POS, Inventory Management, Sales & Purchases', 'Retail • Inventory • Repair', '0300-1234567', 'info@carecenter.pk', '', 'Shop #12, Computer Plaza, Main Boulevard', 'Thank you for choosing us. We appreciate your business.', 0.00, 0.00)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO whatsapp_settings (id, connected, number, business_name, bot_enabled, human_handoff, sales_access, auto_status_notifications, welcome_message, shop_location)
      VALUES (1, false, '', 'Retail & Repair Management', true, true, false, true, 'Welcome to CareCenter ERP! Reply 1 Buy Laptop, 2 Repair Service, 3 Track Repair, 4 Get Quotation, 5 Shop Location, 6 Talk to Human Agent.', 'Shop #12, Computer Plaza, Main Boulevard')
      ON CONFLICT (id) DO NOTHING
    `);

    console.log('--- Seed Completed Successfully ---');
  } catch (error) {
    console.error('Seed Error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed();
