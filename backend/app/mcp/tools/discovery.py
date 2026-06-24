"""
MCP capability discovery tool.

Returns a machine-readable catalog of the APIWeave MCP server's surface and
runtime grammar so agents can write correct workflows on the first try.

Agents should call ``mcp_describe_capabilities`` at the start of a session.
The response is intentionally stable across releases and versioned via
``schema_version``.
"""

from collections.abc import Callable
from typing import Any

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from app.runner.dynamic_functions import DynamicFunctions

CAPABILITIES_SCHEMA_VERSION = "1"

PLACEHOLDER_NAMESPACES: list[dict[str, str]] = [
    {
        "namespace": "variables",
        "syntax": "{{variables.NAME}}",
        "source": (
            "Workflow variable store. Written by HTTP-Request extractors or the Variables panel; "
            "read by any later node in the same run."
        ),
    },
    {
        "namespace": "env",
        "syntax": "{{env.NAME}}",
        "source": (
            "Selected environment (per run). Use for base URLs, API versions, non-secret config."
        ),
    },
    {
        "namespace": "prev",
        "syntax": "{{prev.PATH}} or {{prev[INDEX].PATH}} after a Merge node",
        "source": (
            "Immediately previous node's response. Paths start with `response.` and use dot "
            "notation with `[index]` for arrays (e.g. response.body.items[0].id)."
        ),
    },
    {
        "namespace": "secrets",
        "syntax": "{{secrets.NAME}}",
        "source": (
            "Scope override chain: environment > workspace > organization > bound user. "
            "Write-only at every layer; runtime-only substitution; never returned by any API."
        ),
    },
]

SUBSTITUTION_RULES: list[str] = [
    (
        "URL, query params, and path variables BLOCK {{secrets.*}} placeholders (raises "
        "ValueError). Use secrets only in body, headers, cookies, or auth fields."
    ),
    "Each namespace is a distinct prefix — {{variables.X}}, {{env.X}}, {{secrets.X}}, and {{prev.X}} are resolved independently and cannot conflict.",
    "Variables and secrets use distinct prefixes ({{variables.X}} vs {{secrets.X}}) and resolve independently. There is no name collision.",
    (
        "Missing placeholders resolve to an empty string (no hard error), which often surfaces "
        "as a malformed downstream request. Add an assertion if you need a hard failure."
    ),
    "{{secrets.NAME}} that is not declared in any scope resolves to an empty string.",
    (
        "Extractors run AFTER the node executes. The node that declares an extractor cannot "
        "read its own output; only later nodes can."
    ),
    (
        "Result shape (fields available on every node's response): status, statusCode, headers, "
        "body, cookies, duration (ms), responseSizeBytes, contentType, bodyFormat (json|text|xml|binary), "
        "responseTimeMs, cookieCount, redirectCount, method, url, and a nested response wrapper "
        "{body, headers, cookies, statusCode}. Access via {{prev.response.body.id}} or flat keys "
        "like {{prev.statusCode}}."
    ),
]

EXTRACTOR_NOTE = (
    "HTTP-request extractors write workflow variables from responses. Shape: dict[str, str] "
    'mapping variable name to dot-notation path. Example: {"token": "response.body.access_token"}. '
    "Then any later node can use Authorization: Bearer {{variables.token}}."
)

