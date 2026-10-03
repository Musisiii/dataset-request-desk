from django.db.models import CharField, Q
from django.db.models.functions import Cast
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.utils.dateparse import parse_date

from accounts.models import User

from .models import Episode
from .serializers import EpisodeSerializer


class EpisodeViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = EpisodeSerializer

    def get_queryset(self):
        if self.request.user.role not in {User.Role.OPERATOR, User.Role.ADMIN}:
            raise PermissionDenied("Only operators and admins can view available episodes.")

        queryset = Episode.objects.filter(
            assignment__isnull=True,
            quality__in=[Episode.Quality.GOOD, Episode.Quality.USABLE],
        )
        task_name = self.request.query_params.get("task_name")
        quality = self.request.query_params.get("quality")
        search = self.request.query_params.get("search")
        duration = self.request.query_params.get("duration")
        recorded_date = self.request.query_params.get("recorded_date")
        if task_name and task_name.strip():
            queryset = queryset.filter(task_name__icontains=task_name.strip())
        if quality:
            normalized_quality = quality.strip().lower()
            if normalized_quality not in {Episode.Quality.GOOD, Episode.Quality.USABLE}:
                raise ValidationError({"quality": "Use good or usable."})
            queryset = queryset.filter(quality=normalized_quality)
        if search and search.strip():
            queryset = queryset.annotate(
                search_duration=Cast("duration_seconds", output_field=CharField()),
                search_recorded_at=Cast("recorded_at", output_field=CharField()),
            )
        if search:
            search_term = search.strip()
            if search_term:
                queryset = queryset.filter(
                    Q(episode_id__icontains=search_term)
                    | Q(task_name__icontains=search_term)
                    | Q(robot_id__icontains=search_term)
                    | Q(operator_name__icontains=search_term)
                    | Q(quality__icontains=search_term)
                    | Q(search_duration__icontains=search_term)
                    | Q(search_recorded_at__icontains=search_term)
                )
        if duration:
            try:
                duration_seconds = int(duration.strip())
            except ValueError as exc:
                raise ValidationError({"duration": "Enter a whole number of seconds."}) from exc
            if duration_seconds < 1:
                raise ValidationError({"duration": "Duration must be greater than zero."})
            queryset = queryset.filter(duration_seconds=duration_seconds)
        if recorded_date:
            parsed_date = parse_date(recorded_date.strip())
            if parsed_date is None:
                raise ValidationError({"recorded_date": "Enter a valid date in YYYY-MM-DD format."})
            queryset = queryset.filter(recorded_at__date=parsed_date)
        return queryset.order_by("recorded_at", "episode_id")
