const jwt = require('jsonwebtoken');

async function testHttpConsolidated() {
  try {
    const token = jwt.sign(
      { id: 1, username: 'superadmin', role: 'super_admin', isSuperAdmin: true, branchId: 1 },
      process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026',
      { expiresIn: '1h' }
    );

    const res = await fetch('http://localhost:5000/api/super-admin/reports/consolidated?branchId=all', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const json = await res.json();
    console.log('HTTP Response Status:', res.status);
    console.log('Combined metrics from DB:', json.data?.combined);
    console.log('Branch 1 metrics from DB:', json.data?.branches?.[0]);
    process.exit(0);
  } catch (err) {
    console.error('Fetch error:', err.message);
    process.exit(1);
  }
}

testHttpConsolidated();
