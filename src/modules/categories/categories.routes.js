const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin, requireSalesOrAdmin } = require('../../middleware/rbac');
const { emitEvent } = require('../../config/socket');

// GET /api/categories - All categories aggregated
router.get('/', async (req, res, next) => {
  try {
    const [prodRes, expRes, accRes] = await Promise.all([
      db.query(`
        SELECT pc.id, pc.name, pc.code_prefix, pc.is_system, pc.created_at,
               COUNT(p.id)::int AS product_count
        FROM product_categories pc
        LEFT JOIN products p ON p.category_id = pc.id
        GROUP BY pc.id, pc.name, pc.code_prefix, pc.is_system, pc.created_at
        ORDER BY pc.id ASC
      `),
      db.query('SELECT id, name FROM expense_categories ORDER BY id ASC'),
      db.query('SELECT id, name FROM accessory_categories ORDER BY name ASC')
    ]);

    return res.json({
      success: true,
      data: {
        productCategories: prodRes.rows,
        expenseCategories: expRes.rows,
        accessoryCategories: accRes.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Product Categories
router.get('/product', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT pc.id, pc.name, pc.code_prefix, pc.is_system, pc.created_at,
             COUNT(p.id)::int AS product_count
      FROM product_categories pc
      LEFT JOIN products p ON p.category_id = pc.id
      GROUP BY pc.id, pc.name, pc.code_prefix, pc.is_system, pc.created_at
      ORDER BY pc.id ASC
    `);
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
    const { name, codePrefix } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';

    // Check duplicate
    const existing = await db.query('SELECT id, name FROM product_categories WHERE LOWER(name) = LOWER($1)', [cleanName]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Category "${cleanName}" already exists in the database.`
      });
    }

    const insertRes = await db.query(
      `INSERT INTO product_categories (name, code_prefix, is_system) VALUES ($1, $2, FALSE) RETURNING id, name, code_prefix, is_system`,
      [cleanName, prefix]
    );

    const newCategory = { ...insertRes.rows[0], product_count: 0 };
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
    const { id } = req.params;
    const { name, codePrefix } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Category name is required.'
      });
    }

    const cleanName = String(name).trim();
    const prefix = codePrefix ? String(codePrefix).trim().toUpperCase() : cleanName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';

    // Check duplicate with different ID
    const existing = await db.query('SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1) AND id != $2', [cleanName, id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_EXISTS',
        message: `Category "${cleanName}" already exists.`
      });
    }

    const updated = await db.query(
      `UPDATE product_categories SET name = $1, code_prefix = $2 WHERE id = $3 RETURNING id, name, code_prefix, is_system`,
      [cleanName, prefix, id]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found.'
      });
    }

    // Update category_name in products table
    await db.query('UPDATE products SET category_name = $1 WHERE category_id = $2', [cleanName, id]);

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
    const { id } = req.params;

    const catRes = await db.query('SELECT * FROM product_categories WHERE id = $1', [id]);
    if (catRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found.'
      });
    }

    const category = catRes.rows[0];
    if (category.is_system) {
      return res.status(400).json({
        success: false,
        code: 'SYSTEM_CATEGORY',
        message: `System default category "${category.name}" cannot be deleted.`
      });
    }

    // Check if category is used in products
    const inUse = await db.query('SELECT COUNT(*)::int as count FROM products WHERE category_id = $1', [id]);
    const count = inUse.rows[0].count;
    if (count > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: `Cannot delete "${category.name}" because it is currently assigned to ${count} product(s).`
      });
    }

    await db.query('DELETE FROM product_categories WHERE id = $1', [id]);
    emitEvent('categories.product_deleted', { id: parseInt(id, 10) });

    return res.json({
      success: true,
      message: `Category "${category.name}" deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

// Expense Categories
router.get('/expense', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name FROM expense_categories ORDER BY id ASC');
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
      `INSERT INTO expense_categories (name) VALUES ($1) RETURNING id, name`,
      [cleanName]
    );

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
    const { id } = req.params;

    const inUse = await db.query('SELECT id FROM expenses WHERE category_id = $1 LIMIT 1', [id]);
    if (inUse.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: 'This category is already referenced by recorded expenses.'
      });
    }

    await db.query('DELETE FROM expense_categories WHERE id = $1', [id]);
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
router.get('/accessory', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name FROM accessory_categories ORDER BY name ASC');
    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
