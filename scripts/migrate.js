require('dotenv').config({ quiet: true });
const { createPool, migrate } = require('../src/shared/database');
(async () => {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log('PostgreSQL schema ready.');
  } finally {
    await pool.end();
  }
})().catch(() => {
  console.error('Migration failed. Check DATABASE_URL and PostgreSQL permissions.');
  process.exitCode = 1;
});
