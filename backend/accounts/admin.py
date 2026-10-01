from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    model = User
    ordering = ("email",)
    list_display = ("email", "name", "role", "is_active", "is_staff")
    search_fields = ("email", "name", "organisation")
    fieldsets = (
        (None, {"fields": ("email", "password")} ),
        ("Identity", {"fields": ("name", "role", "organisation")} ),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")} ),
        ("Important dates", {"fields": ("last_login", "created_at", "updated_at")} ),
    )
    readonly_fields = ("created_at", "updated_at")
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "name", "role", "organisation", "password1", "password2")}),)
