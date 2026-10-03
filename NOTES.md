# Technical Test Notes

## Design and State

The backend is Django/DRF with PostgreSQL in Compose; the React/Vite application calls that API through the Vite proxy. A `User` has a unique email, one of three roles, and Django-managed password hashing. A client owns `Request` rows through a protected foreign key. A request stores its current status and delivery requirements. `StatusHistory` records status events with actor and timestamp. `Episode` rows are imported independently and have a canonical, unique business ID. `Assignment` joins one episode to one request; the episode foreign key is one-to-one, so the database prevents assigning the same episode twice.

The current request status is the fast-read state; history is the audit trail. The transition service locks the request, checks the role and state, checks the delivery count, then updates status and inserts history in one transaction. Request creation also writes an initial `submitted` history event in the same transaction. Clients are scoped to their own requests in the queryset; UI role controls are convenience only. The backend remains the authorization boundary.

Three decisions mattered most:

- Episode IDs are trimmed and uppercased before lookup and persistence. A migration reconciles existing case variants deterministically, moves a sole assignment to the retained row, and stops if duplicates have conflicting assignments rather than lose that assignment.
- Assignment inputs use the episode business ID while foreign keys continue to use database IDs internally. The one-to-one database constraint complements the service's role, request-state, and quality checks.
- Delivery analytics uses the actual `submitted` and `delivered` history timestamps. The workflow does not create a second submitted event after rejection; accordingly, rework delivery is not treated as a new submitted-to-delivered observation. Older requests without an initial submitted event are excluded instead of substituting `Request.created_at`.

## What Went Wrong

During episode-ID remediation, PostgreSQL rejected a migration with `cannot ALTER TABLE ... because it has pending trigger events`. The migration reconciled duplicate rows and then added a constraint in the same migration transaction. Splitting the schema operation from an explicitly atomic data-reconciliation block resolved the PostgreSQL restriction; the migration was rerun against the development database and a migration-level test verifies assignment preservation.

The earlier Docker setup also put the default working directory at `/app` although `manage.py` was under `/app/backend`; `docker compose exec backend python manage.py ...` failed. Setting the image workdir to `/app/backend` made the documented commands work. Compose now also allows the internal `backend` hostname so the Vite proxy can reach Django.

## Security and Tradeoffs

Django stores password hashes, not the supplied seed passwords. APIs use Basic Authentication and Django session authentication; there is no separate login/token endpoint. For the browser frontend, the Basic Authorization header is held in tab-scoped `sessionStorage` so requests survive navigation/reload, and it is cleared on logout or a 401. It is reversible and accessible to same-origin scripts, so this is a development/test tradeoff, not a production credential-storage design. A deployed version should use HTTPS and an appropriately scoped HttpOnly session cookie or short-lived token design, plus a tested Content Security Policy.

Two risks I would prioritize:

1. **Broken object authorization (IDOR/BOLA):** a client might alter a request ID to access another client's data. The request queryset filters clients to their own requests and tests cover cross-client list/detail/transition access. Every future nested endpoint must preserve that scoping; production monitoring and broader object-level tests would add defense.
2. **Credential theft through same-origin script execution:** XSS could read the stored Basic header and reuse it. React escapes ordinary text and the API client does not put credentials in URLs or log request bodies, but session storage is not an XSS boundary. HttpOnly session cookies, HTTPS, a restrictive CSP, and dependency/security review are production follow-ups.

The importer parses CSV rather than evaluating input, normalizes identity/quality fields, validates required values and known robots, and uses a database uniqueness constraint for idempotency. It processes rows individually; large-import throughput was not optimized in this remediation.

## Scale and Deliberate Omissions

Analytics aggregates in PostgreSQL rather than loading episode/request tables into Python. Episode has indexes on `recorded_at`, `robot_id`, `task_name`, and `quality`, plus unique `episode_id`; request has client/status and client-FK indexes. Status history has request and actor FK indexes, but no composite status/time index. At five million episodes, broad date ranges still scan and aggregate substantial data, and the percentile query must order matching fulfillment durations. Indexes do not make wide analytical scans free; no five-million-row benchmark was run. I would inspect `EXPLAIN ANALYZE` on production-like distributions before changing indexes. At 10× users, request concurrency and database connection capacity deserve load testing. At 100× episodes, importer throughput, wide-range analytics, and median sorting are likely earlier pressure points. Daily pre-aggregates/materialized views or a dedicated analytics pipeline are possible later steps, not current features.

I deliberately did not add real-time updates, background export jobs, deployment, CI, or pre-aggregated analytics. The UI has simple current-page request filters rather than server-side task/status filters, because those query parameters do not exist in the API. With two more days I would add an end-to-end browser suite against Compose, measure representative query plans, and then decide whether to add server-side request filters or analytics indexes based on use cases and evidence.

## AI Tooling

GitHub Copilot assisted with repository inspection, implementation, test drafting, and debugging during the Phase 4 and Phase 5A/5B work. The repository does not establish which AI tools, if any, were used for earlier phase commits, so I do not attribute those commits to a named tool. Changes were checked against the implementation, automated tests, PostgreSQL migrations, and live Docker/API behavior; I remain responsible for understanding and defending the submitted code.
