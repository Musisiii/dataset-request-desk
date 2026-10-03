# Dataset Request Desk

Dataset Request Desk replaces spreadsheet tracking for robotics-data fulfilment. Clients request datasets, operations staff allocate recorded episodes and deliver them, and clients accept or return deliveries for rework.

The system uses a React/Vite frontend, a Python/Django REST Framework API, and PostgreSQL, orchestrated by Docker Compose. The Vite development server proxies `/api` and `/health` to Django. Backend domains are separated into `accounts`, `dataset_requests`, `episodes`, and `core`. SQLite is also supported for local backend development; PostgreSQL is the exercised Compose configuration.

## Architecture

- `accounts`: email-based users and admin user management.
- `dataset_requests`: requests, role-scoped API access, workflow transitions, and status history.
- `episodes`: episode metadata, CSV import, and one-to-one request assignments.
- `core`: health and analytics endpoints, plus structured request logging.

## Quick start

Prerequisites: Docker Engine and the Docker Compose v2 plugin. From a fresh clone, create a local environment file and start the stack:

```bash
cp .env.example .env
# Set local-only values for the Django secret key and PostgreSQL password.
docker compose up --build -d
```

Compose starts PostgreSQL, then the backend applies migrations and creates any missing development seed users. The frontend is at `http://localhost:5173`; the backend is at `http://localhost:8000`; `http://localhost:8000/health` checks API/database readiness. The episode CSV is intentionally not imported automatically. Import it once (re-running is safe):

```bash
docker compose exec backend python manage.py import_episodes ../seed/episodes.csv
```

In Docker, the frontend proxies browser `/api` and `/health` requests to the backend container, so development requires no CORS configuration. The database has a Compose health check. The unauthenticated `/health` endpoint executes a database query before reporting healthy.

Run tests and other Django commands from the backend container:

```bash
docker compose exec backend python manage.py showmigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_users
docker compose exec backend python manage.py import_episodes ../seed/episodes.csv
docker compose exec backend pytest
```

The image working directory is `/app/backend`, so these commands work without an extra `cd` or `-w` argument. `docker compose down` stops the services and retains the PostgreSQL volume; `docker compose down -v` also removes that data.

The frontend Compose service sets `VITE_API_BASE_URL=/api` and `VITE_BACKEND_PROXY_TARGET=http://backend:8000`. For local Vite development, install frontend packages and start the server from the repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev -- --host 0.0.0.0
```

The local Vite proxy defaults to `http://localhost:8000`; override it with `VITE_BACKEND_PROXY_TARGET` if the backend runs elsewhere.

## Local Development

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cd backend
python manage.py migrate
python manage.py seed_users
python manage.py runserver
```

Without PostgreSQL environment variables, Django uses SQLite. Docker Compose configures PostgreSQL.

## Authentication and Roles

All `/api/` endpoints require authentication. The API supports HTTP Basic and Django session authentication. Development seed accounts are:

| Email | Password | Role |
| --- | --- | --- |
| admin@example.com | admin123 | admin |
| ops1@example.com | ops123 | operator |
| ops2@example.com | ops123 | operator |
| client-a@example.com | client123 | client |
| client-b@example.com | client123 | client |

Clients create requests as themselves and can list or retrieve only their own requests. Clients accept or reject delivered requests. Operators and admins view all requests, perform operational transitions, list available episodes, and assign episodes. Only admins manage users. Seed passwords are development-only; Django stores password hashes.

The browser keeps its Basic Authorization header in tab-scoped `sessionStorage` for this technical-test application. This is a development tradeoff, not a production authentication pattern; see [NOTES.md](./NOTES.md).

## Request Workflow

Valid transitions are `submitted → in_progress → delivered → accepted`, `delivered → rejected`, and `rejected → in_progress`. Clients own acceptance/rejection; operators and admins own operational transitions. Each successful transition updates the request and writes a `StatusHistory` record in one transaction. Delivery is rejected until at least `episodes_requested` episodes are assigned.

The frontend provides request listing and filtering, request creation and detail dialogs, role-appropriate workflow actions, allocation progress, and success/error toasts. Operators can deliver directly from the episode-allocation workflow once the allocation gate is met.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/requests/` | List visible requests. |
| `POST` | `/api/requests/` | Create a request as the authenticated client. |
| `GET` | `/api/requests/{id}/` | Retrieve a permitted request. |
| `POST` | `/api/requests/{id}/transition/` | Transition with `{"status":"in_progress"}` or another permitted status. |
| `POST` | `/api/requests/{id}/assignments/` | Assign an eligible episode by business ID. |

