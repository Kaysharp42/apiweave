from __future__ import annotations

from typing import Any


def resolve_openapi_schema_ref(ref_path: str, openapi_data: dict[str, Any]) -> dict[str, Any]:
    """Resolve an internal OpenAPI $ref path like #/components/schemas/Foo."""
    if not ref_path.startswith("#/"):
        return {}

    parts = ref_path[2:].split("/")
    current: Any = openapi_data

    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return {}

    return current if isinstance(current, dict) else {}


def generate_example_from_schema(
    schema: dict[str, Any],
    openapi_data: dict[str, Any],
    *,
    _seen_refs: set[str] | None = None,
    _depth: int = 0,
    max_depth: int = 12,
    max_properties: int = 40,
) -> Any:
    """Generate safe example values from OpenAPI schema with recursion guards."""
    if not isinstance(schema, dict):
        return None

    if _depth > max_depth:
        return None

    seen_refs = _seen_refs or set()

    if "example" in schema:
        return schema["example"]

    if "$ref" in schema:
        ref_path = str(schema.get("$ref") or "").strip()
        if not ref_path or ref_path in seen_refs:
            return None
        resolved = resolve_openapi_schema_ref(ref_path, openapi_data)
        if not resolved:
            return None
        return generate_example_from_schema(
            resolved,
            openapi_data,
            _seen_refs={*seen_refs, ref_path},
            _depth=_depth + 1,
            max_depth=max_depth,
            max_properties=max_properties,
        )

    for compositional_key in ("allOf", "oneOf", "anyOf"):
        variants = schema.get(compositional_key)
        if isinstance(variants, list) and variants:
            if compositional_key == "allOf":
                merged: dict[str, Any] = {}
                for variant in variants:
                    value = generate_example_from_schema(
                        variant,
                        openapi_data,
                        _seen_refs=seen_refs,
                        _depth=_depth + 1,
                        max_depth=max_depth,
                        max_properties=max_properties,
                    )
                    if isinstance(value, dict):
                        merged.update(value)
                if merged:
                    return merged
                # fall through to first variant if no mergeable object came out
            return generate_example_from_schema(
                variants[0],
                openapi_data,
                _seen_refs=seen_refs,
                _depth=_depth + 1,
                max_depth=max_depth,
                max_properties=max_properties,
            )

    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and enum_values:
        return enum_values[0]

    schema_type = schema.get("type")
    if not schema_type:
        if isinstance(schema.get("properties"), dict):
            schema_type = "object"
        elif isinstance(schema.get("items"), dict):
            schema_type = "array"
        else:
            schema_type = "object"

    if schema_type == "object":
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            return {}

        result: dict[str, Any] = {}
        for index, (prop_name, prop_schema) in enumerate(properties.items()):
            if index >= max_properties:
                break
            result[prop_name] = generate_example_from_schema(
                prop_schema,
                openapi_data,
                _seen_refs=seen_refs,
                _depth=_depth + 1,
                max_depth=max_depth,
                max_properties=max_properties,
            )
        return result

    if schema_type == "array":
        items_schema = schema.get("items", {})
        example_item = generate_example_from_schema(
            items_schema,
            openapi_data,
            _seen_refs=seen_refs,
            _depth=_depth + 1,
            max_depth=max_depth,
            max_properties=max_properties,
        )
        return [example_item] if example_item is not None else []

    if schema_type == "string":
        schema_format = schema.get("format", "")
        if schema_format == "uuid":
            return "00000000-0000-0000-0000-000000000000"
        if schema_format == "date":
            return "2024-01-01"
        if schema_format == "date-time":
            return "2024-01-01T00:00:00Z"
        if schema_format == "email":
            return "user@example.com"
        return schema.get("default", "string")

    if schema_type == "integer":
        return schema.get("default", 0)
    if schema_type == "number":
        return schema.get("default", 0.0)
    if schema_type == "boolean":
        return schema.get("default", False)

    return schema.get("default")
