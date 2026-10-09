require('dotenv').config({ quiet: true });
const net = require('node:net');
const mqtt = require('mqtt');
const { randomUUID } = require('node:crypto');
(async () => {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  const port = Number(process.env.SIMULATOR_PORT || 1884),
    candidateId = process.env.CANDIDATE_ID || '10';
  if (!/^[A-Za-z0-9_-]+$/.test(candidateId)) throw new Error('Invalid candidate ID.');
  const server = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, { reconnectPeriod: 1000 });
  const prefix = `fse-01/${candidateId}`;
  await client.subscribeAsync([`${prefix}/status`, `${prefix}/response`], { qos: 1 });
  console.log(`Local MQTT simulator: mqtt://127.0.0.1:${port}`);
  console.log(
    'Set MQTT_ENABLED=true and MQTT_URL to the local URL in .env, then restart npm start.',
  );
  let sent = false;
  client.on('message', async (topic, payload) => {
    const body = JSON.parse(payload.toString());
    console.log(topic + ' ' + JSON.stringify(body));
    if (topic.endsWith('/status') && body.status === 'ONLINE' && !sent) {
      sent = true;
      const id = 'DEMO-' + randomUUID().slice(0, 8),
        time = new Date().toISOString();
      const count = {
        source_id: 'LINE-01',
        event_id: id + '-COUNT',
        type: 'COUNT',
        quantity: 5,
        event_time: time,
      };
      const challenge = {
        protocol_version: '1.0',
        candidate_id: candidateId,
        challenge_id: id,
        command: 'PROCESS_EVENTS',
        sent_at: time,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        events: [
          count,
          count,
          {
            source_id: 'LINE-01',
            event_id: id + '-VOID',
            type: 'VOID',
            target_event_id: id + '-LATE',
            event_time: time,
          },
          { ...count, event_id: id + '-LATE', quantity: 3 },
          { ...count, event_id: id + '-BAD', quantity: -1 },
        ],
      };
      await client.publishAsync(`${prefix}/challenge`, JSON.stringify(challenge), {
        qos: 1,
        retain: false,
      });
      console.log('Sent a COUNT, duplicate, early VOID, matching COUNT, and rejected item.');
    }
  });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await client.endAsync();
    await new Promise((r) => broker.close(r));
    await new Promise((r) => server.close(r));
    process.exit(0);
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
