from django.db.models import Q
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError

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
        if task_name:
            queryset = queryset.filter(task_name__icontains=task_name.strip())
        if quality:
            normalized_quality = quality.strip().lower()
            if normalized_quality not in {Episode.Quality.GOOD, Episode.Quality.USABLE}:
                raise ValidationError({"quality": "Use good or usable."})
            queryset = queryset.filter(quality=normalized_quality)
        if search:
            search_term = search.strip()
            queryset = queryset.filter(
                Q(episode_id__icontains=search_term)
                | Q(task_name__icontains=search_term)
                | Q(robot_id__icontains=search_term)
                | Q(operator_name__icontains=search_term)
                | Q(quality__icontains=search_term)
            )
        return queryset.order_by("recorded_at", "episode_id")
