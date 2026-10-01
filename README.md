# Dataset Request Desk

Internal platform for managing robotics dataset requests. This repository currently contains the Django foundation and Phase 2 request workflow API.

## Run with Docker

Copy `.env.example` to `.env` and replace the development-only values. Then start the stack:

```bash
docker compose up --build
```

The backend waits for PostgreSQL to pass its health check, then runs Django migrations and `seed_users`. Both are safe on repeated container starts. The API is available at `http://localhost:8000`, and `GET /health` checks both Django and database connectivity.

## Local development

Create a virtual environment, install dependencies, then run commands from `backend/`:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cd backend
python manage.py migrate
python manage.py seed_users
python manage.py runserver
```

Without PostgreSQL environment variables, Django uses SQLite only for convenient local test development. Docker uses PostgreSQL through the `.env` configuration.

## Tests

```bash
pytest
```

## Phase 2 API

All `/api/` endpoints require authentication. Basic authentication is available for local development using the seed accounts below.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/requests/` | List requests visible to the authenticated user. |
| `POST` | `/api/requests/` | Create a request as the authenticated client. |
| `GET` | `/api/requests/{id}/` | Retrieve a permitted request. |
| `POST` | `/api/requests/{id}/transition/` | Submit `{"status": "..."}` for an authorized workflow transition. |

Clients see only their own requests and receive `404` for another client's request. Operators and admins can see all requests and perform operational transitions; clients own acceptance and rejection transitions.

## Development seed accounts

| Email | Password | Role |
| --- | --- | --- |
| admin@example.com | admin123 | admin |
| ops1@example.com | ops123 | operator |
| ops2@example.com | ops123 | operator |
| client-a@example.com | client123 | client |
| client-b@example.com | client123 | client |

Passwords are read from the supplied JSON only when creating missing development users. Django stores password hashes, and subsequent seed runs do not reset existing passwords.
