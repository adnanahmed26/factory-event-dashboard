# Technical explanation

## Entity model and boundaries

The deployable unit is one Node.js process and one PostgreSQL database. The HTTP adapter and outbound MQTT adapter share `processBatch`; neither implements COUNT/VOID rules. Each module has a narrow function interface, so changing an ingestion adapter does not change validation, state queries, or review behavior.

`production_sources` identifies a line/device by its source name. `production_events` stores the canonical logical event, its global ID, UTC event time, receipt/processing/review timestamps, current status, and resolution reason. `submission_attempts` records every received event item with raw JSON, normalized business fields where valid, its source/event IDs where available, transport, challenge ID, original classification, and reason. `acknowledgement_attempts` records supervisor and automatic review attempts. `mqtt_challenges` stores each identifiable envelope, its canonical hash, original response, processing status, and confirmed publication time.

An event is a business fact; an attempt is a delivery. Two identical deliveries create two attempts and one logical event. An event ID is globally unique, not composite with its source. A conflicting delivery from another source remains evidence under the attempted source while preserving the original event. Structurally invalid events only create attempts, because they cannot satisfy logical-event constraints.

## Transactions and concurrency

Every event batch is one transaction. All mutations first take the same PostgreSQL transaction-scoped advisory lock (`8041001`). The lock is shared by REST ingestion, MQTT ingestion, review, and initialization; this serializes business writes even across application instances. It protects non-existent target references, competing global IDs, simultaneous corrections, and ACK races without relying on process memory. The global primary key and partial unique index on accepted VOID targets provide additional database protection.

Items are processed in submitted order. Validation failures are ordinary classified results and create durable attempts; processing continues. Unexpected database errors roll back every event, attempt, resolution, and acknowledgement in the batch. Post-commit notifications only fire after the transaction commits. Observer failures cannot retroactively change success into a retry-inducing failure.

This deliberately simple single-writer design favors correctness and reviewability for the assessment. It limits throughput. A larger deployment could replace the global lock with consistently ordered, per-event/reference locks and retry serialization failures, retaining uniqueness constraints. State reads use repeatable-read, read-only transactions so each query group sees a consistent snapshot.

## What counts as production

A structurally valid, new COUNT with an integer quantity from 1 to 500 becomes ACCEPTED and contributes its quantity once. The UTC-normalized business fields determine duplicate identity. Optional fields omitted or null normalize alike; input JSON key order and equivalent timezone representations do not create conflicts. IDs and source names remain exact, case-sensitive strings. Unknown metadata is retained in raw attempts but excluded from business comparison.

A VOID contributes the negative quantity of its target COUNT only when ACCEPTED. It requires the same source and can only target an accepted COUNT. A partial unique index prevents two accepted corrections for one target. The COUNT is retained, even after reversal or acknowledgement.

When a VOID precedes its target, it becomes PENDING_REFERENCE and contributes nothing. Another same-source VOID for that missing target is rejected because the earlier stored correction reserves it. A different-source pending VOID remains unresolved until the target exists; it is then rejected if sources differ. When the target arrives, pending references are checked in sequence order. The first applicable VOID becomes ACCEPTED; incompatible references are rejected with reasons. If the target turns out to be a VOID, waiting references to it are rejected as well. Event timestamps do not determine priority; durable receipt order does.

The submission attempt retains its original PENDING_REFERENCE classification, while the logical event receives the current ACCEPTED/REJECTED status. This preserves the actual history without rewriting received evidence.

## Acknowledgements and summary

Review adds an acknowledgement timestamp and an attempt record; it does not delete anything or affect production. Repeated review of one ID returns ACKED once and ALREADY_ACKED thereafter, including repeated IDs inside one request. Pending or rejected logical events return NOT_READY; an absent original event returns NOT_FOUND.

The factory workflow automatically acknowledges completed VOID events using the shared acknowledgement function in the same transaction as processing/resolution. Only unacknowledged COUNT events appear in the supervisor review table.

Net production sums accepted COUNT quantities minus the target quantities of accepted VOIDs. Processed events count accepted logical events, including resolved VOIDs. Pending review counts accepted logical events without review. Unresolved counts pending VOID references. Duplicate/conflict counters count attempts, filtered by attempt source. Rejected submissions counts only attempts whose original classification is REJECTED, using the same optional source filter. No total is derived from Node.js memory or client-side optimistic arithmetic.

## MQTT lifecycle and reliability

The worker connects outbound using its configured candidate-specific topics. It checks the protocol version, candidate ID, challenge ID, command, timestamps/expiry, and collection shape before invoking shared event processing. Candidate ID is envelope metadata and is excluded from event identity.

Challenge processing, event processing, and response persistence occur in the same transaction. The response includes a summary taken before releasing the write lock. Canonical JSON hashing ignores object-key ordering but preserves array order and values. An identical saved envelope returns the exact stored response before checking its current expiry. A changed envelope with the same ID returns CHALLENGE_CONFLICT without overwriting the saved result.

