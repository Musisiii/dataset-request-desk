from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from dataset_requests.models import Request, StatusHistory
from dataset_requests.services import transition_request


def make_user(email, role):
    return User.objects.create_user(email, "secure-password-123", name=email, role=role)


def make_request(client, status=Request.Status.SUBMITTED):
    return Request.objects.create(
        client=client,
        task_name="pick cup",
        episodes_requested=1,
        deadline="2026-10-10",
        notes="",
        status=status,
    )


def authenticated_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.django_db
def test_client_creates_submitted_request_for_themselves():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    api_client = authenticated_client(client_user)

    response = api_client.post(
        "/api/requests/",
        {
            "client": 9999,
            "task_name": "pick cup",
            "episodes_requested": 25,
            "deadline": "2026-11-01",
            "notes": "Priority delivery",
        },
        format="json",
    )

    assert response.status_code == 201
    dataset_request = Request.objects.get(pk=response.data["id"])
    assert dataset_request.client == client_user
    assert dataset_request.status == Request.Status.SUBMITTED


@pytest.mark.django_db
def test_unauthenticated_request_creation_is_rejected():
    response = APIClient().post(
        "/api/requests/",
        {"task_name": "pick cup", "episodes_requested": 1, "deadline": "2026-11-01"},
        format="json",
    )

    assert response.status_code == 401


@pytest.mark.django_db
def test_invalid_episode_count_is_rejected():
    api_client = authenticated_client(make_user("client@example.com", User.Role.CLIENT))

    response = api_client.post(
        "/api/requests/",
        {"task_name": "pick cup", "episodes_requested": 0, "deadline": "2026-11-01"},
        format="json",
    )

    assert response.status_code == 400
    assert Request.objects.count() == 0


@pytest.mark.django_db
def test_clients_only_list_and_retrieve_their_own_requests():
    client_a = make_user("client-a@example.com", User.Role.CLIENT)
    client_b = make_user("client-b@example.com", User.Role.CLIENT)
    own_request = make_request(client_a)
    other_request = make_request(client_b)
    api_client = authenticated_client(client_a)

    list_response = api_client.get("/api/requests/")
    detail_response = api_client.get(f"/api/requests/{other_request.pk}/")

    assert [item["id"] for item in list_response.data] == [own_request.pk]
    assert detail_response.status_code == 404


