import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_checks_database_and_returns_ok():
    response = APIClient().get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
