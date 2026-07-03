"""
Pytest configuration for backend tests.

Sets up test environment variables and fixtures that apply to all tests.
"""

import os

import pytest

os.environ["TRUSTED_HOSTS"] = "localhost,127.0.0.1,127.0.0.2,testserver"

from app.config import settings

settings.TRUSTED_HOSTS = "localhost,127.0.0.1,127.0.0.2,testserver"
# ponytail: force billing off for tests; .env sets it true but no real Stripe/Mongo
# billing state exists in test runs. Billing tests needing the gates ON override this.
settings.BILLING_ENABLED = False


@pytest.fixture(autouse=True)
def _remove_trusted_host_middleware():
    from app.main import app

    app.user_middleware = [
        m for m in app.user_middleware if m.cls.__name__ != "TrustedHostMiddleware"
    ]
    app.middleware_stack = app.build_middleware_stack()
