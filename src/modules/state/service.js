const { transaction } = require('../../shared/database');
async function summary(c, sourceId = null) {
  const {
    rows: [row],
  } = await c.query(
    `SELECT
    COALESCE(SUM(CASE WHEN e.status='ACCEPTED' AND e.type='COUNT' THEN e.quantity
      WHEN e.status='ACCEPTED' AND e.type='VOID' THEN -t.quantity ELSE 0 END),0)::text AS net_total,
    COUNT(*) FILTER(WHERE e.status='ACCEPTED')::int AS processed_events,
    COUNT(*) FILTER(WHERE e.status='ACCEPTED' AND e.acknowledged_at IS NULL)::int AS pending_ack,
    COUNT(*) FILTER(WHERE e.status='PENDING_REFERENCE')::int AS unresolved
    FROM production_events e LEFT JOIN production_events t ON t.event_id=e.target_event_id
    WHERE ($1::text IS NULL OR e.source_id=$1)`,
    [sourceId],
  );
  const {
    rows: [attempts],
  } = await c.query(
    `SELECT COUNT(*) FILTER(WHERE classification='DUPLICATE')::int AS duplicates,
    COUNT(*) FILTER(WHERE classification='CONFLICT')::int AS conflicts,
    COUNT(*) FILTER(WHERE classification='REJECTED')::int AS rejected_submissions FROM submission_attempts
    WHERE ($1::text IS NULL OR source_id=$1)`,
    [sourceId],
  );
  return { ...row, net_total: Number(row.net_total), ...attempts };
}
async function getState(pool, sourceId, view) {
  return transaction(
    pool,
    async (c) => {
      if (view === 'summary') return summary(c, sourceId);
      if (view === 'pending')
        return {
          events: (
            await c.query(
              `SELECT * FROM production_events WHERE status='ACCEPTED'
      AND acknowledged_at IS NULL AND type='COUNT' AND ($1::text IS NULL OR source_id=$1) ORDER BY sequence_id`,
              [sourceId],
            )
          ).rows,
        };
      const events = (
        await c.query(
          `SELECT * FROM production_events WHERE status IN ('PENDING_REFERENCE','REJECTED')
      AND ($1::text IS NULL OR source_id=$1) ORDER BY sequence_id`,
          [sourceId],
        )
      ).rows;
      const attempts = (
        await c.query(
          `SELECT * FROM submission_attempts WHERE classification IN ('REJECTED','CONFLICT')
      AND ($1::text IS NULL OR source_id=$1) ORDER BY id`,
          [sourceId],
        )
      ).rows;
      return { events, attempts };
    },
    { readOnly: true },
  );
}
module.exports = { summary, getState };
