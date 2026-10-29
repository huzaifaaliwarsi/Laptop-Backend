// Every operation uses a transaction-local role/context, including through PgBouncer.
// Never put branch state on an idle pooled connection.
function createScopedPool(pool, branchId) {
  const id = Number(branchId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid branch ID');
  async function connect() {
    const raw = await pool.connect();
    let inTransaction = false;
    let released = false;
    let queue = Promise.resolve();
    async function begin() {
      await raw.query('BEGIN');
      inTransaction = true;
      await raw.query("SELECT set_config('app.branch_id', $1, true)", [String(id)]);
    }
    async function execute(sql, params) {
      if (released) throw new Error('Client already released');
      const text = typeof sql === 'string' ? sql : sql.text;
      const command = text.trim().replace(/;$/, '').toUpperCase();
      if (command === 'BEGIN') {
        if (inTransaction) throw new Error('Nested transactions are not supported');
        try { await begin(); return { rows: [], rowCount: null }; }
        catch (error) { await raw.query('ROLLBACK'); inTransaction = false; throw error; }
      }
      if (command === 'COMMIT' || command === 'ROLLBACK') {
        try { return await raw.query(command); } finally { inTransaction = false; }
      }
      if (inTransaction) return raw.query(sql, params);
      try {
        await begin();
        const result = await raw.query(sql, params);
        await raw.query('COMMIT');
        return result;
      } catch (error) {
        await raw.query('ROLLBACK');
        throw error;
      } finally { inTransaction = false; }
    }
    return {
      branchId: id,
      query(sql, params) {
        const result = queue.then(() => execute(sql, params));
        queue = result.catch(() => {});
        return result;
      },
      release(error) {
        if (released) return;
        released = true;
        // Destroy rather than return a connection with an unfinished transaction.
        raw.release(error || (inTransaction ? new Error('Unfinished branch transaction') : undefined));
      },
      on: (...args) => raw.on(...args),
      removeListener: (...args) => raw.removeListener(...args)
    };
  }
  return {
    branchId: id, connect,
    async query(sql, params) {
      const client = await connect();
      try { return await client.query(sql, params); } finally { client.release(); }
    },
    // Branch handles share one physical pool; closing a branch must not close it.
    async end() {}
  };
}
module.exports = { createScopedPool };
