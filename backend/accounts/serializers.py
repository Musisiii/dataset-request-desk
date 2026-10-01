from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "name",
            "role",
            "organisation",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "name",
            "role",
            "organisation",
            "password",
            "is_active",
        ]
        read_only_fields = ["id"]

    def validate_role(self, value):
        if value not in User.Role.values:
            raise serializers.ValidationError("Invalid role.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        is_staff = validated_data.get("role") == User.Role.ADMIN
        user = User.objects.create_user(
            password=password,
            is_staff=is_staff,
            **validated_data,
        )
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["name", "organisation", "role", "is_active"]

    def validate_role(self, value):
        if value not in User.Role.values:
            raise serializers.ValidationError("Invalid role.")
        return value


class ChangeRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=User.Role.choices)
