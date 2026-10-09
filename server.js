require('dotenv').config({ quiet: true });
const { createPool, migrate } = require('./src/shared/database');
const { createApp } = require('./src/app');
const { startMqtt } = require('./src/modules/mqtt/worker');
async function start() {
  const pool = createPool();
  let device;
  try {
    await migrate(pool);
    device = startMqtt(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const app = createApp(pool, device);
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(
        Number(process.env.PORT || 3000),
        process.env.HOST || '127.0.0.1',
        (error) => (error ? reject(error) : resolve(listener)),
      );
    });
  } catch (error) {
    await device.stop();
    await pool.end();
    throw error;
  }
  console.log(
    `Factory dashboard: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`,
  );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await device.stop();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  return { app, server, pool, device };
}
if (require.main === module)
  start().catch(() => {
    console.error(
      'Startup failed. Check DATABASE_URL, PostgreSQL availability, migration permissions, and whether PORT is already in use.',
    );
    process.exitCode = 1;
  });
module.exports = { start };
