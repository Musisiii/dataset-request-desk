from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dataset_requests", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="statushistory",
            name="reason",
            field=models.TextField(blank=True, default=""),
        ),
    ]
