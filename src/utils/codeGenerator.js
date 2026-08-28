const db = require('../config/db');

/**
 * Generates the next sequential product code based on category prefix (e.g. LPT-0001)
 */
async function getNextProductCode(categoryId, client = db) {
  let prefix = 'PRD';
  if (categoryId) {
    const catRes = await client.query('SELECT code_prefix, name FROM product_categories WHERE id = $1', [categoryId]);
    if (catRes.rows.length > 0) {
      prefix = catRes.rows[0].code_prefix || String(catRes.rows[0].name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';
    }
  }

  // Count existing products with this prefix
  const res = await client.query(
    `SELECT code FROM products WHERE code LIKE $1 ORDER BY id DESC`,
    [`${prefix}-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const numPart = parseInt(row.code.replace(`${prefix}-`, ''), 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(4, '0')}`;
}

/**
 * Generates the next sequential invoice number (e.g. SAL-00001, VPU-00001, CPU-00001, EXC-00001, RPR-2026-00001)
 */
async function getNextInvoiceNo(typeKey, client = db) {
  const map = {
    sale: 'SAL',
    vendor_purchase: 'VPU',
    customer_purchase: 'CPU',
    exchange: 'EXC',
    repair: 'RPR',
    diagnosis: 'DIA'
  };
  const prefix = map[typeKey] || 'INV';

  const res = await client.query(
    `SELECT invoice_no FROM invoices WHERE invoice_no LIKE $1 ORDER BY id DESC`,
    [`${prefix}-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const numPart = parseInt(row.invoice_no.replace(`${prefix}-`, ''), 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(5, '0')}`;
}

/**
 * Generates next repair tracking ID (e.g. RPR-00001)
 */
async function getNextTrackingId(client = db) {
  const prefix = 'RPR';

  const res = await client.query(
    `SELECT tracking_id FROM repair_jobs WHERE tracking_id LIKE 'RPR-%' ORDER BY id DESC`
  );

  let maxNum = 0;
  for (const row of res.rows) {
    // Extract the trailing number whether it was RPR-2026-00001 or RPR-00001
    const parts = String(row.tracking_id).split('-');
    const lastPart = parts[parts.length - 1];
    const numPart = parseInt(lastPart, 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(5, '0')}`;
}

/**
 * Generates next ID with prefix (e.g., CUS-0001, VND-0001, ACC-0001, PAY-00001, EXP-00001, HLD-00001, SRV-0001)
 */
async function getNextEntityId(table, idColumn, prefix, padLength = 4, client = db) {
  const res = await client.query(
    `SELECT ${idColumn} as entity_id FROM ${table} WHERE ${idColumn} LIKE $1 ORDER BY ${idColumn} DESC`,
    [`${prefix}-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const numPart = parseInt(String(row.entity_id).replace(`${prefix}-`, ''), 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(padLength, '0')}`;
}

module.exports = {
  getNextProductCode,
  getNextInvoiceNo,
  getNextTrackingId,
  getNextEntityId
};
