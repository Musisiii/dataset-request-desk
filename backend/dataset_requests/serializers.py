from rest_framework import serializers

from .models import Request


class RequestSerializer(serializers.ModelSerializer):
    client = serializers.PrimaryKeyRelatedField(read_only=True)
    episodes_requested = serializers.IntegerField(min_value=1)
    assigned_episodes_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Request
        fields = [
            "id",
            "client",
            "task_name",
            "episodes_requested",
            "assigned_episodes_count",
            "deadline",
            "notes",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "client", "status", "created_at", "updated_at"]


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Request.Status.choices)
