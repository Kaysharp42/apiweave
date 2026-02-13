from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit


def parse_swagger_ui_query_hints(swagger_ui_url: str) -> dict[str, str | None]:
    parsed = urlsplit(swagger_ui_url)
    query = parse_qs(parsed.query)

    def first(name: str) -> str | None:
        values = query.get(name) or []
        if not values:
            return None
        value = values[0].strip()
        return value or None

    return {
        "configUrl": first("configUrl"),
        "url": first("url"),
        "primaryName": first("urls.primaryName"),
    }


def extract_swagger_ui_hints_from_html(html: str) -> dict[str, Any]:
    if not html:
        return {"configUrl": None, "url": None, "urls": []}

    config_match = re.search(r"configUrl\s*:\s*['\"]([^'\"]+)['\"]", html, re.IGNORECASE)

    parsed_urls: list[dict[str, str]] = []
    urls_block = re.search(r"\burls\s*:\s*\[(.*?)\]", html, re.IGNORECASE | re.DOTALL)
    html_without_urls_array = html
    if urls_block:
        html_without_urls_array = html.replace(urls_block.group(0), "")
        objects = re.findall(r"\{[^{}]*\}", urls_block.group(1))
        for obj in objects:
            name_match = re.search(r"\bname\s*:\s*['\"]([^'\"]+)['\"]", obj, re.IGNORECASE)
            url_item_match = re.search(r"\burl\s*:\s*['\"]([^'\"]+)['\"]", obj, re.IGNORECASE)
            if not url_item_match:
                continue
            parsed_urls.append(
                {
                    "name": (name_match.group(1).strip() if name_match else "")
                    or url_item_match.group(1).strip(),
                    "url": url_item_match.group(1).strip(),
                }
            )

    url_match = re.search(
        r"\burl\s*:\s*['\"]([^'\"]+)['\"]", html_without_urls_array, re.IGNORECASE
    )

    return {
        "configUrl": config_match.group(1).strip() if config_match else None,
        "url": url_match.group(1).strip() if url_match else None,
        "urls": parsed_urls,
    }


def resolve_url(base_url: str, target: str) -> str:
    return urljoin(base_url, (target or "").strip())


def build_swagger_config_candidates(
    swagger_ui_url: str,
    query_hints: dict[str, str | None],
    html_hints: dict[str, Any],
) -> list[str]:
    parsed = urlsplit(swagger_ui_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or "/"
    directory = path.rsplit("/", 1)[0] if "/" in path else ""

    prefixes = {""}
    for marker in ("/webjars/swagger-ui/", "/swagger-ui/"):
        if marker in path:
            prefixes.add(path.split(marker)[0])

    candidates: list[str] = []

    def push(url: str | None, *, relative_to: str = swagger_ui_url) -> None:
        if not url:
            return
        candidate = resolve_url(relative_to, url)
        if candidate not in candidates:
            candidates.append(candidate)

    # Explicit hints have highest precedence.
    push(query_hints.get("configUrl"))
    push(html_hints.get("configUrl"))

    # Common config location relative to UI path.
    push(f"{directory}/swagger-config", relative_to=origin)

    # Common API docs config endpoints (with and without service prefix).
    for prefix in prefixes:
        base = prefix.rstrip("/")
        for suffix in (
            "/v3/api-docs/swagger-config",
            "/api-docs/swagger-config",
            "/swagger/v1/swagger-config",
            "/swagger/swagger-config",
        ):
            push(f"{base}{suffix}", relative_to=origin)

    return candidates


def extract_definitions_from_swagger_config(
    config_data: dict[str, Any], config_url: str
) -> dict[str, Any]:
    definitions: list[dict[str, str]] = []

    urls = config_data.get("urls")
    if isinstance(urls, list):
        for item in urls:
            if not isinstance(item, dict):
                continue
            spec_url = (item.get("url") or "").strip()
            if not spec_url:
                continue
            name = (item.get("name") or "").strip() or spec_url
            definitions.append(
                {
                    "name": name,
                    "specUrl": resolve_url(config_url, spec_url),
                    "source": "swagger-config.urls",
                }
            )

    single_url = (config_data.get("url") or "").strip() if isinstance(config_data, dict) else ""
    if single_url:
        definitions.append(
            {
                "name": (config_data.get("name") or "").strip() or "Default",
                "specUrl": resolve_url(config_url, single_url),
                "source": "swagger-config.url",
            }
        )

    deduped: list[dict[str, str]] = []
    seen = set()
    for item in definitions:
        key = item["specUrl"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return {
        "definitions": deduped,
        "primaryName": (config_data.get("urls.primaryName") or "").strip() or None,
    }


def make_definition_scope(name: str, spec_url: str) -> str:
    seed = (name or "").strip() or (spec_url or "").strip() or "definition"
    scope = re.sub(r"[^a-z0-9]+", "-", seed.lower()).strip("-")
    return scope or "definition"
