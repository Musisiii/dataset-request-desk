import json
import logging
import time

logger = logging.getLogger("structured_request")


class StructuredLoggingMiddleware:
    """Logs one machine-readable JSON log entry per HTTP request."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start_time = time.monotonic()
        response = None
        try:
            response = self.get_response(request)
            return response
        finally:
            duration_ms = round((time.monotonic() - start_time) * 1000, 2)
            user = getattr(request, "user", None)
            user_id = user.pk if (user and user.is_authenticated) else None
            status_code = response.status_code if response is not None else 500

            log_entry = {
                "method": request.method,
                "path": request.path,
                "status": status_code,
                "duration_ms": duration_ms,
                "user_id": user_id,
            }
            logger.info(json.dumps(log_entry))