NODE_TYPES: dict[str, dict[str, Any]] = {
    "start": {
        "purpose": "Entry point. Exactly one per workflow.",
        "config_fields": [],
        "handles": "output only",
    },
    "end": {
        "purpose": "Terminal point. A workflow can have multiple End nodes.",
        "config_fields": [],
        "handles": "input only",
    },
    "http-request": {
        "purpose": "Send an HTTP call and optionally extract values from the response.",
        "config_fields": [
            "method",
            "url",
            "queryParams",
            "pathVariables",
            "headers",
            "cookies",
            "body",
            "timeout",
            "followRedirects",
            "extractors",
            "fileUploads",
        ],
        "handles": "one input, one output",
        "notes": EXTRACTOR_NOTE,
    },
    "assertion": {
        "purpose": "Validate values from a previous node and branch on pass/fail.",
        "config_fields": [
            "assertions[]: {field, operator, expected}",
            (
                "operators: equals, notEquals, contains, notContains, gt, lt, gte, lte, "
                "exists, notExists, matchesRegex, isEmpty"
            ),
        ],
        "handles": "one input, two outputs (pass, fail)",
    },
    "delay": {
        "purpose": "Pause execution for a fixed time before continuing.",
        "config_fields": ["duration (milliseconds)"],
        "handles": "one input, one output",
    },
    "merge": {
        "purpose": "Combine parallel branches into a single downstream path.",
        "config_fields": [
            "mergeStrategy: 'all' | 'any' | 'first' | 'conditional'",
            "conditions[] (only when mergeStrategy = 'conditional')",
        ],
        "handles": (
            "many inputs (one per branch), one output. After this, prev[INDEX].PATH addresses "
            "a specific branch by 0-based index."
        ),
    },
    "condition": {
        "purpose": "Conditional branching node.",
        "config_fields": ["condition (dot-notation path into previous result, e.g. response.body.status)", "operator", "value"],
        "handles": "one input, two outputs",
    },
}

DOCS_RESOURCES: list[dict[str, str]] = [
    {
        "uri": "apiweave://docs/placeholders",
        "title": "Placeholder Grammar Reference",
        "summary": "The four placeholder namespaces, substitution order, and edge cases.",
    },
    {
        "uri": "apiweave://docs/dynamic-functions",
        "title": "Dynamic Functions Reference",
        "summary": "All 13 dynamic functions with signatures and examples.",
    },
    {
        "uri": "apiweave://docs/variables-and-extractors",
        "title": "Variables and Extractors Guide",
        "summary": "How to pull values from HTTP responses and pass them between nodes.",
    },
    {
        "uri": "apiweave://docs/workflows-and-nodes",
        "title": "Workflows and Nodes Guide",
        "summary": "The seven node types, canvas actions, and resume behavior.",
    },
    {
        "uri": "apiweave://docs/environments-and-secrets",
        "title": "Environments and Secrets Guide",
        "summary": "Scoped environments, write-only secret model, override chain.",
    },
]

RESOURCE_URIS: list[dict[str, str]] = [
    {
        "uri": "workflow://{workflow_id}",
        "purpose": "Read-only snapshot of a workflow definition with secrets redacted.",
    },
    {
        "uri": "environment://{environment_id}",
        "purpose": "Read-only snapshot of an environment with secrets redacted.",
    },
    {
        "uri": "environments://list",
        "purpose": "List all environments accessible in the current scope.",
    },
    {
        "uri": "run://{run_id}",
        "purpose": "Read-only snapshot of a workflow run status and metadata.",
    },
]

QUICK_START: list[str] = [
    "Call workflow_list and environment_list to inventory the workspace.",
    "Read apiweave://docs/workflows-and-nodes for the canonical node-type reference.",
    "Read apiweave://docs/placeholders for the four placeholder namespaces.",
    "Use {{randomString(N)}} or {{uuid()}} for unique-per-run test data instead of hardcoded values.",
    (
        "Use HTTP-request extractors (dict[str, str]) to write workflow variables once, then "
        "reuse them via {{variables.NAME}} in every later node."
    ),
    (
        "NEVER put {{secrets.NAME}} in URL/query/path — the runner blocks it with ValueError. "
        "Headers, body, cookies, and auth fields are fine."
    ),
    "Use workflow_import_dry_run before workflow_import to surface validation errors early.",
]


class ToolCatalogEntry(BaseModel):
    """One MCP tool exposed by the server."""

    name: str
    description: str


class PlaceholderNamespace(BaseModel):
    """One placeholder namespace and how it resolves."""

    namespace: str
    syntax: str
    source: str


class DocResource(BaseModel):
    """One documentation resource served via apiweave://docs/*."""

    uri: str
    title: str
    summary: str