Responses include `assigned_episodes_count`, calculated with a database annotation. Request lists use DRF page-number pagination with 15 results per page and a `count`, `next`, `previous`, `results` envelope. Use `?page=2` for later pages.

Request lists support `task_name`, `status`, `allocation_state`, and date filters. `submitted_from` and `submitted_to` filter `created_at` by inclusive calendar dates in the configured Django timezone; both accept `YYYY-MM-DD` and may be used independently. For example, `GET /api/requests/?submitted_from=2026-08-01&submitted_to=2026-08-31` returns requests created on any local time from August 1 through August 31. Existing deadline filters `deadline_after` and `deadline_before` remain available, with `start_date` and `end_date` as aliases.

## Episodes and Assignments

Import the supplied recording-system CSV from the repository root in Docker, or from `backend/` locally:

```bash
docker compose exec backend python manage.py import_episodes ../seed/episodes.csv
```

The importer trims and uppercases episode IDs, normalizes quality casing, supports the supplied date formats, and reports imported/skipped rows and reasons. Repeated or case/whitespace-variant IDs resolve to one canonical ID. A database constraint requires stored IDs to be canonical. The migration retains the lowest-PK duplicate and transfers an assignment if exactly one duplicate is assigned; it aborts rather than discard conflicting assignments.

Operators and admins can list unassigned `good` or `usable` episodes. `task_name` is a live, case-insensitive substring filter; `quality` filters by quality. The `search` parameter matches substrings in episode ID, task, robot, operator, quality, duration, and recorded timestamp. Exact `duration` and `recorded_date` filters are also available. For example, `GET /api/episodes/?task_name=up&quality=good` matches task names containing `up`, while `GET /api/episodes/?search=EP-00015` searches the business ID. Episode lists use the same 15-record page-number pagination and response envelope; the UI supports numbered pages and direct page jumps.

Assignment creation uses the episode business identifier, not its database primary key:

```http
POST /api/requests/1/assignments/
Content-Type: application/json

{"episode_id":"EP-00015"}
```

Only operators/admins can assign episodes. Bad-quality and already-assigned episodes are rejected. An episode can belong to at most one request.

## Admin User Management

