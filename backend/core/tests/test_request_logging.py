import io
import json
import logging
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from accounts.models import User


@pytest.mark.django_db
def test_anonymous_request_emits_one_json_log_record():
    output = io.StringIO()
    handler = logging.getLogger("structured_request").handlers[0]
    with patch.object(handler, "stream", output):
        response = APIClient().get("/health")

    log_lines = output.getvalue().strip().splitlines()
    assert response.status_code == 200
    assert len(log_lines) == 1
    data = json.loads(log_lines[0])
    assert data["method"] == "GET"
    assert data["path"] == "/health"
    assert data["status"] == 200
    assert data["duration_ms"] >= 0
    assert data["user_id"] is None


@pytest.mark.django_db
def test_authenticated_request_log_contains_user_id():
    user = User.objects.create_user(
        "operator@example.com",
        "secure-password-123",
        name="Operator",
        role=User.Role.OPERATOR,
    )
    client = APIClient()
    client.force_authenticate(user)
    output = io.StringIO()
    handler = logging.getLogger("structured_request").handlers[0]
    with patch.object(handler, "stream", output):
        response = client.get("/api/requests/")

    log_lines = output.getvalue().strip().splitlines()
    assert response.status_code == 200
    assert len(log_lines) == 1
    data = json.loads(log_lines[0])
    assert data["method"] == "GET"
    assert data["path"] == "/api/requests/"
    assert data["status"] == 200
    assert data["user_id"] == user.pk