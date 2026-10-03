# Engineering Notes

## Design and data model

The application is a React/Vite client over a Django REST Framework API, backed by PostgreSQL in Docker Compose. A `User` has an email identity and a role. A client owns many `Request` records. Each request stores its current workflow status and requested episode count; related `StatusHistory` rows retain the actor, timestamp, prior/new status, and optional reason. `Episode` stores imported recording metadata under a canonical, unique business ID. `Assignment` links a request to an episode, with a one-to-one episode relation so the database prevents double allocation.

Current request status is the fast-read state; history is the audit trail. Creation writes the initial `submitted` event transactionally. A transition locks the request, checks role and legal state transition, applies the delivery allocation gate, updates the request, and inserts history in one transaction. Assignment similarly locks the request and episode before creating the row; the uniqueness constraint is the final concurrency guard. PostgreSQL remains the production-like database; SQLite is retained for lightweight local development.

Three decisions shaped the design:

- Normalize episode business IDs by trimming and uppercasing at import/persistence boundaries. The remediation migration preserves a sole existing assignment when merging duplicate IDs, and aborts on conflicting assignments rather than silently losing one.
- Keep a request's current status on the request row while storing every transition separately. This keeps list views simple without sacrificing traceability.
- Calculate delivery median from actual `submitted` and `delivered` history timestamps. A request without its initial submitted event is excluded; `created_at` is not substituted. A rejection/rework path has no new submission event and therefore does not create an artificial second cycle.

## Security and validation

Django's user manager hashes passwords using Django's configured password hashers and validators. Server-side permissions enforce role rules; request querysets isolate clients to their own records. Admin safeguards prevent self-deactivation/self-demotion and protect the last active administrator. Serializers, model/database constraints, and the importer validate request counts, dates, status values, episode quality, robot IDs, duration, and canonical identifiers. The importer parses CSV as data and uses the unique business ID for idempotency.

The browser uses HTTP Basic Authentication and keeps its Authorization value in tab-scoped `sessionStorage`; it is cleared on logout or an unauthorized response. This is a deliberate technical-test/development tradeoff, not production-ready credential storage. Production should use HTTPS and a suitably scoped HttpOnly session cookie or short-lived token, with CSRF protections where applicable, a restrictive Content Security Policy, and security/dependency review. The two risks I would prioritize are broken object-level authorization (IDOR/BOLA) and credential theft after same-origin script execution (XSS). Request logs contain method, path, status, duration, and authenticated user ID only; they do not include request bodies or credentials, and credentials are not placed in URLs.

## Problems encountered

During the episode-ID migration, PostgreSQL rejected a schema change with pending trigger events because duplicate reconciliation and constraint creation shared one migration transaction. Separating the schema operation from the explicitly atomic data reconciliation resolved it; a migration test verifies preservation of an assignment during canonicalization.

The container image initially used `/app` as its working directory even though `manage.py` was under `/app/backend`. The documented `docker compose exec backend python manage.py ...` command therefore failed. Setting the image working directory to `/app/backend` made the commands consistent. During final startup review, Django also reported parallel request-migration leaves; an empty merge migration joined the branches, after which startup, `check`, and migration consistency validation succeeded. The lesson was to test migrations with the production database and to verify the documented container commands, not infer them from the local shell.

## Scale and measured verification

Analytics grouping, status counts, top-task ranking, and median calculation execute in the database. PostgreSQL uses `PERCENTILE_CONT` for the median; the application formats grouped results rather than loading all episode/request records into Python. Existing indexes cover episode recorded time, robot, task, quality, and unique episode ID; request client/status and foreign keys are indexed. These help selective reads but cannot make broad scans or large percentile sorts free.

No five-million-episode benchmark or 10×-user load test was run. At 10× users, connection capacity, concurrent transitions, and request-list query plans should be measured. At 100× episodes, importer throughput and wide-range analytics are likely pressure points; row-by-row `get_or_create` is safe and idempotent but not optimized for bulk throughput. Before changing indexes, use `EXPLAIN ANALYZE` on representative PostgreSQL data and date ranges. If analytics latency or concurrency warrants it, daily aggregates/materialized views or a separate analytics pipeline could reduce repeated wide scans. These are future options, not implemented or benchmarked behavior.

Verification includes the backend suite on the Compose/PostgreSQL service, frontend unit/component tests and production build, Django system and migration checks, and live health, episode-search, and pagination checks. These checks establish functional behavior for the tested cases; they do not establish large-scale performance.

## Deliberate omissions and future work

Core workflow, authorization, import, analytics, and operations were prioritized. Optional Stretch Item was not implemented. The specification's optional choices—real-time updates, background export simulation, and public HTTPS deployment—remain future work, not core-scope failures. With more time, I would first add browser-level end-to-end tests against Compose, measure representative query plans/import throughput, and use that evidence to prioritize production authentication and analytics improvements. CI and analytics pre-aggregation are also not included.

## AI tooling

GitHub Copilot assisted with repository inspection, implementation, test drafting, and debugging. I reviewed changes against source behavior, tests, migrations, and live Docker/API responses; I am responsible for understanding and defending the submitted design. I do not attribute earlier commits to a specific AI tool where the repository does not establish that attribution.
