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

  // Count existing products with this prefix (case-insensitive)
  const res = await client.query(
    `SELECT code FROM products WHERE code ILIKE $1`,
    [`${prefix}-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const parts = String(row.code).split('-');
    const numPart = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  let nextNum = maxNum + 1;
  let candidate = `${prefix}-${String(nextNum).padStart(4, '0')}`;

  while (true) {
    const check = await client.query('SELECT 1 FROM products WHERE code = $1', [candidate]);
    if (check.rows.length === 0) break;
    nextNum++;
    candidate = `${prefix}-${String(nextNum).padStart(4, '0')}`;
  }

  return candidate;
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
    `SELECT invoice_no FROM invoices WHERE invoice_no ILIKE $1`,
    [`${prefix}-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const parts = String(row.invoice_no).split('-');
    const numPart = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  let nextNum = maxNum + 1;
  let candidate = `${prefix}-${String(nextNum).padStart(5, '0')}`;

  while (true) {
    const check = await client.query('SELECT 1 FROM invoices WHERE invoice_no = $1', [candidate]);
    if (check.rows.length === 0) break;
    nextNum++;
    candidate = `${prefix}-${String(nextNum).padStart(5, '0')}`;
  }

  return candidate;
}

/**
 * Generates next repair tracking ID (e.g. BR01-RPR-00001, BR02-RPR-00001)
 */
async function getNextTrackingId(client = db) {
  const branchContext = require('../middleware/branchContext');
  const store = branchContext.getBranchStore();
  const branchId = store?.branchId || 1;
  const branchCode = branchId === 2 ? 'BR02' : 'BR01';
  const prefix = `${branchCode}-RPR`;

  const res = await client.query(
    `SELECT tracking_id FROM repair_jobs WHERE tracking_id ILIKE 'RPR-%' OR tracking_id ILIKE $1`,
    [`${branchCode}-RPR-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const parts = String(row.tracking_id).split('-');
    const lastPart = parts[parts.length - 1];
    const numPart = parseInt(lastPart, 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  let nextNum = maxNum + 1;
  let candidate = `${prefix}-${String(nextNum).padStart(5, '0')}`;

  while (true) {
    const check = await client.query('SELECT 1 FROM repair_jobs WHERE tracking_id = $1', [candidate]);
    if (check.rows.length === 0) break;
    nextNum++;
    candidate = `${prefix}-${String(nextNum).padStart(5, '0')}`;
  }

  return candidate;
}

/**
 * Generates next ID with prefix (e.g., CUS-0001, VND-0001, ACC-0001, PAY-00001, EXP-00001, HLD-00001, SRV-0001)
 */
async function getNextEntityId(table, idColumn, prefix, padLength = 4, client = db) {
  const res = await client.query(
    `SELECT ${idColumn} as entity_id FROM ${table} WHERE ${idColumn} ILIKE $1`,
    [`${prefix}-%`]
  );

  let maxNum = 0;
  for (const row of res.rows) {
    const parts = String(row.entity_id).split('-');
    const numPart = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(numPart) && numPart > maxNum) {
      maxNum = numPart;
    }
  }

  let nextNum = maxNum + 1;
  let candidate = `${prefix}-${String(nextNum).padStart(padLength, '0')}`;

  while (true) {
    const check = await client.query(`SELECT 1 FROM ${table} WHERE ${idColumn} = $1`, [candidate]);
    if (check.rows.length === 0) break;
    nextNum++;
    candidate = `${prefix}-${String(nextNum).padStart(padLength, '0')}`;
  }

  return candidate;
}

module.exports = {
  getNextProductCode,
  getNextInvoiceNo,
  getNextTrackingId,
  getNextEntityId
};
