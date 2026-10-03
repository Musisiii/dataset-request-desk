# Dataset Request Desk

Dataset Request Desk is an internal platform for managing robotics data requests, episode metadata, assignment, and client acceptance. The backend uses Python, Django, and Django REST Framework; the frontend uses React and Vite; Docker Compose runs PostgreSQL. SQLite is available for local backend development.

## Architecture

- `accounts`: email-based users and admin user management.
- `dataset_requests`: requests, role-scoped API access, workflow transitions, and status history.
- `episodes`: episode metadata, CSV import, and one-to-one request assignments.
- `core`: health and analytics endpoints, plus structured request logging.

## Run with Docker

Copy `.env.example` to `.env`, replacing development-only values, then start the database and API:

```bash
docker compose up --build -d
```

The backend waits for PostgreSQL, applies migrations, and creates missing seed users. The frontend is available at `http://localhost:5173`, the API at `http://localhost:8000`, and `GET /health` checks database connectivity. Vite proxies browser `/api` and `/health` requests to the backend container, so development requires no CORS configuration.

Run Django commands from the backend container:

```bash
docker compose exec backend python manage.py showmigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_users
docker compose exec backend python manage.py import_episodes ../seed/episodes.csv
docker compose exec backend pytest
```

The image working directory is `/app/backend`, so these commands work without an extra `cd` or `-w` argument. `docker compose down` stops the services and retains the PostgreSQL volume.

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

## Request Workflow

Valid transitions are `submitted → in_progress → delivered → accepted`, `delivered → rejected`, and `rejected → in_progress`. Clients own acceptance/rejection; operators and admins own operational transitions. Each successful transition updates the request and writes a `StatusHistory` record in one transaction. Delivery is rejected until at least `episodes_requested` episodes are assigned.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/requests/` | List visible requests. |
| `POST` | `/api/requests/` | Create a request as the authenticated client. |
| `GET` | `/api/requests/{id}/` | Retrieve a permitted request. |
| `POST` | `/api/requests/{id}/transition/` | Transition with `{"status":"in_progress"}` or another permitted status. |
| `POST` | `/api/requests/{id}/assignments/` | Assign an eligible episode by business ID. |

Responses include `assigned_episodes_count`, calculated with a database annotation. Request lists use DRF page-number pagination with 50 results per page and a `count`, `next`, `previous`, `results` envelope. Use `?page=2` for later pages.

## Episodes and Assignments

Import the supplied recording-system CSV from the repository root in Docker, or from `backend/` locally:

```bash
docker compose exec backend python manage.py import_episodes ../seed/episodes.csv
```

The importer trims and uppercases episode IDs, normalizes quality casing, supports the supplied date formats, and reports imported/skipped rows and reasons. Repeated or case/whitespace-variant IDs resolve to one canonical ID. A database constraint requires stored IDs to be canonical. The migration retains the lowest-PK duplicate and transfers an assignment if exactly one duplicate is assigned; it aborts rather than discard conflicting assignments.

Operators and admins can list unassigned `good` or `usable` episodes. Optional `task_name` and `quality` filters work, for example `GET /api/episodes/?task_name=pick%20cup&quality=good`. Episode lists use the same page-number pagination and response envelope.

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

## Analytics

`GET /api/analytics/?start_date=2026-08-01&end_date=2026-08-31` is available to authenticated operators and admins. Both dates are inclusive and must use `YYYY-MM-DD`.

The response contains episodes grouped by recorded date and robot, request counts by current status for requests created in the range, the median delivery duration for delivered transitions in the range, and the top five task names by good episodes recorded in the range. Request creation in the `submitted` state is the submission timestamp; delivery time comes from the `StatusHistory` transition to `delivered`. PostgreSQL calculates the median with `PERCENTILE_CONT`; grouping and top-task counts are database aggregates. The implementation does not load entire episode/request tables into Python, though large date ranges still require database work and should be monitored at production scale.

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

Backend tests cover authorization, transitions/history, importer idempotency and canonical IDs, assignments, admin user management, analytics, logging, pagination, and health checks. Frontend tests cover login handling, role navigation, request creation/review, assignment, and API errors.
