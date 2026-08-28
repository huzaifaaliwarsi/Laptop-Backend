const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { validateOutflow } = require('../../utils/financialFormulas');
const { emitEvent } = require('../../config/socket');

router.use(authenticateToken);

// GET /api/expenses - List expenses with role scoping
router.get('/', async (req, res, next) => {
  try {
    const { from, to, categoryId, categoryName, paymentMethod, staffId } = req.query;
    let queryText = `
      SELECT e.*, ec.name as category_name_rel
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE 1=1
    `;
    const params = [];

    // Role-scoping: non-admins only see their own entries
    if (req.user.role !== 'admin') {
      params.push(req.user.id);
      queryText += ` AND e.created_by = $${params.length}`;
    } else if (staffId) {
      params.push(staffId);
      queryText += ` AND e.created_by = $${params.length}`;
    }

    if (from) {
      params.push(from);
      queryText += ` AND e.date >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      queryText += ` AND e.date <= $${params.length}`;
    }

    if (categoryId) {
      params.push(categoryId);
      queryText += ` AND e.category_id = $${params.length}`;
    } else if (categoryName) {
      params.push(categoryName);
      queryText += ` AND e.category_name = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      queryText += ` AND e.payment_method = $${params.length}`;
    }

    queryText += ' ORDER BY e.date DESC, e.created_at DESC';

    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(exp => ({
        id: exp.id,
        date: exp.date,
        categoryId: exp.category_id,
        category: exp.category_name,
        description: exp.description,
        amount: parseFloat(exp.amount || 0),
        paymentMethod: exp.payment_method,
        referenceId: exp.reference_id,
        linkedTrackingId: exp.linked_tracking_id,
        createdById: exp.created_by,
        createdByName: exp.created_by_name,
        createdAt: exp.created_at,
        updatedAt: exp.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/expenses - Create expense
router.post('/', async (req, res, next) => {
  try {
    const { category, categoryId: reqCatId, description, amount: reqAmount, paymentMethod, referenceId, linkedTrackingId, date } = req.body;

    const amount = parseFloat(reqAmount || 0);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_AMOUNT',
        message: 'Expense amount must be greater than zero.'
      });
    }

    if (!description || String(description).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_DESCRIPTION',
        message: 'Expense description is required.'
      });
    }

    const pMethod = paymentMethod || 'Cash';

    // Validate available Cash/Online balance
    await validateOutflow(pMethod, amount, 'Operating Expense');

    let categoryId = reqCatId;
    let categoryName = category;

    if (!categoryId && categoryName) {
      const catRes = await db.query('SELECT id, name FROM expense_categories WHERE LOWER(name) = LOWER($1)', [categoryName.trim()]);
      if (catRes.rows.length > 0) {
        categoryId = catRes.rows[0].id;
        categoryName = catRes.rows[0].name;
      }
    } else if (categoryId && !categoryName) {
      const catRes = await db.query('SELECT name FROM expense_categories WHERE id = $1', [categoryId]);
      if (catRes.rows.length > 0) {
        categoryName = catRes.rows[0].name;
      }
    }

    const expId = await getNextEntityId('expenses', 'id', 'EXP', 5);

    const insertRes = await db.query(
      `INSERT INTO expenses (
        id, date, category_id, category_name, description, amount, payment_method,
        reference_id, linked_tracking_id, created_by, created_by_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        expId,
        date || new Date(),
        categoryId || null,
        categoryName || 'Other',
        description.trim(),
        amount,
        pMethod,
        referenceId ? referenceId.trim() : null,
        linkedTrackingId ? linkedTrackingId.trim() : null,
        req.user.id,
        req.user.name
      ]
    );

    emitEvent('expense.created', insertRes.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      data: insertRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/expenses/:id - Update expense
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category, categoryId: reqCatId, description, amount: reqAmount, paymentMethod, referenceId, linkedTrackingId, date } = req.body;

    const existingRes = await db.query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Expense not found.'
      });
    }

    const existing = existingRes.rows[0];

    // Non-admins can only edit their own entries
    if (req.user.role !== 'admin' && existing.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You can only edit your own expense entries.'
      });
    }

    const amount = parseFloat(reqAmount || existing.amount);
    const pMethod = paymentMethod || existing.payment_method;

    let categoryId = reqCatId || existing.category_id;
    let categoryName = category || existing.category_name;

    const updateRes = await db.query(
      `UPDATE expenses SET
        date = COALESCE($1, date),
        category_id = $2,
        category_name = $3,
        description = COALESCE($4, description),
        amount = $5,
        payment_method = $6,
        reference_id = $7,
        linked_tracking_id = $8,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        date || null,
        categoryId,
        categoryName,
        description ? description.trim() : null,
        amount,
        pMethod,
        referenceId !== undefined ? (referenceId ? referenceId.trim() : null) : existing.reference_id,
        linkedTrackingId !== undefined ? (linkedTrackingId ? linkedTrackingId.trim() : null) : existing.linked_tracking_id,
        id
      ]
    );

    emitEvent('expense.updated', updateRes.rows[0]);

    return res.json({
      success: true,
      message: 'Expense updated successfully',
      data: updateRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/expenses/:id - Delete expense
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingRes = await db.query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Expense not found.'
      });
    }

    if (req.user.role !== 'admin' && existingRes.rows[0].created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You can only delete your own expense entries.'
      });
    }

    await db.query('DELETE FROM expenses WHERE id = $1', [id]);
    emitEvent('expense.deleted', { id });

    return res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
