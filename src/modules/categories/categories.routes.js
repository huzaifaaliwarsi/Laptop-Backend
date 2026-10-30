const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin, requireSalesOrAdmin } = require('../../middleware/rbac');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute, getBranchIdFromReq } = require('../../config/cache');

// GET /api/categories - All categories aggregated (Cached 300s)
router.get('/', cacheRoute(300), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const [prodRes, expRes, accRes, repRes] = await Promise.all([
      db.query(`
        SELECT pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at,
               COUNT(p.id)::int AS product_count
        FROM product_categories pc
        LEFT JOIN products p ON (p.category_id = pc.id OR LOWER(p.category_name) = LOWER(pc.name)) AND p.branch_id = $1
        WHERE pc.branch_id = $1
        GROUP BY pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at
        ORDER BY pc.id ASC
      `, [bId]),
      db.query('SELECT id, name FROM expense_categories WHERE branch_id = $1 ORDER BY id ASC', [bId]),
      db.query('SELECT id, name FROM accessory_categories WHERE branch_id = $1 ORDER BY name ASC', [bId]),
      db.query(`
        SELECT rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at,
               COUNT(rj.id)::int AS repair_count
        FROM repair_categories rc
        LEFT JOIN repair_jobs rj ON rj.category_id = rc.id AND rj.branch_id = $1
        WHERE rc.branch_id = $1
        GROUP BY rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at
        ORDER BY rc.id ASC
      `, [bId])
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

// Product Categories
router.get('/product', cacheRoute(300), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const result = await db.query(`
      SELECT pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at,
             COUNT(p.id)::int AS product_count
      FROM product_categories pc
      LEFT JOIN products p ON (p.category_id = pc.id OR LOWER(p.category_name) = LOWER(pc.name)) AND p.branch_id = $1
      WHERE pc.branch_id = $1
      GROUP BY pc.id, pc.name, pc.code_prefix, pc.is_system, pc.custom_fields, pc.created_at
      ORDER BY pc.id ASC
    `, [bId]);
    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post('/product', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { name, codePrefix, customFields } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';
    const fieldsJson = JSON.stringify(Array.isArray(customFields) ? customFields : []);

    // Check duplicate in same branch
    const existing = await db.query('SELECT id, name FROM product_categories WHERE LOWER(name) = LOWER($1) AND branch_id = $2', [cleanName, bId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Category "${cleanName}" already exists in the database.`
      });
    }

    const insertRes = await db.query(
      `INSERT INTO product_categories (name, code_prefix, is_system, custom_fields, branch_id) VALUES ($1, $2, FALSE, $3::jsonb, $4) RETURNING id, name, code_prefix, is_system, custom_fields, branch_id`,
      [cleanName, prefix, fieldsJson, bId]
    );

    const newCategory = { ...insertRes.rows[0], product_count: 0 };
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.product_added', newCategory);

    return res.status(201).json({
      success: true,
      message: `Category "${cleanName}" created and saved to database successfully`,
      data: newCategory
    });
  } catch (error) {
    next(error);
  }
});

router.put('/product/:id', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;
    const { name, codePrefix, customFields } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';

    // Check duplicate with different ID in same branch
    const existing = await db.query('SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1) AND id != $2 AND branch_id = $3', [cleanName, id, bId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Category "${cleanName}" already exists.`
      });
    }

    let updated;
    if (customFields !== undefined) {
      const fieldsJson = JSON.stringify(Array.isArray(customFields) ? customFields : []);
      updated = await db.query(
        `UPDATE product_categories SET name = $1, code_prefix = $2, custom_fields = $3::jsonb WHERE id = $4 AND branch_id = $5 RETURNING id, name, code_prefix, is_system, custom_fields, branch_id`,
        [cleanName, prefix, fieldsJson, id, bId]
      );
    } else {
      updated = await db.query(
        `UPDATE product_categories SET name = $1, code_prefix = $2 WHERE id = $3 AND branch_id = $4 RETURNING id, name, code_prefix, is_system, custom_fields, branch_id`,
        [cleanName, prefix, id, bId]
      );
    }

    if (updated.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found.'
      });
    }

    // Update category_name in products table
    await db.query('UPDATE products SET category_name = $1 WHERE category_id = $2 AND branch_id = $3', [cleanName, id, bId]);

    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    await CacheService.invalidateBranchPattern(bId, '/api/products*');
    emitEvent('categories.product_updated', updated.rows[0]);

    return res.json({
      success: true,
      message: 'Category updated successfully',
      data: updated.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/product/:id', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;

    const catRes = await db.query('SELECT * FROM product_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    if (catRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found.'
      });
    }

    const category = catRes.rows[0];

    // Check if category is used in products
    const inUse = await db.query(
      'SELECT COUNT(*)::int as count FROM products WHERE (category_id = $1 OR LOWER(category_name) = LOWER($2)) AND branch_id = $3',
      [id, category.name, bId]
    );
    const count = inUse.rows[0].count;
    if (count > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: `Cannot delete "${category.name}" because it is currently assigned to ${count} product(s).`
      });
    }

    await db.query('DELETE FROM product_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.product_deleted', { id: parseInt(id, 10), name: category.name });

    return res.json({
      success: true,
      message: `Category "${category.name}" deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

// Spare Part Categories
router.get('/spare-parts', cacheRoute(300), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const result = await db.query(`
      SELECT spc.id, spc.name, spc.code_prefix, spc.is_system, spc.created_at,
             COUNT(rp.id)::int AS part_count
      FROM spare_part_categories spc
      LEFT JOIN repair_parts rp ON LOWER(rp.category) = LOWER(spc.name) AND rp.branch_id = $1
      WHERE spc.branch_id = $1
      GROUP BY spc.id, spc.name, spc.code_prefix, spc.is_system, spc.created_at
      ORDER BY spc.id ASC
    `, [bId]);
    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post('/spare-parts', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { name, codePrefix } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Spare part category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRT';

    const existing = await db.query('SELECT id, name FROM spare_part_categories WHERE LOWER(name) = LOWER($1) AND branch_id = $2', [cleanName, bId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Category "${cleanName}" already exists.`
      });
    }

    const insertRes = await db.query(
      `INSERT INTO spare_part_categories (name, code_prefix, is_system, branch_id) VALUES ($1, $2, FALSE, $3) RETURNING id, name, code_prefix, is_system, branch_id`,
      [cleanName, prefix, bId]
    );

    const newCategory = { ...insertRes.rows[0], part_count: 0 };
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.spare_part_added', newCategory);

    return res.status(201).json({
      success: true,
      message: `Spare part category "${cleanName}" created successfully`,
      data: newCategory
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/spare-parts/:id', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;
    const catRes = await db.query('SELECT * FROM spare_part_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    if (catRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Spare part category not found.'
      });
    }

    const category = catRes.rows[0];
    const inUse = await db.query('SELECT COUNT(*)::int as count FROM repair_parts WHERE LOWER(category) = LOWER($1) AND branch_id = $2', [category.name, bId]);
    const count = inUse.rows[0].count;
    if (count > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: `Cannot delete category "${category.name}" because it is linked to ${count} spare part(s).`
      });
    }

    await db.query('DELETE FROM spare_part_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.spare_part_deleted', { id: parseInt(id, 10), name: category.name });

    return res.json({
      success: true,
      message: `Spare part category "${category.name}" deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

// Expense Categories
router.get('/expense', cacheRoute(300), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const result = await db.query('SELECT id, name FROM expense_categories WHERE branch_id = $1 ORDER BY id ASC', [bId]);
    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post('/expense', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { name } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Expense category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const insertRes = await db.query(
      `INSERT INTO expense_categories (name, branch_id) VALUES ($1, $2) RETURNING id, name, branch_id`,
      [cleanName, bId]
    );

    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.expense_added', insertRes.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Expense category added successfully',
      data: insertRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/expense/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;

    const inUse = await db.query('SELECT id FROM expenses WHERE category_id = $1 AND branch_id = $2 LIMIT 1', [id, bId]);
    if (inUse.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: 'This category is already referenced by recorded expenses.'
      });
    }

    await db.query('DELETE FROM expense_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.expense_deleted', { id: parseInt(id, 10) });

    return res.json({
      success: true,
      message: 'Expense category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Accessory Categories
router.get('/accessory', cacheRoute(300), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const result = await db.query('SELECT id, name FROM accessory_categories WHERE branch_id = $1 ORDER BY name ASC', [bId]);
    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post('/accessory', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { name } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ success: false, code: 'MISSING_NAME', message: 'Category name is required.' });
    }
    const cleanName = String(name).trim();
    const insertRes = await db.query(
      `INSERT INTO accessory_categories (name, branch_id) VALUES ($1, $2) RETURNING id, name, branch_id`,
      [cleanName, bId]
    );
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    return res.status(201).json({ success: true, message: 'Accessory category added', data: insertRes.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete('/accessory/:id', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;
    await db.query('DELETE FROM accessory_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    return res.json({ success: true, message: 'Accessory category deleted' });
  } catch (error) {
    next(error);
  }
});

// Repair Categories
router.get('/repair', cacheRoute(120), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { activeOnly } = req.query;
    let queryText = `
      SELECT rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at,
             COUNT(rj.id)::int AS repair_count
      FROM repair_categories rc
      LEFT JOIN repair_jobs rj ON rj.category_id = rc.id AND rj.branch_id = $1
      WHERE rc.branch_id = $1
    `;
    const params = [bId];

    if (activeOnly === 'true' || activeOnly === true) {
      params.push(true);
      queryText += ` AND rc.is_active = $${params.length}`;
    }

    queryText += `
      GROUP BY rc.id, rc.name, rc.description, rc.is_active, rc.created_at, rc.updated_at
      ORDER BY rc.id ASC
    `;

    const result = await db.query(queryText, params);
    return res.json({
      success: true,
      data: result.rows.map(r => ({
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

router.post('/repair', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { name, description, isActive } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Repair category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const cleanDesc = description ? String(description).trim() : null;
    const active = isActive !== undefined ? Boolean(isActive) : true;

    // Check duplicate in same branch
    const existing = await db.query('SELECT id, name FROM repair_categories WHERE LOWER(name) = LOWER($1) AND branch_id = $2', [cleanName, bId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Repair category "${cleanName}" already exists in the database.`
      });
    }

    const insertRes = await db.query(
      `INSERT INTO repair_categories (name, description, is_active, branch_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, is_active, created_at, updated_at, branch_id`,
      [cleanName, cleanDesc, active, bId]
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

    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.repair_added', newCategory);

    return res.status(201).json({
      success: true,
      message: `Repair category "${cleanName}" created successfully`,
      data: newCategory
    });
  } catch (error) {
    next(error);
  }
});

