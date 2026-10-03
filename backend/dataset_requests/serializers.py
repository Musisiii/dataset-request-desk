from datetime import date

from rest_framework import serializers

from episodes.serializers import EpisodeSerializer

from .models import Request


class RequestSerializer(serializers.ModelSerializer):
    client = serializers.PrimaryKeyRelatedField(read_only=True)
    episodes_requested = serializers.IntegerField(min_value=1)
    assigned_episodes_count = serializers.IntegerField(read_only=True, default=0)
    assigned_episodes = serializers.SerializerMethodField()

    class Meta:
        model = Request
        fields = [
            "id",
            "client",
            "task_name",
            "episodes_requested",
            "assigned_episodes_count",
            "assigned_episodes",
            "deadline",
            "notes",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "client", "status", "created_at", "updated_at"]

    def validate_deadline(self, value):
        if value < date.today():
            raise serializers.ValidationError("Deadline cannot be in the past.")
        return value

    def get_assigned_episodes(self, obj):
        assignments = obj.assignments.select_related("episode").order_by("episode__recorded_at", "episode__episode_id")
        return EpisodeSerializer([assignment.episode for assignment in assignments], many=True).data


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Request.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
