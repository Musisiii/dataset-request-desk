from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("dataset_requests", "0002_request_dataset_request_valid_status_and_more"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="statushistory",
            name="status_history_valid_previous_status",
        ),
        migrations.AlterField(
            model_name="statushistory",
            name="previous_status",
            field=models.CharField(blank=True, choices=[("submitted", "Submitted"), ("in_progress", "In progress"), ("delivered", "Delivered"), ("accepted", "Accepted"), ("rejected", "Rejected")], max_length=16, null=True),
        ),
        migrations.AddConstraint(
            model_name="statushistory",
            constraint=models.CheckConstraint(
                condition=Q(previous_status__isnull=True) | Q(previous_status__in=["submitted", "in_progress", "delivered", "accepted", "rejected"]),
                name="status_history_valid_previous_status",
            ),
        ),
    ]