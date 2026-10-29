const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute, getBranchIdFromReq } = require('../../config/cache');

// GET /api/settings/company - Public or any authenticated user (Cached 300s — called on every invoice print)
router.get('/company', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');
  res.setHeader('Vary', 'X-Branch-Id');
  next();
}, cacheRoute(300), async (req, res, next) => {
  try {
    const branchId = getBranchIdFromReq(req) || 1;
    const result = await db.query(`
      SELECT id, branch_id, company_name, tagline, invoice_subtitle, phone, email, tax_number, address, invoice_footer, logo_data, ntn, strn, pos_id, fbr_pos_id, updated_at
      FROM business_settings
      WHERE branch_id = $1
      LIMIT 1
    `, [branchId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          branch_id: branchId,
          company_name: 'Retail & Repair Management',
          tagline: 'POS, Inventory Management, Sales & Purchases',
          invoice_subtitle: 'Retail • Inventory • Repair',
          phone: '',
          email: '',
          tax_number: '',
          ntn: '',
          strn: '',
          pos_id: '',
          fbr_pos_id: '',
          address: '',
          invoice_footer: 'Thank you for choosing us. We appreciate your business.',
          logo_data: null
        }
      });
    }

    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        ntn: row.ntn || row.tax_number || '',
        strn: row.strn || '',
        pos_id: row.pos_id || row.fbr_pos_id || ''
      }
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/company - Update company branding (Admin only)
router.put('/company', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { companyName, tagline, invoiceSubtitle, phone, email, taxNumber, ntn, strn, posId, address, invoiceFooter, logoData } = req.body;

    if (!companyName || String(companyName).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_COMPANY_NAME',
        message: 'Company name is required.'
      });
    }

    const bId = getBranchIdFromReq(req) || 1;
    const finalNtn = ntn !== undefined ? (ntn ? String(ntn).trim() : null)
      : (taxNumber ? String(taxNumber).trim() : null);
    const finalTaxNumber = taxNumber ? String(taxNumber).trim() : (ntn ? String(ntn).trim() : null);

    const existing = await db.query('SELECT id FROM business_settings WHERE branch_id = $1 LIMIT 1', [bId]);
    let updateRes;
    if (existing.rows.length > 0) {
      updateRes = await db.query(`
        UPDATE business_settings SET
          company_name = $1,
          tagline = $2,
          invoice_subtitle = $3,
          phone = $4,
          email = $5,
          tax_number = $6,
          ntn = $7,
          strn = $8,
          pos_id = $9,
          address = $10,
          invoice_footer = $11,
          logo_data = COALESCE($12, logo_data),
          updated_at = CURRENT_TIMESTAMP
        WHERE branch_id = $13
        RETURNING *
      `, [
        companyName.trim(),
        tagline ? tagline.trim() : null,
        invoiceSubtitle ? invoiceSubtitle.trim() : null,
        phone ? phone.trim() : null,
        email ? email.trim() : null,
        finalTaxNumber,
        finalNtn,
        strn ? strn.trim() : null,
        posId ? posId.trim() : null,
        address ? address.trim() : null,
        invoiceFooter ? invoiceFooter.trim() : null,
        logoData || null,
        bId
      ]);
    } else {
      updateRes = await db.query(`
        INSERT INTO business_settings (branch_id, company_name, tagline, invoice_subtitle, phone, email, tax_number, ntn, strn, pos_id, address, invoice_footer, logo_data, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        bId,
        companyName.trim(),
        tagline ? tagline.trim() : null,
        invoiceSubtitle ? invoiceSubtitle.trim() : null,
        phone ? phone.trim() : null,
        email ? email.trim() : null,
        finalTaxNumber,
        finalNtn,
        strn ? strn.trim() : null,
        posId ? posId.trim() : null,
        address ? address.trim() : null,
        invoiceFooter ? invoiceFooter.trim() : null,
        logoData || null
      ]);
    }



    // Also sync branch name and contact info to master_branches so all listings remain unified
    try {
      const branchManager = require('../../config/branchManager');
      await branchManager.masterPool.query(`
        UPDATE master_branches 
        SET branch_name = $1, phone = COALESCE($2, phone), email = COALESCE($3, email), address = COALESCE($4, address), updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
      `, [companyName.trim(), phone || null, email || null, address || null, bId]);
    } catch (syncErr) {
      console.warn('[Settings] Non-critical: Could not sync branch metadata to Master DB:', syncErr.message);
    }

    await CacheService.invalidateBranchPattern(bId, '/api/settings*');
    await CacheService.invalidatePattern('route:*:/api/super-admin*');
    emitEvent('settings.updated', updateRes.rows[0]);

    return res.json({
      success: true,
      message: 'Company branding updated successfully',
      data: updateRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/opening-balances (Admin only) — Cached 120s
router.get('/opening-balances', authenticateToken, requireAdmin, cacheRoute(120), async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const result = await db.query('SELECT opening_cash, opening_online FROM business_settings WHERE branch_id = $1 LIMIT 1', [bId]);
    const cash = result.rows.length > 0 ? parseFloat(result.rows[0].opening_cash || 0) : 0;
    const online = result.rows.length > 0 ? parseFloat(result.rows[0].opening_online || 0) : 0;

    return res.json({
      success: true,
      data: {
        openingCash: cash,
        openingOnline: online
      }
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/opening-balances (Admin only)
router.put('/opening-balances', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    const rawCash = req.body.openingCash !== undefined ? req.body.openingCash : req.body.openingCashBalance;
    const rawOnline = req.body.openingOnline !== undefined ? req.body.openingOnline : req.body.openingOnlineBalance;
    const cash = Math.max(0, parseFloat(rawCash || 0));
    const online = Math.max(0, parseFloat(rawOnline || 0));

    const existing = await db.query('SELECT id FROM business_settings WHERE branch_id = $1 LIMIT 1', [bId]);
    if (existing.rows.length > 0) {
      await db.query(`
        UPDATE business_settings SET
          opening_cash = $1, opening_online = $2, updated_at = CURRENT_TIMESTAMP
        WHERE branch_id = $3
      `, [cash, online, bId]);
    } else {
      await db.query(`
        INSERT INTO business_settings (branch_id, opening_cash, opening_online, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      `, [bId, cash, online]);
    }

    await CacheService.invalidateBranchPattern(bId, '/api/settings*');
    await CacheService.invalidateBranchPattern(bId, '/api/reports*');
    emitEvent('settings.balances_updated', { openingCash: cash, openingOnline: online });

    return res.json({
      success: true,
      message: 'Opening cash and online balances saved successfully',
      data: { openingCash: cash, openingOnline: online }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/reset-database (Admin only) - Clear transactional & test data for this branch
router.post('/reset-database', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const bId = getBranchIdFromReq(req) || 1;
    await db.withTransaction(async (client) => {
      // Invoices & Payments for this branch
      await client.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE branch_id = $1)', [bId]);
      await client.query('DELETE FROM invoices WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM payments WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM accounts WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM vendor_returns WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM held_bills WHERE branch_id = $1', [bId]);

      // Repairs for this branch
      await client.query('DELETE FROM repair_parts_used WHERE repair_job_id IN (SELECT id FROM repair_jobs WHERE branch_id = $1)', [bId]);
      await client.query('DELETE FROM repair_job_lines WHERE repair_job_id IN (SELECT id FROM repair_jobs WHERE branch_id = $1)', [bId]);
      await client.query('DELETE FROM repair_status_history WHERE repair_job_id IN (SELECT id FROM repair_jobs WHERE branch_id = $1)', [bId]);
      await client.query('DELETE FROM repair_additional_work_requests WHERE repair_job_id IN (SELECT id FROM repair_jobs WHERE branch_id = $1)', [bId]);
      await client.query('DELETE FROM repair_jobs WHERE branch_id = $1', [bId]);

      // Inventory & Spare Parts for this branch
      await client.query('DELETE FROM inventory_movements WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM products WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM repair_parts_movements WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM repair_parts WHERE branch_id = $1', [bId]);

      // Expenses & Logs
      await client.query('DELETE FROM expenses WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM audit_logs WHERE branch_id = $1', [bId]);

      // Customers & Vendors
      await client.query('DELETE FROM customers WHERE branch_id = $1', [bId]);
      await client.query('DELETE FROM vendors WHERE branch_id = $1', [bId]);

      // Reset opening cash & online
      await client.query(`
        UPDATE business_settings 
        SET opening_cash = 0.00, opening_online = 0.00 
        WHERE branch_id = $1
      `, [bId]);
    });

    // Flush cache for this branch
    await CacheService.invalidateBranchPattern(bId, '*');

    emitEvent('database.reset', { branchId: bId, timestamp: new Date() });

    return res.json({
      success: true,
      message: 'Branch records, inventory, invoices, repairs, accounts and contacts have been reset to fresh empty state.'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