Only authenticated users with role `admin` can use these endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/` | List users. |
| `POST` | `/api/users/` | Create a user with email, name, role, optional organisation, and password. |
| `GET` | `/api/users/{id}/` | Retrieve a user. |
| `PATCH` | `/api/users/{id}/` | Update profile, role, or active state. |
| `POST` | `/api/users/{id}/deactivate/` | Soft-deactivate a user. |
| `POST` | `/api/users/{id}/change-role/` | Change role with `{"role":"operator"}`. |

Roles are `admin`, `operator`, and `client`; passwords use Django validation and hashing. Admins cannot deactivate themselves or remove their own admin role. The last active admin cannot be deactivated or demoted. Deactivation preserves request/status history and prevents future authentication.

The admin UI supports paginated user listing, account creation, role changes, and deactivation, with confirmation dialogs for destructive actions.

## Analytics

`GET /api/analytics/?start_date=2026-08-01&end_date=2026-08-31` is available to authenticated operators and admins. Both dates are inclusive and must use `YYYY-MM-DD`.

The response contains episodes grouped by recorded date and robot, episode counts by quality, request counts by current status for requests created in the range, the median delivery duration for delivered transitions in the range, and the top five task names by good episodes recorded in the range. Request creation writes an initial `submitted` `StatusHistory` event with no previous status. Each median observation pairs that event with the first later `delivered` history event before another `submitted` or `delivered` event for the same request. A rejected request can return to `in_progress` and be delivered again, but that rework path creates no new `submitted` event, so its later delivery is not counted as another submission-to-delivery observation. Older requests without an initial submitted history event are excluded; their submission time is not inferred from `created_at`. The delivery timestamp determines whether an observation falls in the inclusive requested date range. PostgreSQL calculates the median with `PERCENTILE_CONT`; grouping and top-task counts are database aggregates.

## Scale considerations

### Current implementation

With around 5 million episodes, analytics aggregates in PostgreSQL and formats grouped results in the application; it does not load every Episode or Request row into Python. The query filters/grouping keys are indexed individually on Episode: `recorded_at`, `robot_id`, `task_name`, and `quality`; `episode_id` is unique. Request has a `(client, status)` index and its client foreign-key index. StatusHistory has indexes on its request and actor foreign keys, but no composite index for status plus change time. Request `created_at` is not indexed.

These indexes can help selective date, quality, task, robot, and relationship lookups, but they do not eliminate work for broad ranges. PostgreSQL may scan many matching episode entries and still aggregate/sort groups; the percentile median must order qualifying cycle durations and can become expensive or spill to disk as volume/concurrency grows. At 10× users, connection capacity and concurrent request/assignment transactions need load testing. At 100× episodes, importer throughput and wide-range analytics are likely pressure points. No 5-million-row benchmark or load test has been run.

### Production-scale next steps

Use `EXPLAIN ANALYZE` with production-like distributions and date ranges before adding indexes; the planner may prefer a sequential scan for broad ranges. In particular, evaluate composite Episode date/quality indexes and a StatusHistory delivery-time/relationship index against measured plans. For much higher analytics volume or concurrency, consider daily pre-aggregates/materialized views or a separate analytics pipeline. None of those optimizations is currently implemented.

## Health and Request Logs

`GET /health` is unauthenticated and returns `{"status":"ok"}` when the database is reachable. Each HTTP request emits one JSON log line to container stdout with `method`, `path`, `status`, `duration_ms`, and `user_id` (null for anonymous requests). Request bodies and credentials are not logged.

## Tests

Run the backend suite with Docker/PostgreSQL:

```bash
docker compose exec backend pytest
```

Run frontend tests and a production build with:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Sign in with the development accounts above. Clients can manage their own requests; operators can manage request workflow and episode allocation; admins also manage users. Frontend Basic Auth credentials are held in tab-scoped session storage and cleared on logout or an unauthorized response.

Backend tests cover authorization, client isolation, transitions/history, importer idempotency and invalid rows, canonical IDs, assignment/delivery rules, admin protections, analytics, logging, pagination, and health checks. Frontend tests cover login handling, role navigation, request creation/review, allocation and delivery, rejection reasons, filters, pagination, admin actions, analytics defaults/charts, and API errors. These are automated tests, not a large-scale performance benchmark.

## Known limitations and next steps

- No five-million-episode or high-concurrency benchmark has been run. Broad analytics ranges still aggregate many rows; see [Scale considerations](#scale-considerations).
- The importer processes rows individually. Batch insertion and throughput measurement are future optimizations.
- Browser authentication uses tab-scoped Basic Auth credentials; production should use HTTPS and an appropriately scoped HttpOnly session or short-lived token design.
- **Optional stretch not implemented:** real-time updates, background export simulation, or public deployment were not selected. Core workflow and operational requirements were prioritized; one of these is a possible next extension.
- No CI workflow or analytics pre-aggregation is included.