@pytest.mark.django_db
def test_client_cannot_transition_another_clients_request():
    client_a = make_user("client-a@example.com", User.Role.CLIENT)
    client_b = make_user("client-b@example.com", User.Role.CLIENT)
    other_request = make_request(client_b, Request.Status.DELIVERED)

    response = authenticated_client(client_a).post(
        f"/api/requests/{other_request.pk}/transition/", {"status": "accepted"}, format="json"
    )

    assert response.status_code == 404
    other_request.refresh_from_db()
    assert other_request.status == Request.Status.DELIVERED


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("starting_status", "target_status", "role"),
    [
        (Request.Status.SUBMITTED, Request.Status.IN_PROGRESS, User.Role.OPERATOR),
        (Request.Status.IN_PROGRESS, Request.Status.DELIVERED, User.Role.OPERATOR),
        (Request.Status.DELIVERED, Request.Status.ACCEPTED, User.Role.CLIENT),
        (Request.Status.DELIVERED, Request.Status.REJECTED, User.Role.CLIENT),
        (Request.Status.REJECTED, Request.Status.IN_PROGRESS, User.Role.OPERATOR),
    ],
)
def test_each_valid_transition_updates_request_and_records_history(starting_status, target_status, role):
    client_user = make_user("client@example.com", User.Role.CLIENT)
    actor = client_user if role == User.Role.CLIENT else make_user("ops@example.com", role)
    dataset_request = make_request(client_user, starting_status)
    if target_status == Request.Status.DELIVERED:
        from datetime import timedelta

        from django.utils import timezone
        from episodes.models import Assignment, Episode

        episode = Episode.objects.create(
            episode_id="EP-PHASE-2-DELIVERY",
            robot_id="arm-01",
            task_name="pick cup",
            recorded_at=timezone.now() - timedelta(days=1),
            duration_seconds=30,
            operator_name="Aline",
            quality=Episode.Quality.GOOD,
        )
        Assignment.objects.create(request=dataset_request, episode=episode, assigned_by=actor)

    response = authenticated_client(actor).post(
        f"/api/requests/{dataset_request.pk}/transition/", {"status": target_status}, format="json"
    )

    assert response.status_code == 200
    dataset_request.refresh_from_db()
    history = StatusHistory.objects.get(request=dataset_request)
    assert dataset_request.status == target_status
    assert history.previous_status == starting_status
    assert history.new_status == target_status
    assert history.changed_by == actor


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("starting_status", "target_status", "actor_role"),
    [
        (Request.Status.SUBMITTED, Request.Status.DELIVERED, User.Role.OPERATOR),
        (Request.Status.SUBMITTED, Request.Status.ACCEPTED, User.Role.CLIENT),
        (Request.Status.IN_PROGRESS, Request.Status.ACCEPTED, User.Role.CLIENT),
        (Request.Status.DELIVERED, Request.Status.IN_PROGRESS, User.Role.OPERATOR),
        (Request.Status.ACCEPTED, Request.Status.IN_PROGRESS, User.Role.OPERATOR),
    ],
)
def test_invalid_transitions_are_rejected_without_history(starting_status, target_status, actor_role):
    client_user = make_user("client@example.com", User.Role.CLIENT)
    actor = client_user if actor_role == User.Role.CLIENT else make_user("ops@example.com", actor_role)
    dataset_request = make_request(client_user, starting_status)

    response = authenticated_client(actor).post(
        f"/api/requests/{dataset_request.pk}/transition/", {"status": target_status}, format="json"
    )

    assert response.status_code == 400
    dataset_request.refresh_from_db()
    assert dataset_request.status == starting_status
    assert StatusHistory.objects.filter(request=dataset_request).count() == 0


@pytest.mark.django_db
def test_transition_role_ownership_and_admin_operator_capabilities():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    admin = make_user("admin@example.com", User.Role.ADMIN)
    submitted_request = make_request(client_user)
    delivered_request = make_request(client_user, Request.Status.DELIVERED)

    client_response = authenticated_client(client_user).post(
        f"/api/requests/{submitted_request.pk}/transition/", {"status": "in_progress"}, format="json"
    )
    operator_response = authenticated_client(operator).post(
        f"/api/requests/{delivered_request.pk}/transition/", {"status": "accepted"}, format="json"
    )
    admin_response = authenticated_client(admin).post(
        f"/api/requests/{submitted_request.pk}/transition/", {"status": "in_progress"}, format="json"
    )

    assert client_response.status_code == 403
    assert operator_response.status_code == 403
    assert admin_response.status_code == 200


@pytest.mark.django_db
def test_unauthenticated_request_access_is_rejected():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    dataset_request = make_request(client_user)
    api_client = APIClient()

    assert api_client.get("/api/requests/").status_code == 401
    assert api_client.post(
        f"/api/requests/{dataset_request.pk}/transition/", {"status": "in_progress"}, format="json"
    ).status_code == 401


@pytest.mark.django_db
def test_transition_rolls_back_when_history_creation_fails():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    dataset_request = make_request(client_user)

    with patch("dataset_requests.services.StatusHistory.objects.create", side_effect=RuntimeError("database error")):
        with pytest.raises(RuntimeError, match="database error"):
            transition_request(dataset_request, Request.Status.IN_PROGRESS, operator)

    dataset_request.refresh_from_db()
    assert dataset_request.status == Request.Status.SUBMITTED
    assert StatusHistory.objects.filter(request=dataset_request).count() == 0
