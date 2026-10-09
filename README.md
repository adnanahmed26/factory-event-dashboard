# NorthBridge production event dashboard

A runnable Express application with a responsive supervisor dashboard, PostgreSQL event ledger, REST ingestion, and an outbound MQTT worker. COUNT events add production once; VOID events reverse an earlier COUNT without deleting history. Every received event item is recorded as a submission attempt.

## Quick start

Requires Node.js 22 or newer and npm. The development dependencies include real PostgreSQL binaries for a local development database; SQLite and in-memory database substitutes are not used.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run db:local
```

Keep the database terminal open. In another terminal:

```powershell
npm.cmd run migrate
npm.cmd start
```

Open **http://127.0.0.1:3001**. The sample environment uses port 3001 to avoid the original scaffold's server on port 3000. `server.js` also applies the idempotent initial migration at startup. Ctrl+C stops each foreground process. The database files remain in `.local-postgres`, so events survive restart. The included password is only for the loopback development database.

For an existing PostgreSQL installation, set `DATABASE_URL` in `.env` to its connection string instead of running `db:local`. The selected database must already exist, and the database role must be able to create the schema. For Docker, set `POSTGRES_PASSWORD` in your terminal, run `docker compose up -d db`, and point `DATABASE_URL` to `postgresql://factory:<your-password>@127.0.0.1:5432/factory`.

If Windows reports a port conflict, choose another `PORT` or `LOCAL_PG_PORT` and adjust `DATABASE_URL` accordingly. The local launcher uses `pg_ctl` to start PostgreSQL under a restricted Windows token. It never creates a system user or a Windows service.

## Dashboard workflow

1. Use **Count** to populate valid JSON. Edit the source, event ID, quantity, and timezone timestamp, then select **Submit events**. The seven summary values and pending table come from PostgreSQL. COUNT quantities must be integers from 1 through 500; 450 is accepted and 501 is rejected and recorded.
2. Submit the identical payload again: the result is DUPLICATE and the total stays unchanged.
3. Choose **Void** to populate a correction for the newest applicable COUNT. It reverses production, retains both events, and automatically acknowledges the VOID.
4. For a VOID-before-COUNT demonstration, give a VOID a new target ID, submit it, then submit a COUNT with that ID and the same source. Watch the unresolved count return to zero.
5. Select pending COUNT rows and choose **Acknowledge selected**. Acknowledgement records review; a later valid VOID can still reverse that COUNT.
6. Use **Exceptions** for pending references, rejected submissions, and conflicts. Use **Audit history** for every attempt, including identical retries. Click an event ID to inspect the raw and normalized values and timestamps.

Use the **Production source** input above the summary to enter one source ID (for example, `LINE-01`), then choose **Apply** or press Enter. Suggestions include known sources, but you can enter a source without accepted events. **Clear** restores all sources. Filtering applies to all seven summary values, Pending, Exceptions, All events, and Audit history. Rejected submissions has a red-tinted indicator and counts stored REJECTED submission attempts, including repeated rejected deliveries. It excludes DUPLICATE, CONFLICT, and PENDING_REFERENCE attempts. Conflicting attempts belong to the submitted source, while the original event remains with its original source. Invalid submissions without a source appear in unfiltered exceptions and audit history. MQTT status is global. The dashboard refreshes every 15 seconds and also offers manual refresh.

## REST contracts

All request and response bodies are JSON. The body limit is 1 MB and batches contain at most 1,000 items.

### POST /api/events

Accepts one object or an array, returning one result per item in submitted order. A syntactically valid object or array returns HTTP 200 even if items are REJECTED. Invalid JSON, primitive top-level input, or an oversized batch returns HTTP 400 (body-size limit returns 413). Validation failures never undo valid siblings. An unexpected database failure rolls back the whole batch and returns a sanitized error.

```json
{
  "source_id": "LINE-01",
  "event_id": "EV-101",
  "type": "COUNT",
  "quantity": 5,
  "target_event_id": null,
  "event_time": "2026-10-09T10:30:00Z"
}
```

```json
{
  "results": [
    { "event_id": "EV-101", "status": "ACCEPTED", "message": "Event processed." }
  ]
}
```

COUNT requires an integer quantity from 1 to 500, inclusive, and a null/omitted target. Values greater than 500 return REJECTED with the reason `COUNT quantity must be an integer from 1 to 500, inclusive.` The original rejected payload is retained in PostgreSQL and does not increase production totals. This rule is shared by REST and MQTT. VOID requires a target COUNT ID and null/omitted quantity. Both require non-empty source/event IDs (maximum 200 characters) and a valid ISO 8601 timestamp including seconds and a timezone. Timestamps are normalized to UTC for retry comparison. Optional null fields and omitted fields normalize alike. Unknown fields are retained in raw attempts and do not affect business identity.

