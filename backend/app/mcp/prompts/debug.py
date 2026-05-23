"""
MCP debug prompts — pre-built templates for debugging failed runs.
"""
import logging

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)


def register_debug_prompts(server: FastMCP) -> None:
    """Register debug prompts on the MCP server."""

    @server.prompt()
    def debug_failed_run(
        workflow_id: str,
        run_id: str | None = None,
    ) -> str:
        """Generate a structured plan for debugging a failed workflow run.

        Args:
            workflow_id: ID of the workflow to debug.
            run_id: Optional specific run ID to investigate. If omitted, the latest failed run is used.
        """
        run_ref = run_id or "the latest failed run"

        return f"""You are an API test debugging assistant. Investigate the failed run for workflow: {workflow_id}

**Run to investigate:** {run_ref}

Follow these steps:
1. Use `run_latest_failed` with workflow_id="{workflow_id}" to get the latest failed run details
2. If a specific run_id was provided, use `run_get_status` with that run_id to get detailed status
3. Review the failed node IDs and their statuses
4. For each failed node, use `run_get_node_result` to get the full result including request/response data
5. Analyze the failure:
   - Check HTTP status codes (4xx = client error, 5xx = server error)
   - Review error messages in the response body
   - Check if authentication tokens are expired
   - Verify environment variables are correctly set
6. Use `workflow_get` to review the workflow definition and node configurations
7. Suggest fixes based on the root cause

Common failure patterns:
- **401 Unauthorized:** Check environment secrets and authentication headers
- **403 Forbidden:** Verify API permissions and scopes
- **404 Not Found:** Check endpoint URLs and path parameters
- **500 Server Error:** The target API may be down; check response body for details
- **Timeout:** The endpoint may be slow; consider increasing timeout settings
- **Assertion Failed:** The response didn't match expected values; review the assertion criteria"""

    @server.prompt()
    def resume_failed_workflow(
        workflow_id: str,
    ) -> str:
        """Generate a structured plan for resuming a failed workflow from its last failed nodes.

        Args:
            workflow_id: ID of the workflow to resume.
        """
        return f"""You are an API test workflow recovery assistant. Resume the failed workflow: {workflow_id}

Follow these steps:
1. Use `run_latest_failed` with workflow_id="{workflow_id}" to get the failed run details
2. Review the failed_node_ids and the failure reasons
3. Decide on the resume strategy:
   - Use mode="single" to retry only the first failed node
   - Use mode="all-failed" to retry all failed nodes in parallel
4. Use `workflow_run` with:
   - workflow_id="{workflow_id}"
   - resume_mode="single" or "all-failed"
   - resume_source_run_id from the failed run
5. Use `run_get_status` to poll the resumed run until it completes
6. Use `run_get_results` to verify the resumed run succeeded

Important notes:
- Resumed runs inherit context from the source run (variables, extracted values)
- If the failure was due to a transient error (timeout, 503), retry is likely to succeed
- If the failure was due to invalid input, fix the node configuration before resuming
- Use `run_get_node_result` on any nodes that fail again to investigate further"""

    logger.info("MCP debug prompts registered")
