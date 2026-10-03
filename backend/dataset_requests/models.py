from django.conf import settings
from django.db import models


class Request(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        IN_PROGRESS = "in_progress", "In progress"
        DELIVERED = "delivered", "Delivered"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"

    client = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="dataset_requests",
    )
    task_name = models.CharField(max_length=255)
    episodes_requested = models.PositiveIntegerField()
    deadline = models.DateField()
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(episodes_requested__gt=0),
                name="dataset_request_positive_episode_count",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["submitted", "in_progress", "delivered", "accepted", "rejected"]),
                name="dataset_request_valid_status",
            ),
        ]
        indexes = [models.Index(fields=["client", "status"])]

    def __str__(self):
        return f"Request #{self.pk}: {self.task_name}"


class StatusHistory(models.Model):
    request = models.ForeignKey(Request, on_delete=models.CASCADE, related_name="status_history")
    previous_status = models.CharField(max_length=16, choices=Request.Status.choices, null=True, blank=True)
    new_status = models.CharField(max_length=16, choices=Request.Status.choices)
    reason = models.TextField(blank=True, default="")
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="request_status_changes",
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["changed_at", "pk"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(previous_status__isnull=True)
                | models.Q(previous_status__in=["submitted", "in_progress", "delivered", "accepted", "rejected"]),
                name="status_history_valid_previous_status",
            ),
            models.CheckConstraint(
                condition=models.Q(new_status__in=["submitted", "in_progress", "delivered", "accepted", "rejected"]),
                name="status_history_valid_new_status",
            ),
        ]

    def __str__(self):
        return f"Request #{self.request_id}: {self.previous_status} -> {self.new_status}"
