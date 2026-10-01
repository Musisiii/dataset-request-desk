from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Trim, Upper
from django.utils import timezone

from dataset_requests.models import Request

from .constants import KNOWN_ROBOT_IDS, MAX_EPISODE_DURATION_SECONDS


class Episode(models.Model):
    class Quality(models.TextChoices):
        GOOD = "good", "Good"
        USABLE = "usable", "Usable"
        BAD = "bad", "Bad"

    episode_id = models.CharField(max_length=64, unique=True)
    robot_id = models.CharField(max_length=32, db_index=True)
    task_name = models.CharField(max_length=255, db_index=True)
    recorded_at = models.DateTimeField(db_index=True)
    duration_seconds = models.PositiveIntegerField()
    operator_name = models.CharField(max_length=255)
    quality = models.CharField(max_length=16, choices=Quality.choices, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(robot_id__in=KNOWN_ROBOT_IDS),
                name="episode_known_robot_id",
            ),
            models.CheckConstraint(
                condition=models.Q(episode_id=Upper(Trim("episode_id"))),
                name="episode_id_canonical_format",
            ),
            models.CheckConstraint(
                condition=models.Q(quality__in=["good", "usable", "bad"]),
                name="episode_valid_quality",
            ),
            models.CheckConstraint(
                condition=models.Q(duration_seconds__gt=0) & models.Q(duration_seconds__lte=MAX_EPISODE_DURATION_SECONDS),
                name="episode_sensible_duration",
            ),
        ]

    def clean(self):
        errors = {}
        if not self.episode_id or not str(self.episode_id).strip():
            errors["episode_id"] = "Episode ID is required."
        else:
            self.episode_id = str(self.episode_id).strip().upper()
        if self.robot_id not in KNOWN_ROBOT_IDS:
            errors["robot_id"] = "Unknown robot ID."
        if not self.task_name or not self.task_name.strip():
            errors["task_name"] = "Task name is required."
        if not self.operator_name or not self.operator_name.strip():
            errors["operator_name"] = "Operator name is required."
        if self.recorded_at and self.recorded_at > timezone.now():
            errors["recorded_at"] = "Recorded time cannot be in the future."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.episode_id:
            self.episode_id = str(self.episode_id).strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.episode_id


class Assignment(models.Model):
    request = models.ForeignKey(Request, on_delete=models.CASCADE, related_name="assignments")
    episode = models.OneToOneField(Episode, on_delete=models.PROTECT, related_name="assignment")
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="episode_assignments",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.episode.episode_id} assigned to request #{self.request_id}"
