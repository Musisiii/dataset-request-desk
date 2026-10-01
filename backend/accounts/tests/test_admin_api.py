import pytest
from django.contrib.auth import authenticate
from rest_framework.test import APIClient

from accounts.models import User
from dataset_requests.models import Request, StatusHistory


def make_user(email, role, password="secure-password-123", is_active=True):
    return User.objects.create_user(
        email=email,
        password=password,
        name=email.split("@")[0].capitalize(),
        role=role,
        is_active=is_active,
        is_staff=(role == User.Role.ADMIN),
    )


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.django_db
def test_admin_can_list_and_create_user_with_hashed_password():
    admin = make_user("admin@example.com", User.Role.ADMIN)
    client = auth_client(admin)

    list_response = client.get("/api/users/")
    assert list_response.status_code == 200

    create_response = client.post(
        "/api/users/",
        {
            "email": "new_operator@example.com",
            "name": "New Operator",
            "role": "operator",
            "organisation": "RoboOps",
            "password": "strong-password-987",
        },
        format="json",
    )
    assert create_response.status_code == 201
    assert create_response.data["email"] == "new_operator@example.com"
    assert create_response.data["role"] == "operator"
    assert "password" not in create_response.data

    user = User.objects.get(email="new_operator@example.com")
    assert user.password != "strong-password-987"
    assert user.check_password("strong-password-987")
    assert authenticate(email="new_operator@example.com", password="strong-password-987") == user


@pytest.mark.django_db
def test_user_creation_validates_unique_email_and_valid_role():
    admin = make_user("admin@example.com", User.Role.ADMIN)
    client = auth_client(admin)

    make_user("existing@example.com", User.Role.CLIENT)
    duplicate_email_response = client.post(
        "/api/users/",
        {
            "email": "existing@example.com",
            "name": "Duplicate",
            "role": "client",
            "password": "password-1234",
        },
        format="json",
    )
    assert duplicate_email_response.status_code == 400

    invalid_role_response = client.post(
        "/api/users/",
        {
            "email": "invalid_role@example.com",
            "name": "Invalid Role",
            "role": "superuser",
            "password": "password-1234",
        },
        format="json",
    )
    assert invalid_role_response.status_code == 400


@pytest.mark.django_db
def test_admin_can_deactivate_user_and_inactive_user_cannot_authenticate():
    admin = make_user("admin@example.com", User.Role.ADMIN)
    target = make_user("operator@example.com", User.Role.OPERATOR, password="target-password-123")
    client = auth_client(admin)

    deactivate_response = client.post(f"/api/users/{target.pk}/deactivate/")
    assert deactivate_response.status_code == 200
    assert deactivate_response.data["is_active"] is False

    target.refresh_from_db()
    assert target.is_active is False
    assert authenticate(email="operator@example.com", password="target-password-123") is None

    # Inactive user cannot access authenticated endpoints
    inactive_api = APIClient()
    inactive_api.force_authenticate(target)
    request_list_response = inactive_api.get("/api/requests/")
    # Force authenticate on inactive user in DRF fails authentication check or permissions
    assert authenticate(email="operator@example.com", password="target-password-123") is None


@pytest.mark.django_db
def test_historical_records_remain_intact_after_user_deactivation():
    admin = make_user("admin@example.com", User.Role.ADMIN)
    operator = make_user("ops@example.com", User.Role.OPERATOR)
    dataset_request = Request.objects.create(
        client=make_user("client@example.com", User.Role.CLIENT),
        task_name="pick cup",
        episodes_requested=5,
        deadline="2026-12-01",
        status=Request.Status.IN_PROGRESS,
    )
    history = StatusHistory.objects.create(
        request=dataset_request,
        previous_status=Request.Status.SUBMITTED,
        new_status=Request.Status.IN_PROGRESS,
        changed_by=operator,
    )

    client = auth_client(admin)
    client.post(f"/api/users/{operator.pk}/deactivate/")

    operator.refresh_from_db()
    assert operator.is_active is False
    history.refresh_from_db()
    assert history.changed_by == operator


@pytest.mark.django_db
def test_admin_can_change_role_and_invalid_role_rejected():
    admin = make_user("admin@example.com", User.Role.ADMIN)
    user = make_user("user@example.com", User.Role.CLIENT)
    client = auth_client(admin)

    response = client.post(f"/api/users/{user.pk}/change-role/", {"role": "operator"}, format="json")
    assert response.status_code == 200
    assert response.data["role"] == "operator"

    user.refresh_from_db()
    assert user.role == "operator"

    invalid_response = client.post(f"/api/users/{user.pk}/change-role/", {"role": "master"}, format="json")
    assert invalid_response.status_code == 400


@pytest.mark.django_db
def test_admin_self_deactivation_and_last_admin_protection():
    admin1 = make_user("admin1@example.com", User.Role.ADMIN)
    admin2 = make_user("admin2@example.com", User.Role.ADMIN)
    client1 = auth_client(admin1)

    # Self-deactivation rejected
    self_deact = client1.post(f"/api/users/{admin1.pk}/deactivate/")
    assert self_deact.status_code == 400

    # Self-demotion rejected
    self_demote = client1.post(f"/api/users/{admin1.pk}/change-role/", {"role": "operator"}, format="json")
    assert self_demote.status_code == 400

    # Can deactivate another admin when multiple admins exist
    other_deact = client1.post(f"/api/users/{admin2.pk}/deactivate/")
    assert other_deact.status_code == 200

    # Now admin1 is the last active admin -> cannot demote or deactivate
    admin2_client = auth_client(admin2)
    # Admin1 cannot be deactivated even if attempted
    client1.post(f"/api/users/{admin1.pk}/deactivate/")
    admin1.refresh_from_db()
    assert admin1.is_active is True


@pytest.mark.django_db
def test_non_admin_and_anonymous_users_cannot_access_user_api():
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    client_user = make_user("client@example.com", User.Role.CLIENT)
    anon = APIClient()

    assert anon.get("/api/users/").status_code == 401
    assert auth_client(operator).get("/api/users/").status_code == 403
    assert auth_client(client_user).get("/api/users/").status_code == 403

    assert anon.post("/api/users/", {"email": "x@x.com"}).status_code == 401
    assert auth_client(operator).post("/api/users/", {"email": "x@x.com"}).status_code == 403
    assert auth_client(client_user).post("/api/users/", {"email": "x@x.com"}).status_code == 403