After commit, the worker publishes the response with QoS 1 and retain false. Only the PUBACK callback allows marking it published. Unpublished responses form a durable outbox and are retried after resubscription and each heartbeat. A crash after broker acknowledgement but before marking publication can cause a response replay; it cannot reprocess production. Invalid envelopes with usable challenge IDs are also stored. A malformed envelope without an identifiable ID cannot provide an ID-correlated durable record; it receives a failure response with a null ID. A transient database failure returns INTERNAL_ERROR and leaves the original request retryable.

ONLINE is sent after successful subscription. HEARTBEAT runs every 25 seconds. OFFLINE is sent on graceful shutdown and configured as a last will. Reconnect uses exponential backoff from one to thirty seconds and restores the candidate subscription. MQTT connectivity/error fields are runtime observations; challenge history and response evidence are durable and survive restarts. Only one configured candidate is intended per deployment.

## Important functions

| Function | Responsibility |
| --- | --- |
| `validateEvent` | Validate an item and return normalized business fields or a reason |
| `processOne` / `processBatch` | Classify attempts and apply COUNT/VOID rules in order |
| `resolveReferences` | Resolve/reject previously stored VOID references |
| `acknowledgeOne` | Safely review a completed event and preserve the review attempt |
| `transaction` | Begin, lock writers, commit/rollback, and release the connection |
| `summary` / `getState` | Query durable totals and review/exception queues |
| `handleChallenge` | Validate, replay/detect conflict, process and persist one envelope |
| `startMqtt` | Subscription, publication, heartbeat, outbox retry and reconnect |

To trace a challenge, inspect `mqtt_challenges.request`, follow `challenge_id` in `submission_attempts`, inspect current `production_events`, then compare the saved response to `published_at`. The UI's challenge details expose the envelope and response together.

## Change request implementation

The shared `validateEvent` function now restricts new COUNT submissions to integer quantities from 1 to 500, inclusive. REST and MQTT both call the existing event service, so the rule is implemented once. Invalid quantities remain persisted REJECTED attempts and do not create production events or change totals. Existing accepted history is retained, including any quantities accepted before the policy changed; no destructive schema rewrite or backfill is required.

The shared `summary` query adds `rejected_submissions` using a PostgreSQL aggregate over REJECTED submission attempts and the existing optional source filter. It counts deliveries, including repeated invalid deliveries, rather than logical events. A previously pending reference later rejected during resolution is not a new REJECTED submission attempt. The six original fields are unchanged. Newly processed MQTT responses use the same query and include the field; saved historical challenge replays retain their exact original snapshots.

The dashboard exposes the existing `source_id` API contract through an editable source input with suggestions, Apply/Enter, and Clear. Filtering controls Summary, Pending, Exceptions, All events, and Audit. A seventh red-tinted Rejected submissions indicator refreshes from real backend values, shows zero when no rejections exist, and remains responsive. Loading and failed filtering cannot expose stale rows from a prior source. No new API, separate service, or duplicated business rule was introduced.

## Assumptions and practical limits

- The configured candidate ID is `10`, as specified by the user. The supplied `.env.example` disables the external examiner-broker connection.
- Required `view` is explicit; an omitted/unknown view returns 400. An empty batch is a valid no-op. IDs/source names have a 200-character limit, batches a 1,000-item limit, and JSON bodies a 1 MB limit.
- Source IDs need no separate onboarding and are added automatically for valid logical events. Invalid attempts do not create sources.
- Timezone timestamps include seconds, optional one-to-three millisecond digits, and `Z` or a numeric offset. Impossible calendar dates are rejected rather than silently rolled forward.
- Repeated identical rejected logical events return DUPLICATE. Correcting one requires a new event ID. Structurally invalid attempts reserve no logical ID.
- The dashboard is a local assessment application without multi-user authentication or role enforcement. It binds to loopback by default. Add authentication, authorization, TLS, broker ACLs, operational monitoring, pagination, and retention controls before a wider deployment.
- Audit/event queries currently return full matching history; challenge details show the latest twenty records. This is suitable for the assessment, but pagination is needed for sustained factory traffic. Summary numbers are represented as JavaScript numbers and assume totals stay within its exact integer range.
- Database schema initialization is idempotent. Future schema changes should use numbered, version-tracked migrations rather than changing an already-applied initial migration.
- The frontend uses native HTML/CSS/JavaScript served by the existing Express project. It avoids introducing a separate frontend build/deployment while keeping UI state and backend contracts separate.
- GitHub publication uses the user's specified repository and existing authentication. The project import has three current, scoped commits; no historical commits were fabricated. Google Form submission, live examiner-broker verification, and the private conversation export remain user handoff steps.
- Optional Protocol Buffers support is not included; existing JSON contracts are the implementation target.
