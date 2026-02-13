from __future__ import annotations

from typing import Optional

DEFAULT_FETCH_TIMEOUT_SECONDS = 20.0
DEFAULT_FETCH_CONCURRENCY = 6
MAX_DISCOVERED_OPENAPI_DEFINITIONS = 50
MAX_IMPORTED_OPENAPI_ENDPOINTS = 5000


def validate_definition_limit(
    discovered_count: int,
    max_definitions: int = MAX_DISCOVERED_OPENAPI_DEFINITIONS,
) -> Optional[str]:
    if discovered_count <= max_definitions:
        return None
    return (
        f"Discovered {discovered_count} definitions, "
        f"which exceeds safety limit ({max_definitions})."
    )


def validate_endpoint_limit(
    endpoint_count: int,
    max_endpoints: int = MAX_IMPORTED_OPENAPI_ENDPOINTS,
) -> Optional[str]:
    if endpoint_count <= max_endpoints:
        return None
    return f"Imported endpoint count exceeded safety limit ({max_endpoints})."
