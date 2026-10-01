from rest_framework import serializers

from .models import Assignment, Episode


class EpisodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Episode
        fields = [
            "id",
            "episode_id",
            "robot_id",
            "task_name",
            "recorded_at",
            "duration_seconds",
            "operator_name",
            "quality",
        ]


class AssignmentCreateSerializer(serializers.Serializer):
    episode_id = serializers.CharField(max_length=64)

    def validate_episode_id(self, value):
        normalized = value.strip().upper()
        if not normalized:
            raise serializers.ValidationError("Episode ID cannot be empty.")
        return normalized


class AssignmentSerializer(serializers.ModelSerializer):
    episode_id = serializers.CharField(source="episode.episode_id", read_only=True)

    class Meta:
        model = Assignment
        fields = ["id", "request", "episode_id", "assigned_by", "assigned_at"]
        read_only_fields = fields