```json
{
  "source_id": "LINE-01",
  "event_id": "EV-102",
  "type": "VOID",
  "target_event_id": "EV-101",
  "event_time": "2026-10-09T10:31:00Z"
}
```

Possible statuses: ACCEPTED, DUPLICATE, CONFLICT, PENDING_REFERENCE, REJECTED. A retry of a stored event is DUPLICATE even if that event is still pending or was later rejected; it does not reprocess the original. A malformed event is validated before identity comparison.

### GET /api/state?view=summary[&source_id=LINE-01]

`view` is required and must be `summary`, `pending`, or `exceptions`.

```json
{
  "net_total": 5,
  "processed_events": 1,
  "pending_ack": 1,
  "unresolved": 0,
  "duplicates": 0,
  "conflicts": 0,
  "rejected_submissions": 0
}
```

`pending` returns `{ "events": [...] }`: successfully processed, unacknowledged COUNT events. `exceptions` returns `{ "events": [...], "attempts": [...] }`: unresolved/rejected logical events and rejected/conflicting submission attempts. An attempt's original classification is immutable; inspect the logical event for its current resolution status.

### POST /api/ack

```json
{ "event_ids": ["EV-101", "EV-101", "UNKNOWN"] }
```

```json
{
  "results": [
    { "event_id": "EV-101", "status": "ACKED" },
    { "event_id": "EV-101", "status": "ALREADY_ACKED" },
    { "event_id": "UNKNOWN", "status": "NOT_FOUND" }
  ]
}
```

NOT_READY identifies pending/rejected logical events. Both completed COUNTs and completed VOIDs support this API; VOIDs are already acknowledged automatically. Repeated IDs are processed in order and are safe.

Additional dashboard endpoints: `GET /api/health`, `GET /api/audit[?source_id=...]`, and `GET /api/device`.

### PowerShell example

```powershell
$event = @{ source_id='LINE-01'; event_id='EV-101'; type='COUNT'; quantity=5; event_time='2026-10-09T10:30:00Z' }
Invoke-RestMethod http://127.0.0.1:3001/api/events -Method Post -ContentType application/json -Body ($event | ConvertTo-Json)
Invoke-RestMethod 'http://127.0.0.1:3001/api/state?view=summary'
Invoke-RestMethod 'http://127.0.0.1:3001/api/state?view=pending&source_id=LINE-01'
Invoke-RestMethod 'http://127.0.0.1:3001/api/state?view=exceptions'
Invoke-RestMethod http://127.0.0.1:3001/api/ack -Method Post -ContentType application/json -Body '{"event_ids":["EV-101"]}'
```

## MQTT

MQTT is disabled in `.env.example`. The candidate ID is `10`, as specified by the user. No connection to the external assessment broker was made during development.

### Reproducible local device demo

Run `npm.cmd run mqtt:simulator` in a third terminal. It starts a loopback-only MQTT broker on port 1884. Set these values in `.env` and restart the application:

```dotenv
MQTT_ENABLED=true
MQTT_URL=mqtt://127.0.0.1:1884
CANDIDATE_ID=10
```

The simulator waits for ONLINE, then sends a real MQTT challenge containing a COUNT, an identical retry, a VOID-before-COUNT pair, and an invalid item. It prints the correlated response and status messages. Open **Device connection → Challenge history & responses** to inspect the persisted envelope, response, timestamps, and publication state. Demo events are genuine persisted events on `LINE-01`; they intentionally remain in the ledger.

### Assessment broker

After confirming the assigned ID, set `MQTT_ENABLED=true`, `MQTT_URL=mqtt://152.42.238.142:1883`, and `CANDIDATE_ID=<assigned-id>`, then restart the app. The broker uses plain MQTT for the synthetic assessment only.

| Direction | Topic |
| --- | --- |
| Subscribe | `fse-01/{candidate_id}/challenge` |
| Publish response | `fse-01/{candidate_id}/response` |
| Publish status | `fse-01/{candidate_id}/status` |

Client ID: `fse01-{candidate_id}-{random_suffix}`. MQTT 3.1.1, QoS 1, retain false. ONLINE follows successful subscription; HEARTBEAT publishes every 25 seconds; graceful shutdown publishes OFFLINE, and an OFFLINE last will handles unexpected loss. Reconnect uses 1–30 second exponential backoff and resubscribes. Committed responses awaiting PUBACK are retried on reconnect and heartbeat.

