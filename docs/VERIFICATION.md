# Verification record

Verified on 9 October 2026 in the supplied Windows workspace. The completed application runs at `http://127.0.0.1:3001`; the previous scaffold occupied port 3000. Runtime dependencies were audited during installation with zero reported vulnerabilities.

## Functional results

| Check | Result | Evidence |
| --- | --- | --- |
| Real PostgreSQL integration suite | PASS, 21 tests | `npm.cmd test`; no skipped or failed tests |
| COUNT and identical retry | PASS | Quantity changes once; both raw submissions remain stored |
| Global conflicts and source filtering | PASS | Original preserved, conflict attributed to attempted source |
| VOID and VOID-before-COUNT | PASS | One reversal; pending resolution; incompatible references rejected |
| Safe acknowledgements | PASS | ACKED once, ALREADY_ACKED on repeat; pending/not-found distinguished |
| Concurrent requests | PASS | Twelve simultaneous retries count once; competing corrections reverse once |
| Batch rollback | PASS | Forced database failure commits no sibling and emits no success callback |
| Persistence | PASS | PostgreSQL stopped/restarted; pool and app recreated; pending event and original MQTT response retained |
| MQTT on actual local broker | PASS | Own-topic subscription, QoS 1, correlation, exact replay, failed-envelope status |
| MQTT heartbeat and reconnect | PASS | Heartbeat observed; forced connection closure followed by resubscription and a new completed challenge |
| Durable response recovery | PASS | Worker publishes a saved unpublished response without resubmitting events |
| Browser operator flow | PASS | Count → duplicate → details → ACK → VOID → rejected input → exceptions/audit |
| Mobile and unavailable API | PASS | 390×844 viewport, no document overflow, actionable unavailable state |
| Browser runtime errors | PASS | No page errors in successful operator flow or screenshot capture |
| Formatting | PASS | `npm.cmd run format:check` |

`npm.cmd run test:ui` passes all five browser tests. The Browser plugin was unavailable in the session, so Playwright used the installed Chrome browser. Browser tests submit real, isolated-source test events to the application database; these remain in its audit trail.

## Running local MQTT demonstration

The completed app was also connected to `mqtt://127.0.0.1:1884`, using the included simulator and candidate ID `08`. Challenge `DEMO-315c45f0` returned COMPLETED with results, in order:

1. COUNT — ACCEPTED, +5.
2. Identical COUNT retry — DUPLICATE, no additional production.
3. VOID for a missing COUNT — PENDING_REFERENCE.
4. Matching COUNT — ACCEPTED; the earlier VOID resolved and was automatically acknowledged.
5. Negative COUNT — REJECTED with its validation reason.

The correlated response and challenge are stored in PostgreSQL and shown in the dashboard. The response's state was net total 5, processed events 5, pending acknowledgement 2, unresolved 0, duplicates 2, conflicts 0; processed/duplicate counters also included the earlier browser test's genuine events. These are observed totals, not UI fixtures. MQTT ONLINE and HEARTBEAT were observed. No assessment-broker connection was made.

## Design comparison

Reference: `docs/dashboard-concept.png` (1505×1045). Latest running-app screenshots: `docs/screenshots/dashboard-desktop.png` and `docs/screenshots/dashboard-mobile.png`. Both the concept and implementation were opened with `view_image` in the final visual QA pass. Desktop was captured at the concept's native viewport; the full-page image extends below the viewport to include the functional challenge history and footer.

| Comparison point | Inspection and resolution |
| --- | --- |
| Overall layout | Preserved the sidebar, header, original six metrics, event table, submit pane, and bottom connection panel; added the requested seventh rejection indicator and source input |
| Palette and borders | Matched white surfaces, light slate borders, navy text, blue primary controls and distinct metric icon colors |
| Typography | Increased desktop heading, navigation, metrics, table and device type after comparison; retained readable mobile sizes |
| Spacing and containers | Matched the 248px desktop rail, open metric rhythm, restrained panel radii and compact tool controls |
| Icons | Native stroked SVG icons follow the reference metaphors and accent treatment |
| Copy and controls | Main heading, subtitle, metric names, tabs, source filter, submit/sample labels, and device labels retained |
| Responsive behavior | Three-column mobile metrics, stacked panes, two-column connection details; wide event table scrolls inside its container |

Above-the-fold copy comparison found the core product labels unchanged. Deliberate functional differences: the concept's invalid abbreviated JSON example was replaced by a complete valid COUNT; live totals, events and connection status replace illustrative zero/disabled values; event status badges, refresh timestamps, backend health, details dialogs, and expandable challenge evidence were added to meet the supplied requirements. Decorative table sort arrows were omitted because sorting was not a required or implemented operation. The product is implemented faithfully to the concept's structure and visual system with these documented differences. No clipped page content or document-level mobile overflow remained.

## Change request verification

The requested quantity limit and rejection summary are implemented in the existing validator and state service. No API or separate service was added. Real PostgreSQL tests verify quantities 1, 450 and 500 are accepted; 501, zero, negative, fractional, string and null values are durably rejected; valid quantities alone affect totals. Duplicate/conflict/VOID regressions still pass. The rejection aggregate counts REJECTED attempts, includes repeated invalid deliveries, excludes other classifications, returns zero for an empty source, and remains correct after recreating the database pool. The MQTT protocol and real wire-level broker tests verify the same rejection rule and the additional response-state field.

Browser tests verify the editable source input applies `source_id` to Summary, Pending and Exceptions, Clear restores all sources, an unknown source returns zero/empty state, and failed filtering removes prior-source rows. The seventh red-tinted indicator is responsive and uses backend values. Desktop (1505×1045) and mobile (390×844) captures were inspected with `view_image`; no JavaScript errors, console errors, or document overflow were observed. Production-source suggestions remain optional: operators can enter arbitrary source IDs.

`node scripts/capture-ui.js --change-request-demo` demonstrates real accepted COUNT 450 and rejected COUNT 501 submissions in a fresh source. Its filtered summary is net total 450, processed events 1, pending review 1, unresolved 0, duplicates 0, conflicts 0, rejected submissions 1. See `docs/screenshots/change-request-desktop.png`, `change-request-exceptions.png`, and `change-request-mobile.png` for the submission results, source-filtered values, and retained validation reason.

## Remaining external handoff

The examiner broker and its candidate-topic access are unverified. Confirm the exact assigned candidate ID before enabling it. GitHub publication, examiner Google Form submission, and a full private conversation export have not been performed. The source archive excludes `.env`, databases, dependencies, Python PDF-reading tools, test output, and build caches. Authentication, pagination, operational monitoring, and TLS are future deployment concerns described in the technical explanation.
