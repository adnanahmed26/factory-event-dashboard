function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function text(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}
function isoTime(v) {
  if (typeof v !== 'string') return false;
  const m = v.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!m) return false;
  const [, year, month, day, hour, minute, second, zone] = m;
  const y = Number(year),
    mo = Number(month),
    d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    y >= 1 &&
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= days[mo - 1] &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60 &&
    (zone === 'Z' || (Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4)) < 60)) &&
    Number.isFinite(Date.parse(v))
  );
}
function validateEvent(raw) {
  if (!isObject(raw)) return { error: 'Each event must be a JSON object.' };
  if (!text(raw.source_id))
    return { error: 'source_id must be a non-empty string (max 200 characters).' };
  if (!text(raw.event_id))
    return { error: 'event_id must be a non-empty string (max 200 characters).' };
  if (!['COUNT', 'VOID'].includes(raw.type)) return { error: 'type must be COUNT or VOID.' };
  if (!isoTime(raw.event_time))
    return { error: 'event_time must be a valid ISO 8601 timestamp with a timezone.' };
  if (raw.type === 'COUNT') {
    if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 500)
      return { error: 'COUNT quantity must be an integer from 1 to 500, inclusive.' };
    if (raw.target_event_id != null)
      return { error: 'COUNT target_event_id must be null or omitted.' };
  } else {
    if (raw.quantity != null) return { error: 'VOID quantity must be null or omitted.' };
    if (!text(raw.target_event_id)) return { error: 'VOID target_event_id must identify a COUNT.' };
    if (raw.target_event_id === raw.event_id) return { error: 'A VOID cannot target itself.' };
  }
  return {
    event: {
      source_id: raw.source_id,
      event_id: raw.event_id,
      type: raw.type,
      quantity: raw.type === 'COUNT' ? raw.quantity : null,
      target_event_id: raw.type === 'VOID' ? raw.target_event_id : null,
      event_time: new Date(raw.event_time).toISOString(),
    },
  };
}
function eventCollection(body) {
  if (Array.isArray(body)) return body;
  if (isObject(body)) return [body];
  const error = new Error('Request must be one event object or a JSON array.');
  error.status = 400;
  throw error;
}
module.exports = { validateEvent, eventCollection, isObject, isoTime, text };
