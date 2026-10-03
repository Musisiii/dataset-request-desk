from datetime import datetime

from django.db import transaction
from django.db.models import Count, F
from django.db.models.functions import Coalesce
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import User
from episodes.serializers import AssignmentCreateSerializer, AssignmentSerializer
from episodes.services import assign_episode

from .models import Request, StatusHistory
from .serializers import RequestSerializer, TransitionSerializer
from .services import transition_request


class RequestViewSet(viewsets.ModelViewSet):
    serializer_class = RequestSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = Request.objects.select_related("client").annotate(
            assigned_episodes_count=Count("assignments")
        )
        task_name = self.request.query_params.get("task_name")
        status = self.request.query_params.get("status")
        deadline_after = self.request.query_params.get("deadline_after") or self.request.query_params.get("start_date")
        deadline_before = self.request.query_params.get("deadline_before") or self.request.query_params.get("end_date")
        allocation_state = self.request.query_params.get("allocation_state")

        if task_name:
            queryset = queryset.filter(task_name__icontains=task_name.strip())
        if status and status != "all":
            queryset = queryset.filter(status=status)
        if deadline_after:
            try:
                queryset = queryset.filter(deadline__gte=datetime.strptime(deadline_after, "%Y-%m-%d").date())
            except ValueError as exc:
                raise ValidationError({"deadline_after": "Use YYYY-MM-DD."}) from exc
        if deadline_before:
            try:
                queryset = queryset.filter(deadline__lte=datetime.strptime(deadline_before, "%Y-%m-%d").date())
            except ValueError as exc:
                raise ValidationError({"deadline_before": "Use YYYY-MM-DD."}) from exc
        if allocation_state == "needs_allocation":
            queryset = queryset.filter(assigned_episodes_count__lt=F("episodes_requested"))
        elif allocation_state == "ready_for_delivery":
            queryset = queryset.filter(assigned_episodes_count__gte=F("episodes_requested"))

        queryset = queryset.order_by("deadline", "created_at", "pk")
        if self.request.user.role == User.Role.CLIENT:
            return queryset.filter(client=self.request.user)
        return queryset

    def create(self, request, *args, **kwargs):
        if request.user.role != User.Role.CLIENT:
            raise PermissionDenied("Only clients can create requests.")
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def perform_create(self, serializer):
        dataset_request = serializer.save(client=self.request.user)
        StatusHistory.objects.create(
            request=dataset_request,
            previous_status=None,
            new_status=Request.Status.SUBMITTED,
            changed_by=self.request.user,
        )

    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, pk=None):
        dataset_request = self.get_object()
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transitioned_request = transition_request(
            dataset_request,
            serializer.validated_data["status"],
            request.user,
            serializer.validated_data.get("reason", ""),
        )
        response_request = self.get_queryset().get(pk=transitioned_request.pk)
        return Response(RequestSerializer(response_request).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="assignments")
    def assign(self, request, pk=None):
        dataset_request = self.get_object()
        serializer = AssignmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignment = assign_episode(dataset_request, serializer.validated_data["episode_id"], request.user)
        return Response(AssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)
