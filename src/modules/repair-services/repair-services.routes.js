const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');

router.use(authenticateToken);

// GET /api/repair-services - List repair services
router.get('/', async (req, res, next) => {
  try {
    const { status, type } = req.query;
    let queryText = 'SELECT * FROM repair_services WHERE 1=1';
    const params = [];

    if (status) {
      params.push(status);
      queryText += ` AND status = $${params.length}`;
    } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && !req.user.isSuperAdmin) {
      queryText += " AND status = 'Active'";
    }

    if (type) {
      params.push(type.toLowerCase());
      queryText += ` AND LOWER(COALESCE(service_type, 'repair')) = $${params.length}`;
    }

    queryText += ' ORDER BY id ASC';
    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(s => ({
        id: s.id,
        code: s.code,
        name: s.name,
        charges: parseFloat(s.charges || 0),
        duration: s.duration,
        conditions: s.conditions,
        status: s.status,
        serviceType: s.service_type || 'repair',
        createdAt: s.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repair-services - Create repair service (Admin, Sales & Technician)
router.post('/', async (req, res, next) => {
  try {
    const { name, charges, duration, conditions, status, serviceType } = req.body;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Service name is required.'
      });
    }

    const srvId = await getNextEntityId('repair_services', 'id', 'SRV', 4);
    const cost = parseFloat(charges || 0);
    const sType = serviceType && String(serviceType).toLowerCase() === 'diagnosis' ? 'diagnosis' : 'repair';

    const insertRes = await db.query(
      `INSERT INTO repair_services (id, code, name, charges, duration, conditions, status, service_type)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        srvId,
        name.trim(),
        cost,
        duration ? duration.trim() : null,
        conditions ? conditions.trim() : null,
        status || 'Active',
        sType
      ]
    );

    emitEvent('repair_services.created', insertRes.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Repair service added successfully',
      data: {
        ...insertRes.rows[0],
        charges: parseFloat(insertRes.rows[0].charges || 0),
        serviceType: insertRes.rows[0].service_type || 'repair'
      }
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repair-services/:id - Update repair service (Admin only)
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, charges, duration, conditions, status, serviceType } = req.body;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_NAME',
        message: 'Service name is required.'
      });
    }

    const sType = serviceType ? (String(serviceType).toLowerCase() === 'diagnosis' ? 'diagnosis' : 'repair') : null;

    const updateRes = await db.query(
      `UPDATE repair_services SET
        name = $1,
        charges = $2,
        duration = $3,
        conditions = $4,
        status = COALESCE($5, status),
        service_type = COALESCE($6, service_type)
       WHERE id = $7
       RETURNING *`,
      [
        name.trim(),
        parseFloat(charges || 0),
        duration ? duration.trim() : null,
        conditions ? conditions.trim() : null,
        status || 'Active',
        sType,
        id
      ]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Repair service not found.'
      });
    }

    emitEvent('repair_services.updated', updateRes.rows[0]);

    return res.json({
      success: true,
      message: 'Repair service updated successfully',
      data: {
        ...updateRes.rows[0],
        charges: parseFloat(updateRes.rows[0].charges || 0),
        serviceType: updateRes.rows[0].service_type || 'repair'
      }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/repair-services/:id/toggle - Toggle status (Admin only)
router.patch('/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const srvRes = await db.query('SELECT status FROM repair_services WHERE id = $1', [id]);
    if (srvRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Repair service not found.'
      });
    }

    const currentStatus = srvRes.rows[0].status;
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';

    const updateRes = await db.query(
      'UPDATE repair_services SET status = $1 WHERE id = $2 RETURNING *',
      [newStatus, id]
    );

    emitEvent('repair_services.status_changed', updateRes.rows[0]);

    return res.json({
      success: true,
      message: `Repair service marked ${newStatus.toLowerCase()}`,
      data: updateRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/repair-services/:id - Delete service (Admin only)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const inUse = await db.query('SELECT id FROM repair_job_lines WHERE service_id = $1 LIMIT 1', [id]);
    if (inUse.rows.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'SERVICE_IN_USE',
        message: 'This repair service is used in historical repair jobs and cannot be deleted. Deactivate it instead.'
      });
    }

    await db.query('DELETE FROM repair_services WHERE id = $1', [id]);
    emitEvent('repair_services.deleted', { id });

    return res.json({
      success: true,
      message: 'Repair service deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
