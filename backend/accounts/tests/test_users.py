import pytest
from django.contrib.auth import authenticate
from django.db import IntegrityError

from accounts.models import User


@pytest.mark.django_db
def test_user_uses_email_login_and_hashed_password():
    user = User.objects.create_user(
        email="Person@Example.com",
        password="secure-password-123",
        name="Test Person",
        role=User.Role.CLIENT,
    )

    assert user.email == "person@example.com"
    assert user.password != "secure-password-123"
    assert user.check_password("secure-password-123")
    assert authenticate(email="person@example.com", password="secure-password-123") == user


@pytest.mark.django_db
def test_email_must_be_unique():
    User.objects.create_user("same@example.com", "password-123", name="One", role=User.Role.CLIENT)

    with pytest.raises(IntegrityError):
        User.objects.create_user("same@example.com", "password-123", name="Two", role=User.Role.OPERATOR)


@pytest.mark.django_db
def test_roles_are_limited_to_declared_values():
    assert set(User.Role.values) == {"admin", "operator", "client"}


@pytest.mark.django_db
def test_inactive_user_cannot_authenticate():
    User.objects.create_user(
        "inactive@example.com",
        "secure-password-123",
        name="Inactive Person",
        role=User.Role.CLIENT,
        is_active=False,
    )

    assert authenticate(email="inactive@example.com", password="secure-password-123") is None


@pytest.mark.django_db
def test_seed_users_is_idempotent():
    from django.core.management import call_command

    call_command("seed_users")
    first_password = User.objects.get(email="admin@example.com").password
    call_command("seed_users")

    assert User.objects.count() == 5
    assert User.objects.get(email="admin@example.com").password == first_password
