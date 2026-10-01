from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.models import User

from .models import Request, StatusHistory


VALID_TRANSITIONS = {
    Request.Status.SUBMITTED: {Request.Status.IN_PROGRESS},
    Request.Status.IN_PROGRESS: {Request.Status.DELIVERED},
    Request.Status.DELIVERED: {Request.Status.ACCEPTED, Request.Status.REJECTED},
    Request.Status.REJECTED: {Request.Status.IN_PROGRESS},
    Request.Status.ACCEPTED: set(),
}

CLIENT_TRANSITION_TARGETS = {Request.Status.ACCEPTED, Request.Status.REJECTED}
OPERATOR_TRANSITION_TARGETS = {Request.Status.IN_PROGRESS, Request.Status.DELIVERED}


def transition_request(dataset_request, new_status, acting_user):
    """Apply one authorized transition and write its audit record atomically."""
    try:
        new_status = Request.Status(new_status)
    except ValueError as exc:
        raise ValidationError({"status": "Unknown status."}) from exc

    with transaction.atomic():
        locked_request = Request.objects.select_for_update().get(pk=dataset_request.pk)
        current_status = locked_request.status

        if new_status not in VALID_TRANSITIONS[current_status]:
            raise ValidationError({"status": f"Cannot transition from {current_status} to {new_status}."})

        if acting_user.role == User.Role.CLIENT:
            if locked_request.client_id != acting_user.id:
                raise PermissionDenied("You cannot transition another client's request.")
            allowed_targets = CLIENT_TRANSITION_TARGETS
        elif acting_user.role in {User.Role.OPERATOR, User.Role.ADMIN}:
            allowed_targets = OPERATOR_TRANSITION_TARGETS
        else:
            raise PermissionDenied("Your role cannot transition requests.")

        if new_status not in allowed_targets:
            raise PermissionDenied("Your role cannot perform this transition.")

        locked_request.status = new_status
        locked_request.save(update_fields=["status", "updated_at"])
        StatusHistory.objects.create(
            request=locked_request,
            previous_status=current_status,
            new_status=new_status,
            changed_by=acting_user,
        )
    return locked_request
