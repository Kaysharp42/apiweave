from app.utils.openapi_examples import generate_example_from_schema


def test_generate_example_from_schema_handles_self_ref_without_recursion_error():
    openapi_data = {
        "openapi": "3.0.1",
        "components": {
            "schemas": {
                "Node": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "child": {"$ref": "#/components/schemas/Node"},
                    },
                }
            }
        },
    }

    schema = {"$ref": "#/components/schemas/Node"}
    example = generate_example_from_schema(schema, openapi_data)

    assert isinstance(example, dict)
    assert example.get("id") == "string"
    assert example.get("child") is None


def test_generate_example_from_schema_supports_allof_merge():
    openapi_data = {
        "openapi": "3.0.1",
        "components": {
            "schemas": {
                "Base": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}},
                },
                "Extra": {
                    "type": "object",
                    "properties": {"count": {"type": "integer"}},
                },
            }
        },
    }

    schema = {
        "allOf": [
            {"$ref": "#/components/schemas/Base"},
            {"$ref": "#/components/schemas/Extra"},
        ]
    }

    example = generate_example_from_schema(schema, openapi_data)

    assert example == {"id": "string", "count": 0}
