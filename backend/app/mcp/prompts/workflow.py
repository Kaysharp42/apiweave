"""
MCP workflow prompts — pre-built templates for workflow creation tasks.
"""

import logging

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)


def register_workflow_prompts(server: FastMCP) -> None:
    """Register workflow prompts on the MCP server."""

    @server.prompt()
    def create_test_from_openapi(
        openapi_url: str,
        workflow_name: str | None = None,
        focus_endpoints: str | None = None,
    ) -> str:
        """Generate a structured plan for creating a test workflow from an OpenAPI spec.

        Args:
            openapi_url: URL to the OpenAPI/Swagger specification.
            workflow_name: Desired name for the test workflow.
            focus_endpoints: Comma-separated list of endpoints to prioritize.
        """
        name = workflow_name or "OpenAPI Test Workflow"
        focus = focus_endpoints or "all discovered endpoints"

        return f"""You are an API test workflow designer.
Create a test workflow for the API at: {openapi_url}

**Workflow name:** {name}
**Focus endpoints:** {focus}

Follow these steps:
1. Use `import_openapi_url` with the OpenAPI URL to discover available endpoints
2. Review the discovered endpoints and select the most important ones for testing
3. Use `workflow_create` to create a new workflow with request nodes for each selected endpoint
4. Add assertion nodes to validate expected response status codes, headers, and body structure
5. Use `environment_list` to find an appropriate environment for execution
6. Use `workflow_run` to execute the workflow and verify it works
7. Use `run_get_results` to review the execution summary

Best practices:
- Group related endpoints into logical test sequences
- Add assertions for response status codes (e.g., 200, 201, 400)
- Include assertions for required response headers (e.g., Content-Type)
- Validate response body structure against the OpenAPI schema
- Use variables to pass data between nodes (e.g., extract IDs from create responses)
- Add error-handling nodes for expected failure cases"""

    @server.prompt()
    def create_test_from_curl(
        curl_commands: str,
        workflow_name: str | None = None,
    ) -> str:
        """Generate a structured plan for creating a test workflow from curl commands.

        Args:
            curl_commands: One or more curl commands, each on a new line.
            workflow_name: Desired name for the test workflow.
        """
        name = workflow_name or "Curl Test Workflow"

        return f"""You are an API test workflow designer.
Create a test workflow from these curl commands:

```bash
{curl_commands}
```

**Workflow name:** {name}

Follow these steps:
1. Use `import_curl` with the curl commands to create request nodes
2. Review the generated nodes and adjust any that need modification
3. Use `workflow_create` to create a new workflow with the imported nodes
4. Add assertion nodes to validate expected responses
5. Use `environment_list` to find an appropriate environment
6. Use `workflow_run` to execute and verify the workflow

Best practices:
- Order nodes logically (e.g., create → read → update → delete)
- Extract values from responses using variables for use in subsequent nodes
- Add assertions for status codes, headers, and body content
- Handle authentication tokens by extracting them from login responses"""

    logger.info("MCP workflow prompts registered")


""" finish  work  """
