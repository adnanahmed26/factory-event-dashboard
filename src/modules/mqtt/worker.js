const mqtt = require('mqtt');
const { randomBytes } = require('node:crypto');
const { handleChallenge, failed } = require('./service');
function startMqtt(pool, options = {}) {
  const candidateId = options.candidateId || process.env.CANDIDATE_ID || '10';
  const enabled = options.enabled ?? process.env.MQTT_ENABLED === 'true';
  const state = {
    status: enabled ? 'CONNECTING' : 'DISABLED',
    candidate_id: candidateId,
    last_error: null,
    last_connected_at: null,
    last_challenge_id: null,
    last_response_status: null,
  };
  if (!enabled) return { state, stop: async () => {} };
  if (!/^[A-Za-z0-9_-]+$/.test(candidateId))
    throw new Error('CANDIDATE_ID cannot contain topic wildcards or separators.');
  const prefix = `fse-01/${candidateId}`;
  const envelope = (status, extra = {}) =>
    JSON.stringify({
      protocol_version: '1.0',
      candidate_id: candidateId,
      status,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  const client = mqtt.connect(options.url || process.env.MQTT_URL || 'mqtt://152.42.238.142:1883', {
    clientId: `fse01-${candidateId}-${randomBytes(4).toString('hex')}`,
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 10000,
    will: { topic: `${prefix}/status`, payload: envelope('OFFLINE'), qos: 1, retain: false },
  });
  let stopping = false,
    heartbeat,
    reconnectTimer,
    retryDelay = 1000,
    queue = Promise.resolve();
  const publish = (topic, payload) =>
    new Promise((resolve, reject) =>
      client.publish(
        topic,
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        { qos: 1, retain: false },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  const status = async (value, extra) => publish(`${prefix}/status`, envelope(value, extra));
  async function publishResponse(response) {
    await publish(`${prefix}/response`, response);
    state.last_response_status = response.status;
    if (response.error) {
      state.last_error = response.error.code + ': ' + response.error.message;
      await status('FAILED', { challenge_id: response.challenge_id, error: response.error });
    } else state.last_error = null;
    if (response.challenge_id)
      await pool.query(
        `UPDATE mqtt_challenges SET published_at=clock_timestamp()
      WHERE challenge_id=$1 AND response=$2::jsonb`,
        [response.challenge_id, JSON.stringify(response)],
      );
  }
  async function flushOutbox() {
    const { rows } = await pool.query(
      'SELECT response FROM mqtt_challenges WHERE published_at IS NULL ORDER BY id',
    );
    for (const row of rows) await publishResponse(row.response);
  }
  client.on('connect', () => {
    clearTimeout(reconnectTimer);
    retryDelay = 1000;
    client.subscribe(`${prefix}/challenge`, { qos: 1 }, async (error, grants) => {
      if (error || grants?.some((g) => g.qos === 128)) {
        state.last_error = 'MQTT subscription failed.';
        client.end(true);
        return;
      }
      state.status = 'ONLINE';
      state.last_connected_at = new Date().toISOString();
      state.last_error = null;
      try {
        await status('ONLINE');
        await flushOutbox();
      } catch {
        state.last_error = 'Unable to publish MQTT response; stored responses will retry.';
      }
      clearInterval(heartbeat);
      heartbeat = setInterval(async () => {
        if (!client.connected) return;
        try {
          await status('HEARTBEAT');
          await flushOutbox();
        } catch {
          state.last_error = 'MQTT publish failed; retry pending.';
        }
      }, options.heartbeatMs || 25000);
      heartbeat.unref();
    });
  });
  client.on('message', (topic, payload) => {
    if (topic !== `${prefix}/challenge`) return;
    queue = queue
      .then(async () => {
        let body, response;
        try {
          if (payload.length > 1024 * 1024) throw new Error('too large');
          body = JSON.parse(payload.toString());
        } catch {
          response = failed(
            null,
            candidateId,
            'VALIDATION_ERROR',
            'Challenge must be valid JSON under 1 MB.',
          );
        }
        if (!response) {
          state.last_challenge_id =
            typeof body?.challenge_id === 'string' ? body.challenge_id : null;
          try {
            response = await handleChallenge(pool, body, candidateId);
          } catch {
            response = failed(
              body,
              candidateId,
              'INTERNAL_ERROR',
              'Unable to process challenge. Retry the same request.',
            );
          }
        }
        await publishResponse(response);
      })
      .catch(() => {
        state.last_error = 'MQTT response publish failed; persisted response will retry.';
      });
  });
  client.on('error', () => {
    state.last_error = 'MQTT connection failed. Retrying with backoff.';
  });
  client.on('close', () => {
    clearInterval(heartbeat);
    state.status = 'OFFLINE';
    if (stopping || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopping) {
        state.status = 'CONNECTING';
        client.reconnect();
      }
    }, retryDelay);
    reconnectTimer.unref();
    retryDelay = Math.min(retryDelay * 2, 30000);
  });
  return {
    state,
    client,
    async stop() {
      stopping = true;
      clearInterval(heartbeat);
      clearTimeout(reconnectTimer);
      if (client.connected) {
        try {
          await status('OFFLINE');
        } catch {}
      }
      await new Promise((resolve) => client.end(true, {}, resolve));
      await queue;
    },
  };
}
module.exports = { startMqtt };
