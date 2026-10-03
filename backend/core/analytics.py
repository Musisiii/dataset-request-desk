from datetime import datetime, time

from django.db import connection
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from dataset_requests.models import Request
from episodes.models import Episode


def calculate_median_delivery_time_seconds(start_datetime, end_datetime):
    """Calculate the median from each submission event to its first delivery event."""
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH fulfilment_cycles AS (
                    SELECT EXTRACT(EPOCH FROM (delivered.changed_at - submitted.changed_at)) AS seconds
                    FROM dataset_requests_statushistory submitted
                    JOIN dataset_requests_statushistory delivered
                      ON delivered.request_id = submitted.request_id
                     AND delivered.new_status = 'delivered'
                     AND (delivered.changed_at, delivered.id) > (submitted.changed_at, submitted.id)
                    WHERE submitted.new_status = 'submitted'
                      AND delivered.changed_at >= %s
                      AND delivered.changed_at <= %s
                      AND NOT EXISTS (
                          SELECT 1
                          FROM dataset_requests_statushistory intermediate
                          WHERE intermediate.request_id = submitted.request_id
                            AND intermediate.new_status IN ('submitted', 'delivered')
                            AND (intermediate.changed_at, intermediate.id) > (submitted.changed_at, submitted.id)
                            AND (intermediate.changed_at, intermediate.id) < (delivered.changed_at, delivered.id)
                      )
                )
                SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seconds)
                FROM fulfilment_cycles
                """,
                [start_datetime, end_datetime],
            )
            row = cursor.fetchone()
            return round(float(row[0]), 2) if (row and row[0] is not None) else None
    else:
        # SQLite fallback for local developer environments without Postgres
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH fulfilment_cycles AS (
                    SELECT
                        (julianday(delivered.changed_at) - julianday(submitted.changed_at)) * 86400.0 AS seconds
                    FROM dataset_requests_statushistory submitted
                    JOIN dataset_requests_statushistory delivered
                      ON delivered.request_id = submitted.request_id
                     AND delivered.new_status = 'delivered'
                     AND (
                         delivered.changed_at > submitted.changed_at
                         OR (delivered.changed_at = submitted.changed_at AND delivered.id > submitted.id)
                     )
                    WHERE submitted.new_status = 'submitted'
                      AND delivered.changed_at >= %s
                      AND delivered.changed_at <= %s
                      AND NOT EXISTS (
                          SELECT 1
                          FROM dataset_requests_statushistory intermediate
                          WHERE intermediate.request_id = submitted.request_id
                            AND intermediate.new_status IN ('submitted', 'delivered')
                            AND (
                                intermediate.changed_at > submitted.changed_at
                                OR (intermediate.changed_at = submitted.changed_at AND intermediate.id > submitted.id)
                            )
                            AND (
                                intermediate.changed_at < delivered.changed_at
                                OR (intermediate.changed_at = delivered.changed_at AND intermediate.id < delivered.id)
                            )
                      )
                ), ranked_times AS (
                    SELECT seconds,
                           ROW_NUMBER() OVER (ORDER BY seconds) AS row_number,
                           COUNT(*) OVER () AS total
                    FROM fulfilment_cycles
                )
                SELECT AVG(seconds)
                FROM ranked_times
                WHERE row_number IN ((total + 1) / 2, (total + 2) / 2)
                """,
                [start_datetime, end_datetime],
            )
            row = cursor.fetchone()
            return round(float(row[0]), 2) if row and row[0] is not None else None


class AnalyticsView(APIView):
    """
    Returns analytics across episodes and requests for an inclusive date range.
    Only available to operators and administrators.
    """

    def get(self, request):
        if not request.user or not request.user.is_authenticated:
            raise PermissionDenied("Authentication credentials were not provided.")
        if request.user.role not in {User.Role.OPERATOR, User.Role.ADMIN}:
            raise PermissionDenied("Only operators and administrators can view analytics.")

        start_date_str = request.query_params.get("start_date")
        end_date_str = request.query_params.get("end_date")

        if not start_date_str or not end_date_str:
            raise ValidationError(
                {"detail": "Both 'start_date' and 'end_date' query parameters are required (YYYY-MM-DD)."}
            )

        try:
            start_date = datetime.strptime(start_date_str.strip(), "%Y-%m-%d").date()
            end_date = datetime.strptime(end_date_str.strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValidationError(
                {"detail": "Invalid date format. Expected YYYY-MM-DD."}
            ) from exc

        if start_date > end_date:
            raise ValidationError(
                {"detail": "'start_date' must be less than or equal to 'end_date'."}
            )

        tz = timezone.get_current_timezone()
        start_datetime = timezone.make_aware(datetime.combine(start_date, time.min), tz)
        end_datetime = timezone.make_aware(datetime.combine(end_date, time.max), tz)

        # 1. Episodes recorded per day, per robot (database-side aggregation)
        episodes_per_day_qs = (
            Episode.objects.filter(
                recorded_at__gte=start_datetime,
                recorded_at__lte=end_datetime,
            )
            .annotate(date=TruncDate("recorded_at"))
            .values("date", "robot_id")
            .annotate(count=Count("id"))
            .order_by("date", "robot_id")
        )
        episodes_recorded = [
            {
                "date": row["date"].isoformat(),
                "robot_id": row["robot_id"],
                "count": row["count"],
            }
            for row in episodes_per_day_qs
        ]

        # 2. Request fulfilment: counts by status and median delivery time
        status_counts = {choice: 0 for choice in Request.Status.values}
        counts_qs = (
            Request.objects.filter(
                created_at__gte=start_datetime,
                created_at__lte=end_datetime,
            )
            .values("status")
            .annotate(total=Count("id"))
        )
        for row in counts_qs:
            status_counts[row["status"]] = row["total"]

        median_seconds = calculate_median_delivery_time_seconds(start_datetime, end_datetime)

        # 3. Top 5 task names by number of good episodes
        top_tasks_qs = (
            Episode.objects.filter(
                quality=Episode.Quality.GOOD,
                recorded_at__gte=start_datetime,
                recorded_at__lte=end_datetime,
            )
            .values("task_name")
            .annotate(good_episodes_count=Count("id"))
            .order_by("-good_episodes_count", "task_name")[:5]
        )
        top_tasks = [
            {
                "task_name": row["task_name"],
                "good_episodes_count": row["good_episodes_count"],
            }
            for row in top_tasks_qs
        ]

        quality_counts = {
            choice: Episode.objects.filter(recorded_at__gte=start_datetime, recorded_at__lte=end_datetime, quality=choice).count()
            for choice in Episode.Quality.values
        }

        return Response(
            {
                "date_range": {
                    "start_date": start_date_str,
                    "end_date": end_date_str,
                    "inclusive": True,
                },
                "episodes_recorded": episodes_recorded,
                "quality_counts": quality_counts,
                "request_fulfilment": {
                    "counts_by_status": status_counts,
                    "median_seconds_to_deliver": median_seconds,
                },
                "top_tasks_by_good_episodes": top_tasks,
            },
            status=status.HTTP_200_OK,
        )
