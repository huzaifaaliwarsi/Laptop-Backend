const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { CacheService, cacheRoute, getBranchIdFromReq } = require('../../config/cache');

// CRITICAL FIX: All repair-parts routes now require authentication
router.use(authenticateToken);

// GET /api/repair-parts - List repair spare parts (Cached 60s)
router.get('/', cacheRoute(60), async (req, res, next) => {
  try {
    const { search, category, status, inStockOnly, lowStockOnly } = req.query;
    let queryText = 'SELECT * FROM repair_parts WHERE 1=1';
    const params = [];

    if (category && String(category).trim() !== '') {
      params.push(category.trim());
      queryText += ` AND LOWER(category) = LOWER($${params.length})`;
    }

    if (status && String(status).trim() !== '') {
      params.push(status.trim());
      queryText += ` AND status = $${params.length}`;
    }

    if (inStockOnly === 'true' || inStockOnly === true) {
      queryText += ' AND current_stock > 0';
    }

    if (lowStockOnly === 'true' || lowStockOnly === true) {
      queryText += ' AND current_stock <= min_stock_alert';
    }

    if (search && String(search).trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (
        LOWER(code) LIKE $${params.length} OR
        LOWER(name) LIKE $${params.length} OR
        LOWER(category) LIKE $${params.length} OR
        LOWER(COALESCE(compatible_models, '')) LIKE $${params.length}
      )`;
    }

    queryText += ' ORDER BY category ASC, name ASC';

    const result = await db.query(queryText, params);
    const isTech = req.user && req.user.role === 'technician';

    return res.json({
      success: true,
      data: result.rows.map(p => ({
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

// GET /api/repair-parts/categories - List distinct spare part categories (Cached 300s)
router.get('/categories', cacheRoute(300), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT name FROM spare_part_categories ORDER BY id ASC`
    );
    const catList = result.rows.map(r => r.name.trim());

    return res.json({
      success: true,
      data: catList
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repair-parts/:id - Get single repair part (Cached 60s)
router.get('/:id', cacheRoute(60), async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM repair_parts WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repair spare part not found.' });
    }
    const p = result.rows[0];
    const isTech = req.user && req.user.role === 'technician';

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

// POST /api/repair-parts - Create new repair part (Admin, Sales & Technician)
router.post('/', async (req, res, next) => {
  try {
    const { code, name, category, compatibleModels, costPrice, sellingPrice, currentStock, minStockAlert, status } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Spare part name is required.' });
    }

    const cleanName = name.trim();
    const cleanCategory = category ? category.trim() : 'General';
    const cleanModels = compatibleModels ? compatibleModels.trim() : null;
    const numCost = costPrice !== undefined && costPrice !== null && costPrice !== '' ? parseFloat(costPrice) : 0;
    const numSelling = sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== '' ? parseFloat(sellingPrice) : 0;
    const numStock = currentStock !== undefined && currentStock !== null && currentStock !== '' ? parseInt(currentStock, 10) : 0;
    const numAlert = minStockAlert !== undefined && minStockAlert !== null && minStockAlert !== '' ? parseInt(minStockAlert, 10) : 2;
    const partStatus = status || 'Active';

    if (isNaN(numCost) || numCost < 0) {
      return res.status(400).json({ success: false, message: 'Cost price must be a valid non-negative number.' });
    }
    if (isNaN(numSelling) || numSelling < 0) {
      return res.status(400).json({ success: false, message: 'Selling price must be a valid non-negative number.' });
    }
    if (isNaN(numStock) || numStock < 0) {
      return res.status(400).json({ success: false, message: 'Initial stock must be a non-negative integer.' });
    }

    let partCode = code ? code.trim() : '';
    if (!partCode) {
      const countRes = await db.query('SELECT COUNT(*) FROM repair_parts');
      const nextNum = parseInt(countRes.rows[0].count, 10) + 1;
      partCode = `PRT-${String(nextNum).padStart(4, '0')}`;
    }

    // Check duplicate code
    const dupRes = await db.query('SELECT id FROM repair_parts WHERE LOWER(code) = LOWER($1)', [partCode]);
    if (dupRes.rows.length > 0) {
      return res.status(400).json({ success: false, message: `Part code "${partCode}" already exists. Please choose a unique SKU code.` });
    }

    const partId = await getNextEntityId('repair_parts', 'id', 'PRT', 4);

    const insertRes = await db.query(
      `INSERT INTO repair_parts (
        id, code, name, category, compatible_models, cost_price, selling_price, current_stock, min_stock_alert, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [partId, partCode, cleanName, cleanCategory, cleanModels, numCost, numSelling, numStock, numAlert, partStatus]
    );

    const created = insertRes.rows[0];

    // Log initial stock movement if stock > 0
    if (numStock > 0) {
      try {
        await db.query(
          `INSERT INTO repair_parts_movements (
            part_id, part_code, part_name, direction, quantity, reason, reference_type, balance_after, performed_by, performed_by_name
          ) VALUES ($1, $2, $3, 'IN', $4, 'Initial Catalog Stock Creation', 'Initial Setup', $4, $5, $6)`,
          [created.id, created.code, created.name, numStock, req.user?.id || null, req.user?.name || 'Admin']
        );
      } catch (logErr) {
        console.error('[Spare Parts Movement] Error logging initial stock:', logErr.message);
      }
    }

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    emitEvent('repairPart.created', created);

    return res.status(201).json({
      success: true,
      message: 'Repair spare part created successfully.',
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

// GET /api/repair-parts/:id/history - Stock movement history for a spare part (Cached 60s)
router.get('/:id/history', cacheRoute(60), async (req, res, next) => {
  try {
    const partId = req.params.id;
    const partRes = await db.query('SELECT * FROM repair_parts WHERE id = $1', [partId]);
    if (partRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repair spare part not found.' });
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

// PUT /api/repair-parts/:id - Update repair part
router.put('/:id', async (req, res, next) => {
  try {
    const { code, name, category, compatibleModels, costPrice, sellingPrice, currentStock, minStockAlert, status } = req.body;
    const partId = req.params.id;

    const checkRes = await db.query('SELECT * FROM repair_parts WHERE id = $1', [partId]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repair spare part not found.' });
    }

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Spare part name is required.' });
    }

    const cleanName = name.trim();
    const cleanCategory = category ? category.trim() : 'General';
    const cleanModels = compatibleModels ? compatibleModels.trim() : null;
    const numCost = costPrice !== undefined && costPrice !== null && costPrice !== '' ? parseFloat(costPrice) : parseFloat(checkRes.rows[0].cost_price || 0);
    const numSelling = sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== '' ? parseFloat(sellingPrice) : parseFloat(checkRes.rows[0].selling_price || 0);
    const numStock = currentStock !== undefined && currentStock !== null && currentStock !== '' ? parseInt(currentStock, 10) : parseInt(checkRes.rows[0].current_stock || 0, 10);
    const numAlert = minStockAlert !== undefined && minStockAlert !== null && minStockAlert !== '' ? parseInt(minStockAlert, 10) : parseInt(checkRes.rows[0].min_stock_alert || 2, 10);
    const partStatus = status || checkRes.rows[0].status;

    let partCode = code ? code.trim() : checkRes.rows[0].code;
    if (partCode && partCode.toLowerCase() !== checkRes.rows[0].code.toLowerCase()) {
      const dupRes = await db.query('SELECT id FROM repair_parts WHERE LOWER(code) = LOWER($1) AND id != $2', [partCode, partId]);
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

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
    emitEvent('repairPart.updated', updated);

    return res.json({
      success: true,
      message: 'Repair spare part updated successfully.',
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

// PATCH /api/repair-parts/:id/stock - Adjust stock quantity
router.patch('/:id/stock', async (req, res, next) => {
  try {
    const { quantity, direction, reason } = req.body;
    const partId = req.params.id;
    const qty = parseInt(quantity || 0, 10);

    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid adjustment quantity greater than 0 is required.' });
    }

    const partRes = await db.query('SELECT * FROM repair_parts WHERE id = $1', [partId]);
    if (partRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repair spare part not found.' });
    }
    const currentStock = parseInt(partRes.rows[0].current_stock || 0, 10);

    let newStock = currentStock;
    const dirUpper = (direction || '').toUpperCase();
    if (dirUpper === 'IN' || dirUpper === 'ADD') {
      newStock += qty;
    } else if (dirUpper === 'OUT' || dirUpper === 'DEDUCT') {
      if (qty > currentStock) {
        return res.status(400).json({ success: false, message: `Cannot deduct ${qty} units. Current stock is only ${currentStock}.` });
      }
      newStock -= qty;
    } else {
      return res.status(400).json({ success: false, message: 'Direction must be IN or OUT.' });
    }

    const updateRes = await db.query(
      `UPDATE repair_parts SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [newStock, partId]
    );

    const updated = updateRes.rows[0];

    // Log stock adjustment movement
    try {
      await db.query(
        `INSERT INTO repair_parts_movements (
          part_id, part_code, part_name, direction, quantity, reason, reference_type, balance_after, performed_by, performed_by_name
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Stock Adjustment', $7, $8, $9)`,
        [
          updated.id, updated.code, updated.name, dirUpper, qty,
          reason || (dirUpper === 'IN' ? 'Stock Added / Restocked' : 'Stock Deducted / Written off'),
          newStock,
          req.user?.id || null,
          req.user?.name || 'Staff'
        ]
      );
    } catch (logErr) {
      console.error('[Spare Parts Movement] Error logging stock adjustment:', logErr.message);
    }

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
    emitEvent('repairPart.updated', updated);

    return res.json({
      success: true,
      message: `Stock adjusted to ${newStock} units.`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/repair-parts/:id/toggle - Toggle active status
router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const partId = req.params.id;
    const partRes = await db.query('SELECT * FROM repair_parts WHERE id = $1', [partId]);
    if (partRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repair spare part not found.' });
    }

    const newStatus = partRes.rows[0].status === 'Active' ? 'Inactive' : 'Active';
    const updateRes = await db.query(
      `UPDATE repair_parts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [newStatus, partId]
    );

    const updated = updateRes.rows[0];

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    emitEvent('repairPart.updated', updated);

    return res.json({
      success: true,
      message: `Spare part status set to ${newStatus}.`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repair-parts/bulk-delete - Bulk delete selected spare parts (Admin only)
router.post('/bulk-delete', requireAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one spare part to delete.' });
    }

    // Unlink from repair_parts_used so past jobs snapshot is safe
    await db.query('UPDATE repair_parts_used SET part_id = NULL WHERE part_id = ANY($1::varchar[])', [ids]);
    // Delete associated movements
    await db.query('DELETE FROM repair_parts_movements WHERE part_id = ANY($1::varchar[])', [ids]);
    // Delete spare parts
    const delRes = await db.query('DELETE FROM repair_parts WHERE id = ANY($1::varchar[]) RETURNING id', [ids]);

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
    emitEvent('repairPart.bulkDeleted', { ids });

    return res.json({
      success: true,
      message: `${delRes.rowCount || 0} spare parts deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/repair-parts/all/wipe - Delete ALL spare parts (Admin only)
router.delete('/all/wipe', requireAdmin, async (req, res, next) => {
  try {
    // Unlink from repair_parts_used
    await db.query('UPDATE repair_parts_used SET part_id = NULL');
    // Truncate spare parts movements
    await db.query('TRUNCATE TABLE repair_parts_movements CASCADE');
    // Delete all spare parts
    const delRes = await db.query('DELETE FROM repair_parts RETURNING id');

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
    emitEvent('repairPart.allDeleted', {});

    return res.json({
      success: true,
      message: `All ${delRes.rowCount || 0} spare parts have been deleted from catalog.`
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/repair-parts/:id - Delete single repair spare part
router.delete('/:id', async (req, res, next) => {
  try {
    const partId = req.params.id;

    const partRes = await db.query('SELECT * FROM repair_parts WHERE id = $1', [partId]);
    if (partRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repair spare part not found.' });
    }

    const partName = partRes.rows[0].name;

    // Unlink from repair_parts_used so job history snapshot remains intact
    await db.query('UPDATE repair_parts_used SET part_id = NULL WHERE part_id = $1', [partId]);

    // Delete movements
    await db.query('DELETE FROM repair_parts_movements WHERE part_id = $1', [partId]);

    // Delete the part
    await db.query('DELETE FROM repair_parts WHERE id = $1', [partId]);

    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/repair-parts*');
    await CacheService.invalidateBranchPattern(getBranchIdFromReq(req), '/api/reports*');
    emitEvent('repairPart.deleted', { id: partId });

    return res.json({
      success: true,
      message: `Spare part "${partName}" deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
