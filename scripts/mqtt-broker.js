require('dotenv').config({ quiet: true });
const net = require('node:net');

(async () => {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  const port = Number(process.env.SIMULATOR_PORT || 1884);
  const server = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Local MQTT broker: mqtt://127.0.0.1:${port}`);
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => broker.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
