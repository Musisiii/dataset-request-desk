from django.db import IntegrityError, transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.models import User
from dataset_requests.models import Request

from .models import Assignment, Episode


def assign_episode(dataset_request, episode_id, acting_user):
    """Allocate one eligible episode to an in-progress request atomically."""
    if acting_user.role not in {User.Role.OPERATOR, User.Role.ADMIN}:
        raise PermissionDenied("Only operators and admins can assign episodes.")

    with transaction.atomic():
        locked_request = Request.objects.select_for_update().get(pk=dataset_request.pk)
        if locked_request.status != Request.Status.IN_PROGRESS:
            raise ValidationError({"request": "Episodes can only be assigned while a request is in progress."})

        try:
            episode = Episode.objects.select_for_update().get(pk=episode_id)
        except Episode.DoesNotExist as exc:
            raise ValidationError({"episode_id": "Episode not found."}) from exc
        if episode.quality == Episode.Quality.BAD:
            raise ValidationError({"episode_id": "Bad-quality episodes cannot be assigned."})
        if Assignment.objects.filter(episode=episode).exists():
            raise ValidationError({"episode_id": "Episode is already assigned."})

        try:
            with transaction.atomic():
                return Assignment.objects.create(request=locked_request, episode=episode, assigned_by=acting_user)
        except IntegrityError:
            raise ValidationError({"episode_id": "Episode is already assigned."})
