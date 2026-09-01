const jwt = require('jsonwebtoken');

async function testSuperAdminOperations() {
  try {
    const token = jwt.sign(
      { id: 1, username: 'superadmin', role: 'super_admin', isSuperAdmin: true, branchId: 1 },
      process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
      { expiresIn: '1h' }
    );

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    console.log('--- 1. Testing Super Admin Creating POS Sale ---');
    const salePayload = {
      customerId: 'CUST-TEST',
      customerName: 'SuperAdmin Test Customer',
      customerContact: '0300-1112233',
      paymentMethod: 'Cash',
      items: [
        {
          itemType: 'custom',
          name: 'USB 3.0 Adapter',
          description: 'Testing by superadmin',
          quantity: 1,
          unitPrice: 1500,
          costPrice: 1000
        }
      ],
      paid: 1500
    };

    const saleRes = await fetch('http://localhost:5000/api/invoices/sale', {
      method: 'POST',
      headers,
      body: JSON.stringify(salePayload)
    });
    const saleJson = await saleRes.json();
    console.log('Sale Result Status:', saleRes.status, 'Success:', saleJson.success, 'Invoice No:', saleJson.data?.invoice?.invoice_no, 'Created By Name:', saleJson.data?.invoice?.created_by_name);

    console.log('--- 2. Testing Super Admin Creating Repair Job ---');
    const repairPayload = {
      customerName: 'SuperAdmin Repair Client',
      contact: '0321-9988776',
      jobType: 'Service Job',
      categoryId: 1,
      categoryName: 'Laptop',
      brand: 'Dell',
      model: 'XPS 15',
      problem: 'Display flickering test by superadmin',
      lines: [
        {
          name: 'Screen Cleaning & Ribbon Inspection',
          charges: 2000,
          quantity: 1
        }
      ],
      paid: 500,
      paymentMethod: 'Cash'
    };

    const repRes = await fetch('http://localhost:5000/api/repairs', {
      method: 'POST',
      headers,
      body: JSON.stringify(repairPayload)
    });
    const repJson = await repRes.json();
    console.log('Repair Result Status:', repRes.status, 'Success:', repJson.success, 'Tracking ID:', repJson.data?.tracking_id, 'Created By Name:', repJson.data?.created_by_name);

    console.log('--- 3. Testing Super Admin Creating Expense ---');
    const expPayload = {
      category: 'Office Supplies',
      description: 'SuperAdmin test expense entry',
      amount: 450,
      paymentMethod: 'Cash'
    };

    const expRes = await fetch('http://localhost:5000/api/expenses', {
      method: 'POST',
      headers,
      body: JSON.stringify(expPayload)
    });
    const expJson = await expRes.json();
    console.log('Expense Result Status:', expRes.status, 'Success:', expJson.success, 'Expense ID:', expJson.data?.id, 'Created By Name:', expJson.data?.created_by_name);

    console.log('--- ALL SUPER ADMIN TRANSACTION TESTS COMPLETE ---');
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

testSuperAdminOperations();
