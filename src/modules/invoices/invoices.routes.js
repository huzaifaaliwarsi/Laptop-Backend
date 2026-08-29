const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const InvoiceService = require('./invoices.service');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin, requireSalesOrAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute } = require('../../config/cache');

router.use(authenticateToken);

// GET /api/invoices - Query invoices with filters (Cached 60s)
router.get('/', cacheRoute(60), async (req, res, next) => {
  try {
    const { search, type, status, from, to, page, limit } = req.query;
    let queryText = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];

    // Role scoping: Sales staff only see their own invoices if requested
    if (req.user.role === 'sales') {
      // In sales purchases page they see all, or scoped
    }

    if (search && String(search).trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (
        LOWER(invoice_no) LIKE $${params.length} OR
        LOWER(party_name) LIKE $${params.length} OR
        LOWER(COALESCE(contact, '')) LIKE $${params.length}
      )`;
    }

    if (type) {
      params.push(type);
      queryText += ` AND (type = $${params.length} OR type_key = $${params.length})`;
    }

    if (status) {
      params.push(status);
      if (status === 'Voided') {
        queryText += ` AND is_voided = TRUE`;
      } else {
        queryText += ` AND payment_status = $${params.length} AND is_voided = FALSE`;
      }
    }

    if (from) {
      params.push(from);
      queryText += ` AND date >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      queryText += ` AND date <= $${params.length}`;
    }

    queryText += ' ORDER BY date DESC, created_at DESC';

    if (limit) {
      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit, 10);
      const offset = (pageNum - 1) * limitNum;
      params.push(limitNum);
      queryText += ` LIMIT $${params.length}`;
      params.push(offset);
      queryText += ` OFFSET $${params.length}`;
    }

    const result = await db.query(queryText, params);

    return res.json({
      success: true,
      data: result.rows.map(inv => ({
        id: inv.id,
        invoiceNo: inv.invoice_no,
        type: inv.type,
        typeKey: inv.type_key,
        date: inv.date,
        partyType: inv.party_type,
        partyId: inv.party_id,
        partyName: inv.party_name,
        contact: inv.contact,
        exchangeCase: inv.exchange_case,
        productTotal: parseFloat(inv.product_total || 0),
        serviceTotal: parseFloat(inv.service_total || 0),
        total: parseFloat(inv.total || 0),
        paid: parseFloat(inv.paid || 0),
        initialPaid: parseFloat(inv.initial_paid || 0),
        creditAdjusted: parseFloat(inv.credit_adjusted || 0),
        balance: parseFloat(inv.balance || 0),
        paymentMethod: inv.payment_method,
        referenceId: inv.reference_id,
        paymentStatus: inv.payment_status,
        isVoided: inv.is_voided,
        voidDate: inv.void_date,
        voidReason: inv.void_reason,
        refundAmount: parseFloat(inv.refund_amount || 0),
        createdById: inv.created_by,
        createdByName: inv.created_by_name,
        createdAt: inv.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pos/sale - Create POS sale
router.post('/sale', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.createSale(req.body, req.user);
    await CacheService.invalidatePattern('route:/api/invoices*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/customers*');
    return res.status(201).json({
      success: true,
      message: 'Sales invoice completed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pos/customer-purchase - Customer trade-in buyback
router.post('/customer-purchase', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.createCustomerPurchase(req.body, req.user);
    await CacheService.invalidatePattern('route:/api/invoices*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/customers*');
    return res.status(201).json({
      success: true,
      message: 'Customer purchase invoice completed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pos/vendor-purchase - Vendor stock receiving (Admin only)
router.post('/vendor-purchase', requireAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.createVendorPurchase(req.body, req.user);
    await CacheService.invalidatePattern('route:/api/invoices*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/vendors*');
    return res.status(201).json({
      success: true,
      message: 'Vendor purchase completed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pos/exchange - Product exchange
router.post('/exchange', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.createExchange(req.body, req.user);
    await CacheService.invalidatePattern('route:/api/invoices*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/customers*');
    return res.status(201).json({
      success: true,
      message: 'Product exchange completed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/vendors/return - Vendor return & settlement (Admin only)
router.post('/vendor-return', requireAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.createVendorReturn(req.body, req.user);
    await CacheService.invalidatePattern('route:/api/invoices*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/vendors*');
    return res.status(201).json({
      success: true,
      message: 'Vendor return recorded successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Held Bills Endpoints (MUST be before /:id wildcard)
router.get('/held-bills', requireSalesOrAdmin, async (req, res, next) => {
  try {
    let query = `SELECT * FROM held_bills`;
    const params = [];

    if (req.user.role !== 'admin') {
      query += ` WHERE created_by = $1`;
      params.push(req.user.id);
    }
    query += ` ORDER BY updated_at DESC`;

    const result = await db.query(query, params);
    return res.json({
      success: true,
      data: result.rows.map(b => ({
        id: b.id,
        type: b.type,
        label: b.label,
        partyName: b.party_name,
        total: parseFloat(b.total || 0),
        payload: b.payload,
        createdById: b.created_by,
        createdByName: b.created_by_name,
        createdAt: b.created_at,
        updatedAt: b.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post('/held-bills', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { id, type, label, partyName, total, payload } = req.body;
    let holdId = id;

    if (!holdId) {
      holdId = await getNextEntityId('held_bills', 'id', 'HLD', 5);
      await db.query(
        `INSERT INTO held_bills (id, type, label, party_name, total, payload, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [holdId, type, label, partyName || 'Walk-in', parseFloat(total || 0), payload || {}, req.user.id, req.user.name]
      );
    } else {
      await db.query(
        `UPDATE held_bills
         SET type = $1, label = $2, party_name = $3, total = $4, payload = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [type, label, partyName || 'Walk-in', parseFloat(total || 0), payload || {}, holdId]
      );
    }

    emitEvent('held_bills.updated', { id: holdId });

    return res.json({
      success: true,
      message: `${holdId} saved to Held Bills`,
      data: { id: holdId }
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/held-bills/:id', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    let delQuery = 'DELETE FROM held_bills WHERE id = $1';
    const params = [id];

    if (req.user.role !== 'admin') {
      delQuery += ' AND created_by = $2';
      params.push(req.user.id);
    }

    await db.query(delQuery, params);
    emitEvent('held_bills.deleted', { id });

    return res.json({
      success: true,
      message: 'Held bill discarded'
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/invoices/:id - Full invoice details (Cached 60s)
router.get('/:id', cacheRoute(60), async (req, res, next) => {
  try {
    const invoice = await InvoiceService.getInvoiceById(req.params.id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Invoice not found.'
      });
    }

    return res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/invoices/:id/void - Void sales invoice (Admin only)
router.post('/:id/void', requireAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.voidSale(req.params.id, req.body, req.user);
    await CacheService.invalidatePattern('route:/api/invoices*');
    await CacheService.invalidatePattern('route:/api/dashboard*');
    await CacheService.invalidatePattern('route:/api/products*');
    await CacheService.invalidatePattern('route:/api/customers*');
    return res.json({
      success: true,
      message: 'Sales invoice voided and inventory restored successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
