from django.db import migrations, models, transaction
from django.db.models.functions import Trim, Upper


def canonicalize_episode_ids(apps, schema_editor):
    Episode = apps.get_model("episodes", "Episode")
    Assignment = apps.get_model("episodes", "Assignment")
    database = schema_editor.connection.alias
    with transaction.atomic(using=database):
        grouped_ids = {}

        for episode_id, value in Episode.objects.using(database).order_by("pk").values_list("pk", "episode_id"):
            canonical_id = value.strip().upper()
            grouped_ids.setdefault(canonical_id, []).append(episode_id)

        for canonical_id, episode_ids in grouped_ids.items():
            keeper_id = episode_ids[0]
            duplicate_ids = episode_ids[1:]
            assignments = list(
                Assignment.objects.using(database)
                .filter(episode_id__in=episode_ids)
                .values_list("pk", "episode_id")
            )
            if len(assignments) > 1:
                raise RuntimeError(
                    f"Cannot canonicalize {canonical_id}: duplicate episodes have conflicting assignments."
                )
            if assignments and assignments[0][1] != keeper_id:
                Assignment.objects.using(database).filter(pk=assignments[0][0]).update(episode_id=keeper_id)

            Episode.objects.using(database).filter(pk__in=duplicate_ids).delete()
            Episode.objects.using(database).filter(pk=keeper_id).update(episode_id=canonical_id)


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("episodes", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(canonicalize_episode_ids, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="episode",
            constraint=models.CheckConstraint(
                condition=models.Q(episode_id=Upper(Trim("episode_id"))),
                name="episode_id_canonical_format",
            ),
        ),
    ]