from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import User
from .permissions import IsAdminUserRole
from .serializers import (
    ChangeRoleSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)


class UserViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUserRole]
    queryset = User.objects.all().order_by("id")
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        if self.action in {"update", "partial_update"}:
            return UserUpdateSerializer
        if self.action == "change_role":
            return ChangeRoleSerializer
        return UserSerializer

    def perform_update(self, serializer):
        user = self.get_object()
        new_is_active = serializer.validated_data.get("is_active")
        new_role = serializer.validated_data.get("role")

        if new_is_active is False and user.pk == self.request.user.pk:
            raise ValidationError({"is_active": "Administrators cannot deactivate their own account."})

        if new_role and new_role != User.Role.ADMIN and user.pk == self.request.user.pk:
            raise ValidationError({"role": "Administrators cannot remove their own admin role."})

        if new_is_active is False or (new_role and new_role != User.Role.ADMIN and user.role == User.Role.ADMIN):
            admin_count = User.objects.filter(role=User.Role.ADMIN, is_active=True).count()
            if user.role == User.Role.ADMIN and user.is_active and admin_count <= 1:
                raise ValidationError({"detail": "Cannot deactivate or demote the last active administrator."})

        instance = serializer.save()
        if "role" in serializer.validated_data:
            instance.is_staff = (instance.role == User.Role.ADMIN)
            instance.save(update_fields=["is_staff"])

    @action(detail=True, methods=["post"], url_path="deactivate")
    def deactivate(self, request, pk=None):
        user = self.get_object()
        if user.pk == request.user.pk:
            raise ValidationError({"detail": "Administrators cannot deactivate their own account."})

        admin_count = User.objects.filter(role=User.Role.ADMIN, is_active=True).count()
        if user.role == User.Role.ADMIN and user.is_active and admin_count <= 1:
            raise ValidationError({"detail": "Cannot deactivate the last active administrator."})

        user.is_active = False
        user.save(update_fields=["is_active", "updated_at"])
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="change-role")
    def change_role(self, request, pk=None):
        user = self.get_object()
        serializer = ChangeRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_role = serializer.validated_data["role"]

        if user.pk == request.user.pk and new_role != User.Role.ADMIN:
            raise ValidationError({"role": "Administrators cannot remove their own admin role."})

        if new_role != User.Role.ADMIN and user.role == User.Role.ADMIN and user.is_active:
            admin_count = User.objects.filter(role=User.Role.ADMIN, is_active=True).count()
            if admin_count <= 1:
                raise ValidationError({"role": "Cannot demote the last active administrator."})

        user.role = new_role
        user.is_staff = (new_role == User.Role.ADMIN)
        user.save(update_fields=["role", "is_staff", "updated_at"])
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)
