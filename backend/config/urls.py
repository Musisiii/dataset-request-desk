from django.contrib import admin
from django.urls import include, path

from core.analytics import AnalyticsView
from core.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health", health, name="health"),
    path("health/", health, name="health-slash"),
    path("api/analytics/", AnalyticsView.as_view(), name="analytics"),
    path("api/", include("dataset_requests.urls")),
    path("api/", include("accounts.urls")),
]
