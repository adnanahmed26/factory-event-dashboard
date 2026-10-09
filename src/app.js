const express = require('express');
const path = require('node:path');
const { eventCollection, text, isObject } = require('./modules/events/validation');
const { submitEvents } = require('./modules/events/service');
const { acknowledge } = require('./modules/ack/service');
const { getState } = require('./modules/state/service');
const { getAudit } = require('./modules/audit/service');
const { getDeviceState } = require('./modules/mqtt/service');
function createApp(
  pool,
  device = { state: { status: 'DISABLED', candidate_id: process.env.CANDIDATE_ID || '10' } },
) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '1mb', strict: false }));
  const source = (req) => {
    if (req.query.source_id !== undefined && !text(req.query.source_id)) {
      const error = new Error('source_id must be a non-empty string.');
      error.status = 400;
      throw error;
    }
    return req.query.source_id || null;
  };
  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'running', database: 'PostgreSQL' });
  });
  app.post('/api/events', async (req, res) => {
    const items = eventCollection(req.body);
    if (items.length > 1000) return res.status(400).json({ error: 'Maximum batch size is 1000.' });
    res.json(await submitEvents(pool, items));
  });
  app.get('/api/state', async (req, res) => {
    const view = req.query.view;
    if (!['summary', 'pending', 'exceptions'].includes(view))
      return res.status(400).json({ error: 'view must be summary, pending, or exceptions.' });
    res.json(await getState(pool, source(req), view));
  });
  app.post('/api/ack', async (req, res) => {
    if (
      !isObject(req.body) ||
      !Array.isArray(req.body.event_ids) ||
      req.body.event_ids.length > 1000 ||
      !req.body.event_ids.every(text)
    )
      return res.status(400).json({
        error: 'event_ids must be an array of non-empty event ID strings (maximum 1000).',
      });
    res.json(await acknowledge(pool, req.body.event_ids));
  });
  app.get('/api/audit', async (req, res) => res.json(await getAudit(pool, source(req))));
  app.get('/api/device', async (req, res) => res.json(await getDeviceState(pool, device.state)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.use((error, req, res, next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error.code || error.name);
    res.status(status).json({
      error:
        status >= 500
          ? 'Service unavailable. Please retry.'
          : status === 413
            ? 'Request body exceeds 1 MB.'
            : error.type === 'entity.parse.failed'
              ? 'Invalid JSON body.'
              : error.message,
    });
  });
  return app;
}
module.exports = { createApp };
