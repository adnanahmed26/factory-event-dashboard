CREATE TABLE IF NOT EXISTS production_sources (
  source_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS production_events (
  sequence_id BIGSERIAL UNIQUE NOT NULL,
  event_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES production_sources(source_id),
  type TEXT NOT NULL CHECK (type IN ('COUNT','VOID')),
  quantity INTEGER, target_event_id TEXT,
  event_time TIMESTAMPTZ NOT NULL, normalized_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  status TEXT NOT NULL CHECK (status IN ('ACCEPTED','PENDING_REFERENCE','REJECTED')),
  error TEXT, processed_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
  CHECK ((type='COUNT' AND quantity IS NOT NULL AND quantity > 0 AND target_event_id IS NULL) OR
    (type='VOID' AND quantity IS NULL AND target_event_id IS NOT NULL)),
  CHECK (acknowledged_at IS NULL OR status='ACCEPTED')
);
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_void_per_count ON production_events(target_event_id)
  WHERE type='VOID' AND status='ACCEPTED';
CREATE INDEX IF NOT EXISTS events_source_status ON production_events(source_id,status);
CREATE INDEX IF NOT EXISTS pending_references ON production_events(target_event_id,sequence_id) WHERE status='PENDING_REFERENCE';
CREATE TABLE IF NOT EXISTS submission_attempts (
  id BIGSERIAL PRIMARY KEY, raw_payload JSONB NOT NULL, normalized_payload JSONB,
  source_id TEXT, event_id TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('ACCEPTED','PENDING_REFERENCE','REJECTED','DUPLICATE','CONFLICT')),
  error TEXT, transport TEXT NOT NULL CHECK (transport IN ('REST','MQTT')), challenge_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS attempts_source_class ON submission_attempts(source_id,classification);
CREATE TABLE IF NOT EXISTS acknowledgement_attempts (
  id BIGSERIAL PRIMARY KEY, event_id TEXT NOT NULL, status TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'SUPERVISOR', received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS mqtt_challenges (
  id BIGSERIAL UNIQUE NOT NULL, challenge_id TEXT PRIMARY KEY, request JSONB NOT NULL,
  request_hash TEXT NOT NULL, response JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), published_at TIMESTAMPTZ
);
