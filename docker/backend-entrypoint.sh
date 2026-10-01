#!/bin/sh
set -eu

cd /app/backend
python manage.py migrate --noinput
python manage.py seed_users
exec "$@"
