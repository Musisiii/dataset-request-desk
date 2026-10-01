import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from accounts.models import User


class Command(BaseCommand):
    help = "Create development users from seed/users.json without changing existing accounts."

    def handle(self, *args, **options):
        users_file = Path(__file__).resolve().parents[4] / "seed" / "users.json"
        try:
            users = json.loads(users_file.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise CommandError(f"Could not read {users_file}: {exc}") from exc

        created = 0
        skipped = 0
        for data in users:
            email = data["email"].strip().lower()
            if User.objects.filter(email=email).exists():
                skipped += 1
                self.stdout.write(f"Skipped existing user: {email}")
                continue

            user = User.objects.create_user(
                email=email,
                password=data["password"],
                name=data["name"].strip(),
                role=data["role"],
                organisation=data.get("organisation", "").strip(),
                is_staff=data["role"] == User.Role.ADMIN,
            )
            created += 1
            self.stdout.write(f"Created user: {user.email}")

        self.stdout.write(self.style.SUCCESS(f"Seed users complete: created={created}, skipped={skipped}"))
