const db = require('../../config/db');
const { getNextProductCode, getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');

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
      const updatedStockIn = existing.stock_in + quantity;
      const updatedCurrentStock = existing.current_stock + quantity;

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
          user?.id || null,
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
        user?.id || null,
        sourceData.date || new Date()
      ]
    );

    emitEvent('inventory.product_created', insertRes.rows[0]);

    return {
      product: insertRes.rows[0],
      isNew: true
    };
  }

  static async adjustStock({ productId, direction, quantity, reason, refType, refId, date, user }, client = db) {
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

    if (direction === 'OUT' && qty > product.current_stock) {
      const error = new Error(`Insufficient stock. Only ${product.current_stock} item(s) available for ${product.code}.`);
      error.status = 400;
      error.code = 'INSUFFICIENT_STOCK';
      throw error;
    }

    let updatedStockIn = product.stock_in;
    let updatedStockOut = product.stock_out;
    let updatedCurrentStock = product.current_stock;

    if (direction === 'IN') {
      updatedStockIn += qty;
      updatedCurrentStock += qty;
    } else {
      updatedStockOut += qty;
      updatedCurrentStock -= qty;
    }

    const updateRes = await client.query(
      `UPDATE products 
       SET stock_in = $1, stock_out = $2, current_stock = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [updatedStockIn, updatedStockOut, updatedCurrentStock, productId]
    );

    await client.query(
      `INSERT INTO inventory_movements (product_id, product_code, direction, quantity, reason, reference_type, reference_id, performed_by, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        productId,
        product.code,
        direction,
        qty,
        reason || `Manual ${direction} adjustment`,
        refType || 'Manual Adjustment',
        refId || 'MANUAL',
        user?.id || null,
        date || new Date()
      ]
    );

    emitEvent('inventory.updated', { productId, currentStock: updatedCurrentStock });

    return updateRes.rows[0];
  }
}

module.exports = InventoryService;
