from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command

from episodes.models import Episode


HEADER = "episode_id,robot_id,task_name,recorded_at,duration_seconds,operator_name,quality\n"
VALID_ROW = " EP-TEST-001 , arm-01 ,  Pick Cup  ,2026-08-05T13:18:00,53, Diane , GOOD \n"


def run_import(path):
    stdout = StringIO()
    stderr = StringIO()
    call_command("import_episodes", str(path), stdout=stdout, stderr=stderr)
    return stdout.getvalue(), stderr.getvalue()


@pytest.mark.django_db
def test_import_normalizes_valid_rows_and_is_idempotent(tmp_path):
    csv_file = tmp_path / "episodes.csv"
    csv_file.write_text(HEADER + VALID_ROW)

    first_output, _ = run_import(csv_file)
    second_output, _ = run_import(csv_file)

    episode = Episode.objects.get()
    assert episode.episode_id == "EP-TEST-001"
    assert episode.robot_id == "arm-01"
    assert episode.task_name == "Pick Cup"
    assert episode.operator_name == "Diane"
    assert episode.quality == Episode.Quality.GOOD
    assert "Imported: 1" in first_output
    assert "Imported: 0" in second_output
    assert "duplicate episode: 1" in second_output


@pytest.mark.django_db
def test_import_skips_invalid_rows_and_reports_reasons(tmp_path):
    csv_file = tmp_path / "episodes.csv"
    csv_file.write_text(
        HEADER
        + VALID_ROW
        + ",arm-01,pick cup,2026-08-05T13:18:00,53,Diane,good\n"
        + "EP-TEST-002,arm-99,pick cup,2026-08-05T13:18:00,53,Diane,good\n"
        + "EP-TEST-003,arm-01,pick cup,not a date,53,Diane,good\n"
        + "EP-TEST-004,arm-01,pick cup,2026-08-05T13:18:00,45.5,Diane,good\n"
        + "EP-TEST-005,arm-01,pick cup,2026-08-05T13:18:00,53,Diane,excellent\n"
        + "EP-TEST-006,arm-01,pick cup,2026-08-05T13:18:00,53,Diane\n"
    )

    output, errors = run_import(csv_file)

    assert Episode.objects.count() == 1
    assert "Rows processed: 7" in output
    assert "Imported: 1" in output
    assert "Skipped: 6" in output
    for reason in ("missing episode ID", "unknown robot", "invalid recorded_at", "invalid duration", "invalid quality", "missing quality"):
        assert reason in output
    assert "Row 3: skipped (missing episode ID)" in errors


@pytest.mark.django_db
def test_supplied_seed_file_import_is_idempotent():
    seed_file = Path(__file__).resolve().parents[3] / "seed" / "episodes.csv"

    first_output, _ = run_import(seed_file)
    first_count = Episode.objects.count()
    second_output, _ = run_import(seed_file)

    assert first_count > 0
    assert Episode.objects.count() == first_count
    assert "Imported: 0" in second_output
    assert "duplicate episode" in second_output


@pytest.mark.django_db
def test_import_skips_differently_cased_duplicate_episode_ids(tmp_path):
    csv_file = tmp_path / "episodes.csv"
    csv_file.write_text(
        HEADER
        + "EP-00003,humanoid-01,fold towel,2026-08-05T06:57:00,12,Aline,good\n"
        + "ep-00003,arm-02,wipe table,2026-08-22T09:10:00,33,Eric,good\n"
        + " ep-00003 ,arm-03,stack blocks,2026-08-23T09:10:00,34,Jeanne,good\n"
    )

    output, _ = run_import(csv_file)
    assert Episode.objects.count() == 1
    episode = Episode.objects.get()
    assert episode.episode_id == "EP-00003"
    assert episode.robot_id == "humanoid-01"
    assert "Imported: 1" in output
    assert "duplicate episode: 2" in output
