from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
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
