"""
OpenAPI URL fetch — fetch and parse OpenAPI specs from URLs (direct or Swagger UI).
"""

import json
import logging
from typing import Any

from app.services.safe_http import SafeUrlError, validate_url

from .openapi import parse_openapi_to_workflow

logger = logging.getLogger(__name__)


async def fetch_openapi_from_url(
    url: str,
    base_url: str = "",
    tag_filter: list[str] | None = None,
    sanitize: bool = True,
) -> dict[str, Any]:
    """Fetch and parse OpenAPI spec from a URL (direct spec or Swagger UI).

    Returns a dict with keys: nodes, definitions, total_endpoints,
    api_title, source_url, warnings.
    """
    import asyncio

    import httpx

    from app.utils.openapi_import_limits import (
        DEFAULT_FETCH_CONCURRENCY,
        DEFAULT_FETCH_TIMEOUT_SECONDS,
        MAX_DISCOVERED_OPENAPI_DEFINITIONS,
        MAX_IMPORTED_OPENAPI_ENDPOINTS,
    )
    from app.utils.swagger_discovery import (
        build_swagger_config_candidates,
        extract_definitions_from_swagger_config,
        extract_swagger_ui_hints_from_html,
        make_definition_scope,
        parse_swagger_ui_query_hints,
        replace_url_host,
        resolve_url,
        select_primary_definition,
    )

    url = url.strip()
    if not url:
        raise ValueError("URL is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("URL must start with http:// or https://")

    # SSRF safety: validate URL before any outbound request
    try:
        validate_url(url)
    except SafeUrlError as exc:
        logger.warning("Blocked unsafe URL in fetch_openapi_from_url: %s (%s)", url, exc)
        raise ValueError(f"URL blocked by safety policy: {url} ({exc})") from exc

    def _extract_openapi_document(response: httpx.Response) -> dict[str, Any] | None:
        try:
            data = response.json()
        except (ValueError, json.JSONDecodeError):
            data = None

        if isinstance(data, dict) and "paths" in data:
            return data

        content_type = (response.headers.get("content-type") or "").lower()
        body_text = response.text or ""
        should_try_yaml = (
            "yaml" in content_type
            or body_text.lstrip().startswith("openapi:")
            or body_text.lstrip().startswith("swagger:")
        )

        if not should_try_yaml:
            return None

        try:
            import yaml  # type: ignore[import-not-found,import-untyped]
        except Exception:
            return None

        try:
            yaml_data = yaml.safe_load(body_text)
        except Exception:
            return None

        if isinstance(yaml_data, dict) and "paths" in yaml_data:
            return yaml_data

        return None

    def _dedupe_definitions(definitions: list[dict[str, str]]) -> list[dict[str, str]]:
        deduped: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in definitions:
            spec_url = (item.get("specUrl") or "").strip()
            if not spec_url or spec_url in seen:
                continue
            seen.add(spec_url)
            deduped.append(
                {
                    "name": (item.get("name") or "").strip() or spec_url,
                    "specUrl": spec_url,
                    "source": (item.get("source") or "discovered").strip() or "discovered",
                }
            )
        return deduped

    def _host_resolves(host: str) -> bool:
        import socket

        try:
            socket.getaddrinfo(host, None)
            return True
        except socket.gaierror:
            return False

    def _fetch_url_candidates(target_url: str) -> list[str]:
        candidates = [target_url]
        parsed = httpx.URL(target_url)
        if parsed.host == "localhost" and _host_resolves("host.docker.internal"):
            candidate = replace_url_host(target_url, "host.docker.internal")
            if candidate not in candidates:
                candidates.append(candidate)
        return candidates

    async def _get_with_localhost_fallback(
        client: httpx.AsyncClient,
        target_url: str,
        headers: dict[str, str],
    ) -> httpx.Response:
        original_error: Exception | None = None
        for candidate in _fetch_url_candidates(target_url):
            try:
                validate_url(candidate)
                return await client.get(candidate, headers=headers)
            except httpx.RequestError as exc:
                if candidate == target_url:
                    original_error = exc
                continue
        if original_error:
            raise original_error
        return await client.get(target_url, headers=headers)

    async def _discover_from_swagger_ui(
        client: httpx.AsyncClient,
        swagger_ui_url: str,
        html_text: str,
    ) -> dict[str, Any]:
        query_hints = parse_swagger_ui_query_hints(swagger_ui_url)
        html_hints = extract_swagger_ui_hints_from_html(html_text)

        definitions: list[dict[str, str]] = []

        if query_hints.get("url"):
            definitions.append(
                {
                    "name": query_hints.get("primaryName") or "Default",
                    "specUrl": resolve_url(swagger_ui_url, query_hints["url"] or ""),
                    "source": "swagger-ui.query.url",
                }
            )

        for entry in html_hints.get("urls") or []:
            definitions.append(
                {
                    "name": (entry.get("name") or "").strip() or (entry.get("url") or "").strip(),
                    "specUrl": resolve_url(swagger_ui_url, entry.get("url") or ""),
                    "source": "swagger-ui.html.urls",
                }
            )

        if html_hints.get("url"):
            definitions.append(
                {
                    "name": query_hints.get("primaryName") or "Default",
                    "specUrl": resolve_url(swagger_ui_url, html_hints["url"]),
                    "source": "swagger-ui.html.url",
                }
            )

        primary_name = query_hints.get("primaryName")
        config_candidates = build_swagger_config_candidates(swagger_ui_url, query_hints, html_hints)

        for candidate in config_candidates:
            try:
                validate_url(candidate)
            except SafeUrlError as exc:
                logger.warning(
                    "Blocked unsafe swagger config candidate URL: %s (%s)",
                    candidate,
                    exc,
                )
                continue
            try:
                response = await _get_with_localhost_fallback(
                    client,
                    candidate,
                    headers={
                        "Accept": "application/json, application/vnd.oai.openapi+json",
                    },
                )
                response.raise_for_status()
                config_data = response.json()
                if not isinstance(config_data, dict):
                    continue
                extracted = extract_definitions_from_swagger_config(config_data, str(response.url))
                if extracted.get("primaryName") and not primary_name:
                    primary_name = extracted["primaryName"]
                definitions.extend(extracted.get("definitions") or [])
                if extracted.get("definitions"):
                    break
            except Exception:
                continue

        deduped = select_primary_definition(_dedupe_definitions(definitions), primary_name)
        return {"definitions": deduped, "primaryName": primary_name}

    async with httpx.AsyncClient(
        timeout=DEFAULT_FETCH_TIMEOUT_SECONDS, follow_redirects=True
    ) as client:
        initial_response = await _get_with_localhost_fallback(
            client,
            url,
            headers={
                "Accept": "application/json, application/vnd.oai.openapi+json, text/html",
            },
        )
        initial_response.raise_for_status()

        direct_spec = _extract_openapi_document(initial_response)

        discovered_definitions: list[dict[str, str]] = []

        if direct_spec:
            discovered_definitions = [
                {
                    "name": direct_spec.get("info", {}).get("title") or "Default",
                    "specUrl": url,
                    "source": "direct-url",
                }
            ]
        else:
            discovery = await _discover_from_swagger_ui(
                client,
                swagger_ui_url=url,
                html_text=initial_response.text,
            )
            discovered_definitions = discovery.get("definitions") or []

            if not discovered_definitions:
                raise ValueError(
                    "Could not discover OpenAPI definitions from Swagger UI URL. "
                    "Use a direct OpenAPI spec URL or verify Swagger UI config exposure."
                )

        if len(discovered_definitions) > MAX_DISCOVERED_OPENAPI_DEFINITIONS:
            raise ValueError(
                f"Discovered {len(discovered_definitions)} definitions, "
                f"which exceeds safety limit ({MAX_DISCOVERED_OPENAPI_DEFINITIONS})."
            )

        successful_specs: list[dict[str, Any]] = []
        failed_definitions: list[dict[str, str]] = []

        async def _fetch_definition(definition: dict[str, str]) -> dict[str, Any]:
            definition_name = definition.get("name") or "Definition"
            spec_url = definition.get("specUrl") or ""
            if not spec_url:
                return {
                    "status": "failed",
                    "name": definition_name,
                    "specUrl": spec_url,
                    "error": "Missing spec URL",
                }

            if direct_spec and spec_url == url:
                return {
                    "status": "imported",
                    "definition": definition,
                    "openapi_data": direct_spec,
                }

            try:
                validate_url(spec_url)
            except SafeUrlError as exc:
                logger.warning("Blocked unsafe definition spec URL: %s (%s)", spec_url, exc)
                return {
                    "status": "failed",
                    "name": definition_name,
                    "specUrl": spec_url,
                    "error": f"URL blocked by safety policy: {exc}",
                }

            try:
                spec_response = await _get_with_localhost_fallback(
                    client,
                    spec_url,
                    headers={
                        "Accept": "application/json, application/vnd.oai.openapi+json",
                    },
                )
                spec_response.raise_for_status()
                openapi_data = _extract_openapi_document(spec_response)
                if not openapi_data:
                    raise ValueError("Definition URL did not return a valid OpenAPI JSON document")

                return {
                    "status": "imported",
                    "definition": definition,
                    "openapi_data": openapi_data,
                }
            except Exception as exc:
                return {
                    "status": "failed",
                    "name": definition_name,
                    "specUrl": spec_url,
                    "error": str(exc),
                }

        semaphore = asyncio.Semaphore(DEFAULT_FETCH_CONCURRENCY)

        async def _fetch_with_limit(definition: dict[str, str]) -> dict[str, Any]:
            async with semaphore:
                return await _fetch_definition(definition)

        fetch_results = await asyncio.gather(
            *(_fetch_with_limit(d) for d in discovered_definitions)
        )

        for result in fetch_results:
            if result.get("status") == "imported":
                successful_specs.append(result)
            else:
                failed_definitions.append(
                    {
                        "name": result["name"],
                        "specUrl": result["specUrl"],
                        "error": result["error"],
                    }
                )

    if not successful_specs:
        first_error = (
            failed_definitions[0]["error"] if failed_definitions else "Unknown fetch error"
        )
        raise ValueError(f"Failed to fetch any OpenAPI definitions: {first_error}")

    total_discovered = len(discovered_definitions)
    total_imported = len(successful_specs)
    is_multi_definition = total_discovered > 1

    all_http_nodes: list[dict[str, Any]] = []
    definition_summaries: list[dict[str, Any]] = []

    for bundle in successful_specs:
        definition = bundle["definition"]
        definition_name = definition.get("name") or "Definition"
        definition_spec_url = definition.get("specUrl") or ""
        definition_scope = make_definition_scope(definition_name, definition_spec_url)

        workflow_data = parse_openapi_to_workflow(
            bundle["openapi_data"],
            base_url,
            tag_filter,
            sanitize,
            source_context={
                "definitionName": definition_name,
                "definitionSpecUrl": definition_spec_url,
                "definitionScope": definition_scope,
                "sourceUiUrl": url,
            },
        )
        http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]

        if is_multi_definition:
            for node in http_nodes:
                label = node.get("label") or node.get("config", {}).get("url") or "Request"
                node["label"] = f"[{definition_name}] {label}"

        all_http_nodes.extend(http_nodes)

        if len(all_http_nodes) > MAX_IMPORTED_OPENAPI_ENDPOINTS:
            raise ValueError(
                f"Imported endpoint count exceeded safety limit ({MAX_IMPORTED_OPENAPI_ENDPOINTS})."
            )

        definition_summaries.append(
            {
                "name": definition_name,
                "spec_url": definition_spec_url,
                "status": "imported",
                "endpoint_count": len(http_nodes),
                "source": definition.get("source") or "discovered",
            }
        )

    for failed in failed_definitions:
        definition_summaries.append(
            {
                "name": failed["name"],
                "spec_url": failed["specUrl"],
                "status": "failed",
                "endpoint_count": 0,
                "source": "discovered",
                "error": failed["error"],
            }
        )

    api_title = (
        "Multiple APIs"
        if total_imported > 1
        else (successful_specs[0]["openapi_data"].get("info", {}).get("title", "API"))
    )

    warnings = [
        {
            "type": "definition-fetch-failed",
            "name": item["name"],
            "specUrl": item["specUrl"],
            "message": item["error"],
        }
        for item in failed_definitions
    ]

    return {
        "nodes": all_http_nodes,
        "definitions": definition_summaries,
        "total_endpoints": len(all_http_nodes),
        "api_title": api_title,
        "source_url": url,
        "warnings": warnings,
    }
