from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
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
    initial_history = StatusHistory.objects.get(request=dataset_request)
    assert initial_history.previous_status is None
    assert initial_history.new_status == Request.Status.SUBMITTED
    assert initial_history.changed_by == client_user


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

    assert [item["id"] for item in list_response.data["results"]] == [own_request.pk]
    assert detail_response.status_code == 404


@pytest.mark.django_db
def test_request_list_filters_submission_dates_inclusive_in_configured_timezone():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("ops@example.com", User.Role.OPERATOR)
    requests = [make_request(client_user) for _ in range(4)]

    local_tz = timezone.get_default_timezone()
    start = timezone.make_aware(datetime(2026, 10, 3), local_tz)
    next_day = timezone.make_aware(datetime(2026, 10, 5), local_tz)
    timestamps = [
        start - timedelta(microseconds=1),
        start,
        next_day - timedelta(microseconds=1),
        next_day,
    ]
    for dataset_request, created_at in zip(requests, timestamps):
        Request.objects.filter(pk=dataset_request.pk).update(created_at=created_at)
    Request.objects.filter(pk=requests[1].pk).update(deadline="2026-10-09")

    api_client = authenticated_client(operator)
    response = api_client.get("/api/requests/?submitted_from=2026-10-03&submitted_to=2026-10-04")
    deadline_filtered_response = api_client.get(
        "/api/requests/?submitted_from=2026-10-03&submitted_to=2026-10-04&deadline_after=2026-10-10"
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.data["results"]] == [requests[1].pk, requests[2].pk]
    assert [item["id"] for item in deadline_filtered_response.data["results"]] == [requests[2].pk]


@pytest.mark.django_db
@pytest.mark.parametrize("parameter", ["submitted_from", "submitted_to"])
def test_invalid_submission_date_filter_is_rejected(parameter):
    operator = make_user("ops@example.com", User.Role.OPERATOR)

    response = authenticated_client(operator).get(f"/api/requests/?{parameter}=not-a-date")

    assert response.status_code == 400
    assert parameter in response.data


@pytest.mark.django_db
def test_request_responses_include_annotated_assigned_episode_counts():
    from datetime import timedelta

    from django.utils import timezone
    from episodes.models import Assignment, Episode

    client_user = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("ops@example.com", User.Role.OPERATOR)
    assigned_request = make_request(client_user)
    empty_request = make_request(client_user)
    episode = Episode.objects.create(
        episode_id="EP-COUNT-001",
        robot_id="arm-01",
        task_name="pick cup",
        recorded_at=timezone.now() - timedelta(days=1),
        duration_seconds=30,
        operator_name="Aline",
        quality=Episode.Quality.GOOD,
    )
    Assignment.objects.create(request=assigned_request, episode=episode, assigned_by=operator)

    response = authenticated_client(client_user).get("/api/requests/")
    counts_by_id = {item["id"]: item["assigned_episodes_count"] for item in response.data["results"]}

    assert counts_by_id == {assigned_request.pk: 1, empty_request.pk: 0}


@pytest.mark.django_db
def test_request_list_is_paginated_without_leaking_other_clients_requests():
    client_a = make_user("client-a@example.com", User.Role.CLIENT)
    client_b = make_user("client-b@example.com", User.Role.CLIENT)
    requests_a = [make_request(client_a) for _ in range(51)]
    make_request(client_b)

    api_client = authenticated_client(client_a)
    first_page = api_client.get("/api/requests/")
    second_page = api_client.get("/api/requests/?page=2")
    third_page = api_client.get("/api/requests/?page=3")
    fourth_page = api_client.get("/api/requests/?page=4")

    assert first_page.data["count"] == 51
    assert len(first_page.data["results"]) == 15
    assert len(second_page.data["results"]) == 15
    assert len(third_page.data["results"]) == 15
    assert len(fourth_page.data["results"]) == 6
    all_pages = first_page.data["results"] + second_page.data["results"] + third_page.data["results"] + fourth_page.data["results"]
    assert {item["id"] for item in all_pages} == {
        item.pk for item in requests_a
    }


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
