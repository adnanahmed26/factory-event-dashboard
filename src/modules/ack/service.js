const { transaction } = require('../../shared/database');
async function acknowledgeOne(c, id, origin = 'SUPERVISOR') {
  const event = (
    await c.query('SELECT status,acknowledged_at FROM production_events WHERE event_id=$1', [id])
  ).rows[0];
  const status = !event
    ? 'NOT_FOUND'
    : event.status !== 'ACCEPTED'
      ? 'NOT_READY'
      : event.acknowledged_at
        ? 'ALREADY_ACKED'
        : 'ACKED';
  if (status === 'ACKED')
    await c.query(
      'UPDATE production_events SET acknowledged_at=clock_timestamp() WHERE event_id=$1',
      [id],
    );
  await c.query('INSERT INTO acknowledgement_attempts(event_id,status,origin) VALUES($1,$2,$3)', [
    id,
    status,
    origin,
  ]);
  return { event_id: id, status };
}
async function acknowledge(pool, ids) {
  return transaction(pool, async (c) => {
    const results = [];
    for (const id of ids) results.push(await acknowledgeOne(c, id));
    return { results };
  });
}
module.exports = { acknowledge, acknowledgeOne };
