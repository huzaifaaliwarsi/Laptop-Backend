const db = require('../../config/db');

class BatchService {
  /**
   * Safe, non-destructive migration ensuring product_batches table & columns exist
   */
  static async initBatchTables(client = db) {
    if (this._initialized) return;

    await client.query(`
      CREATE TABLE IF NOT EXISTS product_batches (
        id SERIAL PRIMARY KEY,
        batch_no VARCHAR(100),
        product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        branch_id INT NOT NULL DEFAULT 1,
        purchase_invoice_no VARCHAR(100),
        source_type VARCHAR(100) DEFAULT 'Vendor Purchase',
        source_id VARCHAR(100),
        source_name VARCHAR(255),
        cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        selling_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
        initial_quantity INT NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 0,
        expiry_date DATE,
        purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_product_batches_prod_branch ON product_batches(product_id, branch_id);
      CREATE INDEX IF NOT EXISTS idx_product_batches_qty ON product_batches(quantity);
      CREATE INDEX IF NOT EXISTS idx_product_batches_expiry ON product_batches(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_product_batches_purchase_date ON product_batches(purchase_date);

      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS batch_id INT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date DATE;

      -- Backfill existing in-stock products with an initial batch if none exists
      INSERT INTO product_batches (
        product_id, branch_id, batch_no, cost_price, selling_price,
        initial_quantity, quantity, expiry_date, purchase_date, source_type
      )
      SELECT 
        p.id,
        COALESCE(p.branch_id, 1),
        'BATCH-INIT-' || p.code,
        COALESCE(p.cost_price, 0.00),
        COALESCE(p.expected_sale_price, 0.00),
        p.current_stock,
        p.current_stock,
        p.expiry_date,
        COALESCE(p.date_added, CURRENT_DATE),
        'Initial Stock'
      FROM products p
      WHERE p.current_stock > 0
        AND NOT EXISTS (
          SELECT 1 FROM product_batches pb 
          WHERE pb.product_id = p.id AND pb.branch_id = COALESCE(p.branch_id, 1)
        );
    `);

    this._initialized = true;
  }

  /**
   * Helper to generate human-readable unique batch numbers
   */
  static generateBatchNo(productCode = 'PRD') {
    const cleanCode = String(productCode || 'PRD').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
    const ts = Date.now().toString().slice(-6);
    const rnd = Math.floor(Math.random() * 900 + 100);
    return `B-${cleanCode}-${ts}-${rnd}`;
  }

