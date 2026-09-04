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
 * PERFORMANCE FIX:
 * Previously this function executed 3 sequential DB queries.
 * Now the same calculation is done in a single PostgreSQL query.
 */
async function getAvailableBalance(method, client = db) {
  if (!['Cash', 'Online'].includes(method)) {
    return 0;
  }

  const result = await client.query(
    `
    SELECT
      (
        COALESCE(
          (
            SELECT
              CASE
                WHEN $1 = 'Cash'
                  THEN opening_cash
                ELSE opening_online
              END
            FROM business_settings
            WHERE id = 1
          ),
          0
        )

        +

        COALESCE(
          (
            SELECT SUM(
              CASE
                WHEN direction = 'Received'
                  THEN amount

                WHEN direction = 'Paid'
                  THEN -amount

                ELSE 0
              END
            )
            FROM payments
            WHERE payment_method = $1
              AND affects_money = TRUE
          ),
          0
        )

        -

        COALESCE(
          (
            SELECT SUM(amount)
            FROM expenses
            WHERE payment_method = $1
          ),
          0
        )
      ) AS available_balance
    `,
    [method]
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
  client = db
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
      client
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