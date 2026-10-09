const { Pool } = require('pg');
const fs = require('node:fs/promises');
const path = require('node:path');
function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
}
async function transaction(pool, work, { readOnly = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    // Serialize writers, including missing references and acknowledgement races.
    if (!readOnly) await client.query('SELECT pg_advisory_xact_lock(8041001)');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function migrate(pool) {
  const sql = await fs.readFile(path.join(__dirname, '../../migrations/001_initial.sql'), 'utf8');
  await transaction(pool, (client) => client.query(sql));
}
module.exports = { createPool, transaction, migrate };
