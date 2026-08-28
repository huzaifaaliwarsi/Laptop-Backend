const db = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function seedData() {
  console.log('[Seed] Starting realistic demo dataset insertion...');

  await db.withTransaction(async (client) => {
    // 1. Clear existing transaction mock rows
    await client.query('DELETE FROM invoice_items');
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM accounts');
    await client.query('DELETE FROM invoices');
    await client.query('DELETE FROM repair_parts_used');
    await client.query('DELETE FROM repair_status_history');
    await client.query('DELETE FROM repair_job_lines');
    await client.query('DELETE FROM repair_jobs');
    await client.query('DELETE FROM inventory_movements');
    await client.query('DELETE FROM products');
    await client.query('DELETE FROM customers');
    await client.query('DELETE FROM vendors');
    await client.query('DELETE FROM expenses');
    await client.query('DELETE FROM whatsapp_messages');
    await client.query('DELETE FROM whatsapp_conversations');
    await client.query('DELETE FROM repair_services');
    await client.query('DELETE FROM expense_categories');
    await client.query('DELETE FROM product_categories');

    // 2. Insert Master Categories
    await client.query(`
      INSERT INTO product_categories (name, code_prefix, is_system) VALUES
      ('Laptop', 'LPT', TRUE),
      ('PC', 'PC', TRUE),
      ('LCD / Screen', 'LCD', TRUE),
      ('Accessories', 'ACC', TRUE)
      ON CONFLICT (name) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO expense_categories (name) VALUES
      ('Shop Rent'),
      ('Utilities'),
      ('Staff Salaries'),
      ('Tea & Refreshments'),
      ('Shipping & Courier'),
      ('Repair Supplies'),
      ('Other')
      ON CONFLICT (name) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO repair_services (id, code, name, charges, duration, conditions, status) VALUES
      ('SRV-0001', 'SRV-0001', 'Screen / Display Replacement Labor', 2500, '1-2 Hours', 'Screen glass or panel fitting', 'Active'),
      ('SRV-0002', 'SRV-0002', 'Motherboard Chip-Level Power Repair', 6500, '1-2 Days', 'Dead / Short circuit troubleshooting', 'Active'),
      ('SRV-0003', 'SRV-0003', 'Complete Internal Servicing & Thermal Paste', 1500, '1 Hour', 'Fan cleaning + Arctic MX-4 paste', 'Active'),
      ('SRV-0004', 'SRV-0004', 'Hinges & Body Fabrication', 3500, 'Same Day', 'Broken plastic/metal casing repair', 'Active'),
      ('SRV-0005', 'SRV-0005', 'BIOS / EC Chip Reprogramming', 2500, '2 Hours', 'Corrupt firmware / password removal', 'Active')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 3. Ensure Staff Users
    const hashedAdmin = await bcrypt.hash('admin', 10);
    const hashedSales = await bcrypt.hash('sales123', 10);
    const hashedTech1 = await bcrypt.hash('tech123', 10);
    const hashedTech2 = await bcrypt.hash('tech456', 10);

    await client.query(`
      INSERT INTO users (id, username, password_hash, name, role, designation, contact, status) VALUES
      ('USR-0001', 'admin', $1, 'Super Admin', 'admin', 'System Administrator', '03001112233', 'Active'),
      ('USR-0002', 'sales', $2, 'Hamza Sales', 'sales', 'Senior Sales Executive', '03214445566', 'Active'),
      ('USR-0003', 'tech', $3, 'Usman Technician', 'technician', 'Senior Chip-Level Specialist', '03337778899', 'Active'),
      ('USR-0004', 'tech2', $4, 'Ali Raza Tech', 'technician', 'Hardware & Screen Technician', '03459990011', 'Active')
      ON CONFLICT (username) DO UPDATE SET id = EXCLUDED.id, password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role, designation = EXCLUDED.designation, contact = EXCLUDED.contact, status = EXCLUDED.status;
    `, [hashedAdmin, hashedSales, hashedTech1, hashedTech2]);

    // 4. Insert Vendors
    await client.query(`
      INSERT INTO vendors (id, name, contact, notes) VALUES
      ('VND-0001', 'Hafiz Center Wholesale Suppliers', '03214567890', 'Shop #45, 2nd Floor, Hafiz Center, Lahore - Authorized supplier for Dell & HP used corporate stock'),
      ('VND-0002', 'Dubai Laptop Traders', '03009876543', 'Plot 12, Techno City Mall, Karachi - Direct import container lots for Lenovo ThinkPad & MacBooks'),
      ('VND-0003', 'Al-Rehman Parts & Display Solutions', '03335554433', 'Shop #8, Uni Center, Rawalpindi - Genuine replacement IPS panels, hinges and keyboards'),
      ('VND-0004', 'Tech Zone Accessories & Batteries', '03456789012', 'Shop #19, City Tower, Lahore - Original adapters, SSDs, RAM and thermal consumables')
    `);

    // 5. Insert Customers
    await client.query(`
      INSERT INTO customers (id, name, contact, notes) VALUES
      ('CUS-0001', 'Muhammad Bilal', '03001234567', 'House #12, Block B, Gulberg III, Lahore - Regular client - Freelance Web Developer'),
      ('CUS-0002', 'Dr. Kamran Ahmed', '03219876543', 'Sector J, Phase 5, DHA, Lahore - Hospital Medical Officer - Bought 2 laptops'),
      ('CUS-0003', 'Syed Zeeshan Ali', '03334445566', 'Civic Center, Model Town, Lahore - Graphic Designer & Video Editor'),
      ('CUS-0004', 'Fatima Noor', '03123456789', 'F-Block, Johar Town, Lahore - University Student'),
      ('CUS-0005', 'Alpha Tech Solutions', '03017778899', 'Floor 3, Saudi Pak Tower, Blue Area, Islamabad - Corporate Client - 5 Annual Service Contracts')
    `);

    // 6. Insert Products
    const productsData = [
      ['PRD-0001', 'LPT-0001', 'Vendor Purchased', 'Laptop', 'Dell', 'Latitude 5400', 'Core i5 8th Gen • 16GB DDR4 • 256GB M.2 SSD • 14.0 FHD IPS', 'Used', 6, 6, 1, 48000, 56000, 'Excellent condition, back-lit keyboard, 4-hour battery'],
      ['PRD-0002', 'LPT-0002', 'Vendor Purchased', 'Laptop', 'HP', 'EliteBook 840 G5', 'Core i5 8th Gen • 8GB DDR4 • 256GB NVMe SSD • 14.0 FHD Slim', 'Used', 4, 4, 1, 52000, 60000, 'Silver aluminum chassis, Type-C charging, Bang & Olufsen sound'],
      ['PRD-0003', 'LPT-0003', 'Vendor Purchased', 'Laptop', 'Lenovo', 'ThinkPad T480', 'Core i7 8th Gen • 16GB DDR4 • 512GB SSD • Dual Battery', 'Used', 3, 3, 1, 62000, 72000, 'Legendary keyboard, 6-cell extended battery backup'],
      ['PRD-0004', 'LPT-0004', 'Vendor Purchased', 'Laptop', 'Apple', 'MacBook Pro A1708', 'Core i5 • 8GB RAM • 256GB PCIe SSD • 13.3 Retina Display', 'Used', 2, 2, 1, 85000, 98000, 'Space Gray, 2x Thunderbolt 3, Cycle count 180'],
      ['PRD-0005', 'LPT-0005', 'Vendor Purchased', 'Laptop', 'Dell', 'XPS 13 9360', 'Core i7 7th Gen • 16GB RAM • 512GB SSD • InfinityEdge FHD', 'Used', 1, 1, 1, 68000, 78000, 'Ultra-slim carbon fiber palmrest, pristine battery health'],
      ['PRD-0006', 'LCD-0001', 'Vendor Purchased', 'LCD / Screen', 'Innolux', '14.0 Slim 30-Pin FHD IPS', '1920x1080 Resolution • 60Hz • Matte Anti-Glare • 30-Pin Connector', 'New', 8, 8, 2, 7500, 11000, 'Compatible with Dell Latitude, HP EliteBook & ThinkPad'],
      ['PRD-0007', 'ACC-0001', 'Vendor Purchased', 'Accessories', 'Dell', '65W Type-C Original Adapter', '65W USB Type-C Fast Charger • 3-Pin Pakistan Power Cord', 'New', 15, 15, 3, 2200, 3500, 'Genuine OEM tested power supply'],
      ['PRD-0008', 'ACC-0002', 'Vendor Purchased', 'Accessories', 'Logitech', 'M185 Wireless Optical Mouse', '2.4GHz Wireless Nano Receiver • 12-Month Battery Life', 'New', 12, 12, 3, 1200, 1800, 'Original retail pack with 1-year warranty'],
      ['PRD-0009', 'ACC-0003', 'Vendor Purchased', 'Accessories', 'Kingston', 'NV2 256GB M.2 NVMe SSD', 'PCIe 4.0 Gen 4x4 • Read up to 3000MB/s • Ultra Fast', 'New', 10, 10, 2, 4500, 6200, 'Brand new boxed storage upgrade'],
      ['PRD-0010', 'ACC-0010', 'Vendor Purchased', 'Accessories', 'Samsung', '8GB DDR4 2666MHz Laptop RAM', 'PC4-21300 SODIMM 260-Pin Memory Module', 'Used', 14, 14, 3, 3200, 4800, 'Tested 100% pass on MemTest86']
    ];

    for (const p of productsData) {
      await client.query(`
        INSERT INTO products (
          id, code, inventory_type, category_name, brand, model, product_name,
          specifications, condition, initial_stock, current_stock, low_stock_alert, cost_price,
          expected_sale_price, remarks
        ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, p);
    }

    // 7. Insert Invoices & Items
    // SAL-00001
    await client.query(`
      INSERT INTO invoices (
        id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
        product_total, service_total, total, paid, initial_paid, credit_adjusted, balance,
        payment_method, reference_id, payment_status, is_voided, created_by, created_by_name
      ) VALUES (
        'INV-00001', 'SAL-00001', 'Sales Invoice', 'sale', CURRENT_DATE - INTERVAL '3 days',
        'Customer', 'CUS-0001', 'Muhammad Bilal', '03001234567',
        56000, 0, 56000, 56000, 56000, 0, 0,
        'Cash', 'CSH-REC-101', 'Paid', FALSE, 'USR-0002', 'Hamza Sales'
      );
    `);
    await client.query(`
      INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
      VALUES ('INV-00001', 'product', 'PRD-0001', 'LPT-0001', 'Dell Latitude 5400', 'Core i5 8th Gen • 16GB DDR4 • 256GB SSD', 1, 56000, 48000, 56000);
    `);

    // SAL-00002 (Partial with remaining balance)
    await client.query(`
      INSERT INTO invoices (
        id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
        product_total, service_total, total, paid, initial_paid, credit_adjusted, balance,
        payment_method, reference_id, payment_status, is_voided, created_by, created_by_name
      ) VALUES (
        'INV-00002', 'SAL-00002', 'Sales Invoice', 'sale', CURRENT_DATE - INTERVAL '1 days',
        'Customer', 'CUS-0002', 'Dr. Kamran Ahmed', '03219876543',
        61800, 0, 61800, 40000, 40000, 0, 21800,
        'Online', 'MEEZAN-TRF-9021', 'Partial', FALSE, 'USR-0002', 'Hamza Sales'
      );
    `);
    await client.query(`
      INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total) VALUES
      ('INV-00002', 'product', 'PRD-0002', 'LPT-0002', 'HP EliteBook 840 G5', 'Core i5 8th • 8GB • 256GB SSD', 1, 60000, 52000, 60000),
      ('INV-00002', 'product', 'PRD-0008', 'ACC-0002', 'Logitech M185 Wireless Mouse', '2.4GHz Optical', 1, 1800, 1200, 1800);
    `);

    // Create Customer Receivable for SAL-00002
    await client.query(`
      INSERT INTO accounts (id, type, party_type, party_id, party_name, invoice_id, invoice_no, amount, remaining, status, date)
      VALUES ('ACC-0001', 'Customer Receivable', 'Customer', 'CUS-0002', 'Dr. Kamran Ahmed', 'INV-00002', 'SAL-00002', 61800, 21800, 'Open', CURRENT_DATE - INTERVAL '1 days');
    `);

    // PUR-00001 (Vendor Purchase with Payable balance)
    await client.query(`
      INSERT INTO invoices (
        id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
        product_total, service_total, total, paid, initial_paid, credit_adjusted, balance,
        payment_method, reference_id, payment_status, is_voided, created_by, created_by_name
      ) VALUES (
        'INV-00003', 'PUR-00001', 'Vendor Purchase', 'vendor_purchase', CURRENT_DATE - INTERVAL '5 days',
        'Vendor', 'VND-0002', 'Dubai Laptop Traders', '03009876543',
        520000, 0, 520000, 300000, 300000, 0, 220000,
        'Online', 'HBL-LOT-551', 'Partial', FALSE, 'USR-0001', 'Super Admin'
      );
    `);
    await client.query(`
      INSERT INTO accounts (id, type, party_type, party_id, party_name, invoice_id, invoice_no, amount, remaining, status, date)
      VALUES ('ACC-0002', 'Vendor Payable', 'Vendor', 'VND-0002', 'Dubai Laptop Traders', 'INV-00003', 'PUR-00001', 520000, 220000, 'Open', CURRENT_DATE - INTERVAL '5 days');
    `);

    // 8. Insert Repair Jobs
    // Job 1: In Progress
    await client.query(`
      INSERT INTO repair_jobs (
        id, tracking_id, job_type, origin_job_type, date, customer_id, customer_name, contact,
        technician_id, technician_name, priority, product_type, brand, model, serial, problem,
        total, paid, initial_paid, payment_method, status, duration, expected_completion,
        work_progress, diagnosed_issue, recommended_solution, created_by, created_by_name
      ) VALUES (
        'REP-00001', 'RPR-2026-00001', 'Service Job', 'Service Job', CURRENT_DATE - INTERVAL '2 days',
        'CUS-0001', 'Muhammad Bilal', '03001234567',
        'USR-0003', 'Usman Technician', 'High', 'Laptop', 'Dell', 'Inspiron 15 3593', '9X1YZ42',
        'No display on power on, fan spins for 3 seconds then powers off',
        6500, 3000, 3000, 'Cash', 'Work in Progress', '1-2 Days', CURRENT_DATE + INTERVAL '1 days',
        60, 'Short circuit in 3.3V power rail near Super I/O chip', 'Replace Mosfet and SIO controller',
        'USR-0002', 'Hamza Sales'
      );
    `);
    await client.query(`
      INSERT INTO repair_job_lines (repair_job_id, service_id, name, charges, duration, condition) VALUES
      ('REP-00001', 'SRV-0002', 'Motherboard Chip-Level Power Repair', 6500, '1-2 Days', 'No Display / Dead Power');
    `);
    await client.query(`
      INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name) VALUES
      ('REP-00001', 'Job Received', 'Device received at front desk and assigned to Usman Technician', 'USR-0002', 'Hamza Sales'),
      ('REP-00001', 'Work in Progress', 'Short circuit found on 3.3V line, IC replacement in progress', 'USR-0003', 'Usman Technician');
    `);

    // Job 2: Ready for Delivery
    await client.query(`
      INSERT INTO repair_jobs (
        id, tracking_id, job_type, origin_job_type, date, customer_id, customer_name, contact,
        technician_id, technician_name, priority, product_type, brand, model, serial, problem,
        total, paid, initial_paid, payment_method, status, duration, expected_completion,
        work_progress, testing_result, warranty_days, final_remarks, created_by, created_by_name
      ) VALUES (
        'REP-00002', 'RPR-2026-00002', 'Service Job', 'Service Job', CURRENT_DATE - INTERVAL '1 days',
        'CUS-0003', 'Syed Zeeshan Ali', '03334445566',
        'USR-0003', 'Usman Technician', 'Normal', 'Laptop', 'HP', 'Pavilion Gaming 15', '5CD9821A',
        'Broken screen glass and flickering horizontal lines after drop',
        13500, 13500, 5000, 'Online', 'Ready for Delivery', 'Same Day', CURRENT_DATE,
        100, 'Passed', 30, 'Brand new 144Hz FHD IPS display fitted & fully tested', 'USR-0002', 'Hamza Sales'
      );
    `);
    await client.query(`
      INSERT INTO repair_job_lines (repair_job_id, service_id, name, charges, duration, condition) VALUES
      ('REP-00002', 'SRV-0001', 'Screen / Display Replacement Labor', 2500, '1-2 Hours', 'Screen broken');
    `);
    await client.query(`
      INSERT INTO repair_parts_used (repair_job_id, product_id, product_code, name, quantity, customer_charge, cost_price_snapshot, added_by, added_by_name)
      VALUES ('REP-00002', 'PRD-0006', 'LCD-0001', '14.0 Slim 30-Pin FHD IPS Screen', 1, 11000, 7500, 'USR-0003', 'Usman Technician');
    `);
    await client.query(`
      INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name) VALUES
      ('REP-00002', 'Job Received', 'Job intake completed', 'USR-0002', 'Hamza Sales'),
      ('REP-00002', 'Work Completed', 'Screen replaced, brightness levels and refresh rate tested OK', 'USR-0003', 'Usman Technician'),
      ('REP-00002', 'Ready for Delivery', 'Device cleaned and packed for customer pickup', 'USR-0002', 'Hamza Sales');
    `);

    // Job 3: Waiting for Approval
    await client.query(`
      INSERT INTO repair_jobs (
        id, tracking_id, job_type, origin_job_type, date, customer_id, customer_name, contact,
        technician_id, technician_name, priority, product_type, brand, model, serial, problem,
        total, paid, initial_paid, payment_method, status, duration, expected_completion,
        work_progress, quotation_amount, diagnosed_issue, recommended_solution, approval_status,
        created_by, created_by_name
      ) VALUES (
        'REP-00003', 'RPR-2026-00003', 'Diagnosis Job', 'Diagnosis Job', CURRENT_DATE,
        'CUS-0004', 'Fatima Noor', '03123456789',
        'USR-0004', 'Ali Raza Tech', 'Normal', 'Laptop', 'Lenovo', 'Legion 5 15ARH05', 'PF2X9L0',
        'Overheating, fan noise very loud, and laptop shuts down during video rendering',
        1500, 1500, 1500, 'Cash', 'Waiting for Customer Approval', '2 Days', CURRENT_DATE + INTERVAL '2 days',
        30, 9500, 'Thermal paste completely dried up and GPU heatsink copper pipe punctured',
        'Replace thermal heatsink module and apply Arctic MX-4 paste', 'Pending',
        'USR-0002', 'Hamza Sales'
      );
    `);
    await client.query(`
      INSERT INTO repair_job_lines (repair_job_id, name, charges, duration, condition) VALUES
      ('REP-00003', 'Complete Diagnostic Inspection', 1500, 'Same Day', 'Diagnostic Fee');
    `);
    await client.query(`
      INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name) VALUES
      ('REP-00003', 'Diagnosis Received', 'Device accepted for full internal diagnostic check', 'USR-0002', 'Hamza Sales'),
      ('REP-00003', 'Waiting for Customer Approval', 'Diagnosis complete. Quoted PKR 9,500 for heatsink replacement.', 'USR-0004', 'Ali Raza Tech');
    `);

    // 9. Insert Expenses
    await client.query(`
      INSERT INTO expenses (id, date, category_name, description, amount, payment_method, reference_id, created_by, created_by_name) VALUES
      ('EXP-00001', CURRENT_DATE - INTERVAL '4 days', 'Utilities', 'Shop Electricity Bill (LESCO)', 18500, 'Online', 'LESCO-ONLINE-9921', 'USR-0001', 'Super Admin'),
      ('EXP-00002', CURRENT_DATE - INTERVAL '3 days', 'Repair Supplies', 'Soldering flux, copper braid, and Arctic MX-4 thermal paste', 3800, 'Cash', 'SLIP-440', 'USR-0003', 'Usman Technician'),
      ('EXP-00003', CURRENT_DATE - INTERVAL '2 days', 'Tea & Refreshments', 'Shop tea, water dispenser bottles and biscuits', 4200, 'Cash', 'CSH-EXP-12', 'USR-0002', 'Hamza Sales'),
      ('EXP-00004', CURRENT_DATE - INTERVAL '1 days', 'Shipping & Courier', 'TCS delivery charges for returning defective screen to Rawalpindi vendor', 1450, 'Cash', 'TCS-8899210', 'USR-0002', 'Hamza Sales'),
      ('EXP-00005', CURRENT_DATE, 'Utilities', 'Shop Fiber Optic High-Speed Internet Monthly Bill', 3500, 'Online', 'NAYATEL-INV-109', 'USR-0001', 'Super Admin')
    `);

    // 10. Insert WhatsApp Conversations
    await client.query(`
      INSERT INTO whatsapp_conversations (id, contact, name, status, bot_state, lead_type, last_message, updated_at) VALUES
      ('CONV-0001', '03001234567', 'Muhammad Bilal', 'Bot Active', NULL, 'Repair Notification', 'Tracking ID: RPR-2026-00001\nStatus: Work in Progress\nExpected Completion: Tomorrow\nPaid: PKR 3,000\nRemaining: PKR 3,500', CURRENT_TIMESTAMP),
      ('CONV-0002', '03219876543', 'Dr. Kamran Ahmed', 'Human Handoff', NULL, 'Quotation', 'Thank you! A sales agent is available to assist you with the invoice details.', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('CONV-0003', '03123456789', 'Fatima Noor', 'Bot Active', 'repair_approval', 'Repair Notification', 'Diagnostic Quotation: PKR 9,500 for Heatsink replacement.\nReply 1 to APPROVE or 2 to DECLINE.', CURRENT_TIMESTAMP - INTERVAL '1 hours')
    `);

    await client.query(`
      INSERT INTO whatsapp_messages (conversation_id, direction, text, tag, created_at) VALUES
      ('CONV-0001', 'in', 'Salam, please check status for my laptop RPR-2026-00001', 'customer', CURRENT_TIMESTAMP - INTERVAL '4 hours'),
      ('CONV-0001', 'out', 'Tracking ID: RPR-2026-00001\nProduct: Dell Inspiron 15\nStatus: Work in Progress\nExpected Completion: Tomorrow\nTotal: PKR 6,500\nPaid: PKR 3,000\nRemaining: PKR 3,500\nLatest Update: Motherboard power section repair in progress.', 'bot', CURRENT_TIMESTAMP - INTERVAL '4 hours'),
      ('CONV-0002', 'in', 'Hello, do you have HP EliteBook laptops in stock with 16GB RAM?', 'customer', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('CONV-0002', 'out', 'Available inventory:\n1. HP EliteBook 840 G5 — PKR 60,000\n2. Dell Latitude 5400 — PKR 56,000\n3. Lenovo ThinkPad T480 — PKR 72,000\nReply 6 to talk to an agent.', 'bot', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('CONV-0002', 'in', '6', 'customer', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('CONV-0002', 'out', 'A human agent has been requested. Our sales team will join this conversation shortly.', 'bot', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('CONV-0003', 'in', 'Salam, I dropped my Legion 5 for diagnosis today', 'customer', CURRENT_TIMESTAMP - INTERVAL '1 hours'),
      ('CONV-0003', 'out', 'Diagnostic Quotation: PKR 9,500 for Heatsink replacement.\nReply 1 to APPROVE or 2 to DECLINE.', 'bot', CURRENT_TIMESTAMP - INTERVAL '1 hours')
    `);

    // 11. Ensure Settings Row
    await client.query(`
      INSERT INTO business_settings (id, company_name, tagline, invoice_subtitle, phone, email, tax_number, address, opening_cash, opening_online)
      VALUES (1, 'Retail & Repair Management', 'POS, Inventory Management, Sales & Purchases', 'Retail • Inventory • Repair', '0300-1234567', 'support@retailrepair.pk', 'NTN-7890123-4', 'Main Boulevard Computer Market, Lahore', 50000.00, 250000.00)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO whatsapp_settings (id, connected, number, business_name, bot_enabled, welcome_message, shop_location)
      VALUES (1, TRUE, '+923001234567', 'Retail & Repair Management', TRUE, 'Welcome to Retail & Repair Management!\nReply 1 Buy Laptop\nReply 2 Repair Service\nReply 3 Track Repair\nReply 4 Get Quotation\nReply 5 Shop Location\nReply 6 Talk to Human Agent', 'Shop #12, 1st Floor, Main Computer Plaza, Lahore')
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('[Seed] Successfully inserted 10 products, 4 vendors, 5 customers, invoices, 3 repair jobs, accounts, 5 expenses, and WhatsApp conversations!');
  });
}

seedData()
  .then(() => {
    console.log('[Seed] Database initialization complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Seed Error]:', err);
    process.exit(1);
  });
