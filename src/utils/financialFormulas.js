const db = require('../config/db');

/**
 * Derives current available balance for a payment method ('Cash' or 'Online')
 * Formula: Opening Balance + All Money Received - All Money Paid - All Operating Expenses
 */
async function getAvailableBalance(method, client = db) {
  // 1. Get opening balance from business_settings
  const settingsRes = await client.query(`SELECT opening_cash, opening_online FROM business_settings WHERE id = 1`);
  const openingCash = settingsRes.rows.length > 0 ? parseFloat(settingsRes.rows[0].opening_cash || 0) : 0;
  const openingOnline = settingsRes.rows.length > 0 ? parseFloat(settingsRes.rows[0].opening_online || 0) : 0;

  let balance = method === 'Cash' ? openingCash : openingOnline;

  // 2. Aggregate all actual money flows from payments table
  const payRes = await client.query(`
    SELECT 
      COALESCE(SUM(CASE WHEN direction = 'Received' THEN amount WHEN direction = 'Paid' THEN -amount ELSE 0 END), 0) as net_payments
    FROM payments
    WHERE payment_method = $1 AND affects_money = TRUE
  `, [method]);

  // 3. Aggregate operating expenses
  const expRes = await client.query(`
    SELECT COALESCE(SUM(amount), 0) as total_expenses
    FROM expenses
    WHERE payment_method = $1
  `, [method]);

  const netPayments = parseFloat(payRes.rows[0].net_payments || 0);
  const totalExpenses = parseFloat(expRes.rows[0].total_expenses || 0);

  balance += (netPayments - totalExpenses);
  return balance;
}

/**
 * Checks outflow against available funds without hard-blocking,
 * allowing negative drawer balance to be tracked accurately in financial reporting.
 */
async function validateOutflow(method, amount, label = 'Payment', client = db) {
  const reqAmount = parseFloat(amount || 0);
  if (reqAmount <= 0) return true;
  if (!['Cash', 'Online'].includes(method)) return true;

  try {
    const available = await getAvailableBalance(method, client);
    if (reqAmount > available + 0.005) {
      console.warn(
        `[Financial Outflow Warning] ${label}: ${method} drawer balance is PKR ${available} (required: PKR ${reqAmount}). Outflow recorded; balance will reflect negatively.`
      );
    }
  } catch (err) {
    console.error('Error checking balance:', err);
  }
  return true;
}

module.exports = {
  getAvailableBalance,
  validateOutflow
};

