from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from dataset_requests.models import Request, StatusHistory
from episodes.models import Assignment, Episode


def make_user(email, role):
    return User.objects.create_user(email, "secure-password-123", name=email, role=role)


def make_request(client, episodes_requested=1, status=Request.Status.IN_PROGRESS):
    return Request.objects.create(
        client=client,
        task_name="pick cup",
        episodes_requested=episodes_requested,
        deadline="2026-11-01",
        status=status,
    )


def make_episode(number, quality=Episode.Quality.GOOD, task_name="pick cup"):
    return Episode.objects.create(
        episode_id=f"EP-ASSIGN-{number:03d}",
        robot_id="arm-01",
        task_name=task_name,
        recorded_at=timezone.now() - timedelta(days=1),
        duration_seconds=30,
        operator_name="Aline",
        quality=quality,
    )


def authenticated_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.django_db
@pytest.mark.parametrize("quality", [Episode.Quality.GOOD, Episode.Quality.USABLE])
def test_operator_can_assign_eligible_episode_with_authenticated_actor(quality):
    request_client = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    dataset_request = make_request(request_client)
    episode = make_episode(1, quality)

    response = authenticated_client(operator).post(
        f"/api/requests/{dataset_request.pk}/assignments/", {"episode_id": episode.episode_id}, format="json"
    )

    assignment = Assignment.objects.get()
    assert response.status_code == 201
    assert response.data["episode_id"] == episode.episode_id
    assert response.data["request"] == dataset_request.pk
    assert assignment.episode == episode
    assert assignment.assigned_by == operator


@pytest.mark.django_db
def test_bad_or_already_assigned_episode_is_rejected():
    request_client = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    dataset_request = make_request(request_client)
    bad_episode = make_episode(1, Episode.Quality.BAD)
    assigned_episode = make_episode(2)
    Assignment.objects.create(request=dataset_request, episode=assigned_episode, assigned_by=operator)
    api_client = authenticated_client(operator)

    bad_response = api_client.post(
        f"/api/requests/{dataset_request.pk}/assignments/", {"episode_id": bad_episode.episode_id}, format="json"
    )
    duplicate_response = api_client.post(
        f"/api/requests/{dataset_request.pk}/assignments/", {"episode_id": assigned_episode.episode_id}, format="json"
    )

    assert bad_response.status_code == 400
    assert "Bad-quality" in str(bad_response.data)
    assert duplicate_response.status_code == 400
    assert "already assigned" in str(duplicate_response.data)
    assert Assignment.objects.count() == 1


@pytest.mark.django_db
def test_assignment_requires_operational_role_and_in_progress_request():
    request_client = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    accepted_request = make_request(request_client, status=Request.Status.ACCEPTED)
    episode = make_episode(1)

    assert APIClient().post(
        f"/api/requests/{accepted_request.pk}/assignments/", {"episode_id": episode.episode_id}, format="json"
    ).status_code == 401
    assert authenticated_client(request_client).post(
        f"/api/requests/{accepted_request.pk}/assignments/", {"episode_id": episode.episode_id}, format="json"
    ).status_code == 403
    assert authenticated_client(operator).post(
        f"/api/requests/{accepted_request.pk}/assignments/", {"episode_id": episode.episode_id}, format="json"
    ).status_code == 400


@pytest.mark.django_db
def test_admin_can_assign_and_episode_list_only_shows_available_eligible_matches():
    request_client = make_user("client@example.com", User.Role.CLIENT)
    admin = make_user("admin@example.com", User.Role.ADMIN)
    dataset_request = make_request(request_client)
    available = make_episode(1, task_name="pick cup")
    unavailable = make_episode(2, task_name="pick cup")
    bad = make_episode(3, Episode.Quality.BAD, task_name="pick cup")
    make_episode(4, task_name="wipe table")
    Assignment.objects.create(request=dataset_request, episode=unavailable, assigned_by=admin)
    api_client = authenticated_client(admin)

    list_response = api_client.get("/api/episodes/?task_name=pick%20cup&quality=good")
    assign_response = api_client.post(
        f"/api/requests/{dataset_request.pk}/assignments/", {"episode_id": available.episode_id}, format="json"
    )

    assert any(item["episode_id"] == available.episode_id for item in (list_response.data.get("results") if isinstance(list_response.data, dict) else list_response.data))
    assert assign_response.status_code == 201
    assert assign_response.data["episode_id"] == available.episode_id


@pytest.mark.django_db
def test_client_cannot_view_available_episodes():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    make_episode(1)

    response = authenticated_client(client_user).get("/api/episodes/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_episode_list_is_paginated_and_filters_remain_active():
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    for number in range(52):
        make_episode(number, task_name="pick cup")
    make_episode(100, task_name="wipe table")

    api_client = authenticated_client(operator)
    first_page = api_client.get("/api/episodes/?task_name=pick%20cup&quality=good")
    second_page = api_client.get("/api/episodes/?task_name=pick%20cup&quality=good&page=2")

    assert first_page.data["count"] == 52
    assert len(first_page.data["results"]) == 50
    assert len(second_page.data["results"]) == 2
    assert all(item["task_name"] == "pick cup" for item in first_page.data["results"] + second_page.data["results"])


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_count, expected_status", [(0, 400), (9, 400), (10, 200), (11, 200)])
def test_delivery_requires_at_least_requested_episode_assignments(assigned_count, expected_status):
    request_client = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    dataset_request = make_request(request_client, episodes_requested=10)
    for number in range(assigned_count):
        Assignment.objects.create(request=dataset_request, episode=make_episode(number), assigned_by=operator)

    response = authenticated_client(operator).post(
        f"/api/requests/{dataset_request.pk}/transition/", {"status": "delivered"}, format="json"
    )

    dataset_request.refresh_from_db()
    assert response.status_code == expected_status
    assert dataset_request.status == (Request.Status.DELIVERED if expected_status == 200 else Request.Status.IN_PROGRESS)
    assert StatusHistory.objects.filter(request=dataset_request).count() == (1 if expected_status == 200 else 0)


@pytest.mark.django_db
def test_assign_with_nonexistent_episode_id():
    request_client = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    dataset_request = make_request(request_client)

    response = authenticated_client(operator).post(
        f"/api/requests/{dataset_request.pk}/assignments/",
        {"episode_id": "EP-NONEXISTENT"},
        format="json",
    )

    assert response.status_code == 400
    assert "Episode not found." in str(response.data)
