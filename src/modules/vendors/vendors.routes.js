const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin, requireSalesOrAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute } = require('../../config/cache');

router.use(authenticateToken);

// GET /api/vendors - List all vendors with payable/receivable balance calculation (Cached 60s)
router.get('/', requireSalesOrAdmin, cacheRoute(60), async (req, res, next) => {
  try {
    const { search } = req.query;
    let whereClause = '';
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      whereClause = `WHERE LOWER(v.name) LIKE $${params.length} OR LOWER(COALESCE(v.contact, '')) LIKE $${params.length} OR LOWER(COALESCE(v.address, '')) LIKE $${params.length} OR LOWER(v.id) LIKE $${params.length}`;
    }

    const query = `
      SELECT 
        v.id, v.name, v.contact, v.address, v.notes, v.created_at, v.updated_at,
        COALESCE(SUM(CASE WHEN a.type = 'Vendor Payable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) as payable,
        COALESCE(SUM(CASE WHEN a.type = 'Vendor Receivable' AND a.status = 'Open' THEN a.remaining ELSE 0 END), 0) as receivable
      FROM vendors v
      LEFT JOIN accounts a ON a.party_id = v.id
      ${whereClause}
      GROUP BY v.id
      ORDER BY v.created_at DESC
    `;
    const result = await db.query(query, params);

    const vendors = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      contact: row.contact,
      address: row.address,
      notes: row.notes,
      payable: parseFloat(row.payable || 0),
      receivable: parseFloat(row.receivable || 0),
      openPayable: parseFloat(row.payable || 0),
      openReceivable: parseFloat(row.receivable || 0),
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
});

// POST /api/vendors - Create vendor
router.post('/', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { name, contact, address, notes } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Vendor name is required.'
      });
    }

    const cleanName = String(name).trim();
    const cleanContact = contact ? String(contact).trim() : null;
    const cleanAddress = address ? String(address).trim() : null;
    const cleanNotes = notes ? String(notes).trim() : null;

    const existing = await db.query(
      `SELECT id, name, contact, address, notes FROM vendors WHERE LOWER(name) = $1 AND ($2::varchar IS NULL OR contact = $2)`,
      [cleanName.toLowerCase(), cleanContact]
    );

    if (existing.rows.length > 0) {
      if (cleanAddress && !existing.rows[0].address) {
        await db.query(`UPDATE vendors SET address = $1 WHERE id = $2`, [cleanAddress, existing.rows[0].id]);
        existing.rows[0].address = cleanAddress;
      }
      return res.json({
        success: true,
        message: 'Existing vendor found',
        data: existing.rows[0]
      });
    }

    const vendorId = await getNextEntityId('vendors', 'id', 'VND', 4);
    const insertRes = await db.query(
      `INSERT INTO vendors (id, name, contact, address, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [vendorId, cleanName, cleanContact, cleanAddress, cleanNotes]
    );

    await CacheService.invalidatePattern('route:/api/vendors*');
    emitEvent('vendors.created', insertRes.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Vendor created successfully',
      data: insertRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/vendors/:id - Update vendor (Admin only)
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, contact, address, notes } = req.body;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Vendor name is required.'
      });
    }

    const cleanName = String(name).trim();
    const cleanContact = contact ? String(contact).trim() : null;
    const cleanAddress = address ? String(address).trim() : null;
    const cleanNotes = notes ? String(notes).trim() : null;

    const result = await db.withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE vendors SET name = $1, contact = $2, address = $3, notes = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *`,
        [cleanName, cleanContact, cleanAddress, cleanNotes, id]
      );

      if (updateRes.rows.length === 0) {
        const error = new Error('Vendor not found');
        error.status = 404;
        throw error;
      }

      await client.query(`UPDATE invoices SET party_name = $1, contact = $2 WHERE party_id = $3`, [cleanName, cleanContact, id]);
      await client.query(`UPDATE accounts SET party_name = $1 WHERE party_id = $2`, [cleanName, id]);
      await client.query(`UPDATE payments SET party_name = $1 WHERE party_id = $2`, [cleanName, id]);
      await client.query(`UPDATE vendor_returns SET vendor_name = $1 WHERE vendor_id = $2`, [cleanName, id]);

      return updateRes.rows[0];
    });

    await CacheService.invalidatePattern('route:/api/vendors*');
    emitEvent('vendors.updated', result);

    return res.json({
      success: true,
      message: 'Vendor updated successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/vendors/:id - Delete vendor (Admin only)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const invCheck = await db.query('SELECT id FROM invoices WHERE party_id = $1 LIMIT 1', [id]);
    const returnCheck = await db.query('SELECT id FROM vendor_returns WHERE vendor_id = $1 LIMIT 1', [id]);
    const accCheck = await db.query('SELECT id FROM accounts WHERE party_id = $1 LIMIT 1', [id]);

    if (invCheck.rows.length > 0 || returnCheck.rows.length > 0 || accCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'HAS_TRANSACTION_HISTORY',
        message: 'This vendor has transaction history and cannot be deleted. You may edit their profile instead.'
      });
    }

    await db.query('DELETE FROM vendors WHERE id = $1', [id]);
    await CacheService.invalidatePattern('route:/api/vendors*');
    emitEvent('vendors.deleted', { id });

    return res.json({
      success: true,
      message: 'Vendor profile deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