class ResourceUri(BaseModel):
    """One non-doc resource URI exposed by the server."""

    uri: str
    purpose: str


class NodeTypeDescriptor(BaseModel):
    """One workflow node type and its config field reference."""

    type: str
    purpose: str
    config_fields: list[str]
    handles: str
    notes: str | None = None


class DynamicFunctionDescriptor(BaseModel):
    """One dynamic function callable inside a placeholder."""

    name: str
    signature: str
    description: str


class CapabilitiesResponse(BaseModel):
    """Machine-readable catalog of the APIWeave MCP server."""

    schema_version: str = Field(default=CAPABILITIES_SCHEMA_VERSION)
    server_name: str = "APIWeave"
    tools: list[ToolCatalogEntry]
    resource_uris: list[ResourceUri]
    docs: list[DocResource]
    placeholder_namespaces: list[PlaceholderNamespace]
    substitution_rules: list[str]
    dynamic_functions: list[DynamicFunctionDescriptor]
    node_types: list[NodeTypeDescriptor]
    quick_start: list[str]


def _build_dynamic_function_descriptors() -> list[DynamicFunctionDescriptor]:
    descriptors: list[DynamicFunctionDescriptor] = []
    for signature, description in DynamicFunctions.get_all_functions().items():
        name = signature.split("(", 1)[0]
        descriptors.append(
            DynamicFunctionDescriptor(
                name=name,
                signature=signature,
                description=description,
            )
        )
    return descriptors


def _build_node_type_descriptors() -> list[NodeTypeDescriptor]:
    return [
        NodeTypeDescriptor(
            type=name,
            purpose=spec["purpose"],
            config_fields=list(spec.get("config_fields", [])),
            handles=spec["handles"],
            notes=spec.get("notes"),
        )
        for name, spec in NODE_TYPES.items()
    ]


async def _list_tools(server: FastMCP) -> list[ToolCatalogEntry]:
    tools = await server.list_tools()
    entries = [
        ToolCatalogEntry(name=tool.name, description=tool.description or "")
        for tool in tools
    ]
    entries.sort(key=lambda entry: entry.name)
    return entries


def make_describe_capabilities(
    server: FastMCP,
) -> Callable[[], Any]:
    """Build the describe-capabilities coroutine bound to a server instance."""

    async def mcp_describe_capabilities() -> CapabilitiesResponse:
        """Catalog every MCP tool, resource URI, placeholder, and dynamic function.

        Call this FIRST when starting a new agent session. It returns every
        registered tool with its description, every resource URI (including
        the apiweave://docs/* documentation resources), the four placeholder
        namespaces with substitution rules, the full list of dynamic functions,
        the seven node types with config field references, and a quick-start
        checklist for writing correct workflows.

        The response is versioned via ``schema_version``.
        """
        return CapabilitiesResponse(
            tools=await _list_tools(server),
            resource_uris=[ResourceUri(**r) for r in RESOURCE_URIS],
            docs=[DocResource(**d) for d in DOCS_RESOURCES],
            placeholder_namespaces=[
                PlaceholderNamespace(**ns) for ns in PLACEHOLDER_NAMESPACES
            ],
            substitution_rules=SUBSTITUTION_RULES,
            dynamic_functions=_build_dynamic_function_descriptors(),
            node_types=_build_node_type_descriptors(),
            quick_start=QUICK_START,
        )

    return mcp_describe_capabilities


def register_discovery_tools(server: FastMCP) -> None:
    """Register the capability discovery tool on the MCP server."""
    describe = make_describe_capabilities(server)
    server.tool(
        name="mcp_describe_capabilities",
        description=(
            "Catalog every MCP tool, resource URI, placeholder namespace, dynamic function, "
            "and node type the APIWeave server exposes. Call this FIRST in any new session "
            "to learn how to write correct workflows without trial-and-error. Response is "
            "stable across releases (versioned by schema_version)."
        ),
    )(describe)
