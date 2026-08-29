-- =============================================================================
-- RETAIL & REPAIR MANAGEMENT SYSTEM - PRODUCTION POSTGRESQL SCHEMA
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS & AUTHENTICATION
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS whatsapp_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_conversations CASCADE;
DROP TABLE IF EXISTS whatsapp_settings CASCADE;
DROP TABLE IF EXISTS business_settings CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS repair_status_history CASCADE;
DROP TABLE IF EXISTS repair_parts_used CASCADE;
DROP TABLE IF EXISTS repair_job_lines CASCADE;
DROP TABLE IF EXISTS repair_jobs CASCADE;
DROP TABLE IF EXISTS vendor_returns CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS held_bills CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS inventory_movements CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS expense_categories CASCADE;
DROP TABLE IF EXISTS repair_services CASCADE;
DROP TABLE IF EXISTS accessory_categories CASCADE;
DROP TABLE IF EXISTS product_categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact VARCHAR(50),
    designation VARCHAR(100),
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'sales', 'technician')),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- 2. MASTER CATEGORIES & SERVICES
CREATE TABLE product_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    code_prefix VARCHAR(10) NOT NULL DEFAULT 'PRD',
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accessory_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repair_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repair_services (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    charges NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    duration VARCHAR(100),
    conditions TEXT,
    status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expense_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. CUSTOMERS & VENDORS
CREATE TABLE customers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact VARCHAR(50),
    address TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_contact ON customers(contact);

CREATE TABLE vendors (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact VARCHAR(50),
    address TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vendors_name ON vendors(name);
CREATE INDEX idx_vendors_contact ON vendors(contact);

-- 4. PRODUCTS & INVENTORY
CREATE TABLE products (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    inventory_type VARCHAR(50) NOT NULL CHECK (inventory_type IN ('Vendor Purchased', 'Customer Purchased')),
    category_id INT REFERENCES product_categories(id) ON DELETE RESTRICT,
    category_name VARCHAR(100) NOT NULL,
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(255) NOT NULL,
    product_name VARCHAR(255),
    screen_size VARCHAR(100),
    processor VARCHAR(100),
    ram VARCHAR(100),
    rom_ssd VARCHAR(100),
    hard_drive VARCHAR(100),
    graphics_card VARCHAR(100),
    accessory_category VARCHAR(100),
    description TEXT,
    others TEXT,
    specifications TEXT,
    condition VARCHAR(50) DEFAULT 'Used' CHECK (condition IN ('New', 'Used', 'Refurbished')),
    initial_stock INT NOT NULL DEFAULT 0,
    stock_in INT NOT NULL DEFAULT 0,
    stock_out INT NOT NULL DEFAULT 0,
    current_stock INT NOT NULL DEFAULT 0,
    low_stock_alert INT NOT NULL DEFAULT 1,
    cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    expected_sale_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    remarks TEXT,
    source_type VARCHAR(100),
    source_id VARCHAR(100),
    source_name VARCHAR(255),
    purchase_invoice_no VARCHAR(100),
    date_added DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_current_stock ON products(current_stock);

CREATE TABLE inventory_movements (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_code VARCHAR(50) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    quantity INT NOT NULL CHECK (quantity > 0),
    reason TEXT NOT NULL,
    reference_type VARCHAR(100),
    reference_id VARCHAR(100),
    performed_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_date ON inventory_movements(date);

-- 5. INVOICES & POS
CREATE TABLE invoices (
    id VARCHAR(50) PRIMARY KEY,
    invoice_no VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(100) NOT NULL,
    type_key VARCHAR(50) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    party_type VARCHAR(50),
    party_id VARCHAR(50),
    party_name VARCHAR(255) NOT NULL,
    contact VARCHAR(50),
    exchange_case VARCHAR(100),
    product_total NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    service_total NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    paid NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    initial_paid NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    credit_adjusted NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    payment_method VARCHAR(50) DEFAULT 'Cash',
    reference_id VARCHAR(100),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'Unpaid',
    is_voided BOOLEAN DEFAULT FALSE,
    void_date DATE,
    void_reason TEXT,
    refund_amount NUMERIC(18, 2) DEFAULT 0.00,
    refund_method VARCHAR(50),
    refund_reference VARCHAR(100),
    voided_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    repair_job_id VARCHAR(50),
    created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invoices_invoice_no ON invoices(invoice_no);
CREATE INDEX idx_invoices_date ON invoices(date);
CREATE INDEX idx_invoices_party ON invoices(party_id);
CREATE INDEX idx_invoices_type ON invoices(type_key);

CREATE TABLE invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(50) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    item_type VARCHAR(50) NOT NULL DEFAULT 'product',
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
    service_id VARCHAR(50) REFERENCES repair_services(id) ON DELETE SET NULL,
    code VARCHAR(50),
    name VARCHAR(255),
    description TEXT,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    cost_price_snapshot NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(18, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE held_bills (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    label VARCHAR(100) NOT NULL,
    party_name VARCHAR(255),
    total NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    payload JSONB NOT NULL,
    created_by VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. ACCOUNTS, PAYMENTS & VENDOR RETURNS
CREATE TABLE accounts (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    party_type VARCHAR(50) NOT NULL,
    party_id VARCHAR(50) NOT NULL,
    party_name VARCHAR(255) NOT NULL,
    invoice_id VARCHAR(50) REFERENCES invoices(id) ON DELETE CASCADE,
    invoice_no VARCHAR(100) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    remaining NUMERIC(18, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Settled', 'Cancelled')),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_party ON accounts(party_id);
CREATE INDEX idx_accounts_invoice ON accounts(invoice_id);
CREATE INDEX idx_accounts_status ON accounts(status);

CREATE TABLE payments (
    id VARCHAR(50) PRIMARY KEY,
    account_id VARCHAR(50) REFERENCES accounts(id) ON DELETE SET NULL,
    invoice_id VARCHAR(50) REFERENCES invoices(id) ON DELETE SET NULL,
    invoice_no VARCHAR(100),
    party_type VARCHAR(50) NOT NULL,
    party_id VARCHAR(50) NOT NULL,
    party_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(100) NOT NULL,
    direction VARCHAR(50) NOT NULL CHECK (direction IN ('Received', 'Paid', 'Adjusted')),
    amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash',
    reference_id VARCHAR(100),
    notes TEXT,
    affects_money BOOLEAN DEFAULT TRUE,
    is_initial_settlement BOOLEAN DEFAULT FALSE,
    created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_payments_party ON payments(party_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE TABLE vendor_returns (
    id VARCHAR(50) PRIMARY KEY,
    vendor_id VARCHAR(50) NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    vendor_name VARCHAR(255) NOT NULL,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_code VARCHAR(50) NOT NULL,
    returned_product_name VARCHAR(255),
    quantity INT NOT NULL CHECK (quantity > 0),
    amount NUMERIC(18, 2) NOT NULL,
    initial_settlement NUMERIC(18, 2) DEFAULT 0.00,
    actual_money_received NUMERIC(18, 2) DEFAULT 0.00,
    exchange_value NUMERIC(18, 2) DEFAULT 0.00,
    payable_adjustment NUMERIC(18, 2) DEFAULT 0.00,
    replacement_mode VARCHAR(50),
    replacement_qty INT DEFAULT 0,
    replacement_product_id VARCHAR(50),
    replacement_product_code VARCHAR(50),
    replacement_product_name VARCHAR(255),
    replacement_product_cost_price NUMERIC(18, 2) DEFAULT 0.00,
    replacement_expected_sale_price NUMERIC(18, 2) DEFAULT 0.00,
    balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    payment_method VARCHAR(50) NOT NULL,
    settlement_method VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100),
    reason TEXT,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'Unpaid',
    created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. REPAIR OPERATIONS & TECHNICIAN WORKSTATION
CREATE TABLE repair_jobs (
    id VARCHAR(50) PRIMARY KEY,
    tracking_id VARCHAR(100) UNIQUE NOT NULL,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('Service Job', 'Diagnosis Job')),
    origin_job_type VARCHAR(50),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    customer_name VARCHAR(255) NOT NULL,
    contact VARCHAR(50) NOT NULL,
    technician_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    technician_name VARCHAR(255),
    priority VARCHAR(50) DEFAULT 'Normal' CHECK (priority IN ('Normal', 'High', 'Urgent')),
    category_id INT REFERENCES repair_categories(id) ON DELETE SET NULL,
    category_name VARCHAR(100),
    product_type VARCHAR(100),
    brand VARCHAR(100),
    model VARCHAR(255),
    serial VARCHAR(100),
    problem TEXT NOT NULL,
    extra_charges NUMERIC(18, 2) DEFAULT 0.00,
    extra_reason TEXT,
    total NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    paid NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    initial_paid NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    payment_method VARCHAR(50) DEFAULT 'Cash',
    payment_reference VARCHAR(100),
    remarks TEXT,
    final_remarks TEXT,
    diagnosed_issue TEXT,
    recommended_solution TEXT,
    technical_notes TEXT,
    work_progress INT DEFAULT 0,
    quotation_amount NUMERIC(18, 2) DEFAULT 0.00,
    approval_status VARCHAR(50) DEFAULT 'Pending',
    approval_requested_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by VARCHAR(255),
    testing_result VARCHAR(50) DEFAULT 'Pending',
    warranty_days INT DEFAULT 0,
    status VARCHAR(100) NOT NULL DEFAULT 'Received',
    duration VARCHAR(100),
    expected_completion DATE,
    invoice_id VARCHAR(50),
    created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_repair_jobs_tracking ON repair_jobs(tracking_id);
CREATE INDEX idx_repair_jobs_technician ON repair_jobs(technician_id);
CREATE INDEX idx_repair_jobs_status ON repair_jobs(status);
CREATE INDEX idx_repair_jobs_customer ON repair_jobs(customer_id);
CREATE INDEX idx_repair_jobs_category ON repair_jobs(category_id);

CREATE TABLE repair_job_lines (
    id SERIAL PRIMARY KEY,
    repair_job_id VARCHAR(50) NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
    service_id VARCHAR(50) REFERENCES repair_services(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    catalog_price_snapshot NUMERIC(18, 2),
    charges NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    duration VARCHAR(100),
    condition TEXT,
    is_approved_repair_line BOOLEAN DEFAULT FALSE
);

CREATE TABLE repair_parts (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    compatible_models TEXT,
    cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    selling_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    current_stock INT NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    min_stock_alert INT NOT NULL DEFAULT 2,
    status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repair_parts_used (
    id SERIAL PRIMARY KEY,
    repair_job_id VARCHAR(50) NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
    part_id VARCHAR(50) REFERENCES repair_parts(id) ON DELETE SET NULL,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
    product_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    customer_charge NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    cost_price_snapshot NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    added_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    added_by_name VARCHAR(255),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repair_status_history (
    id SERIAL PRIMARY KEY,
    repair_job_id VARCHAR(50) NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
    status VARCHAR(100) NOT NULL,
    note TEXT,
    performed_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    performed_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. OPERATING EXPENSES
CREATE TABLE expenses (
    id VARCHAR(50) PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    category_id INT REFERENCES expense_categories(id) ON DELETE RESTRICT,
    category_name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Online')),
    reference_id VARCHAR(100),
    linked_tracking_id VARCHAR(100),
    created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_created_by ON expenses(created_by);

-- 9. SETTINGS, BRANDING & WHATSAPP
CREATE TABLE business_settings (
    id INT PRIMARY KEY DEFAULT 1,
    company_name VARCHAR(255) NOT NULL DEFAULT 'Retail & Repair Management',
    tagline VARCHAR(255) DEFAULT 'POS, Inventory Management, Sales & Purchases',
    invoice_subtitle VARCHAR(255) DEFAULT 'Retail • Inventory • Repair',
    phone VARCHAR(50),
    email VARCHAR(100),
    tax_number VARCHAR(100),
    address TEXT,
    invoice_footer TEXT DEFAULT 'Thank you for choosing us. We appreciate your business.',
    logo_data TEXT,
    opening_cash NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    opening_online NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE whatsapp_settings (
    id INT PRIMARY KEY DEFAULT 1,
    connected BOOLEAN DEFAULT FALSE,
    number VARCHAR(50),
    business_name VARCHAR(255) DEFAULT 'Retail & Repair Management',
    bot_enabled BOOLEAN DEFAULT TRUE,
    human_handoff BOOLEAN DEFAULT TRUE,
    sales_access BOOLEAN DEFAULT FALSE,
    auto_status_notifications BOOLEAN DEFAULT TRUE,
    welcome_message TEXT DEFAULT 'Welcome to CareCenter ERP! Reply 1 Buy Laptop, 2 Repair Service, 3 Track Repair, 4 Get Quotation, 5 Shop Location, 6 Talk to Human Agent.',
    shop_location TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE whatsapp_conversations (
    id VARCHAR(50) PRIMARY KEY,
    contact VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Bot Active' CHECK (status IN ('Bot Active', 'Human Handoff')),
    bot_state VARCHAR(100),
    lead_type VARCHAR(100) DEFAULT 'General',
    lead_data JSONB DEFAULT '{}',
    quote_budget NUMERIC(18, 2) DEFAULT 0.00,
    quote_requirement TEXT,
    approval_tracking_id VARCHAR(100),
    last_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE whatsapp_messages (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(50) NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
    text TEXT NOT NULL,
    tag VARCHAR(50) DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_whatsapp_messages_conversation ON whatsapp_messages(conversation_id);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100),
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
