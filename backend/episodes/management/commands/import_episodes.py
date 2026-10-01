import csv
from collections import Counter
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError
from django.utils import timezone

from episodes.constants import KNOWN_ROBOT_IDS, MAX_EPISODE_DURATION_SECONDS
from episodes.models import Episode


DATE_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%Y-%m-%dT%H:%M:%SZ",
)
REQUIRED_COLUMNS = {
    "episode_id",
    "robot_id",
    "task_name",
    "recorded_at",
    "duration_seconds",
    "operator_name",
    "quality",
}


class RowError(ValueError):
    pass


def normalized_value(row, field):
    value = row.get(field)
    return value.strip() if isinstance(value, str) else ""


def parse_recorded_at(value):
    for date_format in DATE_FORMATS:
        try:
            recorded_at = datetime.strptime(value, date_format)
        except ValueError:
            continue
        if timezone.is_naive(recorded_at):
            recorded_at = timezone.make_aware(
                recorded_at,
                datetime_timezone.utc if date_format.endswith("Z") else timezone.get_current_timezone(),
            )
        if recorded_at > timezone.now():
            raise RowError("future recorded_at")
        return recorded_at
    raise RowError("invalid recorded_at")


def parse_row(row):
    if row.get(None):
        raise RowError("malformed row")

    episode_id = normalized_value(row, "episode_id").upper()
    robot_id = normalized_value(row, "robot_id")
    task_name = normalized_value(row, "task_name")
    recorded_at_value = normalized_value(row, "recorded_at")
    duration_value = normalized_value(row, "duration_seconds")
    operator_name = normalized_value(row, "operator_name")
    quality = normalized_value(row, "quality").lower()

    if not episode_id:
        raise RowError("missing episode ID")
    if not robot_id:
        raise RowError("missing robot ID")
    if robot_id not in KNOWN_ROBOT_IDS:
        raise RowError("unknown robot")
    if not task_name:
        raise RowError("missing task name")
    if not recorded_at_value:
        raise RowError("missing recorded_at")
    if not duration_value:
        raise RowError("missing duration")
    if not operator_name:
        raise RowError("missing operator name")
    if not quality:
        raise RowError("missing quality")
    if quality not in Episode.Quality.values:
        raise RowError("invalid quality")

    try:
        duration_seconds = int(duration_value)
    except ValueError as exc:
        raise RowError("invalid duration") from exc
    if duration_seconds <= 0 or duration_seconds > MAX_EPISODE_DURATION_SECONDS:
        raise RowError("invalid duration")

    return {
        "episode_id": episode_id,
        "robot_id": robot_id,
        "task_name": task_name,
        "recorded_at": parse_recorded_at(recorded_at_value),
        "duration_seconds": duration_seconds,
        "operator_name": operator_name,
        "quality": quality,
    }


class Command(BaseCommand):
    help = "Import valid episodes from a recording-system CSV export."
    error_limit = 20

    def add_arguments(self, parser):
        parser.add_argument("csv_file", type=Path)

    def handle(self, *args, **options):
        csv_file = options["csv_file"]
        if not csv_file.is_file():
            raise CommandError(f"CSV file does not exist: {csv_file}")

        rows_processed = 0
        imported = 0
        duplicates = 0
        reasons = Counter()
        reported_errors = 0

        try:
            with csv_file.open(newline="", encoding="utf-8") as source:
                reader = csv.DictReader(source, strict=True)
                if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
                    raise CommandError("CSV is missing one or more required columns.")

                for row_number, row in enumerate(reader, start=2):
                    rows_processed += 1
                    try:
                        episode_data = parse_row(row)
                        _, created = Episode.objects.get_or_create(
                            episode_id=episode_data["episode_id"], defaults=episode_data
                        )
                    except RowError as exc:
                        reason = str(exc)
                        reasons[reason] += 1
                        if reported_errors < self.error_limit:
                            self.stderr.write(f"Row {row_number}: skipped ({reason})")
                            reported_errors += 1
                    except IntegrityError:
                        # The unique constraint is the final guard for concurrent imports.
                        duplicates += 1
                        reasons["duplicate episode"] += 1
                    else:
                        if created:
                            imported += 1
                        else:
                            duplicates += 1
                            reasons["duplicate episode"] += 1
        except csv.Error as exc:
            raise CommandError(f"CSV parsing failed: {exc}") from exc

        skipped = rows_processed - imported
        self.stdout.write("Import complete")
        self.stdout.write(f"Rows processed: {rows_processed}")
        self.stdout.write(f"Imported: {imported}")
        self.stdout.write(f"Skipped: {skipped}")
        self.stdout.write("Reasons:")
        for reason, count in sorted(reasons.items()):
            self.stdout.write(f"  {reason}: {count}")
        if reported_errors == self.error_limit:
            self.stderr.write(f"Further row errors suppressed after {self.error_limit} messages.")
