const { createHash } = require('node:crypto');
const { transaction } = require('../../shared/database');
const { isObject, text, isoTime } = require('../events/validation');
const { processBatch, notify } = require('../events/service');
const { summary } = require('../state/service');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function validateChallenge(body, candidateId, now = Date.now()) {
  if (!isObject(body) || !text(body.challenge_id))
    return {
      code: 'VALIDATION_ERROR',
      message: 'challenge_id and an object envelope are required.',
    };
  if (body.protocol_version !== '1.0')
    return { code: 'UNSUPPORTED_PROTOCOL', message: 'protocol_version must be 1.0.' };
  if (body.candidate_id !== candidateId)
    return { code: 'CANDIDATE_MISMATCH', message: 'candidate_id does not match this worker.' };
  if (
    body.command !== 'PROCESS_EVENTS' ||
    !isoTime(body.sent_at) ||
    !isoTime(body.expires_at) ||
    !Array.isArray(body.events) ||
    body.events.length > 1000
  )
    return {
      code: 'VALIDATION_ERROR',
      message: 'Expected PROCESS_EVENTS, timezone timestamps, and an events array (max 1000).',
    };
  if (Date.parse(body.expires_at) <= now)
    return { code: 'CHALLENGE_EXPIRED', message: 'Challenge has expired.' };
  if (Date.parse(body.expires_at) <= Date.parse(body.sent_at))
    return { code: 'VALIDATION_ERROR', message: 'expires_at must follow sent_at.' };
  return null;
}
function failed(body, candidateId, code, message) {
  return {
    protocol_version: '1.0',
    candidate_id: candidateId,
    challenge_id: typeof body?.challenge_id === 'string' ? body.challenge_id : null,
    status: 'FAILED',
    processed_at: new Date().toISOString(),
    error: { code, message },
  };
}
async function handleChallenge(pool, body, candidateId) {
  const hash = createHash('sha256').update(canonical(body)).digest('hex');
  let emitted;
  const response = await transaction(pool, async (client) => {
    const id = text(body?.challenge_id) ? body.challenge_id : null;
    const saved =
      id &&
      (await client.query('SELECT * FROM mqtt_challenges WHERE challenge_id=$1', [id])).rows[0];
    if (saved) {
      if (saved.request_hash === hash) return saved.response;
      return failed(
        body,
        candidateId,
        'CHALLENGE_CONFLICT',
        'challenge_id already exists with a different request.',
      );
    }
    const validation = validateChallenge(body, candidateId);
    let result;
    if (validation) result = failed(body, candidateId, validation.code, validation.message);
    else {
      emitted = await processBatch(client, body.events, { transport: 'MQTT', challenge_id: id });
      result = {
        protocol_version: '1.0',
        candidate_id: candidateId,
        challenge_id: id,
        status: 'COMPLETED',
        processed_at: new Date().toISOString(),
        results: emitted,
        state: await summary(client),
      };
    }
    if (id)
      await client.query(
        `INSERT INTO mqtt_challenges(challenge_id,request,request_hash,response,status)
      VALUES($1,$2,$3,$4,$5)`,
        [id, JSON.stringify(body), hash, JSON.stringify(result), result.status],
      );
    return result;
  });
  if (emitted) notify(emitted);
  return response;
}
async function getDeviceState(pool, state) {
  return transaction(
    pool,
    async (client) => ({
      ...state,
      challenge_count: (await client.query('SELECT COUNT(*)::int AS count FROM mqtt_challenges'))
        .rows[0].count,
      challenges: (await client.query('SELECT * FROM mqtt_challenges ORDER BY id DESC LIMIT 20'))
        .rows,
    }),
    { readOnly: true },
  );
}
module.exports = { handleChallenge, validateChallenge, failed, getDeviceState };
