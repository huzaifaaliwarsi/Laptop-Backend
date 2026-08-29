const db = require('../../config/db');
const { getNextProductCode, getNextEntityId, getNextInvoiceNo } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');

function paymentStatus(total, paid) {
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid';
  return 'Partial';
}

function generateProductKey(p) {
  return [p.categoryName || p.category, p.brand, p.model, p.specifications || '']
    .map(v => String(v || '').trim().toLowerCase())
    .join('|');
}

function buildSpecifications(data) {
  const parts = [];
  if (data.screenSize) parts.push(`Screen/Size: ${data.screenSize}`);
  if (data.processor) parts.push(`Processor: ${data.processor}`);
  if (data.ram) parts.push(`RAM: ${data.ram}`);
  if (data.romSsd) parts.push(`ROM/SSD: ${data.romSsd}`);
  if (data.hardDrive) parts.push(`Hard Drive: ${data.hardDrive}`);
  if (data.graphicsCard) parts.push(`Graphics: ${data.graphicsCard}`);
  if (data.accessoryCategory) parts.push(`Accessory Category: ${data.accessoryCategory}`);
  if (data.description) parts.push(`Description: ${data.description}`);
  if (data.others) parts.push(`Others: ${data.others}`);
  return parts.join(' | ');
}

class InventoryService {
  static async getProducts(filters = {}, userRole = 'admin') {
    const { search, category, condition, stockStatus, status, inventoryType, inStockOnly, page, limit } = filters;
    let queryText = `
      SELECT 
        p.id, p.code, p.inventory_type, p.category_id, p.category_name, p.brand, p.model,
        p.product_name, p.screen_size, p.processor, p.ram, p.rom_ssd, p.hard_drive,
        p.graphics_card, p.accessory_category, p.description, p.others, p.specifications,
        p.condition, p.initial_stock, p.stock_in, p.stock_out, p.current_stock, p.low_stock_alert,
        ${userRole === 'technician' ? '0.00 as cost_price' : 'p.cost_price'},
        p.expected_sale_price, p.remarks, p.source_type, p.source_id, p.source_name,
        p.purchase_invoice_no, p.date_added, p.created_at, p.updated_at
      FROM products p
      WHERE 1=1
    `;
    const params = [];

    if (search && String(search).trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (
        LOWER(p.code) LIKE $${params.length} OR
        LOWER(p.brand) LIKE $${params.length} OR
        LOWER(p.model) LIKE $${params.length} OR
        LOWER(COALESCE(p.product_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(p.source_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(p.purchase_invoice_no, '')) LIKE $${params.length} OR
        LOWER(COALESCE(p.specifications, '')) LIKE $${params.length}
      )`;
    }

    if (category) {
      params.push(category);
      queryText += ` AND p.category_name = $${params.length}`;
    }

    if (condition) {
      params.push(condition);
      queryText += ` AND p.condition = $${params.length}`;
    }

    if (inventoryType) {
      params.push(inventoryType);
      queryText += ` AND p.inventory_type = $${params.length}`;
    }

    const activeStockStatus = stockStatus || status;
    if (inStockOnly === true || inStockOnly === 'true' || activeStockStatus === 'In Stock') {
      queryText += ` AND p.current_stock > 0`;
    } else if (activeStockStatus === 'Low Stock') {
      queryText += ` AND p.current_stock > 0 AND p.current_stock <= p.low_stock_alert`;
    } else if (activeStockStatus === 'Out of Stock') {
      queryText += ` AND p.current_stock <= 0`;
    }

    queryText += ' ORDER BY p.date_added DESC, p.created_at DESC';

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

    return result.rows.map(row => ({
      id: row.id,
      code: row.code,
      inventoryType: row.inventory_type,
      categoryId: row.category_id,
      category: row.category_name,
      categoryName: row.category_name,
      brand: row.brand,
      model: row.model,
      productName: row.product_name || row.model,
      screenSize: row.screen_size,
      processor: row.processor,
      ram: row.ram,
      romSsd: row.rom_ssd,
      hardDrive: row.hard_drive,
      graphicsCard: row.graphics_card,
      accessoryCategory: row.accessory_category,
      description: row.description,
      others: row.others,
      specifications: row.specifications,
      condition: row.condition,
      initialStock: parseInt(row.initial_stock || 0, 10),
      stockIn: parseInt(row.stock_in || 0, 10),
      stockOut: parseInt(row.stock_out || 0, 10),
      currentStock: parseInt(row.current_stock || 0, 10),
      lowStockAlert: parseInt(row.low_stock_alert || 1, 10),
      costPrice: parseFloat(row.cost_price || 0),
      expectedSalePrice: parseFloat(row.expected_sale_price || 0),
      remarks: row.remarks,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceName: row.source_name,
      vendorId: row.source_id,
      vendorName: row.source_name,
      purchaseInvoiceNo: row.purchase_invoice_no,
      dateAdded: row.date_added,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  static async getProductById(id, userRole = 'admin') {
    const queryText = `
      SELECT 
        p.*,
        ${userRole === 'technician' ? '0.00 as cost_price' : 'p.cost_price'}
      FROM products p
      WHERE p.id = $1
    `;
    const result = await db.query(queryText, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Fetch stock movements
    const movementsRes = await db.query(
      `SELECT m.*, u.name as performed_by_name 
       FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.performed_by
       WHERE m.product_id = $1 
       ORDER BY m.date DESC, m.created_at DESC`,
      [id]
    );

    return {
      product: {
        id: row.id,
        code: row.code,
        inventoryType: row.inventory_type,
        categoryId: row.category_id,
        category: row.category_name,
        brand: row.brand,
        model: row.model,
        productName: row.product_name || row.model,
        screenSize: row.screen_size,
        processor: row.processor,
        ram: row.ram,
        romSsd: row.rom_ssd,
        hardDrive: row.hard_drive,
        graphicsCard: row.graphics_card,
        accessoryCategory: row.accessory_category,
        description: row.description,
        others: row.others,
        specifications: row.specifications,
        condition: row.condition,
        initialStock: parseInt(row.initial_stock || 0, 10),
        stockIn: parseInt(row.stock_in || 0, 10),
        stockOut: parseInt(row.stock_out || 0, 10),
        currentStock: parseInt(row.current_stock || 0, 10),
        lowStockAlert: parseInt(row.low_stock_alert || 1, 10),
        costPrice: parseFloat(row.cost_price || 0),
        expectedSalePrice: parseFloat(row.expected_sale_price || 0),
        remarks: row.remarks,
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceName: row.source_name,
        vendorId: row.source_id,
        vendorName: row.source_name,
        purchaseInvoiceNo: row.purchase_invoice_no,
        dateAdded: row.date_added,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      movements: movementsRes.rows.map(m => ({
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
    };
  }

  static async addOrMergeProduct(productData, sourceData, user, client = db) {
    const categoryName = productData.categoryName || productData.category;
    let categoryId = productData.categoryId;

    if (!categoryId) {
      const catRes = await client.query('SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1)', [categoryName]);
      if (catRes.rows.length > 0) {
        categoryId = catRes.rows[0].id;
      } else {
        const insertCat = await client.query('INSERT INTO product_categories (name, code_prefix) VALUES ($1, $2) RETURNING id', [
          categoryName,
          categoryName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD'
        ]);
        categoryId = insertCat.rows[0].id;
      }
    }

    const specifications = productData.specifications || buildSpecifications(productData);
    const quantity = parseInt(productData.quantity || 1, 10);
    const costPrice = parseFloat(productData.costPrice || 0);
    const expectedSalePrice = parseFloat(productData.expectedSalePrice || 0);
    const lowStockAlert = parseInt(productData.lowStockAlert || 1, 10);

    // Check if an existing product matches this exact signature
    const existingRes = await client.query(
      `SELECT * FROM products 
       WHERE LOWER(category_name) = LOWER($1) 
         AND LOWER(brand) = LOWER($2) 
         AND LOWER(model) = LOWER($3) 
         AND LOWER(COALESCE(specifications, '')) = LOWER($4)
       FOR UPDATE`,
      [categoryName, productData.brand, productData.model, specifications]
    );

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      const updatedStockIn = (parseInt(existing.stock_in, 10) || 0) + quantity;
      const updatedCurrentStock = (parseInt(existing.current_stock, 10) || 0) + quantity;

      const updateRes = await client.query(
        `UPDATE products 
         SET stock_in = $1, current_stock = $2, cost_price = $3, expected_sale_price = $4,
             low_stock_alert = $5, source_id = COALESCE($6, source_id), source_name = COALESCE($7, source_name),
             purchase_invoice_no = COALESCE($8, purchase_invoice_no), updated_at = CURRENT_TIMESTAMP
         WHERE id = $9
         RETURNING *`,
        [
          updatedStockIn,
          updatedCurrentStock,
          costPrice || existing.cost_price,
          expectedSalePrice || existing.expected_sale_price,
          lowStockAlert,
          sourceData.sourceId || existing.source_id,
          sourceData.sourceName || existing.source_name,
          sourceData.invoiceNo || existing.purchase_invoice_no,
          existing.id
        ]
      );

      // Validate user ID exists in DB to prevent foreign key error
      let validUserId = null;
      if (user?.id) {
        const uRes = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
        if (uRes.rows.length > 0) validUserId = uRes.rows[0].id;
      }

      // Log inventory movement
      await client.query(
        `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
         VALUES ($1, $2, 'IN', $3, $4, $5, $6, $7, $8)`,
        [
          existing.id,
          existing.code,
          quantity,
          sourceData.reason || 'Stock added to existing product',
          sourceData.refType || 'Stock In',
          sourceData.refId || 'MANUAL',
          validUserId,
          sourceData.date || new Date()
        ]
      );

      emitEvent('inventory.updated', { productId: existing.id, currentStock: updatedCurrentStock });

      return {
        product: updateRes.rows[0],
        isNew: false
      };
    }

    // Otherwise create new product
    const code = await getNextProductCode(categoryId, client);
    const productId = await getNextEntityId('products', 'id', 'PRD', 4, client);

    const insertRes = await client.query(
      `INSERT INTO products (
        id, code, inventory_type, category_id, category_name, brand, model, product_name,
        screen_size, processor, ram, rom_ssd, hard_drive, graphics_card, accessory_category,
        description, others, specifications, condition, initial_stock, stock_in, stock_out,
        current_stock, low_stock_alert, cost_price, expected_sale_price, remarks, source_type,
        source_id, source_name, purchase_invoice_no, date_added
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
      ) RETURNING *`,
      [
        productId,
        code,
        productData.inventoryType || 'Vendor Purchased',
        categoryId,
        categoryName,
        productData.brand,
        productData.model,
        productData.productName || productData.model,
        productData.screenSize || null,
        productData.processor || null,
        productData.ram || null,
        productData.romSsd || null,
        productData.hardDrive || null,
        productData.graphicsCard || null,
        productData.accessoryCategory || null,
        productData.description || null,
        productData.others || null,
        specifications,
        productData.condition || 'Used',
        quantity, // initial_stock
        quantity, // stock_in
        0,        // stock_out
        quantity, // current_stock
        lowStockAlert,
        costPrice,
        expectedSalePrice,
        productData.remarks || null,
        sourceData.refType || (sourceData.sourceName && sourceData.sourceName !== 'Manual Entry' ? 'Vendor Purchase' : 'Manual Entry'),
        sourceData.sourceId || sourceData.refId || 'MANUAL',
        sourceData.sourceName || null,
        sourceData.invoiceNo || null,
        sourceData.date || new Date()
      ]
    );

    // Validate user ID exists in DB to prevent foreign key error
    let validUserId = null;
    if (user?.id) {
      const uRes = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
      if (uRes.rows.length > 0) validUserId = uRes.rows[0].id;
    }

    // Log movement
    await client.query(
      `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
       VALUES ($1, $2, 'IN', $3, $4, $5, $6, $7, $8)`,
      [
        productId,
        code,
        quantity,
        sourceData.reason || 'Initial stock added',
        sourceData.refType || 'Manual Entry',
        sourceData.refId || 'MANUAL',
        validUserId,
        sourceData.date || new Date()
      ]
    );

    emitEvent('inventory.product_created', insertRes.rows[0]);

    return {
      product: insertRes.rows[0],
      isNew: true
    };
  }

  static async adjustStock({
    productId,
    direction,
    quantity,
    reason,
    refType,
    refId,
    date,
    user,
    vendorId,
    vendorName,
    vendorContact,
    costPrice,
    purchaseInvoiceNo,
    paid,
    paymentMethod = 'Cash',
    referenceId = null
  }, client = db) {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      const error = new Error('Quantity must be greater than zero.');
      error.status = 400;
      throw error;
    }

    const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (prodRes.rows.length === 0) {
      const error = new Error('Product not found.');
      error.status = 404;
      throw error;
    }

    const product = prodRes.rows[0];

    const curStock = parseInt(product.current_stock, 10) || 0;
    if (direction === 'OUT' && qty > curStock) {
      const error = new Error(`Insufficient stock. Only ${curStock} item(s) available for ${product.code}.`);
      error.status = 400;
      error.code = 'INSUFFICIENT_STOCK';
      throw error;
    }

    let updatedStockIn = parseInt(product.stock_in, 10) || 0;
    let updatedStockOut = parseInt(product.stock_out, 10) || 0;
    let updatedCurrentStock = curStock;

    if (direction === 'IN') {
      updatedStockIn += qty;
      updatedCurrentStock += qty;
    } else {
      updatedStockOut += qty;
      updatedCurrentStock -= qty;
    }

    // Cost price determination
    const effectiveCostPrice = costPrice !== undefined && costPrice !== '' ? parseFloat(costPrice || 0) : parseFloat(product.cost_price || 0);

    const updateRes = await client.query(
      `UPDATE products 
       SET stock_in = $1, stock_out = $2, current_stock = $3,
           cost_price = CASE WHEN $4::numeric > 0 THEN $4 ELSE cost_price END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [updatedStockIn, updatedStockOut, updatedCurrentStock, effectiveCostPrice, productId]
    );

    // Validate user ID exists in DB
    let validUserId = null;
    if (user?.id) {
      const uRes = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
      if (uRes.rows.length > 0) validUserId = uRes.rows[0].id;
    }

    let finalRefType = refType || `Manual ${direction} Adjustment`;
    let finalRefId = refId || 'MANUAL';
    const adjDate = date || new Date();

    // 1. Check if Vendor Ledger should be created (when Stock IN from vendor)
    let vId = vendorId;
    let vName = vendorName;
    const hasVendor = (vId && vId !== 'MANUAL') || (vName && vName.trim() !== '' && vName !== 'Manual Entry');

    if (direction === 'IN' && hasVendor) {
      // Resolve vendor ID / Name
      if (vId && (!vName || vName === 'Manual Entry')) {
        const vRes = await client.query('SELECT id, name, contact FROM vendors WHERE id = $1', [vId]);
        if (vRes.rows.length > 0) {
          vName = vRes.rows[0].name;
          if (!vendorContact) vendorContact = vRes.rows[0].contact;
        }
      } else if (vName && (!vId || vId === 'MANUAL')) {
        const vRes = await client.query('SELECT id, name, contact FROM vendors WHERE LOWER(name) = LOWER($1)', [vName.trim()]);
        if (vRes.rows.length > 0) {
          vId = vRes.rows[0].id;
          vName = vRes.rows[0].name;
          if (!vendorContact) vendorContact = vRes.rows[0].contact;
        } else {
          vId = await getNextEntityId('vendors', 'id', 'VND', 4, client);
          await client.query('INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)', [
            vId, vName.trim(), vendorContact || null
          ]);
        }
      }

      const totalCost = qty * effectiveCostPrice;

      if (totalCost > 0) {
        const paidAmount = paid === undefined || paid === ''
          ? totalCost
          : Math.min(Math.max(0, parseFloat(paid || 0)), totalCost);
        const balance = Math.max(0, totalCost - paidAmount);
        const pStatus = paymentStatus(totalCost, paidAmount);

        let candidateInvNo = purchaseInvoiceNo && purchaseInvoiceNo !== 'MANUAL'
          ? purchaseInvoiceNo
          : await getNextInvoiceNo('vendor_purchase', client);

        const invExistsCheck = await client.query('SELECT 1 FROM invoices WHERE invoice_no = $1', [candidateInvNo]);
        if (invExistsCheck.rows.length > 0) {
          candidateInvNo = await getNextInvoiceNo('vendor_purchase', client);
        }

        const targetInvoiceId = await getNextEntityId('invoices', 'id', 'INV', 5, client);
        const targetInvoiceNo = candidateInvNo;

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
            targetInvoiceId, targetInvoiceNo, adjDate, vId, vName, vendorContact,
            totalCost, paidAmount, balance, paymentMethod,
            referenceId, pStatus, validUserId, user?.name || 'Admin'
          ]
        );

        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            targetInvoiceId, productId, product.code,
            `${product.brand} ${product.model}`.trim(),
            `Stock Adjustment (${reason || 'Stock Refill'}) — ${product.category_name} ${product.brand} ${product.model}`,
            qty, effectiveCostPrice, effectiveCostPrice, totalCost
          ]
        );

        if (paidAmount > 0) {
          const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
          await client.query(
            `INSERT INTO payments (
              id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
              direction, amount, date, payment_method, reference_id, notes, affects_money,
              is_initial_settlement, created_by, created_by_name
            ) VALUES (
              $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
              'Paid', $6, $7, $8, $9, $10, TRUE,
              TRUE, $11, $12
            )`,
            [
              payId, targetInvoiceId, targetInvoiceNo, vId, vName,
              paidAmount, adjDate, paymentMethod, referenceId, `Stock Adjustment Payment (${product.code})`,
              validUserId, user?.name || 'Admin'
            ]
          );
        }

        if (balance > 0) {
          const accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
          await client.query(
            `INSERT INTO accounts (
              id, type, party_type, party_id, party_name, invoice_id, invoice_no,
              amount, remaining, status, date
            ) VALUES ($1, 'Vendor Payable', 'Vendor', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
            [accId, vId, vName, targetInvoiceId, targetInvoiceNo, balance, balance, adjDate]
          );
        }

        finalRefType = 'Vendor Purchase';
        finalRefId = targetInvoiceNo;

        emitEvent('invoice.created', invRes.rows[0]);
      }
    }

    // 2. Movement logging
    await client.query(
      `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        productId,
        product.code,
        direction,
        qty,
        reason || `Manual ${direction} adjustment`,
        finalRefType,
        finalRefId,
        validUserId,
        adjDate
      ]
    );

    emitEvent('inventory.updated', { productId, currentStock: updatedCurrentStock });

    return {
      product: updateRes.rows[0],
      newStock: updatedCurrentStock,
      invoiceNo: finalRefId !== 'MANUAL' ? finalRefId : null
    };
  }
}

module.exports = InventoryService;
