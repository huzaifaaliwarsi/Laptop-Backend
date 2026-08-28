const db = require('../../config/db');
const { getNextInvoiceNo, getNextEntityId } = require('../../utils/codeGenerator');
const { validateOutflow } = require('../../utils/financialFormulas');
const InventoryService = require('../inventory/inventory.service');
const { emitEvent } = require('../../config/socket');

function paymentStatus(total, paid, settled = false) {
  if (settled) return 'Settled';
  const t = parseFloat(total || 0);
  const p = parseFloat(paid || 0);
  if (t <= 0 || p >= t) return 'Paid';
  if (p > 0) return 'Partial';
  return 'Unpaid';
}

class InvoiceService {
  /**
   * Complete atomic POS retail sale
   */
  static async createSale(saleData, user) {
    return await db.withTransaction(async (client) => {
      const { customerName, contact, customerId: reqCustId, date, paymentMethod, referenceId, items, paid: reqPaid } = saleData;

      if (!items || !Array.isArray(items) || items.length === 0) {
        const error = new Error('Invoice must contain at least one product line.');
        error.status = 400;
        throw error;
      }

      if (!customerName || String(customerName).trim() === '') {
        const error = new Error('Customer name is required.');
        error.status = 400;
        throw error;
      }

      // Ensure customer exists
      let customerId = reqCustId;
      const cleanName = customerName.trim();
      const cleanContact = contact ? contact.trim() : null;

      if (!customerId) {
        const custRes = await client.query(
          `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
          [cleanName, cleanContact]
        );
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        } else {
          customerId = await getNextEntityId('customers', 'id', 'CUS', 4, client);
          await client.query(
            `INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`,
            [customerId, cleanName, cleanContact]
          );
        }
      }

      const invoiceNo = await getNextInvoiceNo('sale', client);
      const invoiceId = await getNextEntityId('invoices', 'id', 'INV', 5, client);

      let productTotal = 0;
      let serviceTotal = 0;
      const processedItems = [];

      // Process each line item (Stock Product, Custom Sourced Product, or Service)
      for (const item of items) {
        const isService = item.itemType === 'service' || item.isService === true;
        const isCustom = item.itemType === 'custom_product' || item.isCustom === true || (!item.productId && !isService);

        if (isService) {
          const quantity = parseInt(item.quantity || 1, 10);
          const rawPrice = item.salePrice !== undefined && item.salePrice !== null ? item.salePrice : (item.unitPrice || 0);
          const salePrice = parseFloat(rawPrice);
          if (isNaN(salePrice) || salePrice < 0) {
            const error = new Error('Service charge cannot be negative.');
            error.status = 400;
            throw error;
          }
          const lineTotal = quantity * salePrice;
          serviceTotal += lineTotal;

          processedItems.push({
            itemType: 'service',
            productId: null,
            code: item.code || 'SRV',
            name: item.name ? item.name.trim() : 'Service / Software Charge',
            description: item.description ? item.description.trim() : 'Service / Software Charge',
            quantity,
            unitPrice: salePrice,
            costPriceSnapshot: 0.00,
            lineTotal
          });
        } else if (isCustom) {
          // Custom Sale: Direct external source & sold immediately without inventory stock deduction
          const quantity = parseInt(item.quantity || 1, 10);
          if (isNaN(quantity) || quantity <= 0) {
            const error = new Error('Custom item quantity must be greater than 0.');
            error.status = 400;
            throw error;
          }

          const rawSalePrice = item.salePrice !== undefined && item.salePrice !== null ? item.salePrice : item.unitPrice;
          const salePrice = parseFloat(rawSalePrice || 0);
          if (isNaN(salePrice) || salePrice < 0) {
            const error = new Error('Custom item sale price cannot be negative.');
            error.status = 400;
            throw error;
          }

          const rawCostPrice = item.costPrice !== undefined && item.costPrice !== null
            ? item.costPrice
            : (item.purchaseCost !== undefined ? item.purchaseCost : (item.cost_price || 0));
          const costPrice = parseFloat(rawCostPrice || 0);
          if (isNaN(costPrice) || costPrice < 0) {
            const error = new Error('Custom item purchase cost cannot be negative.');
            error.status = 400;
            throw error;
          }

          const lineTotal = quantity * salePrice;
          productTotal += lineTotal;

          processedItems.push({
            itemType: 'custom_product',
            productId: null,
            code: item.code || 'CUSTOM',
            name: item.name ? item.name.trim() : 'Custom Sourced Product',
            description: item.description ? item.description.trim() : 'Direct Sourced Custom Item',
            quantity,
            unitPrice: salePrice,
            costPriceSnapshot: costPrice,
            lineTotal
          });
        } else {
          // Standard Inventory Stock Product
          const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
          if (prodRes.rows.length === 0) {
            const error = new Error('Product not found in inventory.');
            error.status = 404;
            throw error;
          }
          const product = prodRes.rows[0];
          const quantity = parseInt(item.quantity || 1, 10);
          const rawPrice = item.salePrice !== undefined && item.salePrice !== null && item.salePrice !== ''
            ? item.salePrice
            : product.expected_sale_price;
          const salePrice = parseFloat(rawPrice);

          if (isNaN(salePrice) || salePrice < 0) {
            const error = new Error(`Invalid sale price for ${product.code}. Price cannot be negative or blank.`);
            error.status = 400;
            throw error;
          }

          if (quantity <= 0 || quantity > product.current_stock) {
            const error = new Error(`Insufficient stock for ${product.code}. Available: ${product.current_stock}, Requested: ${quantity}`);
            error.status = 400;
            error.code = 'INSUFFICIENT_STOCK';
            throw error;
          }

          // Deduct inventory
          await InventoryService.adjustStock({
            productId: product.id,
            direction: 'OUT',
            quantity,
            reason: `POS Sales Invoice ${invoiceNo}`,
            refType: 'Sales Invoice',
            refId: invoiceId,
            date: date || new Date(),
            user
          }, client);

          const lineTotal = quantity * salePrice;
          productTotal += lineTotal;

          processedItems.push({
            itemType: 'product',
            productId: product.id,
            code: product.code,
            name: `${product.brand} ${product.model || product.product_name || ''}`.trim(),
            description: `${product.category_name} — ${product.brand} ${product.model} | ${product.specifications || ''}`,
            quantity,
            unitPrice: salePrice,
            costPriceSnapshot: parseFloat(product.cost_price || 0),
            lineTotal
          });
        }
      }

      const total = productTotal + serviceTotal;
      const paid = Math.min(parseFloat(reqPaid || 0), total);
      const balance = Math.max(0, total - paid);
      const payStatus = paymentStatus(total, paid);
      const pMethod = paymentMethod || 'Cash';

      if (pMethod === 'Online' && paid > 0 && (!referenceId || String(referenceId).trim() === '')) {
        const error = new Error('Online payment reference ID is required.');
        error.status = 400;
        throw error;
      }

      // Insert invoice
      const invoiceRes = await client.query(
        `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Sales Invoice', 'sale', $3, 'Customer', $4, $5, $6,
          $7, $8, $9, $10, $10, $11, $12,
          $13, $14, FALSE, $15, $16
        ) RETURNING *`,
        [
          invoiceId, invoiceNo, date || new Date(), customerId, cleanName, cleanContact,
          productTotal, serviceTotal, total, paid, balance, pMethod,
          referenceId ? referenceId.trim() : null, payStatus, user.id, user.name
        ]
      );

      // Insert invoice items
      for (const pItem of processedItems) {
        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            invoiceId, pItem.itemType || 'product', pItem.productId, pItem.code, pItem.name, pItem.description,
            pItem.quantity, pItem.unitPrice, pItem.costPriceSnapshot, pItem.lineTotal
          ]
        );
      }

      // If initial payment made
      if (paid > 0) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
            'Received', $6, $7, $8, $9, 'Initial POS sales payment', TRUE,
            TRUE, $10, $11
          )`,
          [
            payId, invoiceId, invoiceNo, customerId, cleanName,
            paid, date || new Date(), pMethod, referenceId || null, user.id, user.name
          ]
        );
      }

      // If balance remains, create Customer Receivable account
      if (balance > 0) {
        const accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
        await client.query(
          `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Customer Receivable', 'Customer', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
          [accId, customerId, cleanName, invoiceId, invoiceNo, balance, balance, date || new Date()]
        );
      }

      emitEvent('invoice.created', invoiceRes.rows[0]);

      return {
        invoice: invoiceRes.rows[0],
        items: processedItems
      };
    });
  }

  /**
   * Complete atomic Vendor Purchase
   */
  static async createVendorPurchase(purchaseData, user) {
    return await db.withTransaction(async (client) => {
      const { vendorName, vendorId: reqVndId, date, paymentMethod, referenceId, paid: reqPaid } = purchaseData;
      const lines = Array.isArray(purchaseData.lines) && purchaseData.lines.length > 0
        ? purchaseData.lines
        : (purchaseData.product ? [purchaseData.product] : []);

      if (!lines || lines.length === 0) {
        const error = new Error('Purchase must contain at least one product line.');
        error.status = 400;
        throw error;
      }

      if (!vendorName || String(vendorName).trim() === '') {
        const error = new Error('Vendor name is required.');
        error.status = 400;
        throw error;
      }

      let vendorId = reqVndId;
      const cleanName = vendorName.trim();
      const rawContact = purchaseData.vendorContact || purchaseData.contact;
      const cleanContact = rawContact ? String(rawContact).trim() : null;

      if (!vendorId) {
        const vndRes = await client.query(
          `SELECT id FROM vendors WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
          [cleanName, cleanContact]
        );
        if (vndRes.rows.length > 0) {
          vendorId = vndRes.rows[0].id;
        } else {
          vendorId = await getNextEntityId('vendors', 'id', 'VND', 4, client);
          await client.query(
            `INSERT INTO vendors (id, name, contact) VALUES ($1, $2, $3)`,
            [vendorId, cleanName, cleanContact]
          );
        }
      }

      const total = lines.reduce((sum, line) => sum + (parseInt(line.quantity || 1, 10) * parseFloat(line.costPrice || 0)), 0);
      const paid = Math.min(parseFloat(reqPaid || 0), total);
      const balance = Math.max(0, total - paid);
      const pMethod = paymentMethod || 'Cash';

      // Check available cash/online balance if paid > 0
      if (paid > 0) {
        await validateOutflow(pMethod, paid, 'Vendor Purchase Payment', client);
      }

      const invoiceNo = await getNextInvoiceNo('vendor_purchase', client);
      const invoiceId = await getNextEntityId('invoices', 'id', 'INV', 5, client);
      const payStatus = paymentStatus(total, paid);

      const invoiceRes = await client.query(
        `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Vendor Purchase', 'vendor_purchase', $3, 'Vendor', $4, $5, $6,
          $7, 0, $8, $9, $10, $11, $12,
          $13, $14, FALSE, $15, $16
        ) RETURNING *`,
        [
          invoiceId, invoiceNo, date || new Date(), vendorId, cleanName, cleanContact,
          total, total, paid, paid, balance, pMethod,
          referenceId || null, payStatus, user.id, user.name
        ]
      );

      const processedItems = [];
      for (const line of lines) {
        const sourceData = {
          inventoryType: 'Vendor Purchased',
          sourceName: cleanName,
          invoiceNo,
          date: date || new Date(),
          reason: 'Vendor Purchase',
          refType: 'Vendor Purchase',
          refId: invoiceId
        };
        const mergeResult = await InventoryService.addOrMergeProduct(line, sourceData, user, client);
        const qty = parseInt(line.quantity || 1, 10);
        const costPrice = parseFloat(line.costPrice || 0);

        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            invoiceId, mergeResult.product.id, mergeResult.product.code,
            `${mergeResult.product.brand} ${mergeResult.product.model}`.trim(),
            `${mergeResult.product.category_name} — ${mergeResult.product.brand} ${mergeResult.product.model}`,
            qty, costPrice, costPrice, qty * costPrice
          ]
        );

        processedItems.push(mergeResult.product);
      }