  /**
   * Record a new stock purchase batch
   */
  static async createBatch(data, client = db) {
    const {
      productId,
      branchId = 1,
      batchNo,
      costPrice = 0,
      sellingPrice = 0,
      quantity = 0,
      expiryDate = null,
      purchaseDate = new Date(),
      purchaseInvoiceNo = null,
      sourceType = 'Vendor Purchase',
      sourceId = null,
      sourceName = null
    } = data;

    const qty = parseInt(quantity, 10) || 0;
    const cost = parseFloat(costPrice) || 0.00;
    const sell = parseFloat(sellingPrice) || 0.00;
    const bNo = batchNo || this.generateBatchNo(data.productCode || productId);

    const query = `
      INSERT INTO product_batches (
        product_id, branch_id, batch_no, cost_price, selling_price,
        initial_quantity, quantity, expiry_date, purchase_date,
        purchase_invoice_no, source_type, source_id, source_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const result = await client.query(query, [
      productId,
      branchId,
      bNo,
      cost,
      sell,
      qty,
      qty,
      expiryDate || null,
      purchaseDate,
      purchaseInvoiceNo,
      sourceType,
      sourceId,
      sourceName
    ]);

    // Re-synchronize active prices for this product
    await this.syncProductActiveBatch(productId, branchId, client);

    return result.rows[0];
  }

  /**
   * Allocate stock using strict FIFO / FEFO rules:
   * 1. FEFO: Earliest-expiring valid stock first for items with expiry dates.
   * 2. FIFO: Oldest purchased stock first for non-expiring items or equal expiry.
   * 3. Multi-batch: Splits quantity across batches, returning each slice with
   *    its exact batch selling price and cost price snapshot.
   */
  static async allocateStock({ productId, branchId = 1, requestedQty }, client = db) {
    const reqQty = parseInt(requestedQty, 10);
    if (isNaN(reqQty) || reqQty <= 0) {
      const error = new Error('Requested quantity must be greater than zero.');
      error.status = 400;
      throw error;
    }

    // 1. Fetch available eligible batches with row locks
    let batchesRes = await client.query(
      `SELECT * FROM product_batches
       WHERE product_id = $1 
         AND branch_id = $2 
         AND quantity > 0
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       ORDER BY
         CASE 
           WHEN expiry_date IS NOT NULL THEN 0 
           ELSE 1 
         END ASC,
         expiry_date ASC,
         purchase_date ASC,
         created_at ASC,
         id ASC
       FOR UPDATE`,
      [productId, branchId]
    );

    // Resilient fallback: If no batches exist in table yet, but product has current_stock > 0
    if (batchesRes.rows.length === 0) {
      const prodRes = await client.query('SELECT * FROM products WHERE id = $1 AND branch_id = $2 FOR UPDATE', [productId, branchId]);
      if (prodRes.rows.length > 0 && prodRes.rows[0].current_stock > 0) {
        const prod = prodRes.rows[0];
        await this.createBatch({
          productId: prod.id,
          branchId,
          batchNo: `BATCH-INIT-${prod.code}`,
          costPrice: prod.cost_price || 0,
          sellingPrice: prod.expected_sale_price || 0,
          quantity: prod.current_stock,
          expiryDate: prod.expiry_date,
          purchaseDate: prod.date_added || new Date(),
          sourceType: 'Initial Stock'
        }, client);

        batchesRes = await client.query(
          `SELECT * FROM product_batches
           WHERE product_id = $1 
             AND branch_id = $2 
             AND quantity > 0
             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
           ORDER BY
             CASE WHEN expiry_date IS NOT NULL THEN 0 ELSE 1 END ASC,
             expiry_date ASC,
             purchase_date ASC,
             created_at ASC,
             id ASC
           FOR UPDATE`,
          [productId, branchId]
        );
      }
    }

    const totalValidAvailable = batchesRes.rows.reduce((sum, b) => sum + parseInt(b.quantity, 10), 0);

    if (totalValidAvailable < reqQty) {
      // Check if there was expired stock to give a helpful diagnostic message
      const expiredCheck = await client.query(
        `SELECT SUM(quantity) as expired_qty FROM product_batches
         WHERE product_id = $1 AND branch_id = $2 AND quantity > 0 AND expiry_date < CURRENT_DATE`,
        [productId, branchId]
      );
      const expiredQty = parseInt(expiredCheck.rows[0]?.expired_qty || 0, 10);

      const err = new Error(
        expiredQty > 0
          ? `Insufficient valid stock. ${totalValidAvailable} unit(s) valid in stock, but ${expiredQty} unit(s) have expired.`
          : `Insufficient stock. Only ${totalValidAvailable} unit(s) available.`
      );
      err.status = 400;
      err.code = 'INSUFFICIENT_STOCK';
      throw err;
    }

    // 2. Allocate across batches in ordered sequence
    let remainingToAllocate = reqQty;
    const allocations = [];

    for (const batch of batchesRes.rows) {
      if (remainingToAllocate <= 0) break;

      const batchAvailable = parseInt(batch.quantity, 10);
      const takeQty = Math.min(remainingToAllocate, batchAvailable);

      // Decrement batch available quantity
      await client.query(
        `UPDATE product_batches 
         SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [takeQty, batch.id]
      );

      allocations.push({
        batchId: batch.id,
        batchNo: batch.batch_no,
        quantity: takeQty,
        unitPrice: parseFloat(batch.selling_price || 0),
        costPriceSnapshot: parseFloat(batch.cost_price || 0),
        expiryDate: batch.expiry_date || null,
        purchaseDate: batch.purchase_date
      });

