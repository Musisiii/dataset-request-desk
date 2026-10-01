from rest_framework.routers import DefaultRouter

from episodes.views import EpisodeViewSet

from .views import RequestViewSet

router = DefaultRouter()
router.register("requests", RequestViewSet, basename="request")
router.register("episodes", EpisodeViewSet, basename="episode")

urlpatterns = router.urls
