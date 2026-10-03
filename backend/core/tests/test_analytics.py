from datetime import datetime

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from dataset_requests.models import Request, StatusHistory
from episodes.models import Episode


START_DATE = "2026-08-10"
END_DATE = "2026-08-14"


def make_user(email, role):
    return User.objects.create_user(email, "secure-password-123", name=email, role=role)


def make_episode(episode_id, task_name, recorded_at, robot_id="arm-01", quality=Episode.Quality.GOOD):
    return Episode.objects.create(
        episode_id=episode_id,
        robot_id=robot_id,
        task_name=task_name,
        recorded_at=recorded_at,
        duration_seconds=30,
        operator_name="Aline",
        quality=quality,
    )


def local_datetime(day, hour=12):
    return timezone.make_aware(datetime(2026, 8, day, hour))


def history_event(dataset_request, actor, previous_status, new_status, changed_at):
    event = StatusHistory.objects.create(
        request=dataset_request,
        previous_status=previous_status,
        new_status=new_status,
        changed_by=actor,
    )
    StatusHistory.objects.filter(pk=event.pk).update(changed_at=changed_at)
    return event


def analytics_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.django_db
def test_analytics_aggregates_episodes_statuses_median_and_top_five():
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    client_user = make_user("client@example.com", User.Role.CLIENT)

    make_episode("EP-AN-001", "pick cup", local_datetime(10), "arm-01")
    make_episode("EP-AN-002", "pick cup", local_datetime(10), "arm-01")
    make_episode("EP-AN-003", "pick cup", local_datetime(11), "arm-02")
    task_counts = [
        ("pick cup", 2),
        ("wipe table", 4),
        ("fold towel", 3),
        ("pour water", 2),
        ("open drawer", 1),
        ("stack blocks", 1),
    ]
    episode_number = 4
    for task_name, count in task_counts:
        for _ in range(count):
            make_episode(f"EP-AN-{episode_number:03d}", task_name, local_datetime(12))
            episode_number += 1
    make_episode("EP-AN-BAD", "bad-only task", local_datetime(12), quality=Episode.Quality.BAD)
    make_episode("EP-AN-BOUNDARY", "outside task", local_datetime(15))

    statuses = [
        Request.Status.SUBMITTED,
        Request.Status.IN_PROGRESS,
        Request.Status.DELIVERED,
        Request.Status.DELIVERED,
        Request.Status.ACCEPTED,
        Request.Status.REJECTED,
    ]
    delivered_requests = []
    for index, request_status in enumerate(statuses):
        dataset_request = Request.objects.create(
            client=client_user,
            task_name=f"request {index}",
            episodes_requested=1,
            deadline="2026-12-01",
            status=request_status,
        )
        Request.objects.filter(pk=dataset_request.pk).update(created_at=local_datetime(10))
        if request_status == Request.Status.DELIVERED:
            delivered_requests.append(dataset_request)

    for dataset_request, delivered_day in zip(delivered_requests, (12, 14)):
        history_event(
            dataset_request,
            operator,
            None,
            Request.Status.SUBMITTED,
            local_datetime(10),
        )
        history_event(
            dataset_request,
            operator,
            Request.Status.SUBMITTED,
            Request.Status.IN_PROGRESS,
            local_datetime(10),
        )
        history_event(
            dataset_request,
            operator,
            Request.Status.IN_PROGRESS,
            Request.Status.DELIVERED,
            local_datetime(delivered_day),
        )

    response = analytics_client(operator).get(
        f"/api/analytics/?start_date={START_DATE}&end_date={END_DATE}"
    )

    assert response.status_code == 200
    assert response.data["date_range"]["inclusive"] is True
    assert response.data["episodes_recorded"][:2] == [
        {"date": "2026-08-10", "robot_id": "arm-01", "count": 2},
        {"date": "2026-08-11", "robot_id": "arm-02", "count": 1},
    ]
    assert response.data["request_fulfilment"]["counts_by_status"] == {
        Request.Status.SUBMITTED: 1,
        Request.Status.IN_PROGRESS: 1,
        Request.Status.DELIVERED: 2,
        Request.Status.ACCEPTED: 1,
        Request.Status.REJECTED: 1,
    }
    assert response.data["request_fulfilment"]["median_seconds_to_deliver"] == 259200.0
    assert [row["task_name"] for row in response.data["top_tasks_by_good_episodes"]] == [
        "pick cup",
        "wipe table",
        "fold towel",
        "pour water",
        "open drawer",
    ]
    assert response.data["top_tasks_by_good_episodes"][0]["good_episodes_count"] == 5


