from datetime import timedelta

import pytest
from django.db import connection
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from episodes.models import Episode


def episode_data(**overrides):
    data = {
        "episode_id": "EP-TEST-001",
        "robot_id": "arm-01",
        "task_name": "pick cup",
        "recorded_at": timezone.now() - timedelta(days=1),
        "duration_seconds": 30,
        "operator_name": "Aline",
        "quality": Episode.Quality.GOOD,
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_valid_episode_can_be_created():
    episode = Episode.objects.create(**episode_data())

    assert episode.episode_id == "EP-TEST-001"


@pytest.mark.django_db
def test_invalid_quality_is_rejected_by_model_validation():
    episode = Episode(**episode_data(quality="excellent"))

    with pytest.raises(ValidationError):
        episode.full_clean()


@pytest.mark.django_db
def test_episode_id_is_unique_in_database():
    Episode.objects.create(**episode_data())

    with pytest.raises(IntegrityError):
        Episode.objects.create(**episode_data(task_name="wipe table"))


@pytest.mark.django_db
def test_episode_database_constraints_reject_unknown_robot_and_invalid_duration():
    with transaction.atomic():
        with pytest.raises(IntegrityError):
            Episode.objects.create(**episode_data(episode_id="EP-TEST-002", robot_id="arm-99"))
    with transaction.atomic():
        with pytest.raises(IntegrityError):
            Episode.objects.create(**episode_data(episode_id="EP-TEST-003", duration_seconds=0))


@pytest.mark.django_db
def test_episode_id_is_normalized_to_uppercase_on_save():
    episode = Episode.objects.create(**episode_data(episode_id=" ep-lower-001 "))
    assert episode.episode_id == "EP-LOWER-001"


@pytest.mark.django_db
def test_differently_cased_episode_ids_cannot_create_duplicate_episodes():
    Episode.objects.create(**episode_data(episode_id="EP-CASE-001"))
    with pytest.raises(IntegrityError):
        Episode.objects.create(**episode_data(episode_id="ep-case-001"))


@pytest.mark.django_db
def test_database_rejects_noncanonical_episode_id_updates():
    episode = Episode.objects.create(**episode_data())

    with pytest.raises(IntegrityError), transaction.atomic():
        Episode.objects.filter(pk=episode.pk).update(episode_id=" ep-test-001 ")


@pytest.mark.django_db(transaction=True)
def test_canonical_episode_migration_preserves_duplicate_assignment():
    migration_executor = MigrationExecutor(connection)
    migration_executor.migrate([("episodes", "0001_initial")])
    historical_apps = MigrationExecutor(connection).loader.project_state(
        [("episodes", "0001_initial")]
    ).apps
    HistoricalUser = historical_apps.get_model("accounts", "User")
    HistoricalRequest = historical_apps.get_model("dataset_requests", "Request")
    HistoricalEpisode = historical_apps.get_model("episodes", "Episode")
    HistoricalAssignment = historical_apps.get_model("episodes", "Assignment")

    client = HistoricalUser.objects.create(
        email="migration-client@example.com",
        password="!",
        name="Client",
        role="client",
    )
    operator = HistoricalUser.objects.create(
        email="migration-operator@example.com",
        password="!",
        name="Operator",
        role="operator",
    )
    dataset_request = HistoricalRequest.objects.create(
        client=client,
        task_name="pick cup",
        episodes_requested=1,
        deadline="2026-12-01",
    )
    episode_fields = {
        "robot_id": "arm-01",
        "task_name": "pick cup",
        "recorded_at": timezone.now() - timedelta(days=1),
        "duration_seconds": 30,
        "operator_name": "Aline",
        "quality": "good",
    }
    canonical_episode = HistoricalEpisode.objects.create(
        episode_id="EP-MIGRATION-001", **episode_fields
    )
    duplicate_episode = HistoricalEpisode.objects.create(
        episode_id="ep-migration-001", **episode_fields
    )
    HistoricalAssignment.objects.create(
        request=dataset_request,
        episode=duplicate_episode,
        assigned_by=operator,
    )

    try:
        MigrationExecutor(connection).migrate([("episodes", "0002_canonical_episode_id")])
        migrated_apps = MigrationExecutor(connection).loader.project_state(
            [("episodes", "0002_canonical_episode_id")]
        ).apps
        MigratedEpisode = migrated_apps.get_model("episodes", "Episode")
        MigratedAssignment = migrated_apps.get_model("episodes", "Assignment")

        assert list(MigratedEpisode.objects.values_list("episode_id", flat=True)) == ["EP-MIGRATION-001"]
        assignment = MigratedAssignment.objects.get()
        assert assignment.episode_id == canonical_episode.pk
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