      remainingToAllocate -= takeQty;
    }

    // 3. Update product's active pricing to point to the next eligible batch
    await this.syncProductActiveBatch(productId, branchId, client);

    return allocations;
  }

  /**
   * Return stock into its original batch on invoice void or sales return
   */
  static async returnStockToBatch({ batchId, productId, branchId = 1, quantity }, client = db) {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) return;

    if (batchId) {
      const bRes = await client.query(
        `UPDATE product_batches 
         SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2
         RETURNING *`,
        [qty, batchId]
      );
      if (bRes.rows.length > 0) {
        await this.syncProductActiveBatch(bRes.rows[0].product_id, bRes.rows[0].branch_id, client);
        return bRes.rows[0];
      }
    }

    // Fallback if batchId is missing (e.g. historical invoice item):
    // Restore into the oldest available batch, or create a return batch
    const oldestBatchRes = await client.query(
      `SELECT id FROM product_batches 
       WHERE product_id = $1 AND branch_id = $2 
       ORDER BY purchase_date ASC, id ASC LIMIT 1`,
      [productId, branchId]
    );

    if (oldestBatchRes.rows.length > 0) {
      const updated = await client.query(
        `UPDATE product_batches 
         SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 RETURNING *`,
        [qty, oldestBatchRes.rows[0].id]
      );
      await this.syncProductActiveBatch(productId, branchId, client);
      return updated.rows[0];
    }

    // Otherwise create a return batch from product reference
    const prodRes = await client.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length > 0) {
      const p = prodRes.rows[0];
      return await this.createBatch({
        productId,
        branchId,
        batchNo: `BATCH-RET-${p.code}`,
        costPrice: p.cost_price || 0,
        sellingPrice: p.expected_sale_price || 0,
        quantity: qty,
        purchaseDate: new Date(),
        sourceType: 'Return / Reversal'
      }, client);
    }
  }

  /**
   * Keep products.cost_price and products.expected_sale_price synchronized
   * with the current active FIFO/FEFO batch so POS & listings automatically
   * display the active batch's selling price until exhausted.
   */
  static async syncProductActiveBatch(productId, branchId = 1, client = db) {
    const activeRes = await client.query(
      `SELECT cost_price, selling_price, expiry_date 
       FROM product_batches 
       WHERE product_id = $1 
         AND branch_id = $2 
         AND quantity > 0
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       ORDER BY 
         CASE WHEN expiry_date IS NOT NULL THEN 0 ELSE 1 END ASC,
         expiry_date ASC,
         purchase_date ASC,
         created_at ASC,
         id ASC
       LIMIT 1`,
      [productId, branchId]
    );

    if (activeRes.rows.length > 0) {
      const active = activeRes.rows[0];
      await client.query(
        `UPDATE products 
         SET cost_price = $1, 
             expected_sale_price = $2,
             expiry_date = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND branch_id = $5`,
        [
          parseFloat(active.cost_price || 0),
          parseFloat(active.selling_price || 0),
          active.expiry_date || null,
          productId,
          branchId
        ]
      );
    } else {
      // If all batches are exhausted (0 stock), update to the most recent batch's reference pricing
      const latestRes = await client.query(
        `SELECT cost_price, selling_price, expiry_date 
         FROM product_batches 
         WHERE product_id = $1 AND branch_id = $2 
         ORDER BY purchase_date DESC, created_at DESC, id DESC LIMIT 1`,
        [productId, branchId]
      );
      if (latestRes.rows.length > 0) {
        const latest = latestRes.rows[0];
        await client.query(
          `UPDATE products 
           SET cost_price = $1, 
               expected_sale_price = $2,
               expiry_date = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND branch_id = $5`,
          [
            parseFloat(latest.cost_price || 0),
            parseFloat(latest.selling_price || 0),
            latest.expiry_date || null,
            productId,
            branchId
          ]
        );
      }
    }
  }

  /**
   * List all batches for a specific product
   */
  static async getProductBatches(productId, branchId = 1, client = db) {
    const res = await client.query(
      `SELECT 
         id, batch_no, product_id, branch_id, purchase_invoice_no,
         source_type, source_id, source_name,
         cost_price, selling_price, initial_quantity, quantity,
         expiry_date, purchase_date, created_at, updated_at,
         CASE 
           WHEN expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE THEN 'Expired'
           WHEN quantity = 0 THEN 'Exhausted'
           ELSE 'Active'
         END as status
       FROM product_batches 
       WHERE product_id = $1 AND branch_id = $2
       ORDER BY 
         CASE WHEN expiry_date IS NOT NULL THEN 0 ELSE 1 END ASC,
         expiry_date ASC,
         purchase_date ASC,
         id ASC`,
      [productId, branchId]
    );

    return res.rows.map(r => ({
      id: r.id,
      batchNo: r.batch_no,
      productId: r.product_id,
      branchId: r.branch_id,
      purchaseInvoiceNo: r.purchase_invoice_no,
      sourceType: r.source_type,
      sourceId: r.source_id,
      sourceName: r.source_name,
      costPrice: parseFloat(r.cost_price || 0),
      sellingPrice: parseFloat(r.selling_price || 0),
      initialQuantity: parseInt(r.initial_quantity || 0, 10),
      quantity: parseInt(r.quantity || 0, 10),
      expiryDate: r.expiry_date,
      purchaseDate: r.purchase_date,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
}

module.exports = BatchService;
