const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const mqtt = require('mqtt');
const { createPool, migrate, transaction } = require('../src/shared/database');
const { createApp } = require('../src/app');
const { submitEvents, domainEvents } = require('../src/modules/events/service');
const { acknowledge } = require('../src/modules/ack/service');
const { getState } = require('../src/modules/state/service');
const { handleChallenge } = require('../src/modules/mqtt/service');
const { startMqtt } = require('../src/modules/mqtt/worker');
let pool, admin, cluster, server, url, databaseName;
const count = (id = 'EV-101', quantity = 5, source = 'LINE-01') => ({
  source_id: source,
  event_id: id,
  type: 'COUNT',
  quantity,
  target_event_id: null,
  event_time: '2026-10-09T10:30:00Z',
});
const voidEvent = (id = 'EV-102', target = 'EV-101', source = 'LINE-01') => ({
  source_id: source,
  event_id: id,
  type: 'VOID',
  quantity: null,
  target_event_id: target,
  event_time: '2026-10-09T10:31:00Z',
});
const state = (source = null) => getState(pool, source, 'summary');
const challenge = (id = 'CH-01', events = [count()]) => ({
  protocol_version: '1.0',
  candidate_id: 'TEST-08',
  challenge_id: id,
  command: 'PROCESS_EVENTS',
  sent_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60000).toISOString(),
  events,
});
async function freePort() {
  const s = net.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
before(async () => {
  let connection = process.env.TEST_DATABASE_URL;
  if (!connection) {
    const { createLocalPostgres } = await import('../scripts/postgres.mjs');
    cluster = await createLocalPostgres({ directory: '.test-postgres', port: await freePort() });
    connection = cluster.url;
  }
  admin = new Pool({ connectionString: connection });
  databaseName = 'factory_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const parsed = new URL(connection);
  parsed.pathname = '/' + databaseName;
  pool = createPool(parsed.toString());
  await migrate(pool);
  server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (pool) await pool.end();
  if (admin) {
    if (databaseName) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
  if (cluster) await cluster.stop();
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE acknowledgement_attempts,submission_attempts,mqtt_challenges,production_events,production_sources RESTART IDENTITY CASCADE',
  );
});
test('COUNT changes total once and appears in supervisor review', async () => {
  assert.equal((await submitEvents(pool, [count()])).results[0].status, 'ACCEPTED');
  assert.deepEqual(await state(), {
    net_total: 5,
    processed_events: 1,
    pending_ack: 1,
    unresolved: 0,
    duplicates: 0,
    conflicts: 0,
    rejected_submissions: 0,
  });
  assert.equal((await getState(pool, null, 'pending')).events[0].event_id, 'EV-101');
});
test('normalized retries are DUPLICATE and preserve every raw attempt', async () => {
  await submitEvents(pool, [count()]);
  const retry = { ...count(), event_time: '2026-10-09T16:30:00+06:00' };
  delete retry.target_event_id;
  assert.equal((await submitEvents(pool, [retry])).results[0].status, 'DUPLICATE');
  assert.equal((await state()).net_total, 5);
  assert.equal((await state()).duplicates, 1);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM submission_attempts')).rows[0].n, 2);
});
test('global event ID conflicts preserve original and filter by attempt source', async () => {
  await submitEvents(pool, [count()]);
  assert.equal(
    (await submitEvents(pool, [count('EV-101', 9, 'LINE-02')])).results[0].status,
    'CONFLICT',
  );
  assert.equal((await state('LINE-01')).net_total, 5);
  assert.equal((await state('LINE-01')).conflicts, 0);
  assert.equal((await state('LINE-02')).conflicts, 1);
  assert.equal((await state('LINE-02')).net_total, 0);
});
test('VOID reverses an accepted COUNT once and automatically acknowledges the correction', async () => {
  await submitEvents(pool, [count(), voidEvent()]);
  assert.equal((await state()).net_total, 0);
  assert.equal((await state()).processed_events, 2);
  assert.equal((await submitEvents(pool, [voidEvent('EV-103')])).results[0].status, 'REJECTED');
  assert.equal((await acknowledge(pool, ['EV-102'])).results[0].status, 'ALREADY_ACKED');
  assert.deepEqual(
    (await getState(pool, null, 'pending')).events.map((e) => e.event_id),
    ['EV-101'],
  );
});
test('VOID before COUNT resolves automatically; first stored correction wins', async () => {
  assert.equal((await submitEvents(pool, [voidEvent()])).results[0].status, 'PENDING_REFERENCE');
  assert.equal((await state()).unresolved, 1);
  assert.equal((await state()).processed_events, 0);
  assert.equal((await submitEvents(pool, [voidEvent('EV-103')])).results[0].status, 'REJECTED');
  await submitEvents(pool, [count()]);
  assert.equal((await state()).unresolved, 0);
  assert.equal((await state()).net_total, 0);
  assert.equal((await state()).processed_events, 2);
});
test('wrong source and references to VOID are rejected when the target arrives', async () => {
  await submitEvents(pool, [voidEvent('WRONG', 'FUTURE', 'LINE-02'), voidEvent('RIGHT', 'FUTURE')]);
  await submitEvents(pool, [count('FUTURE')]);
  assert.equal(
    (await pool.query("SELECT status FROM production_events WHERE event_id='WRONG'")).rows[0]
      .status,
    'REJECTED',
  );
  assert.equal((await state()).net_total, 0);
  await submitEvents(pool, [
    voidEvent('TARGETS-VOID', 'MISSING-VOID'),
    voidEvent('MISSING-VOID', 'NEVER'),
  ]);
  assert.equal(
    (await pool.query("SELECT status FROM production_events WHERE event_id='TARGETS-VOID'")).rows[0]
      .status,
    'REJECTED',
  );
});
test('mixed batch preserves item order and commits valid siblings', async () => {
  const { results } = await submitEvents(pool, [
    count('A'),
    null,
    count('BAD', -2),
    count('B', 3),
    voidEvent('V', 'B'),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['ACCEPTED', 'REJECTED', 'REJECTED', 'ACCEPTED', 'ACCEPTED'],
  );
  assert.equal((await state()).net_total, 5);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM submission_attempts')).rows[0].n, 5);
});
test('invalid dates and missing timezone are rejected and visible in unfiltered exceptions', async () => {
  for (const time of ['2026-02-30T10:00:00Z', '2026-10-09T10:00:00', '2026-10-09T25:00:00Z'])
    assert.equal(
      (await submitEvents(pool, [{ ...count(time), event_time: time }])).results[0].status,
      'REJECTED',
    );
  await submitEvents(pool, [{}]);
  assert.equal((await getState(pool, null, 'exceptions')).attempts.length, 4);
  assert.equal((await getState(pool, 'LINE-01', 'exceptions')).attempts.length, 3);
});
test('repeat ACK is safe and acknowledgement never prevents a later VOID', async () => {
  await submitEvents(pool, [count(), voidEvent('PENDING', 'MISSING')]);
  const { results } = await acknowledge(pool, ['EV-101', 'EV-101', 'PENDING', 'UNKNOWN']);
  assert.deepEqual(
    results.map((r) => r.status),
    ['ACKED', 'ALREADY_ACKED', 'NOT_READY', 'NOT_FOUND'],
  );
  await submitEvents(pool, [voidEvent()]);
  assert.equal((await state()).net_total, 0);
  assert.equal((await state()).pending_ack, 0);
});
test('concurrent identical submissions never double count', async () => {
  const batches = await Promise.all(
    Array.from({ length: 12 }, () => submitEvents(pool, [count()])),
  );
  assert.equal(batches.filter((b) => b.results[0].status === 'ACCEPTED').length, 1);
  assert.equal((await state()).net_total, 5);
  assert.equal((await state()).duplicates, 11);
});
test('concurrent corrections and acknowledgements produce one reversal and one ACK', async () => {
  await submitEvents(pool, [count()]);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => submitEvents(pool, [voidEvent('VOID-' + i)])),
  );
  assert.equal(results.filter((b) => b.results[0].status === 'ACCEPTED').length, 1);
  const acks = await Promise.all(Array.from({ length: 8 }, () => acknowledge(pool, ['EV-101'])));
  assert.equal(acks.filter((b) => b.results[0].status === 'ACKED').length, 1);
  assert.equal((await state()).net_total, 0);
});
test('database failure rolls back the entire batch and emits no success notification', async () => {
  let notified = 0;
  const observer = () => notified++;
  domainEvents.on('EVENTS_COMMITTED', observer);
  await pool.query(`CREATE OR REPLACE FUNCTION test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event_id='FAIL' THEN RAISE EXCEPTION 'forced test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER force_failure BEFORE INSERT ON production_events FOR EACH ROW EXECUTE FUNCTION test_fail();`);
  try {
    await assert.rejects(submitEvents(pool, [count('GOOD'), count('FAIL')]));
    assert.equal((await state()).net_total, 0);
    assert.equal(notified, 0);
  } finally {
    await pool.query('DROP TRIGGER force_failure ON production_events; DROP FUNCTION test_fail()');
    domainEvents.off('EVENTS_COMMITTED', observer);
  }
});
test('REST contract: object/array accepted, primitive/malformed rejected, ACK validated', async () => {
  let response = await fetch(url + '/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([count(), null]),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).results.map((r) => r.status),
    ['ACCEPTED', 'REJECTED'],
  );
  for (const body of ['null', '42', '{']) {
    response = await fetch(url + '/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal((await fetch(url + '/api/state?view=unknown')).status, 400);
  assert.equal(
    (
      await fetch(url + '/api/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"event_ids":[12]}',
      })
    ).status,
    400,
  );
  assert.equal((await fetch(url + '/api/health')).status, 200);
});
test('MQTT challenge uses shared processing, persists exact response, and replays without processing', async () => {
  const body = challenge('CH-01', [count(), null]);
  const response = await handleChallenge(pool, body, 'TEST-08');
  assert.equal(response.status, 'COMPLETED');
  assert.deepEqual(
    response.results.map((r) => r.status),
    ['ACCEPTED', 'REJECTED'],
  );
  assert.equal(response.state.net_total, 5);
  assert.deepEqual(await handleChallenge(pool, body, 'TEST-08'), response);
  const conflict = await handleChallenge(
    pool,
    { ...body, events: [count('DIFFERENT')] },
    'TEST-08',
  );
  assert.equal(conflict.error.code, 'CHALLENGE_CONFLICT');
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM submission_attempts')).rows[0].n, 2);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM mqtt_challenges')).rows[0].n, 1);
});
test('MQTT rejects wrong candidate, expired challenge, protocol, and invalid envelope before processing', async () => {
  const cases = [
    ['CANDIDATE_MISMATCH', { candidate_id: 'OTHER' }],
    ['CHALLENGE_EXPIRED', { expires_at: '2020-01-01T00:00:00Z' }],
    ['UNSUPPORTED_PROTOCOL', { protocol_version: '2.0' }],
    ['VALIDATION_ERROR', { events: {} }],
  ];
  for (const [code, change] of cases) {
    const result = await handleChallenge(pool, { ...challenge(code), ...change }, 'TEST-08');
    assert.equal(result.status, 'FAILED');
    assert.equal(result.error.code, code);
  }
  assert.equal((await state()).processed_events, 0);
});
test('saved challenges and unresolved events survive a pool and application restart', async () => {
  const body = challenge('RESTART', [voidEvent()]);
  const original = await handleChallenge(pool, body, 'TEST-08');
  const config = pool.options.connectionString;
  await pool.end();
  if (cluster) {
    const port = Number(new URL(cluster.url).port);
    await cluster.stop();
    const { createLocalPostgres } = await import('../scripts/postgres.mjs');
    cluster = await createLocalPostgres({ directory: '.test-postgres', port });
  }
  pool = createPool(config);
  await migrate(pool);
  assert.deepEqual(await handleChallenge(pool, body, 'TEST-08'), original);
  assert.equal((await state()).unresolved, 1);
  await submitEvents(pool, [count()]);
  assert.equal((await state()).net_total, 0);
  assert.equal((await state()).unresolved, 0);
  // The original replay remains a snapshot from the original challenge, even after state changes.
  assert.deepEqual(await handleChallenge(pool, body, 'TEST-08'), original);
  await new Promise((r) => server.close(r));
  server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = 'http://127.0.0.1:' + server.address().port;
});
test('real MQTT broker: own topics, correlated response, QoS 1, and duplicate delivery replay', async () => {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  const tcp = net.createServer(broker.handle);
  tcp.listen(0, '127.0.0.1');
  await once(tcp, 'listening');
  const brokerUrl = 'mqtt://127.0.0.1:' + tcp.address().port;
  const simulator = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
  await once(simulator, 'connect');
  await simulator.subscribeAsync('fse-01/TEST-08/+', { qos: 1 });
  const packets = [];
  simulator.on('message', (topic, payload, packet) =>
    packets.push({ topic, body: JSON.parse(payload.toString()), qos: packet.qos }),
  );
  const worker = startMqtt(pool, {
    enabled: true,
    candidateId: 'TEST-08',
    url: brokerUrl,
    heartbeatMs: 100,
  });
  async function until(predicate) {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('MQTT condition timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    await until(() => worker.state.status === 'ONLINE');
    const body = challenge('WIRE', [count(), count('WIRE-OVER-LIMIT', 501)]);
    await simulator.publishAsync('fse-01/OTHER/challenge', JSON.stringify(body), { qos: 1 });
    await simulator.publishAsync('fse-01/TEST-08/challenge', JSON.stringify(body), { qos: 1 });
    await until(() => packets.some((p) => p.topic.endsWith('/response')));
    const first = packets.find((p) => p.topic.endsWith('/response'));
    assert.equal(first.body.challenge_id, 'WIRE');
    assert.equal(first.body.state.net_total, 5);
    assert.equal(first.body.state.rejected_submissions, 1);
    assert.equal(first.body.results[1].status, 'REJECTED');
    assert.equal(first.qos, 1);
    await simulator.publishAsync('fse-01/TEST-08/challenge', JSON.stringify(body), { qos: 1 });
    await until(() => packets.filter((p) => p.topic.endsWith('/response')).length === 2);
    assert.deepEqual(packets.filter((p) => p.topic.endsWith('/response'))[1].body, first.body);
    assert.equal((await state()).duplicates, 0);
    await until(() =>
      packets.some((p) => p.topic.endsWith('/status') && p.body.status === 'HEARTBEAT'),
    );
    const workerConnection = Object.values(broker.clients).find((c) =>
      c.id.startsWith('fse01-TEST-08-'),
    );
    workerConnection.close();
    await until(
      () =>
        packets.filter((p) => p.topic.endsWith('/status') && p.body.status === 'ONLINE').length >=
        2,
    );
    await simulator.publishAsync(
      'fse-01/TEST-08/challenge',
      JSON.stringify(challenge('AFTER-RECONNECT', [count('RECONNECTED', 2)])),
      { qos: 1 },
    );
    await until(() =>
      packets.some(
        (p) => p.topic.endsWith('/response') && p.body.challenge_id === 'AFTER-RECONNECT',
      ),
    );
    assert.equal((await state()).net_total, 7);
    const invalid = { ...challenge('BAD-WIRE'), candidate_id: 'OTHER' };
    await simulator.publishAsync('fse-01/TEST-08/challenge', JSON.stringify(invalid), { qos: 1 });
    await until(() =>
      packets.some(
        (p) => p.topic.endsWith('/status') && p.body.error?.code === 'CANDIDATE_MISMATCH',
      ),
    );
  } finally {
    await worker.stop();
    await simulator.endAsync();
    await new Promise((r) => broker.close(r));
    await new Promise((r) => tcp.close(r));
  }
});
test('COUNT quantity accepts 1, 450, and 500; rejects out-of-range or non-integer attempts durably', async () => {
  const quantities = [1, 450, 500, 501, 0, -1, 1.5, '450', null];
  const response = await fetch(url + '/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quantities.map((quantity, index) => count('LIMIT-' + index, quantity))),
  });
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(
    results.map((result) => result.status),
    ['ACCEPTED', 'ACCEPTED', 'ACCEPTED', ...Array(6).fill('REJECTED')],
  );
  assert.match(results[3].message, /1 to 500/);
  assert.equal((await state()).net_total, 951);
  assert.equal((await state()).rejected_submissions, 6);
  const rejected = (
    await pool.query(
      "SELECT raw_payload,classification FROM submission_attempts WHERE event_id='LIMIT-3'",
    )
  ).rows[0];
  assert.equal(rejected.raw_payload.quantity, 501);
  assert.equal(rejected.classification, 'REJECTED');
  await submitEvents(pool, [
    count('LIMIT-1', 450),
    count('LIMIT-1', 449),
    voidEvent('LIMIT-VOID', 'LIMIT-1'),
  ]);
  assert.equal((await state()).net_total, 501);
  assert.equal((await state()).rejected_submissions, 6);
});

