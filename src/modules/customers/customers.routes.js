const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireSalesOrAdmin, requireAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');

router.use(authenticateToken);

// GET /api/customers - List all customers with receivable/payable balance calculation
router.get('/', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { search, balance } = req.query;
    let whereClause = '';
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      whereClause = `WHERE (LOWER(c.name) LIKE $${params.length} OR LOWER(COALESCE(c.contact, '')) LIKE $${params.length} OR LOWER(COALESCE(c.address, '')) LIKE $${params.length} OR LOWER(c.id) LIKE $${params.length})`;
    }

    let havingClause = '';
    if (balance === 'receivable') {
      havingClause = `HAVING COALESCE(SUM(CASE WHEN a.type = 'Customer Receivable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) > 0`;
    } else if (balance === 'payable') {
      havingClause = `HAVING COALESCE(SUM(CASE WHEN a.type = 'Customer Payable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) > 0`;
    } else if (balance === 'zero') {
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
    const result = await db.query(query, params);

    const customers = result.rows.map(row => ({
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

// POST /api/customers - Create customer
router.post('/', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { name, contact, address, notes } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Customer name is required.'
      });
    }

    const cleanName = String(name).trim();
    const cleanContact = contact ? String(contact).trim() : null;
    const cleanAddress = address ? String(address).trim() : null;
    const cleanNotes = notes ? String(notes).trim() : null;

    // Check if customer already exists by name and contact
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
        message: 'Existing customer found',
        data: existing.rows[0]
      });
    }

    const customerId = await getNextEntityId('customers', 'id', 'CUS', 4);
    const insertRes = await db.query(
      `INSERT INTO customers (id, name, contact, address, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [customerId, cleanName, cleanContact, cleanAddress, cleanNotes]
    );

    emitEvent('customers.created', insertRes.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: insertRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/customers/:id - Update customer
router.put('/:id', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, contact, address, notes } = req.body;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Customer name is required.'
      });
    }

    const cleanName = String(name).trim();
    const cleanContact = contact ? String(contact).trim() : null;
    const cleanAddress = address ? String(address).trim() : null;
    const cleanNotes = notes ? String(notes).trim() : null;

    const result = await db.withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE customers SET name = $1, contact = $2, address = $3, notes = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *`,
        [cleanName, cleanContact, cleanAddress, cleanNotes, id]
      );

      if (updateRes.rows.length === 0) {
        const error = new Error('Customer not found');
        error.status = 404;
        throw error;
      }

      // Update party names in invoices and accounts
      await client.query(`UPDATE invoices SET party_name = $1, contact = $2 WHERE party_id = $3`, [cleanName, cleanContact, id]);
      await client.query(`UPDATE accounts SET party_name = $1 WHERE party_id = $2`, [cleanName, id]);
      await client.query(`UPDATE payments SET party_name = $1 WHERE party_id = $2`, [cleanName, id]);

      return updateRes.rows[0];
    });

    emitEvent('customers.updated', result);

    return res.json({
      success: true,
      message: 'Customer updated successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/customers/:id - Delete customer
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if customer has transaction history
    const invCheck = await db.query('SELECT id FROM invoices WHERE party_id = $1 LIMIT 1', [id]);
    const repairCheck = await db.query('SELECT id FROM repair_jobs WHERE customer_id = $1 LIMIT 1', [id]);
    const accCheck = await db.query('SELECT id FROM accounts WHERE party_id = $1 LIMIT 1', [id]);

    if (invCheck.rows.length > 0 || repairCheck.rows.length > 0 || accCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'HAS_TRANSACTION_HISTORY',
        message: 'This customer has transaction history and cannot be deleted. You may edit their profile instead.'
      });
    }

    await db.query('DELETE FROM customers WHERE id = $1', [id]);
    emitEvent('customers.deleted', { id });

    return res.json({
      success: true,
      message: 'Customer profile deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
