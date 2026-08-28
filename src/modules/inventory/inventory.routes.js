const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const InventoryService = require('./inventory.service');
const authenticateToken = require('../../middleware/auth');
const { requireAdmin, requireSalesOrAdmin } = require('../../middleware/rbac');

router.use(authenticateToken);

// GET /api/products - List products with multi-filter and stock status
router.get('/', async (req, res, next) => {
  try {
    const products = await InventoryService.getProducts(req.query, req.user.role);
    return res.json({
      success: true,
      data: products
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/ledger - Inventory movement history
router.get('/ledger', async (req, res, next) => {
  try {
    const query = `
      SELECT m.*, u.name as performed_by_name
      FROM inventory_movements m
      LEFT JOIN users u ON u.id = m.performed_by
      ORDER BY m.date DESC, m.created_at DESC
      LIMIT 100
    `;
    const result = await db.query(query);

    return res.json({
      success: true,
      data: result.rows.map(m => ({
        id: m.id,
        productId: m.product_id,
        productCode: m.product_code,
        direction: m.direction,
        quantity: m.quantity,
        reason: m.reason,
        referenceType: m.reference_type,
        referenceId: m.reference_id,
        performedBy: m.performed_by_name || m.performed_by,
        date: m.date,
        createdAt: m.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id/history - Product stock movement history
router.get('/:id/history', async (req, res, next) => {
  try {
    const result = await InventoryService.getProductById(req.params.id, req.user.role);
    if (!result) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Product not found.'
      });
    }

    return res.json({
      success: true,
      data: result.movements.map(m => ({
        id: m.id,
        date: m.date,
        ref_type: m.referenceType || (m.direction === 'IN' ? 'Stock IN' : 'Stock OUT'),
        ref_id: m.referenceId,
        reason: m.reason,
        change_amount: m.direction === 'IN' ? m.quantity : -m.quantity,
        balance_after: null,
        created_by_name: m.performedBy
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id - Product detail + movements
router.get('/:id', async (req, res, next) => {
  try {
    const result = await InventoryService.getProductById(req.params.id, req.user.role);
    if (!result) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Product not found.'
      });
    }

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

const { getNextInvoiceNo, getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');

function paymentStatus(total, paid) {
  const t = parseFloat(total || 0);
  const p = parseFloat(paid || 0);
  if (t <= 0 || p >= t) return 'Paid';
  if (p > 0) return 'Partial';
  return 'Unpaid';
}

// POST /api/products - Create product (Admin only)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const category = req.body.category || req.body.categoryName;
    const { brand, model, quantity } = req.body;
    if (!category || !brand || !model || !quantity) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Category, Brand, Model and Quantity are required.'
      });
    }

    req.body.category = category;
    req.body.categoryName = category;

    const qty = parseInt(quantity || 1, 10);
    const costPrice = parseFloat(req.body.costPrice || 0);
    const totalCost = qty * costPrice;

    let vendorName = req.body.vendorName || req.body.supplierName || req.body.sourceName || null;
    let vendorId = req.body.vendorId || req.body.supplierId || req.body.sourceId || null;
    let purchaseInvoiceNo = req.body.purchaseInvoiceNo || req.body.invoiceNo || null;
    const purchaseDate = req.body.purchaseDate || req.body.date || new Date();
    const paymentMethod = req.body.paymentMethod || 'Cash';
    const referenceId = req.body.referenceId || req.body.paymentReferenceId || null;

    const hasVendor = (vendorId && vendorId !== 'MANUAL') || (vendorName && vendorName.trim() !== '' && vendorName !== 'Manual Entry');

    const result = await db.withTransaction(async (client) => {
      // 1. Resolve vendorId if vendorName given but no ID
      if (hasVendor) {
        if (vendorId && !vendorName) {
          const vRes = await client.query('SELECT id, name, contact FROM vendors WHERE id = $1', [vendorId]);
          if (vRes.rows.length > 0) {
            vendorName = vRes.rows[0].name;
          }
        } else if (vendorName && !vendorId) {
          const vRes = await client.query('SELECT id, name, contact FROM vendors WHERE LOWER(name) = LOWER($1)', [vendorName.trim()]);
          if (vRes.rows.length > 0) {
            vendorId = vRes.rows[0].id;
            vendorName = vRes.rows[0].name;
          } else {
            vendorId = await getNextEntityId('vendors', 'id', 'VND', 4, client);
            await client.query('INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)', [
              vendorId, vendorName.trim(), req.body.vendorContact || req.body.contact || null
            ]);
          }
        }
      }

      // Determine invoice number if not already custom entered
      let generatedInvoiceNo = purchaseInvoiceNo;
      let generatedInvoiceId = null;

      if (hasVendor && totalCost > 0) {
        if (!generatedInvoiceNo || generatedInvoiceNo === 'MANUAL') {
          generatedInvoiceNo = await getNextInvoiceNo('vendor_purchase', client);
        }
        generatedInvoiceId = await getNextEntityId('invoices', 'id', 'INV', 5, client);
      }

      const sourceData = {
        sourceName: vendorName || 'Manual Entry',
        sourceId: vendorId || 'MANUAL',
        invoiceNo: generatedInvoiceNo || 'MANUAL',
        date: purchaseDate,
        reason: req.body.reason || (vendorName ? `Stock purchased from ${vendorName}` : 'Manual opening stock'),
        refType: hasVendor ? 'Vendor Purchase' : 'Manual Entry',
        refId: generatedInvoiceId || vendorId || 'MANUAL'
      };

      const productResult = await InventoryService.addOrMergeProduct(req.body, sourceData, req.user, client);
      const product = productResult.product;

      // 2. If vendor purchase with totalCost > 0, generate Invoice, Payments and Accounts (Ledger)
      if (hasVendor && totalCost > 0) {
        // Compute paid amount
        let reqPaid = req.body.paid !== undefined ? req.body.paid : req.body.vendorPaid;
        const paidAmount = reqPaid === undefined || reqPaid === ''
          ? totalCost
          : Math.min(Math.max(0, parseFloat(reqPaid || 0)), totalCost);
        const balance = Math.max(0, totalCost - paidAmount);
        const pStatus = paymentStatus(totalCost, paidAmount);

        // Fetch vendor contact
        let vendorContact = req.body.vendorContact || req.body.contact || null;
        if (!vendorContact && vendorId) {
          const vRow = await client.query('SELECT contact FROM vendors WHERE id = $1', [vendorId]);
          if (vRow.rows.length > 0) vendorContact = vRow.rows[0].contact;
        }

        // Insert Invoice
        const invRes = await client.query(
          `INSERT INTO invoices (
            id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
            product_total, service_total, total, paid, initial_paid, balance, payment_method,
            reference_id, payment_status, is_voided, created_by, created_by_name
          ) VALUES (
            $1, $2, 'Vendor Purchase', 'vendor_purchase', $3, 'Vendor', $4, $5, $6,
            $7, 0, $7, $8, $8, $9, $10,
            $11, $12, FALSE, $13, $14
          ) RETURNING *`,
          [
            generatedInvoiceId, generatedInvoiceNo, purchaseDate, vendorId, vendorName, vendorContact,
            totalCost, paidAmount, balance, paymentMethod,
            referenceId, pStatus, req.user.id, req.user.name
          ]
        );

        // Insert Invoice Item
        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            generatedInvoiceId, product.id, product.code,
            `${product.brand} ${product.model}`.trim(),
            `${product.category_name} — ${product.brand} ${product.model}`,
            qty, costPrice, costPrice, totalCost
          ]
        );

        // If payment made, insert payment record
        if (paidAmount > 0) {
          const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
          await client.query(
            `INSERT INTO payments (
              id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
              direction, amount, date, payment_method, reference_id, notes, affects_money,
              is_initial_settlement, created_by, created_by_name
            ) VALUES (
              $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
              'Paid', $6, $7, $8, $9, 'Inventory Add Product Vendor Payment', TRUE,
              TRUE, $10, $11
            )`,
            [
              payId, generatedInvoiceId, generatedInvoiceNo, vendorId, vendorName,
              paidAmount, purchaseDate, paymentMethod, referenceId, req.user.id, req.user.name
            ]
          );
        }

        // If unpaid balance remaining, insert into Accounts (Payable)
        if (balance > 0) {
          const accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
          await client.query(
            `INSERT INTO accounts (
              id, type, party_type, party_id, party_name, invoice_id, invoice_no,
              amount, remaining, status, date
            ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
            [accId, vendorId, vendorName, generatedInvoiceId, generatedInvoiceNo, balance, balance, purchaseDate]
          );
        }

        emitEvent('invoice.created', invRes.rows[0]);
      }

      return productResult;
    });

    return res.status(201).json({
      success: true,
      message: result.isNew ? 'Product created with new code' : 'Quantity merged into existing product',
      data: result.product,
      isNew: result.isNew
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/products/:id - Update product (Admin only)
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const cat = req.body.category || req.body.categoryName;
    const {
      inventoryType, brand, model, screenSize, processor, ram, romSsd,
      hardDrive, graphicsCard, accessoryCategory, description, others, condition,
      costPrice, expectedSalePrice, lowStockAlert, remarks, dateAdded,
      vendorId, supplierId, sourceId,
      vendorName, supplierName, sourceName,
      purchaseInvoiceNo, invoiceNo
    } = req.body;
    const category = cat;

    const existingRes = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Product not found.'
      });
    }

    const specifications = [
      screenSize ? `Screen/Size: ${screenSize}` : null,
      processor ? `Processor: ${processor}` : null,
      ram ? `RAM: ${ram}` : null,
      romSsd ? `ROM/SSD: ${romSsd}` : null,
      hardDrive ? `Hard Drive: ${hardDrive}` : null,
      graphicsCard ? `Graphics: ${graphicsCard}` : null,
      accessoryCategory ? `Accessory Category: ${accessoryCategory}` : null,
      description ? `Description: ${description}` : null,
      others ? `Others: ${others}` : null
    ].filter(Boolean).join(' | ');

    const vId = vendorId !== undefined ? vendorId : (supplierId !== undefined ? supplierId : (sourceId !== undefined ? sourceId : undefined));
    const vName = vendorName !== undefined ? vendorName : (supplierName !== undefined ? supplierName : (sourceName !== undefined ? sourceName : undefined));
    const invNo = purchaseInvoiceNo !== undefined ? purchaseInvoiceNo : (invoiceNo !== undefined ? invoiceNo : undefined);

    const updateRes = await db.query(
      `UPDATE products SET
        inventory_type = COALESCE($1, inventory_type),
        category_name = COALESCE($2, category_name),
        brand = COALESCE($3, brand),
        model = COALESCE($4, model),
        product_name = COALESCE($4, product_name),
        screen_size = $5,
        processor = $6,
        ram = $7,
        rom_ssd = $8,
        hard_drive = $9,
        graphics_card = $10,
        accessory_category = $11,
        description = $12,
        others = $13,
        specifications = $14,
        condition = COALESCE($15, condition),
        cost_price = COALESCE($16, cost_price),
        expected_sale_price = COALESCE($17, expected_sale_price),
        low_stock_alert = COALESCE($18, low_stock_alert),
        remarks = $19,
        date_added = COALESCE($20, date_added),
        source_id = CASE WHEN $21::varchar IS NOT NULL THEN $21 ELSE source_id END,
        source_name = CASE WHEN $22::varchar IS NOT NULL THEN $22 ELSE source_name END,
        purchase_invoice_no = CASE WHEN $23::varchar IS NOT NULL THEN $23 ELSE purchase_invoice_no END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $24
       RETURNING *`,
      [
        inventoryType, category, brand, model, screenSize, processor, ram, romSsd,
        hardDrive, graphicsCard, accessoryCategory, description, others, specifications,
        condition, costPrice, expectedSalePrice, lowStockAlert, remarks, dateAdded,
        vId !== undefined ? vId : null,
        vName !== undefined ? vName : null,
        invNo !== undefined ? invNo : null,
        id
      ]
    );

    return res.json({
      success: true,
      message: 'Product updated successfully',
      data: updateRes.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/products/adjustments - Manual stock adjustment (Admin only)
router.post('/adjustments', requireAdmin, async (req, res, next) => {
  try {
    const { productId, direction, quantity, reason, date } = req.body;
    if (!productId || !direction || !quantity || !reason) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Product, Direction, Quantity, and Reason are required.'
      });
    }

    const result = await db.withTransaction(async (client) => {
      return await InventoryService.adjustStock({
        productId,
        direction,
        quantity,
        reason,
        refType: 'Manual Adjustment',
        refId: 'MANUAL',
        date: date || new Date(),
        user: req.user
      }, client);
    });

    return res.json({
      success: true,
      message: 'Stock adjustment applied successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/products/bulk-csv - Bulk CSV import
router.post('/bulk-csv', requireAdmin, async (req, res, next) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_LIST',
        message: 'No product rows provided in CSV.'
      });
    }

    const imported = [];
    await db.withTransaction(async (client) => {
      for (const p of products) {
        if (p.category && p.brand && p.model && p.quantity > 0) {
          const sourceData = {
            sourceName: p.sourceName || 'CSV Bulk Import',
            invoiceNo: `CSV-${new Date().toISOString().slice(0, 10)}`,
            date: new Date(),
            reason: 'CSV Bulk Inventory Import',
            refType: 'CSV Import',
            refId: `CSV-${Date.now()}`
          };
          const res = await InventoryService.addOrMergeProduct(p, sourceData, req.user, client);
          imported.push(res.product);
        }
      }
    });

    return res.json({
      success: true,
      message: `${imported.length} product row(s) imported successfully`,
      data: { count: imported.length }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/products/:id - Delete product from inventory
router.delete('/:id', requireSalesOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const prodRes = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Product not found in inventory.'
      });
    }
    const product = prodRes.rows[0];

    await db.withTransaction(async (client) => {
      // 1. Delete associated inventory movement logs
      await client.query('DELETE FROM inventory_movements WHERE product_id = $1', [id]);

      // 2. Clear product reference in invoice_items and repair_parts_used
      await client.query('UPDATE invoice_items SET product_id = NULL WHERE product_id = $1', [id]);
      await client.query('UPDATE repair_parts_used SET product_id = NULL WHERE product_id = $1', [id]);

      // 3. Delete the product
      await client.query('DELETE FROM products WHERE id = $1', [id]);
    });

    emitEvent('products.deleted', { id, code: product.code });

    return res.json({
      success: true,
      message: `Product ${product.code} (${product.brand} ${product.model}) deleted from inventory successfully.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