@pytest.mark.django_db
def test_median_uses_submitted_history_timestamp_not_request_creation():
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    client_user = make_user("client@example.com", User.Role.CLIENT)
    dataset_request = Request.objects.create(
        client=client_user,
        task_name="pick cup",
        episodes_requested=1,
        deadline="2026-12-01",
        status=Request.Status.DELIVERED,
    )
    Request.objects.filter(pk=dataset_request.pk).update(created_at=local_datetime(1))
    history_event(dataset_request, operator, None, Request.Status.SUBMITTED, local_datetime(10))
    history_event(
        dataset_request,
        operator,
        Request.Status.SUBMITTED,
        Request.Status.IN_PROGRESS,
        local_datetime(10),
    )
    history_event(
        dataset_request,
        operator,
        Request.Status.IN_PROGRESS,
        Request.Status.DELIVERED,
        local_datetime(12),
    )

    response = analytics_client(operator).get(
        f"/api/analytics/?start_date={START_DATE}&end_date={END_DATE}"
    )

    assert response.status_code == 200
    assert response.data["request_fulfilment"]["median_seconds_to_deliver"] == 172800.0


@pytest.mark.django_db
def test_rework_delivery_does_not_reuse_submission_as_a_second_cycle():
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    client_user = make_user("client@example.com", User.Role.CLIENT)
    dataset_request = Request.objects.create(
        client=client_user,
        task_name="fold towel",
        episodes_requested=1,
        deadline="2026-12-01",
        status=Request.Status.DELIVERED,
    )
    history_event(dataset_request, operator, None, Request.Status.SUBMITTED, local_datetime(10))
    history_event(
        dataset_request,
        operator,
        Request.Status.SUBMITTED,
        Request.Status.IN_PROGRESS,
        local_datetime(10),
    )
    history_event(
        dataset_request,
        operator,
        Request.Status.IN_PROGRESS,
        Request.Status.DELIVERED,
        local_datetime(11),
    )
    history_event(
        dataset_request,
        client_user,
        Request.Status.DELIVERED,
        Request.Status.REJECTED,
        local_datetime(12),
    )
    history_event(
        dataset_request,
        operator,
        Request.Status.REJECTED,
        Request.Status.IN_PROGRESS,
        local_datetime(13),
    )
    history_event(
        dataset_request,
        operator,
        Request.Status.IN_PROGRESS,
        Request.Status.DELIVERED,
        local_datetime(14),
    )

    response = analytics_client(operator).get(
        f"/api/analytics/?start_date={START_DATE}&end_date={END_DATE}"
    )

    assert response.status_code == 200
    assert response.data["request_fulfilment"]["median_seconds_to_deliver"] == 86400.0


@pytest.mark.django_db
def test_delivery_median_includes_start_and_end_date_boundaries():
    operator = make_user("operator@example.com", User.Role.OPERATOR)
    client_user = make_user("client@example.com", User.Role.CLIENT)
    boundary_times = [
        (timezone.make_aware(datetime(2026, 8, 9, 23)), timezone.make_aware(datetime(2026, 8, 10, 0))),
        (timezone.make_aware(datetime(2026, 8, 14, 22, 59, 59, 999999)), timezone.make_aware(datetime(2026, 8, 14, 23, 59, 59, 999999))),
    ]
    for index, (submitted_at, delivered_at) in enumerate(boundary_times):
        dataset_request = Request.objects.create(
            client=client_user,
            task_name=f"boundary task {index}",
            episodes_requested=1,
            deadline="2026-12-01",
            status=Request.Status.DELIVERED,
        )
        history_event(dataset_request, operator, None, Request.Status.SUBMITTED, submitted_at)
        history_event(
            dataset_request,
            operator,
            Request.Status.SUBMITTED,
            Request.Status.IN_PROGRESS,
            submitted_at,
        )
        history_event(
            dataset_request,
            operator,
            Request.Status.IN_PROGRESS,
            Request.Status.DELIVERED,
            delivered_at,
        )

    response = analytics_client(operator).get(
        f"/api/analytics/?start_date={START_DATE}&end_date={END_DATE}"
    )

    assert response.status_code == 200
    assert response.data["request_fulfilment"]["median_seconds_to_deliver"] == 3600.0


@pytest.mark.django_db
def test_analytics_empty_range_returns_empty_aggregates_and_null_median():
    operator = make_user("operator@example.com", User.Role.OPERATOR)

    response = analytics_client(operator).get(
        "/api/analytics/?start_date=2026-09-01&end_date=2026-09-02"
    )

    assert response.status_code == 200
    assert response.data["episodes_recorded"] == []
    assert response.data["request_fulfilment"]["counts_by_status"] == {
        status_value: 0 for status_value in Request.Status.values
    }
    assert response.data["request_fulfilment"]["median_seconds_to_deliver"] is None
    assert response.data["top_tasks_by_good_episodes"] == []


@pytest.mark.django_db
def test_analytics_requires_operator_or_admin_and_valid_date_range():
    client_user = make_user("client@example.com", User.Role.CLIENT)
    operator = make_user("operator@example.com", User.Role.OPERATOR)

    assert APIClient().get(
        "/api/analytics/?start_date=2026-08-10&end_date=2026-08-14"
    ).status_code == 401
    assert analytics_client(client_user).get(
        "/api/analytics/?start_date=2026-08-10&end_date=2026-08-14"
    ).status_code == 403
    assert analytics_client(operator).get(
        "/api/analytics/?start_date=2026-08-15&end_date=2026-08-14"
    ).status_code == 400
    assert analytics_client(operator).get(
        "/api/analytics/?start_date=not-a-date&end_date=2026-08-14"
    ).status_code == 400