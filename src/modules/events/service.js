const { EventEmitter } = require('node:events');
const { transaction } = require('../../shared/database');
const { validateEvent } = require('./validation');
const repo = require('./repository');
const { acknowledgeOne } = require('../ack/service');
const domainEvents = new EventEmitter();
function voidError(event, target, accepted) {
  if (target.type !== 'COUNT' || target.status !== 'ACCEPTED')
    return 'Target must be an accepted COUNT.';
  if (target.source_id !== event.source_id) return 'VOID and COUNT must have the same source_id.';
  if (accepted.length) return 'This COUNT has already been reversed.';
  return null;
}
async function resolveReferences(c, target) {
  const pending = await repo.voidsFor(c, target.event_id, 'PENDING_REFERENCE');
  const accepted = await repo.voidsFor(c, target.event_id, 'ACCEPTED');
  for (const e of pending) {
    const error = voidError(e, target, accepted);
    if (error) await repo.rejectReference(c, e.event_id, error);
    else {
      await repo.completeVoid(c, e.event_id);
      await acknowledgeOne(c, e.event_id, 'AUTOMATIC_VOID');
      accepted.push(e);
    }
  }
}
async function processOne(c, raw, meta) {
  const { event, error: validationError } = validateEvent(raw);
  let status, error;
  if (validationError) {
    status = 'REJECTED';
    error = validationError;
  } else {
    const existing = await repo.findEvent(c, event.event_id);
    if (existing) {
      status = Object.keys(event).every((k) => existing.normalized_payload[k] === event[k])
        ? 'DUPLICATE'
        : 'CONFLICT';
      error =
        status === 'CONFLICT'
          ? 'event_id already exists with different data; original preserved.'
          : null;
    } else if (event.type === 'COUNT') {
      status = 'ACCEPTED';
      const saved = await repo.insertEvent(c, event, status);
      await resolveReferences(c, saved);
    } else {
      const target = await repo.findEvent(c, event.target_event_id);
      if (target) {
        error = voidError(event, target, await repo.voidsFor(c, target.event_id, 'ACCEPTED'));
        status = error ? 'REJECTED' : 'ACCEPTED';
      } else {
        const pending = await repo.voidsFor(c, event.target_event_id, 'PENDING_REFERENCE');
        error = pending.some((p) => p.source_id === event.source_id)
          ? 'An earlier VOID already reserves this COUNT for this source.'
          : null;
        status = error ? 'REJECTED' : 'PENDING_REFERENCE';
      }
      const saved = await repo.insertEvent(c, event, status, error);
      if (status === 'ACCEPTED') await acknowledgeOne(c, event.event_id, 'AUTOMATIC_VOID');
      await resolveReferences(c, saved);
    }
  }
  await repo.recordAttempt(c, raw, event, status, error, meta);
  return {
    event_id: typeof raw?.event_id === 'string' ? raw.event_id : null,
    status,
    message:
      error ||
      {
        ACCEPTED: 'Event processed.',
        DUPLICATE: 'Identical retry recorded; no production added.',
        PENDING_REFERENCE: 'Waiting for the matching COUNT.',
      }[status],
  };
}
async function processBatch(c, items, meta = {}) {
  const results = [];
  for (const item of items) results.push(await processOne(c, item, meta));
  return results;
}
function notify(results) {
  for (const listener of domainEvents.listeners('EVENTS_COMMITTED')) {
    try {
      listener(results);
    } catch {
      console.error('Post-commit event observer failed.');
    }
  }
}
async function submitEvents(pool, items, meta = {}) {
  const results = await transaction(pool, (c) => processBatch(c, items, meta));
  notify(results);
  return { results };
}
module.exports = { submitEvents, processBatch, domainEvents, notify };
