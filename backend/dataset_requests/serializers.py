from rest_framework import serializers

from .models import Request


class RequestSerializer(serializers.ModelSerializer):
    client = serializers.PrimaryKeyRelatedField(read_only=True)
    episodes_requested = serializers.IntegerField(min_value=1)

    class Meta:
        model = Request
        fields = [
            "id",
            "client",
            "task_name",
            "episodes_requested",
            "deadline",
            "notes",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "client", "status", "created_at", "updated_at"]


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Request.Status.choices)
