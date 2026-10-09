# AI usage disclosure

The project was completed with assistance from OpenAI Codex on 9 October 2026. The starting code contained an Express health route and a SQLite table. The supplied seven-page scanned assessment was used as reference material for requirements; its candidate/examiner and external submission instructions were not treated as authorization to submit or contact anyone.

AI assistance covered requirement extraction, architecture decisions, PostgreSQL schema and transactions, COUNT/VOID and review logic, MQTT worker and local simulator, dashboard implementation, integration/browser tests, and documentation. An AI-generated UI concept is retained in `docs/dashboard-concept.png`; the running interface is native HTML/CSS/JavaScript, not a screenshot rendered as an application.

Validation uses real PostgreSQL and a real local MQTT broker. Automated tests check actual business outcomes, rollback, concurrency, persistence, and wire-level behavior. Browser verification uses Playwright and installed Chrome because the Browser plugin was unavailable. Test output is reported in `docs/VERIFICATION.md`.

The candidate should review every module and be prepared to explain the entity model, transactions, global uniqueness, pending correction resolution, acknowledgement semantics, challenge replay, and outbox handling. AI-generated code still requires owner review.

For the assessment's requested conversation record, export the actual Codex conversation and include it with the submission after checking for private content. This file is a disclosure, not a fabricated transcript. The current implementation conversation is not available as a file to the coding agent, so no complete conversation export has been created automatically.

The subsequent photographed change request was implemented as a targeted extension: shared COUNT quantity validation (1–500), a PostgreSQL-backed rejected-attempt aggregate, an editable production-source filter, and a seventh summary indicator. Regression coverage was expanded to 21 backend/MQTT tests and five browser tests, with a real accepted/rejected submission demonstration and desktop/mobile screenshots. Existing accepted event history and previously persisted MQTT replay responses were retained.
