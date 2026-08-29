const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const RepairService = require('./repairs.service');
const authenticateToken = require('../../middleware/auth');
const { requireSalesOrAdmin, requireTechnicianOrAdmin } = require('../../middleware/rbac');
const { CacheService, cacheRoute } = require('../../config/cache');

router.use(authenticateToken);

// GET /api/repairs - List repair jobs (Cached 60s)
router.get('/', cacheRoute(60), async (req, res, next) => {
  try {
    const { search, status, technicianId, customerId, jobType, categoryId, from, to } = req.query;
    let queryText = 'SELECT * FROM repair_jobs WHERE 1=1';
    const params = [];

    // If Technician, restrict to assigned jobs
    if (req.user.role === 'technician') {
      params.push(req.user.id);
      queryText += ` AND technician_id = $${params.length}`;
    } else if (technicianId) {
      params.push(technicianId);
      queryText += ` AND technician_id = $${params.length}`;
    }

    if (customerId) {
      params.push(customerId);
      queryText += ` AND customer_id = $${params.length}`;
    }

    if (jobType) {
      params.push(jobType);
      queryText += ` AND job_type = $${params.length}`;
    }

    if (categoryId) {
      params.push(categoryId);
      queryText += ` AND category_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      queryText += ` AND status = $${params.length}`;
    }

    if (from) {
      params.push(from);
      queryText += ` AND date >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      queryText += ` AND date <= $${params.length}`;
    }

    if (search && String(search).trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (
        LOWER(tracking_id) LIKE $${params.length} OR
        LOWER(customer_name) LIKE $${params.length} OR
        LOWER(contact) LIKE $${params.length} OR
        LOWER(COALESCE(category_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(brand, '')) LIKE $${params.length} OR
        LOWER(COALESCE(model, '')) LIKE $${params.length} OR
        LOWER(problem) LIKE $${params.length}
      )`;
    }

    queryText += ' ORDER BY date DESC, created_at DESC';

    const result = await db.query(queryText, params);
    const isTech = req.user.role === 'technician';

    return res.json({
      success: true,
      data: result.rows.map(job => ({
        id: job.id,
        trackingId: job.tracking_id,
        jobType: job.job_type,
        originJobType: job.origin_job_type,
        date: job.date,
        customerId: job.customer_id,
        customerName: job.customer_name,
        contact: job.contact,
        technicianId: job.technician_id,
        technicianName: job.technician_name || 'Unassigned',
        priority: job.priority,
        categoryId: job.category_id,
        categoryName: job.category_name,
        productType: job.product_type,
        brand: job.brand,
        model: job.model,
        serial: job.serial,
        problem: job.problem,
        diagnosisFee: isTech ? null : parseFloat(job.diagnosis_fee || 0),
        extraCharges: isTech ? null : parseFloat(job.extra_charges || 0),
        total: isTech ? null : parseFloat(job.total || 0),
        paid: isTech ? null : parseFloat(job.paid || 0),
        remaining: isTech ? null : Math.max(0, parseFloat(job.total || 0) - parseFloat(job.paid || 0)),
        paymentMethod: isTech ? null : job.payment_method,
        status: job.status,
        duration: job.duration,
        expectedCompletion: job.expected_completion,
        approvalStatus: job.approval_status,
        quotationAmount: isTech ? null : parseFloat(job.quotation_amount || 0),
        diagnosedIssue: job.diagnosed_issue,
        recommendedSolution: job.recommended_solution,
        technicalNotes: job.technical_notes,
        finalRemarks: job.final_remarks,
        workProgress: parseInt(job.work_progress || 0, 10),
        invoiceId: isTech ? null : job.invoice_id,
        createdAt: job.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repairs/:id - Full job card details (Cached 60s)
router.get('/:id', cacheRoute(60), async (req, res, next) => {
  try {
    const jobDetails = await RepairService.getJobDetails(req.params.id, req.user.role);
    if (!jobDetails) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Repair job not found.'
      });
    }

    // Role check: Technician can only view assigned jobs
    if (req.user.role === 'technician' && jobDetails.technicianId !== req.user.id) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You can only view repair jobs assigned to you.'
      });
    }

    return res.json({
      success: true,
      data: jobDetails
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repairs - Create repair job (Admin/Sales)
router.post('/', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await RepairService.createJob(req.body, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/customers*');

    return res.status(201).json({
      success: true,
      message: 'Repair job created successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repairs/:id/technical-update - Technician workbench update
router.put('/:id/technical-update', requireTechnicianOrAdmin, async (req, res, next) => {
  try {
    const result = await RepairService.technicalUpdate(req.params.id, req.body, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');

    return res.json({
      success: true,
      message: 'Technical update saved successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repairs/:id/admin-update - Reception/Admin update
router.put('/:id/admin-update', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, technicianId, expectedCompletion, priority, finalRemarks, updateNote } = req.body;

    const result = await db.withTransaction(async (client) => {
      let techName = null;
      if (technicianId) {
        const tRes = await client.query('SELECT name FROM users WHERE id = $1', [technicianId]);
        if (tRes.rows.length > 0) techName = tRes.rows[0].name;
      }

      const updateRes = await client.query(
        `UPDATE repair_jobs SET
          status = COALESCE($1, status),
          technician_id = COALESCE($2, technician_id),
          technician_name = COALESCE($3, technician_name),
          expected_completion = COALESCE($4, expected_completion),
          priority = COALESCE($5, priority),
          final_remarks = COALESCE($6, final_remarks),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [status || null, technicianId || null, techName, expectedCompletion || null, priority || null, finalRemarks ? finalRemarks.trim() : null, id]
      );

      if (updateRes.rows.length === 0) {
        const error = new Error('Repair job not found.');
        error.status = 404;
        throw error;
      }

      if (updateNote) {
        await client.query(
          `INSERT INTO repair_status_history (repair_job_id, status, note, performed_by, performed_by_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, updateRes.rows[0].status, updateNote.trim(), req.user.id, req.user.name]
        );
      }

      await RepairService.syncLinkedInvoice(id, client);
      await RepairService.sendAutomatedWhatsapp(updateRes.rows[0], finalRemarks || updateNote || 'Job status updated', client);

      return updateRes.rows[0];
    });

    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');

    return res.json({
      success: true,
      message: 'Repair job updated successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repairs/:id/approve - Approve quotation
router.post('/:id/approve', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await RepairService.approveQuote(req.params.id, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');

    return res.json({
      success: true,
      message: 'Quotation approved and repair started',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repairs/:id/decline - Decline quotation
router.post('/:id/decline', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await RepairService.declineQuote(req.params.id, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');

    return res.json({
      success: true,
      message: 'Quotation declined',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repairs/:id/collect-payment - Collect advance / installment payment
router.post('/:id/collect-payment', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await RepairService.collectPayment(req.params.id, req.body, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/invoices*');

    return res.json({
      success: true,
      message: 'Payment collected successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repairs/:id/deliver - Atomic Pay & Deliver
router.post('/:id/deliver', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await RepairService.payAndDeliver(req.params.id, req.body, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/invoices*');

    return res.json({
      success: true,
      message: 'Product delivered and repair closed',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repairs/:id/parts - Issue a spare part to repair job
router.post('/:id/parts', async (req, res, next) => {
  try {
    const result = await RepairService.addUsedPart(req.params.id, req.body, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/dashboard*');

    return res.json({
      success: true,
      message: 'Spare part issued successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repairs/:id/parts/:partUsedId - Update an issued spare part
router.put('/:id/parts/:partUsedId', async (req, res, next) => {
  try {
    const result = await RepairService.updateUsedPart(req.params.id, req.params.partUsedId, req.body, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/products*');

    return res.json({
      success: true,
      message: 'Issued spare part updated successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/repairs/:id/parts/:partUsedId - Remove an issued spare part and restore stock
router.delete('/:id/parts/:partUsedId', async (req, res, next) => {
  try {
    const result = await RepairService.removeUsedPart(req.params.id, req.params.partUsedId, req.user);
    await CacheService.invalidatePattern('route:/api/repairs*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/dashboard*');

    return res.json({
      success: true,
      message: 'Spare part removed and stock restored to inventory',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
