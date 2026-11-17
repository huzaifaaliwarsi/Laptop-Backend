const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const InvoiceService = require('./invoices.service');
const InvoiceRegistryService = require('./invoice-registry.service');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin, requireSalesOrAdmin } = require('../../middleware/rbac');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { getCreator } = require('../../utils/userHelper');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute, getBranchIdFromReq } = require('../../config/cache');
// GET /api/invoices/:id/pdf - Stream official PDF invoice document (Direct access for PDF preview & download)
router.get('/:id/pdf', authenticateToken, async (req, res, next) => {
  try {
    const invoice = await InvoiceService.getInvoiceById(req.params.id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found.'
      });
    }

    const { generateInvoicePdf } = require('./invoice-pdf.service');
    const pdfBuffer = await generateInvoicePdf(invoice);
    const filename = `Invoice-${invoice.invoiceNo || invoice.id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

router.use(authenticateToken);

// GET /api/invoices - Query unified transaction-level collection registry with filters (Cached 60s)
router.get('/', cacheRoute(60), async (req, res, next) => {
  try {
    const branchId = getBranchIdFromReq(req) || 1;
    const result = await InvoiceRegistryService.getTransactionRegistry(req.query, req.user, branchId);

    return res.json({
      success: true,
      data: result.rows,
      pagination: result.pagination,
      summary: result.summary
    });
  } catch (error) {
    next(error);
  }
});


// POST /api/pos/sale - Create POS sale
router.post('/sale', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.createSale(req.body, req.user);
    await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
      '/api/invoices*',
      '/api/dashboard*',
      '/api/products*',
      '/api/customers*',
      '/api/accounts*',
      '/api/ledger*',
      '/api/reports*'
    ]);
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
    await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
      '/api/invoices*',
      '/api/dashboard*',
      '/api/products*',
      '/api/customers*',
      '/api/accounts*',
      '/api/ledger*',
      '/api/reports*'
    ]);
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
    await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
      '/api/invoices*',
      '/api/dashboard*',
      '/api/products*',
      '/api/vendors*',
      '/api/accounts*',
      '/api/ledger*',
      '/api/reports*'
    ]);
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
    await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
      '/api/invoices*',
      '/api/dashboard*',
      '/api/products*',
      '/api/customers*',
      '/api/ledger*'
    ]);
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
    await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
      '/api/invoices*',
      '/api/dashboard*',
      '/api/products*',
      '/api/vendors*',
      '/api/accounts*',
      '/api/ledger*',
      '/api/reports*'
    ]);
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

    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.isSuperAdmin;
    if (!isAdmin) {
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
    const creator = getCreator(req.user);

    if (!holdId) {
      holdId = await getNextEntityId('held_bills', 'id', 'HLD', 5);
      await db.query(
        `INSERT INTO held_bills (id, type, label, party_name, total, payload, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [holdId, type, label, partyName || 'Walk-in', parseFloat(total || 0), payload || {}, creator.id, creator.name]
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

    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.isSuperAdmin;
    if (!isAdmin) {
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

    // Role scoping: Sales staff can only view their own invoices
    if (req.user.role === 'sales' && invoice.createdById !== req.user.id && invoice.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access restricted to your own sales invoices.'
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

// POST /api/invoices/:id/payment - Atomic, idempotent remaining installment collection
router.post('/:id/payment', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const branchId = getBranchIdFromReq(req) || 1;
    const requestKey = req.body.requestKey || req.headers['x-request-key'] || req.headers['idempotency-key'];
    const result = await InvoiceRegistryService.recordInvoicePayment(
      req.params.id,
      {
        ...req.body,
        requestKey
      },
      req.user,
      branchId
    );

    await CacheService.invalidateBranchPatterns(branchId, [
      '/api/invoices*',
      '/api/accounts*',
      '/api/ledger*',
      '/api/dashboard*',
      '/api/reports*',
      '/api/customers*',
      '/api/vendors*'
    ]);

    emitEvent('payment.recorded', result);

    return res.status(201).json({
      success: true,
      message: result.message || 'Payment recorded successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/invoices/:id/void - Void sales invoice (Admin only)
router.post('/:id/void', requireAdmin, async (req, res, next) => {
  try {
    const result = await InvoiceService.voidSale(req.params.id, req.body, req.user);
    await CacheService.invalidateBranchPatterns(getBranchIdFromReq(req), [
      '/api/invoices*',
      '/api/dashboard*',
      '/api/products*',
      '/api/customers*',
      '/api/vendors*',
      '/api/accounts*',
      '/api/ledger*',
      '/api/reports*'
    ]);
    return res.json({
      success: true,
      message: 'Sales invoice voided and inventory restored successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/invoices/:id/send-whatsapp - Send official PDF invoice to customer/vendor WhatsApp
router.post('/:id/send-whatsapp', async (req, res, next) => {
  try {
    const InvoiceWhatsAppService = require('./invoice-whatsapp.service');
    const branchId = getBranchIdFromReq(req);
    const result = await InvoiceWhatsAppService.sendInvoiceWhatsApp(req.params.id, {
      branchId,
      isManual: true,
      customNote: req.body?.customNote
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || result.error || 'Failed to dispatch WhatsApp invoice',
        reason: result.reason
      });
    }

    return res.json({
      success: true,
      delivered: result.delivered,
      wa_not_connected: result.wa_not_connected || false,
      contact: result.contact,
      message: result.message || 'Invoice PDF sent via WhatsApp'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
