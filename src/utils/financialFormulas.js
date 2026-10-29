const db = require('../config/db');

/**
 * Derives current available balance for a payment method ('Cash' or 'Online')
 *
 * Formula:
 * Opening Balance
 * + All Money Received
 * - All Money Paid
 * - All Operating Expenses
 *
 * Scoped by branch_id in Single Shared Database Architecture
 */
async function getAvailableBalance(method, client = db, explicitBranchId = null) {
  if (!['Cash', 'Online'].includes(method)) {
    return 0;
  }

  const branchContext = require('../middleware/branchContext');
  const store = branchContext.getBranchStore();
  const bId = explicitBranchId || client.branchId || store?.branchId || 1;

  const result = await client.query(
    `
    SELECT
      (
        COALESCE(
          (
            SELECT
              CASE
                WHEN $1 = 'Cash' THEN opening_cash
                ELSE opening_online
              END
            FROM business_settings
            WHERE branch_id = $2
            LIMIT 1
          ),
          0
        )
        +
        COALESCE(
          (
            SELECT SUM(
              CASE
                WHEN direction = 'Received' THEN amount
                WHEN direction = 'Paid' THEN -amount
                ELSE 0
              END
            )
            FROM payments
            WHERE payment_method = $1
              AND affects_money = TRUE
              AND branch_id = $2
          ),
          0
        )
        -
        COALESCE(
          (
            SELECT SUM(amount)
            FROM expenses
            WHERE payment_method = $1
              AND branch_id = $2
          ),
          0
        )
      ) AS available_balance
    `,
    [method, bId]
  );

  return parseFloat(
    result.rows[0]?.available_balance || 0
  );
}

/**
 * Checks outflow against available funds without hard-blocking,
 * allowing negative drawer balance to be tracked accurately
 * in financial reporting.
 */
async function validateOutflow(
  method,
  amount,
  label = 'Payment',
  client = db,
  explicitBranchId = null
) {
  const reqAmount = parseFloat(amount || 0);

  if (reqAmount <= 0) {
    return true;
  }

  if (!['Cash', 'Online'].includes(method)) {
    return true;
  }

  try {
    const available = await getAvailableBalance(
      method,
      client,
      explicitBranchId
    );

    if (reqAmount > available + 0.005) {
      console.warn(
        `[Financial Outflow Warning] ${label}: ${method} drawer balance is PKR ${available} (required: PKR ${reqAmount}). Outflow recorded; balance will reflect negatively.`
      );
    }
  } catch (err) {
    console.error(
      'Error checking balance:',
      err
    );
  }

  return true;
}

module.exports = {
  getAvailableBalance,
  validateOutflow
};
