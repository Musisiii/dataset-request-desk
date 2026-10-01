from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.models import User

from .models import Request
from .serializers import RequestSerializer, TransitionSerializer
from .services import transition_request


class RequestViewSet(viewsets.ModelViewSet):
    serializer_class = RequestSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = Request.objects.select_related("client")
        if self.request.user.role == User.Role.CLIENT:
            return queryset.filter(client=self.request.user)
        return queryset

    def create(self, request, *args, **kwargs):
        if request.user.role != User.Role.CLIENT:
            raise PermissionDenied("Only clients can create requests.")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(client=self.request.user)

    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, pk=None):
        dataset_request = self.get_object()
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transitioned_request = transition_request(
            dataset_request,
            serializer.validated_data["status"],
            request.user,
        )
        return Response(RequestSerializer(transitioned_request).data, status=status.HTTP_200_OK)