test('rejected summary counts attempts only, supports source filtering and survives pool recreation', async () => {
  assert.equal((await state('NO-EVENTS')).rejected_submissions, 0);
  await submitEvents(pool, [
    count('VALID', 450),
    count('VALID', 450),
    count('VALID', 449),
    voidEvent('WAITING', 'FUTURE'),
    count('TOO-MUCH', 501),
    count('TOO-MUCH', 501),
    count('OTHER-REJECT', 501, 'LINE-02'),
    null,
  ]);
  assert.equal((await state()).rejected_submissions, 4);
  assert.equal((await state('LINE-01')).rejected_submissions, 2);
  assert.equal((await state('LINE-02')).rejected_submissions, 1);
  assert.equal((await state()).duplicates, 1);
  assert.equal((await state()).conflicts, 1);
  assert.equal((await state()).unresolved, 1);
  const reopened = createPool(pool.options.connectionString);
  try {
    assert.equal((await getState(reopened, null, 'summary')).rejected_submissions, 4);
  } finally {
    await reopened.end();
  }
  const response = await fetch(url + '/api/state?view=summary&source_id=LINE-01');
  assert.equal((await response.json()).rejected_submissions, 2);
});

test('MQTT uses quantity limit and includes persisted rejected count in response state', async () => {
  const body = challenge('QUANTITY-LIMIT', [
    count('MQTT-450', 450),
    count('MQTT-501', 501),
    count('MQTT-500', 500),
  ]);
  const response = await handleChallenge(pool, body, 'TEST-08');
  assert.equal(response.status, 'COMPLETED');
  assert.deepEqual(
    response.results.map((result) => result.status),
    ['ACCEPTED', 'REJECTED', 'ACCEPTED'],
  );
  assert.equal(response.state.net_total, 950);
  assert.equal(response.state.rejected_submissions, 1);
  assert.deepEqual(await handleChallenge(pool, body, 'TEST-08'), response);
  assert.equal((await state()).rejected_submissions, 1);
});

test('stored unpublished response is delivered by the worker after restart', async () => {
  const expected = await handleChallenge(pool, challenge('OUTBOX'), 'TEST-08');
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  const tcp = net.createServer(broker.handle);
  tcp.listen(0, '127.0.0.1');
  await once(tcp, 'listening');
  const brokerUrl = 'mqtt://127.0.0.1:' + tcp.address().port,
    simulator = mqtt.connect(brokerUrl, { reconnectPeriod: 0 });
  await once(simulator, 'connect');
  await simulator.subscribeAsync('fse-01/TEST-08/response', { qos: 1 });
  const message = once(simulator, 'message');
  const worker = startMqtt(pool, { enabled: true, candidateId: 'TEST-08', url: brokerUrl });
  try {
    const [, payload] = await message;
    assert.deepEqual(JSON.parse(payload.toString()), expected);
    assert.equal((await state()).duplicates, 0);
  } finally {
    await worker.stop();
    await simulator.endAsync();
    await new Promise((r) => broker.close(r));
    await new Promise((r) => tcp.close(r));
  }
});