router.put('/repair/:id', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Repair category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const cleanDesc = description !== undefined ? (description ? String(description).trim() : null) : undefined;
    const active = isActive !== undefined ? Boolean(isActive) : undefined;

    const existing = await db.query('SELECT id FROM repair_categories WHERE LOWER(name) = LOWER($1) AND id != $2 AND branch_id = $3', [cleanName, id, bId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Repair category "${cleanName}" already exists.`
      });
    }

    const updateRes = await db.query(
      `UPDATE repair_categories SET
        name = $1,
        description = COALESCE($2, description),
        is_active = COALESCE($3, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND branch_id = $5
       RETURNING id, name, description, is_active, created_at, updated_at, branch_id`,
      [cleanName, cleanDesc, active, id, bId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Repair category not found.'
      });
    }

    await db.query('UPDATE repair_jobs SET category_name = $1 WHERE category_id = $2 AND branch_id = $3', [cleanName, id, bId]);

    const updatedCat = {
      id: updateRes.rows[0].id,
      name: updateRes.rows[0].name,
      description: updateRes.rows[0].description,
      isActive: updateRes.rows[0].is_active,
      createdAt: updateRes.rows[0].created_at,
      updatedAt: updateRes.rows[0].updated_at
    };

    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.repair_updated', updatedCat);

    return res.json({
      success: true,
      message: 'Repair category updated successfully',
      data: updatedCat
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/repair/:id/toggle', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;
    const catRes = await db.query('SELECT id, is_active FROM repair_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    if (catRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Repair category not found.'
      });
    }

    const newStatus = !catRes.rows[0].is_active;
    const updateRes = await db.query(
      `UPDATE repair_categories SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND branch_id = $3 RETURNING *`,
      [newStatus, id, bId]
    );

    const updatedCat = {
      id: updateRes.rows[0].id,
      name: updateRes.rows[0].name,
      description: updateRes.rows[0].description,
      isActive: updateRes.rows[0].is_active,
      createdAt: updateRes.rows[0].created_at,
      updatedAt: updateRes.rows[0].updated_at
    };

    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.repair_updated', updatedCat);

    return res.json({
      success: true,
      message: `Repair category marked ${newStatus ? 'active' : 'inactive'}`,
      data: updatedCat
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/repair/:id', authenticateToken, requireSalesOrAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const { id } = req.params;
    const catRes = await db.query('SELECT * FROM repair_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    if (catRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Repair category not found.'
      });
    }

    const category = catRes.rows[0];

    const inUse = await db.query('SELECT COUNT(*)::int as count FROM repair_jobs WHERE category_id = $1 AND branch_id = $2', [id, bId]);
    const count = inUse.rows[0].count;
    if (count > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: `Cannot delete category "${category.name}" because it is assigned to ${count} repair job(s). You can mark it inactive instead.`
      });
    }

    await db.query('DELETE FROM repair_categories WHERE id = $1 AND branch_id = $2', [id, bId]);
    await CacheService.invalidateBranchPattern(bId, '/api/categories*');
    emitEvent('categories.repair_deleted', { id: parseInt(id, 10) });

    return res.json({
      success: true,
      message: `Repair category "${category.name}" deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
