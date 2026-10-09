const { transaction } = require('../../shared/database');
async function getAudit(pool, sourceId = null) {
  return transaction(
    pool,
    async (c) => ({
      events: (
        await c.query(
          'SELECT * FROM production_events WHERE ($1::text IS NULL OR source_id=$1) ORDER BY sequence_id DESC',
          [sourceId],
        )
      ).rows,
      attempts: (
        await c.query(
          'SELECT * FROM submission_attempts WHERE ($1::text IS NULL OR source_id=$1) ORDER BY id DESC',
          [sourceId],
        )
      ).rows,
      acknowledgements: (
        await c.query(
          `SELECT a.* FROM acknowledgement_attempts a LEFT JOIN production_events e USING(event_id)
      WHERE ($1::text IS NULL OR e.source_id=$1) ORDER BY a.id DESC`,
          [sourceId],
        )
      ).rows,
      sources: (
        await c.query('SELECT source_id,display_name FROM production_sources ORDER BY source_id')
      ).rows,
    }),
    { readOnly: true },
  );
}
module.exports = { getAudit };
