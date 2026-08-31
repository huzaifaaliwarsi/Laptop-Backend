const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { emitEvent } = require('../../config/socket');
const { CacheService, cacheRoute } = require('../../config/cache');

// GET /api/settings/company - Public or any authenticated user (Cached 600s)
router.get('/company', cacheRoute(600), async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, company_name, tagline, invoice_subtitle, phone, email, tax_number, address, invoice_footer, logo_data, ntn, strn, pos_id, fbr_pos_id, updated_at
      FROM business_settings
      WHERE id = 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
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

    const finalNtn = (ntn !== undefined ? ntn : taxNumber) ? String(ntn || taxNumber).trim() : null;

    const updateRes = await db.query(`
      INSERT INTO business_settings (id, company_name, tagline, invoice_subtitle, phone, email, tax_number, ntn, strn, pos_id, address, invoice_footer, logo_data, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        tagline = EXCLUDED.tagline,
        invoice_subtitle = EXCLUDED.invoice_subtitle,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        tax_number = EXCLUDED.tax_number,
        ntn = EXCLUDED.ntn,
        strn = EXCLUDED.strn,
        pos_id = EXCLUDED.pos_id,
        address = EXCLUDED.address,
        invoice_footer = EXCLUDED.invoice_footer,
        logo_data = EXCLUDED.logo_data,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      companyName.trim(),
      tagline ? tagline.trim() : null,
      invoiceSubtitle ? invoiceSubtitle.trim() : null,
      phone ? phone.trim() : null,
      email ? email.trim() : null,
      finalNtn,
      strn ? strn.trim() : null,
      posId ? posId.trim() : null,
      address ? address.trim() : null,
      invoiceFooter ? invoiceFooter.trim() : null,
      logoData || null
    ]);

    await CacheService.invalidatePattern('route:/api/settings*');
    emitEvent('settings.company_updated', updateRes.rows[0]);

    return res.json({
      success: true,
      message: 'Company branding updated successfully',
      data: updateRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/opening-balances (Admin only)
router.get('/opening-balances', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const result = await db.query('SELECT opening_cash, opening_online FROM business_settings WHERE id = 1');
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
    const rawCash = req.body.openingCash !== undefined ? req.body.openingCash : req.body.openingCashBalance;
    const rawOnline = req.body.openingOnline !== undefined ? req.body.openingOnline : req.body.openingOnlineBalance;
    const cash = Math.max(0, parseFloat(rawCash || 0));
    const online = Math.max(0, parseFloat(rawOnline || 0));

    await db.query(`
      INSERT INTO business_settings (id, opening_cash, opening_online, updated_at)
      VALUES (1, $1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        opening_cash = EXCLUDED.opening_cash,
        opening_online = EXCLUDED.opening_online,
        updated_at = CURRENT_TIMESTAMP
    `, [cash, online]);

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

// POST /api/settings/reset-database (Admin only) - Clear transactional & test data
router.post('/reset-database', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    await db.withTransaction(async (client) => {
      // Invoices & Payments
      await client.query('TRUNCATE TABLE invoice_items CASCADE');
      await client.query('TRUNCATE TABLE invoices CASCADE');
      await client.query('TRUNCATE TABLE payments CASCADE');
      await client.query('TRUNCATE TABLE accounts CASCADE');
      await client.query('TRUNCATE TABLE vendor_returns CASCADE');
      await client.query('TRUNCATE TABLE held_bills CASCADE');

      // Repairs
      await client.query('TRUNCATE TABLE repair_parts_used CASCADE');
      await client.query('TRUNCATE TABLE repair_job_lines CASCADE');
      await client.query('TRUNCATE TABLE repair_status_history CASCADE');
      await client.query('TRUNCATE TABLE repair_jobs CASCADE');

      // Inventory & Spare Parts
      await client.query('TRUNCATE TABLE inventory_movements CASCADE');
      await client.query('TRUNCATE TABLE products CASCADE');
      await client.query('TRUNCATE TABLE repair_parts_movements CASCADE');
      await client.query('TRUNCATE TABLE repair_parts CASCADE');

      // Expenses & Logs
      await client.query('TRUNCATE TABLE expenses CASCADE');
      await client.query('TRUNCATE TABLE audit_logs CASCADE');

      // WhatsApp
      await client.query('TRUNCATE TABLE whatsapp_messages CASCADE');
      await client.query('TRUNCATE TABLE whatsapp_conversations CASCADE');

      // Customers & Vendors
      await client.query('TRUNCATE TABLE customers CASCADE');
      await client.query('TRUNCATE TABLE vendors CASCADE');

      // Reset opening cash & online
      await client.query(`
        UPDATE business_settings 
        SET opening_cash = 0.00, opening_online = 0.00 
        WHERE id = 1
      `);
    });

    emitEvent('database.reset', { timestamp: new Date() });

    return res.json({
      success: true,
      message: 'All records, inventory, invoices, repairs, accounts and contacts have been reset to fresh empty state.'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