```json
{
  "protocol_version": "1.0",
  "candidate_id": "10",
  "challenge_id": "CH-001",
  "command": "PROCESS_EVENTS",
  "sent_at": "2026-10-09T10:45:00Z",
  "expires_at": "2026-10-09T10:46:00Z",
  "events": [
    { "source_id": "LINE-01", "event_id": "EV-101", "type": "COUNT", "quantity": 5, "event_time": "2026-10-09T10:30:00Z" }
  ]
}
```

Use current timestamps when sending this sample. COMPLETED contains ordered `results` and a committed-state `state` snapshot including `rejected_submissions`. Invalid event items can be REJECTED while the envelope succeeds. FAILED includes `error: { code, message }`; failure codes are VALIDATION_ERROR, CANDIDATE_MISMATCH, UNSUPPORTED_PROTOCOL, CHALLENGE_EXPIRED, CHALLENGE_CONFLICT, and INTERNAL_ERROR.

A saved challenge's identical replay returns its original response, including original timestamp and state snapshot, even after its expiry or subsequent state changes. Reusing an ID with a different envelope returns CHALLENGE_CONFLICT and preserves the original. Candidate ID belongs to the MQTT envelope and never becomes part of event identity.

## Verification

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run format:check
```

`npm test` launches a real isolated PostgreSQL cluster and creates a separate temporary test database. It does not truncate your application database. Set `TEST_DATABASE_URL` to an existing PostgreSQL connection if you prefer; the role needs CREATE DATABASE permission. Tests include COUNT, duplicate, global conflicts, correction ordering, validation, ACK retries, concurrency, atomic rollback, database/application restart, MQTT replay, envelope rejection, wire-level QoS/correlation, heartbeat, reconnection, and stored-response delivery. They use a local test broker and never the assessment broker.

UI tests require the application already running at `http://127.0.0.1:3001` and an installed Chrome browser. Set `UI_BASE_URL` to override. They exercise real backend submissions under distinct `UI-TEST-*` sources and leave those attempts in the audit trail. The mobile and API-outage tests also verify overflow and unavailable states. The Browser plugin was unavailable; verification used Playwright with installed Chrome.

`node scripts/capture-ui.js` captures desktop (1505×1045) and narrow mobile (390×844) screenshots. Add `--change-request-demo` to submit real COUNT 450 and COUNT 501 events under a fresh source, apply that source filter, and capture the resulting production/rejection indicator and Exceptions view. [Desktop](docs/screenshots/dashboard-desktop.png), [mobile](docs/screenshots/dashboard-mobile.png), and the [design concept](docs/dashboard-concept.png) are included.

## Project structure

```text
server.js                 startup, migration, lifecycle
src/app.js                thin REST routes and static frontend
src/shared/database.js    pool, transaction and writer lock
src/modules/events/       validation, business rules, repositories
src/modules/ack/          review and automatic VOID acknowledgement
src/modules/state/        database-derived summary and queues
src/modules/audit/        persistent submission/review history
src/modules/mqtt/         challenge protocol, durable response, worker
migrations/               PostgreSQL initialization SQL
public/                   dashboard HTML, CSS and client code
scripts/                  database, migration, MQTT simulator and screenshots
tests/                    database/MQTT integration and browser tests
```

See [TECHNICAL_EXPLANATION.md](TECHNICAL_EXPLANATION.md) for concurrency, boundaries, assumptions, and tradeoffs. [AI_USAGE.md](AI_USAGE.md) records AI assistance. The original `factory.db` is preserved locally and ignored by Git; this app never reads it.

Run `npm.cmd run package` to produce `output/factory-event-dashboard.zip` with source, tests, documentation, screenshots, and `.env.example`. The packaging script uses an explicit source list and excludes credentials, databases, dependencies, PDF-reading tools, and test output.

GitHub repository: [adnanahmed26/factory-event-dashboard](https://github.com/adnanahmed26/factory-event-dashboard). The existing project was imported with three current, scoped commits for the backend, dashboard, and verification/documentation. The local folder and remote repository initially had no Git history; commits were not backdated or presented as historical development.

Before committing, run `npm.cmd run secrets:check` to scan tracked and unignored files, or `node scripts/scan-secrets.js --staged` to scan the exact staged blobs. The scan reports file/line locations without printing matching secret values. `.env.example` contains only the documented loopback development database placeholder; real environment files, credentials, databases, dependencies, caches and build outputs are ignored. Treat automated scanning as an additional check, not a guarantee against every possible secret format.

Examiner-specific Google Form submission and uploading the private conversation remain external handoff steps. Review the AI conversation and local environment before submitting.