      if (paid > 0) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Vendor', $4, $5, 'Vendor Payable',
            'Paid', $6, $7, $8, $9, 'Initial vendor purchase payment', TRUE,
            TRUE, $10, $11
          )`,
          [
            payId, invoiceId, invoiceNo, vendorId, cleanName,
            paid, date || new Date(), pMethod, referenceId || null, user.id, user.name
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
          [accId, vendorId, cleanName, invoiceId, invoiceNo, balance, balance, date || new Date()]
        );
      }

      emitEvent('invoice.created', invoiceRes.rows[0]);

      return {
        invoice: invoiceRes.rows[0],
        products: processedItems
      };
    });
  }

  /**
   * Complete atomic Customer Purchase (Trade-in buyback)
   */
  static async createCustomerPurchase(purchaseData, user) {
    return await db.withTransaction(async (client) => {
      const { customerName, customerId: reqCustId, date, paymentMethod, referenceId, paid: reqPaid } = purchaseData;
      const lines = Array.isArray(purchaseData.lines) && purchaseData.lines.length > 0
        ? purchaseData.lines
        : (purchaseData.product ? [purchaseData.product] : []);

      if (!lines || lines.length === 0) {
        const error = new Error('Purchase must contain at least one product line.');
        error.status = 400;
        throw error;
      }

      if (!customerName || String(customerName).trim() === '') {
        const error = new Error('Customer name is required.');
        error.status = 400;
        throw error;
      }

      let customerId = reqCustId;
      const cleanName = customerName.trim();
      const rawContact = purchaseData.customerContact || purchaseData.contact;
      const cleanContact = rawContact ? String(rawContact).trim() : null;

      if (!customerId) {
        const custRes = await client.query(
          `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
          [cleanName, cleanContact]
        );
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        } else {
          customerId = await getNextEntityId('customers', 'id', 'CUS', 4, client);
          await client.query(
            `INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`,
            [customerId, cleanName, cleanContact]
          );
        }
      }

      const total = lines.reduce((sum, line) => sum + (parseInt(line.quantity || 1, 10) * parseFloat(line.costPrice || 0)), 0);
      const paid = Math.min(parseFloat(reqPaid || 0), total);
      const balance = Math.max(0, total - paid);
      const pMethod = paymentMethod || 'Cash';

      if (paid > 0) {
        await validateOutflow(pMethod, paid, 'Customer Purchase Payment', client);
      }

      const invoiceNo = await getNextInvoiceNo('customer_purchase', client);
      const invoiceId = await getNextEntityId('invoices', 'id', 'INV', 5, client);
      const payStatus = paymentStatus(total, paid);

      const invoiceRes = await client.query(
        `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          product_total, service_total, total, paid, initial_paid, balance, payment_method,
          reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Customer Purchase', 'customer_purchase', $3, 'Customer', $4, $5, $6,
          $7, 0, $8, $9, $10, $11, $12,
          $13, $14, FALSE, $15, $16
        ) RETURNING *`,
        [
          invoiceId, invoiceNo, date || new Date(), customerId, cleanName, cleanContact,
          total, total, paid, paid, balance, pMethod,
          referenceId || null, payStatus, user.id, user.name
        ]
      );

      const processedItems = [];
      for (const line of lines) {
        const sourceData = {
          inventoryType: 'Customer Purchased',
          sourceName: cleanName,
          invoiceNo,
          date: date || new Date(),
          reason: 'Customer Purchase',
          refType: 'Customer Purchase',
          refId: invoiceId
        };
        const mergeResult = await InventoryService.addOrMergeProduct(line, sourceData, user, client);
        const qty = parseInt(line.quantity || 1, 10);
        const costPrice = parseFloat(line.costPrice || 0);

        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_type, product_id, code, name, description, quantity,
            unit_price, cost_price_snapshot, line_total
          ) VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            invoiceId, mergeResult.product.id, mergeResult.product.code,
            `${mergeResult.product.brand} ${mergeResult.product.model}`.trim(),
            `${mergeResult.product.category_name} — ${mergeResult.product.brand} ${mergeResult.product.model}`,
            qty, costPrice, costPrice, qty * costPrice
          ]
        );

        processedItems.push(mergeResult.product);
      }

      if (paid > 0) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Payable',
            'Paid', $6, $7, $8, $9, 'Initial customer purchase payment', TRUE,
            TRUE, $10, $11
          )`,
          [
            payId, invoiceId, invoiceNo, customerId, cleanName,
            paid, date || new Date(), pMethod, referenceId || null, user.id, user.name
          ]
        );
      }

      if (balance > 0) {
        const accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
        await client.query(
          `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Customer Payable', 'Customer', $2, $3, $4, $5, $6, $7, 'Open', $8)`,
          [accId, customerId, cleanName, invoiceId, invoiceNo, balance, balance, date || new Date()]
        );
      }

      emitEvent('invoice.created', invoiceRes.rows[0]);

      return {
        invoice: invoiceRes.rows[0],
        products: processedItems
      };
    });
  }

  /**
   * Complete atomic 1-to-1 Product Exchange
   */
  static async createExchange(exchangeData, user) {
    return await db.withTransaction(async (client) => {
      const { customerName, contact, customerId: reqCustId, date, paymentMethod, referenceId } = exchangeData;
      const shopProductId = exchangeData.shopProductId || exchangeData.outProductId;
      const receivedProduct = exchangeData.receivedProduct || exchangeData.inProduct;

      if (!customerName || String(customerName).trim() === '') {
        const error = new Error('Customer name is required.');
        error.status = 400;
        throw error;
      }

      if (!shopProductId) {
        const error = new Error('Please select a shop product for exchange.');
        error.status = 400;
        throw error;
      }

      if (!receivedProduct) {
        const error = new Error('Customer trade-in product details are required.');
        error.status = 400;
        throw error;
      }

      // Check shop product stock
      const shopProdRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [shopProductId]);
      if (shopProdRes.rows.length === 0) {
        const error = new Error('Shop product not found.');
        error.status = 404;
        throw error;
      }
      const shopProduct = shopProdRes.rows[0];
      if (shopProduct.current_stock < 1) {
        const error = new Error(`Shop product ${shopProduct.code} is out of stock.`);
        error.status = 400;
        error.code = 'INSUFFICIENT_STOCK';
        throw error;
      }

      let customerId = reqCustId;
      const cleanName = customerName.trim();
      const rawContact = contact || exchangeData.customerContact;
      const cleanContact = rawContact ? String(rawContact).trim() : null;

      if (!customerId) {
        const custRes = await client.query(
          `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND ($2::varchar IS NULL OR contact = $2)`,
          [cleanName, cleanContact]
        );
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        } else {
          customerId = await getNextEntityId('customers', 'id', 'CUS', 4, client);
          await client.query(`INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3)`, [customerId, cleanName, cleanContact]);
        }
      }

      const sVal = parseFloat(exchangeData.shopValue || exchangeData.outSaleValue || shopProduct.expected_sale_price || shopProduct.cost_price || 0);
      const cVal = parseFloat(exchangeData.customerValue || exchangeData.inValue || receivedProduct.costPrice || 0);
      
      let exchangeCase = exchangeData.exchangeCase;
      const diff = sVal - cVal;
      if (!exchangeCase) {
        if (diff > 0.005) exchangeCase = 'Customer Pays Shop';
        else if (diff < -0.005) exchangeCase = 'Shop Pays Customer';
        else exchangeCase = 'Even Exchange';
      }

      let difference = 0;
      if (exchangeCase === 'Customer Pays Shop') difference = Math.max(0, sVal - cVal);
      else if (exchangeCase === 'Shop Pays Customer') difference = Math.max(0, cVal - sVal);
      else difference = 0; // Even exchange

      const reqPaid = exchangeData.paid !== undefined ? exchangeData.paid : difference;
      const paid = Math.min(parseFloat(reqPaid || 0), difference);
      const balance = Math.max(0, difference - paid);
      const pMethod = paymentMethod || 'Cash';

      if (exchangeCase === 'Shop Pays Customer' && paid > 0) {
        await validateOutflow(pMethod, paid, 'Exchange Payment to Customer', client);
      }

      const invoiceNo = await getNextInvoiceNo('exchange', client);
      const invoiceId = await getNextEntityId('invoices', 'id', 'INV', 5, client);
      const payStatus = paymentStatus(difference, paid, exchangeCase === 'Even Exchange');

      // Deduct shop product
      await InventoryService.adjustStock({
        productId: shopProduct.id,
        direction: 'OUT',
        quantity: 1,
        reason: `Product given in exchange ${invoiceNo}`,
        refType: 'Exchange Invoice',
        refId: invoiceId,
        date: date || new Date(),
        user
      }, client);

      // Add received customer product
      const sourceData = {
        inventoryType: 'Customer Purchased',
        sourceName: cleanName,
        invoiceNo,
        date: date || new Date(),
        reason: 'Customer exchange item received',
        refType: 'Exchange Invoice',
        refId: invoiceId
      };
      const recResult = await InventoryService.addOrMergeProduct(receivedProduct, sourceData, user, client);

      // Create exchange invoice
      const invoiceRes = await client.query(
        `INSERT INTO invoices (
          id, invoice_no, type, type_key, date, party_type, party_id, party_name, contact,
          exchange_case, product_total, service_total, total, paid, initial_paid, balance,
          payment_method, reference_id, payment_status, is_voided, created_by, created_by_name
        ) VALUES (
          $1, $2, 'Exchange Invoice', 'exchange', $3, 'Customer', $4, $5, $6,
          $7, $8, 0, $9, $10, $11, $12,
          $13, $14, $15, FALSE, $16, $17
        ) RETURNING *`,
        [
          invoiceId, invoiceNo, date || new Date(), customerId, cleanName, cleanContact,
          exchangeCase, difference, difference, paid, paid, balance,
          pMethod, referenceId || null, payStatus, user.id, user.name
        ]
      );

      // Add items
      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'product', $2, $3, $4, $5, 1, $6, $7, $8)`,
        [
          invoiceId, shopProduct.id, shopProduct.code,
          `${shopProduct.brand} ${shopProduct.model}`.trim(),
          `Shop product given: ${shopProduct.category_name} — ${shopProduct.brand} ${shopProduct.model}`,
          sVal, parseFloat(shopProduct.cost_price || 0), sVal
        ]
      );

      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_type, product_id, code, name, description, quantity, unit_price, cost_price_snapshot, line_total)
         VALUES ($1, 'product', $2, $3, $4, $5, 1, $6, $7, $8)`,
        [
          invoiceId, recResult.product.id, recResult.product.code,
          `${recResult.product.brand} ${recResult.product.model}`.trim(),
          `Customer product received: ${recResult.product.category_name} — ${recResult.product.brand} ${recResult.product.model}`,
          cVal, parseFloat(recResult.product.cost_price || 0), cVal
        ]
      );

      if (paid > 0) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        const direction = exchangeCase === 'Customer Pays Shop' ? 'Received' : 'Paid';
        const accountType = exchangeCase === 'Customer Pays Shop' ? 'Customer Receivable' : 'Customer Payable';

        await client.query(
          `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, $6,
            $7, $8, $9, $10, $11, 'Initial exchange settlement', TRUE,
            TRUE, $12, $13
          )`,
          [
            payId, invoiceId, invoiceNo, customerId, cleanName, accountType,
            direction, paid, date || new Date(), pMethod, referenceId || null, user.id, user.name
          ]
        );
      }

      if (balance > 0) {
        const accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
        const accType = exchangeCase === 'Customer Pays Shop' ? 'Customer Receivable' : 'Customer Payable';
        await client.query(
          `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, $2, 'Customer', $3, $4, $5, $6, $7, $8, 'Open', $9)`,
          [accId, accType, customerId, cleanName, invoiceId, invoiceNo, balance, balance, date || new Date()]
        );
      }

      emitEvent('invoice.created', invoiceRes.rows[0]);

      return {
        invoice: invoiceRes.rows[0],
        shopProduct,
        receivedProduct: recResult.product
      };
    });
  }

  /**
   * Void sales invoice & restore stock
   */
  static async voidSale(id, voidData, user) {
    return await db.withTransaction(async (client) => {
      const invRes = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
      if (invRes.rows.length === 0) {
        const error = new Error('Invoice not found.');
        error.status = 404;
        throw error;
      }
      const invoice = invRes.rows[0];

      if (invoice.is_voided) {
        const error = new Error('This invoice is already voided.');
        error.status = 400;
        throw error;
      }

      const { reason, refundAmount: reqRefund, refundMethod, referenceId, date } = voidData;
      if (!reason || String(reason).trim() === '') {
        const error = new Error('Void reason is required.');
        error.status = 400;
        throw error;
      }

      const refundAmount = Math.min(parseFloat(reqRefund !== undefined ? reqRefund : invoice.paid), parseFloat(invoice.paid || 0));
      const rMethod = refundMethod || 'Cash';

      // Restock items
      const itemsRes = await client.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [id]);
      for (const item of itemsRes.rows) {
        if (item.product_id && item.quantity > 0) {
          await InventoryService.adjustStock({
            productId: item.product_id,
            direction: 'IN',
            quantity: item.quantity,
            reason: `Sales return / invoice void: ${invoice.invoice_no}`,
            refType: 'Sales Void',
            refId: invoice.id,
            date: date || new Date(),
            user
          }, client);
        }
      }

      // Cancel open customer receivable
      await client.query(
        `UPDATE accounts SET status = 'Cancelled', remaining = 0 WHERE invoice_id = $1 AND status = 'Open'`,
        [id]
      );

      // Record refund payout in payments table if refund given
      if (refundAmount > 0) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, $3, 'Customer', $4, $5, 'Customer Receivable',
            'Paid', $6, $7, $8, $9, $10, TRUE, FALSE, $11, $12
          )`,
          [
            payId, invoice.id, invoice.invoice_no, invoice.party_id, invoice.party_name,
            refundAmount, date || new Date(), rMethod, referenceId ? referenceId.trim() : null,
            `Sales Void Refund: ${reason.trim()}`, user.id, user.name
          ]
        );
      }

      // Update invoice to voided
      const updateRes = await client.query(
        `UPDATE invoices SET
          is_voided = TRUE,
          payment_status = 'Voided',
          balance = 0,
          void_date = $1,
          void_reason = $2,
          refund_amount = $3,
          refund_method = $4,
          refund_reference = $5,
          voided_by = $6,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [
          date || new Date(), reason.trim(), refundAmount, rMethod,
          referenceId ? referenceId.trim() : null, user.id, id
        ]
      );

      emitEvent('invoice.voided', updateRes.rows[0]);

      return updateRes.rows[0];
    });
  }

  /**
   * Complete atomic Vendor Return with multi-mode settlement
   */
  static async createVendorReturn(returnData, user) {
    return await db.withTransaction(async (client) => {
      const {
        vendorId: reqVndId, vendorName: reqVndName, productId, quantity: reqQty, amount: reqAmount,
        unitRate, receivedNow: reqReceived, initialSettlement: reqSettled,
        paymentMethod, settlementMethod, referenceId, reason, date, replacementMode,
        sameReplacementQty, replacementProductData
      } = returnData;

      const qty = parseInt(reqQty || 1, 10);
      const rate = parseFloat(unitRate || 0);
      const amount = parseFloat(reqAmount || (qty * rate) || 0);
      const method = settlementMethod || paymentMethod || 'Vendor Payable Adjustment';

      if (qty <= 0 || amount <= 0) {
        const error = new Error('Return quantity and amount must be greater than zero.');
        error.status = 400;
        throw error;
      }

      const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (prodRes.rows.length === 0) {
        const error = new Error('Returned product not found.');
        error.status = 404;
        throw error;
      }
      const product = prodRes.rows[0];

      if (qty > product.current_stock) {
        const error = new Error(`Only ${product.current_stock} unit(s) available in stock to return.`);
        error.status = 400;
        error.code = 'INSUFFICIENT_STOCK';
        throw error;
      }

      let vendor = null;
      let vendorId = reqVndId || returnData.vendor_id;
      const vendorName = reqVndName || returnData.vendor_name || product.source_name;

      if (vendorId) {
        const vndRes = await client.query('SELECT id, name FROM vendors WHERE id = $1', [vendorId]);
        if (vndRes.rows.length > 0) vendor = vndRes.rows[0];
      }
      if (!vendor && vendorName && String(vendorName).trim() !== '' && String(vendorName).trim() !== 'Manual Entry') {
        const vndRes = await client.query('SELECT id, name FROM vendors WHERE LOWER(name) = LOWER($1)', [String(vendorName).trim()]);
        if (vndRes.rows.length > 0) {
          vendor = vndRes.rows[0];
          vendorId = vendor.id;
        } else {
          vendorId = await getNextEntityId('vendors', 'id', 'VND', 4, client);
          await client.query('INSERT INTO vendors (id, name) VALUES ($1, $2)', [vendorId, String(vendorName).trim()]);
          vendor = { id: vendorId, name: String(vendorName).trim() };
        }
      }

      if (!vendor) {
        const error = new Error('Vendor information is required for return.');
        error.status = 400;
        throw error;
      }

      const returnId = await getNextEntityId('vendor_returns', 'id', 'VRT', 4, client);

      // Deduct returned stock
      await InventoryService.adjustStock({
        productId: product.id,
        direction: 'OUT',
        quantity: qty,
        reason: `Vendor Return ${returnId}`,
        refType: 'Vendor Return',
        refId: returnId,
        date: date || new Date(),
        user
      }, client);

      let initialSettlement = parseFloat(reqReceived || 0);
      let actualMoneyReceived = 0;
      let exchangeValue = 0;
      let payableAdjustment = 0;
      let repProduct = null;
      let repQty = 0;

      if (method === 'Cash' || method === 'Online') {
        actualMoneyReceived = initialSettlement;
      } else if (method === 'Exchange Credit' || method === 'Exchange' || method === 'Product Replacement / Exchange') {
        exchangeValue = initialSettlement;
        if (replacementMode === 'same') {
          repQty = parseInt(sameReplacementQty || qty, 10);
          await InventoryService.adjustStock({
            productId: product.id,
            direction: 'IN',
            quantity: repQty,
            reason: `Same product replacement for return ${returnId}`,
            refType: 'Vendor Return',
            refId: returnId,
            date: date || new Date(),
            user
          }, client);
          repProduct = product;
        } else if (replacementProductData) {
          repQty = parseInt(replacementProductData.quantity || 1, 10);
          const sourceData = {
            inventoryType: 'Vendor Purchased',
            sourceName: vendor.name,
            invoiceNo: returnId,
            date: date || new Date(),
            reason: 'Different product replacement received',
            refType: 'Vendor Return',
            refId: returnId
          };
          const repRes = await InventoryService.addOrMergeProduct(replacementProductData, sourceData, user, client);
          repProduct = repRes.product;
        }
      } else if (method === 'Vendor Adjustment' || method === 'Vendor Payable Adjustment') {
        // Adjust against oldest open Vendor Payables
        const openPayables = await client.query(
          `SELECT * FROM accounts WHERE party_id = $1 AND type = 'Vendor Payable' AND status = 'Open' ORDER BY date ASC FOR UPDATE`,
          [vendor.id]
        );

        let remainingToApply = initialSettlement;
        for (const acc of openPayables.rows) {
          if (remainingToApply <= 0.005) break;
          const accRem = parseFloat(acc.remaining || 0);
          const applyAmt = Math.min(accRem, remainingToApply);

          const newRem = Math.max(0, accRem - applyAmt);
          const newStatus = newRem <= 0.005 ? 'Settled' : 'Open';

          await client.query(
            `UPDATE accounts SET remaining = $1, status = $2 WHERE id = $3`,
            [newRem, newStatus, acc.id]
          );

          if (acc.invoice_id) {
            await client.query(
              `UPDATE invoices SET credit_adjusted = credit_adjusted + $1, balance = $2, payment_status = $3 WHERE id = $4`,
              [applyAmt, newRem, newRem <= 0.005 ? 'Paid' : 'Partial', acc.invoice_id]
            );
          }

          remainingToApply -= applyAmt;
        }
        payableAdjustment = initialSettlement - remainingToApply;
        initialSettlement = payableAdjustment;
      }

      const balance = Math.max(0, amount - initialSettlement);
      const retStatus = balance <= 0.005 ? 'Paid' : initialSettlement > 0 ? 'Partial' : 'Unpaid';

      const insertRes = await client.query(
        `INSERT INTO vendor_returns (
          id, vendor_id, vendor_name, product_id, product_code, returned_product_name,
          quantity, amount, initial_settlement, actual_money_received, exchange_value,
          payable_adjustment, replacement_mode, replacement_qty, replacement_product_id,
          replacement_product_code, replacement_product_name, replacement_product_cost_price,
          replacement_expected_sale_price, balance, payment_method, settlement_method,
          reference_id, reason, date, status, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
        ) RETURNING *`,
        [
          returnId, vendor.id, vendor.name, product.id, product.code,
          `${product.brand} ${product.model || product.product_name || ''}`.trim(),
          qty, amount, initialSettlement, actualMoneyReceived, exchangeValue, payableAdjustment,
          replacementMode || null, repQty, repProduct?.id || null, repProduct?.code || null,
          repProduct ? `${repProduct.brand} ${repProduct.model || repProduct.product_name || ''}`.trim() : null,
          repProduct ? parseFloat(repProduct.cost_price || 0) : 0,
          repProduct ? parseFloat(repProduct.expected_sale_price || 0) : 0,
          balance, method, method, referenceId ? referenceId.trim() : null,
          reason ? reason.trim() : null, date || new Date(), retStatus, user.id, user.name
        ]
      );

      // If linked to an existing purchase invoice, update invoice credit_adjusted / void status
      const linkedInvNo = returnData.invoiceNo || returnData.purchaseInvoiceNo || referenceId || product.purchase_invoice_no;
      const linkedInvId = returnData.invoiceId;
      if (linkedInvId || (linkedInvNo && linkedInvNo !== 'MANUAL')) {
        const invLookup = await client.query(
          `SELECT * FROM invoices WHERE id = $1 OR invoice_no = $2`,
          [linkedInvId || null, linkedInvNo || null]
        );
        if (invLookup.rows.length > 0) {
          const origInv = invLookup.rows[0];
          const newCreditAdj = parseFloat(origInv.credit_adjusted || 0) + amount;
          const isFullyReturned = newCreditAdj >= parseFloat(origInv.total || 0) - 0.005;
          await client.query(
            `UPDATE invoices SET
              credit_adjusted = $1,
              is_voided = CASE WHEN $2 THEN TRUE ELSE is_voided END,
              void_reason = CASE WHEN $2 THEN $3 ELSE void_reason END,
              void_date = CASE WHEN $2 THEN $4 ELSE void_date END,
              refund_amount = CASE WHEN $2 THEN $5 ELSE refund_amount END,
              payment_status = CASE WHEN $2 THEN 'Voided' ELSE payment_status END,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [
              newCreditAdj,
              isFullyReturned,
              reason ? `Vendor Return: ${reason.trim()}` : 'Vendor product return',
              date || new Date(),
              amount,
              origInv.id
            ]
          );
        }
      }

      // If credit remains unpaid, create Vendor Receivable account
      let accId = null;
      if (balance > 0) {
        accId = await getNextEntityId('accounts', 'id', 'ACC', 4, client);
        await client.query(
          `INSERT INTO accounts (
            id, type, party_type, party_id, party_name, invoice_id, invoice_no,
            amount, remaining, status, date
          ) VALUES ($1, 'Vendor Receivable', 'Vendor', $2, $3, NULL, $4, $5, $6, 'Open', $7)`,
          [accId, vendor.id, vendor.name, returnId, balance, balance, date || new Date()]
        );
      }

      if (initialSettlement > 0 && (method === 'Cash' || method === 'Online' || method === 'Exchange Credit' || method === 'Exchange' || method === 'Product Replacement / Exchange')) {
        const payId = await getNextEntityId('payments', 'id', 'PAY', 5, client);
        await client.query(
          `INSERT INTO payments (
            id, account_id, invoice_id, invoice_no, party_type, party_id, party_name, account_type,
            direction, amount, date, payment_method, reference_id, notes, affects_money,
            is_initial_settlement, created_by, created_by_name
          ) VALUES (
            $1, $2, NULL, $3, 'Vendor', $4, $5, 'Vendor Receivable',
            $6, $7, $8, $9, $10, $11, $12,
            TRUE, $13, $14
          )`,
          [
            payId, accId, returnId, vendor.id, vendor.name,
            (method === 'Exchange Credit' || method === 'Exchange' || method === 'Product Replacement / Exchange') ? 'Adjusted' : 'Received',
            initialSettlement, date || new Date(), method, referenceId || null,
            (method === 'Exchange Credit' || method === 'Exchange' || method === 'Product Replacement / Exchange') ? `Replacement product: ${repProduct?.code || ''}` : 'Initial vendor return refund',
            method === 'Cash' || method === 'Online', user.id, user.name
          ]
        );
      }

      emitEvent('vendor_returns.created', insertRes.rows[0]);

      return insertRes.rows[0];
    });
  }

  /**
   * Retrieve full invoice with line items & party compliance details
   */
  static async getInvoiceById(id) {
    const invRes = await db.query('SELECT * FROM invoices WHERE id = $1 OR invoice_no = $1', [id]);
    if (invRes.rows.length === 0) return null;
    const invoice = invRes.rows[0];

    const itemsRes = await db.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`,
      [invoice.id]
    );

    // Fetch Party Info from customers or vendors table if partyId is available
    let partyAddress = invoice.party_address || '';
    let partyTaxId = invoice.party_tax_id || '';
    let partyStRegNo = invoice.st_reg_no || '';

    if (invoice.party_id) {
      try {
        if (invoice.party_type === 'Vendor' || invoice.type === 'Vendor Purchase') {
          const vRes = await db.query('SELECT address, ntn_tax_id, st_reg_no FROM vendors WHERE id = $1', [invoice.party_id]);
          if (vRes.rows.length > 0) {
            if (!partyAddress) partyAddress = vRes.rows[0].address || '';
            if (!partyTaxId) partyTaxId = vRes.rows[0].ntn_tax_id || '';
            if (!partyStRegNo) partyStRegNo = vRes.rows[0].st_reg_no || '';
          }
        } else {
          const cRes = await db.query('SELECT address, ntn_cnic, st_reg_no FROM customers WHERE id = $1', [invoice.party_id]);
          if (cRes.rows.length > 0) {
            if (!partyAddress) partyAddress = cRes.rows[0].address || '';
            if (!partyTaxId) partyTaxId = cRes.rows[0].ntn_cnic || '';
            if (!partyStRegNo) partyStRegNo = cRes.rows[0].st_reg_no || '';
          }
        }
      } catch (err) {
        console.error('[getInvoiceById] Party lookup warning:', err.message);
      }
    }

    return {
      id: invoice.id,
      invoiceNo: invoice.invoice_no,
      type: invoice.type,
      typeKey: invoice.type_key,
      date: invoice.date,
      partyType: invoice.party_type,
      partyId: invoice.party_id,
      partyName: invoice.party_name,
      partyAddress: partyAddress,
      partyTaxId: partyTaxId,
      stRegNo: partyStRegNo,
      contact: invoice.contact,
      exchangeCase: invoice.exchange_case,
      productTotal: parseFloat(invoice.product_total || 0),
      serviceTotal: parseFloat(invoice.service_total || 0),
      taxRate: parseFloat(invoice.tax_rate || 0),
      taxAmount: parseFloat(invoice.tax_amount || 0),
      fbrInvoiceNo: invoice.fbr_invoice_no || null,
      total: parseFloat(invoice.total || 0),
      paid: parseFloat(invoice.paid || 0),
      initialPaid: parseFloat(invoice.initial_paid || 0),
      creditAdjusted: parseFloat(invoice.credit_adjusted || 0),
      balance: parseFloat(invoice.balance || 0),
      paymentMethod: invoice.payment_method,
      referenceId: invoice.reference_id,
      paymentStatus: invoice.payment_status,
      isVoided: invoice.is_voided,
      voidDate: invoice.void_date,
      voidReason: invoice.void_reason,
      refundAmount: parseFloat(invoice.refund_amount || 0),
      refundMethod: invoice.refund_method,
      refundReference: invoice.refund_reference,
      repairJobId: invoice.repair_job_id,
      createdById: invoice.created_by,
      createdByName: invoice.created_by_name,
      createdAt: invoice.created_at,
      items: itemsRes.rows.map(item => {
        const qty = parseFloat(item.quantity || 1);
        const rate = parseFloat(item.unit_price || 0);
        const discount = parseFloat(item.discount || 0);
        const grossAmount = qty * rate;
        const lineTotal = parseFloat(item.line_total || (grossAmount - discount));
        return {
          id: item.id,
          itemType: item.item_type,
          productId: item.product_id,
          serviceId: item.service_id,
          productCode: item.code,
          hsCode: item.hs_code || item.code || '—',
          name: item.name,
          description: item.description,
          quantity: qty,
          rate: rate,
          amount: grossAmount,
          discount: discount,
          costPriceSnapshot: parseFloat(item.cost_price_snapshot || 0),
          lineTotal: lineTotal
        };
      })
    };
  }
}

module.exports = InvoiceService;
