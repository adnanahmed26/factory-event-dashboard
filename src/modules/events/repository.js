async function findEvent(c, id) {
  return (await c.query('SELECT * FROM production_events WHERE event_id=$1', [id])).rows[0];
}
async function insertEvent(c, e, status, error = null) {
  await c.query(
    'INSERT INTO production_sources(source_id,display_name) VALUES($1,$1) ON CONFLICT DO NOTHING',
    [e.source_id],
  );
  return (
    await c.query(
      `INSERT INTO production_events
    (event_id,source_id,type,quantity,target_event_id,event_time,normalized_payload,status,error,processed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8='ACCEPTED' THEN clock_timestamp() END) RETURNING *`,
      [
        e.event_id,
        e.source_id,
        e.type,
        e.quantity,
        e.target_event_id,
        e.event_time,
        JSON.stringify(e),
        status,
        error,
      ],
    )
  ).rows[0];
}
async function recordAttempt(c, raw, event, status, error, meta = {}) {
  await c.query(
    `INSERT INTO submission_attempts(raw_payload,normalized_payload,source_id,event_id,classification,error,transport,challenge_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      JSON.stringify(raw),
      event ? JSON.stringify(event) : null,
      typeof raw?.source_id === 'string' ? raw.source_id : null,
      typeof raw?.event_id === 'string' ? raw.event_id : null,
      status,
      error || null,
      meta.transport || 'REST',
      meta.challenge_id || null,
    ],
  );
}
async function voidsFor(c, target, status) {
  return (
    await c.query(
      `SELECT * FROM production_events WHERE type='VOID'
  AND target_event_id=$1 AND status=$2 ORDER BY sequence_id`,
      [target, status],
    )
  ).rows;
}
async function completeVoid(c, id) {
  await c.query(
    "UPDATE production_events SET status='ACCEPTED',error=NULL,processed_at=clock_timestamp() WHERE event_id=$1",
    [id],
  );
}
async function rejectReference(c, id, error) {
  await c.query("UPDATE production_events SET status='REJECTED',error=$2 WHERE event_id=$1", [
    id,
    error,
  ]);
}
module.exports = { findEvent, insertEvent, recordAttempt, voidsFor, completeVoid, rejectReference };
