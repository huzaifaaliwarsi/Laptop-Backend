const { getNextEntityId } = require('./codeGenerator');
const { normalizePhone } = require('./phoneHelper');

/**
 * Resolve existing customer or create new customer.
 * Strict prioritization:
 * 1. If explicit customerId provided -> verify in branch & update contact if missing.
 * 2. If contact phone provided -> match by canonical or raw phone number in branch!
 * 3. If exact name match exists (and not generic walk-in) -> match existing customer!
 * 4. Otherwise -> create new customer with generated CUS-XXXX ID.
 */
async function resolveOrCreateCustomer({ customerId: reqCustId, customerName, contact, branchId = 1, client }) {
  let customerId = reqCustId;
  const cleanName = (customerName || '').trim();
  const rawContact = contact ? String(contact).trim() : null;
  const canonicalPhone = normalizePhone(rawContact) || rawContact;

  // 1. Explicit ID check
  if (customerId) {
    const cCheck = await client.query(
      'SELECT id, name, contact FROM customers WHERE id = $1 AND branch_id = $2',
      [customerId, branchId]
    );
    if (cCheck.rows.length > 0) {
      const existing = cCheck.rows[0];
      if (canonicalPhone && !existing.contact) {
        await client.query('UPDATE customers SET contact = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [canonicalPhone, customerId]);
      }
      return { 
        customerId: existing.id, 
        name: existing.name || cleanName, 
        contact: canonicalPhone || existing.contact 
      };
    }
  }

  // 2. Match by Contact Phone Number (Highest priority for auto-identification)
  if (canonicalPhone && canonicalPhone.length >= 7) {
    const byContact = await client.query(
      `SELECT id, name, contact FROM customers 
       WHERE (contact = $1 OR contact = $2) AND branch_id = $3 
       ORDER BY created_at ASC LIMIT 1`,
      [canonicalPhone, rawContact, branchId]
    );
    if (byContact.rows.length > 0) {
      const existing = byContact.rows[0];
      return { 
        customerId: existing.id, 
        name: existing.name || cleanName, 
        contact: existing.contact || canonicalPhone 
      };
    }
  }

  // 3. Match by Name (case-insensitive, excluding generic walk-in terms)
  const isGenericName = !cleanName || ['walk-in', 'walk in', 'cash customer', 'customer', 'walk-in customer'].includes(cleanName.toLowerCase());
  if (!isGenericName) {
    const byName = await client.query(
      `SELECT id, name, contact FROM customers 
       WHERE LOWER(name) = LOWER($1) AND branch_id = $2 
       ORDER BY created_at ASC LIMIT 1`,
      [cleanName, branchId]
    );
    if (byName.rows.length > 0) {
      const existing = byName.rows[0];
      if (canonicalPhone && !existing.contact) {
        await client.query('UPDATE customers SET contact = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [canonicalPhone, existing.id]);
      }
      return { 
        customerId: existing.id, 
        name: existing.name, 
        contact: canonicalPhone || existing.contact 
      };
    }
  }

  // 4. Create new customer
  const newId = await getNextEntityId('customers', 'id', 'CUS', 4, client);
  await client.query(
    `INSERT INTO customers (id, name, contact, branch_id) VALUES ($1, $2, $3, $4)`,
    [newId, cleanName || 'Walk-in Customer', canonicalPhone, branchId]
  );
  return { customerId: newId, name: cleanName || 'Walk-in Customer', contact: canonicalPhone };
}

module.exports = {
  resolveOrCreateCustomer
};

