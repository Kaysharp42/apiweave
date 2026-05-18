"""
MCP run execution and monitoring tools.
"""
from datetime import datetime
from typing import Annotated, Any, Literal, cast

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.schemas.runs import (
    FailedNodeSummary,
    NodeStatusSummary,
    PollingHint,
    ResumeRunRequest,
    RunGetNodeResultRequest,
    RunGetResultsRequest,
    RunGetStatusRequest,
    RunLatestFailedRequest,
    RunLatestFailedResponse,
    RunListItem,
    RunListRequest,
    RunListResponse,
    RunNodeResultResponse,
    RunResultNodeSummary,
    RunResultsResponse,
    RunStatusResponse,
    WorkflowRunRequest,
    WorkflowRunResponse,
)
from app.services.run_service import get_latest_failed_run as svc_get_latest_failed_run
from app.services.run_service import get_node_result as svc_get_node_result
from app.services.run_service import get_run as svc_get_run
from app.services.run_service import get_run_results as svc_get_run_results
from app.services.run_service import list_runs as svc_list_runs
from app.services.run_service import trigger_workflow_run as svc_trigger_workflow_run
from app.services.secret_utils import detect_secrets_in_value

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def _polling_hint_from_dict(data: dict[str, Any]) -> PollingHint:
    return PollingHint(
        tool=str(data.get("tool", "run_get_status")),
        recommended_interval_seconds=int(data.get("recommendedIntervalSeconds", 1)),
        instructions=str(data.get("instructions", "Poll until the run reaches a terminal status.")),
        terminal_statuses=list(data.get("terminalStatuses", ["completed", "failed", "cancelled"])),
    )


def _workflow_run_response_from_dict(data: dict[str, Any]) -> WorkflowRunResponse:
    polling = cast(dict[str, Any], data.get("polling", {}))
    return WorkflowRunResponse(
        message=str(data.get("message", "Workflow run triggered")),
        run_id=str(data.get("runId")),
        workflow_id=str(data.get("workflowId")),
        environment_id=cast(str | None, data.get("environmentId")),
        resume_mode=cast(str | None, data.get("resumeMode")),
        resume_from_run_id=cast(str | None, data.get("resumeFromRunId")),
        start_node_ids=cast(list[str] | None, data.get("startNodeIds")),
        status=str(data.get("status", "pending")),
        runtime_secret_count=int(data.get("runtimeSecretCount", 0)),
        polling_hint=_polling_hint_from_dict(polling),
    )


def _node_status_summaries(node_statuses: dict[str, Any]) -> list[NodeStatusSummary]:
    summaries: list[NodeStatusSummary] = []
    for node_id, metadata in sorted(
        node_statuses.items(),
        key=lambda item: str((item[1] or {}).get("timestamp", ""))
        if isinstance(item[1], dict)
        else "",
    ):
        if isinstance(metadata, dict):
            node_status = metadata.get("status")
            timestamp = metadata.get("timestamp")
        else:
            node_status = str(metadata) if metadata is not None else None
            timestamp = None
        summaries.append(
            NodeStatusSummary(
                node_id=node_id,
                status=cast(str | None, node_status),
                timestamp=cast(str | None, timestamp),
                has_full_result=True,
            )
        )
    return summaries


def _node_counts(node_statuses: list[NodeStatusSummary]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in node_statuses:
        key = node.status or "unknown"
        counts[key] = counts.get(key, 0) + 1
    return counts


def _run_to_status_response(run: Any) -> RunStatusResponse:
    node_statuses = _node_status_summaries(
        cast(dict[str, Any], getattr(run, "nodeStatuses", {}) or {})
    )
    status = str(getattr(run, "status"))
    return RunStatusResponse(
        run_id=str(getattr(run, "runId")),
        workflow_id=str(getattr(run, "workflowId")),
        status=status,
        trigger=str(getattr(run, "trigger")),
        environment_id=cast(str | None, getattr(run, "environmentId", None)),
        resume_from_run_id=cast(str | None, getattr(run, "resumeFromRunId", None)),
        resume_from_node_ids=cast(list[str] | None, getattr(run, "resumeFromNodeIds", None)),
        resume_mode=cast(str | None, getattr(run, "resumeMode", None)),
        created_at=cast(datetime, getattr(run, "createdAt")),
        started_at=cast(datetime | None, getattr(run, "startedAt", None)),
        completed_at=cast(datetime | None, getattr(run, "completedAt", None)),
        duration_ms=cast(int | None, getattr(run, "duration", None)),
        error=cast(str | None, getattr(run, "error", None)),
        failure_message=cast(str | None, getattr(run, "failureMessage", None)),
        failed_nodes=list(getattr(run, "failedNodes", None) or []),
        node_statuses=node_statuses,
        node_counts=_node_counts(node_statuses),
        terminal=status in TERMINAL_STATUSES,
    )


def _result_node_summary(result: dict[str, Any]) -> RunResultNodeSummary:
    assertions = result.get("assertions", [])
    assertion_count = len(assertions) if isinstance(assertions, list) else 0
    return RunResultNodeSummary(
        node_id=cast(str | None, result.get("nodeId")),
        node_type=cast(str | None, result.get("nodeType")),
        status=str(result.get("status", "UNKNOWN")),
        duration=cast(str | None, result.get("duration")),
        duration_seconds=cast(float | None, result.get("durationSeconds")),
        error=cast(str | None, result.get("error")),
        assertion_count=assertion_count,
        has_request=result.get("request") is not None,
        has_response=result.get("response") is not None,
    )


def _sanitize_result_value(value: Any, secret_refs: list[str], path: str = "result") -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            current_path = f"{path}.{key}" if path else str(key)
            if detect_secrets_in_value(str(key)):
                sanitized[key] = "<SECRET>"
                secret_refs.append(current_path)
            else:
                sanitized[key] = _sanitize_result_value(item, secret_refs, current_path)
        return sanitized
    if isinstance(value, list):
        return [
            _sanitize_result_value(item, secret_refs, f"{path}.{index}")
            for index, item in enumerate(value)
        ]
    if isinstance(value, str) and detect_secrets_in_value(value):
        secret_refs.append(path)
        return "<SECRET>"
    return value


def _failed_node_summary(data: dict[str, Any]) -> FailedNodeSummary:
    return FailedNodeSummary(
        node_id=str(data.get("nodeId")),
        label=str(data.get("label", data.get("nodeId"))),
        type=cast(str | None, data.get("type")),
        status=cast(str | None, data.get("status")),
        timestamp=cast(str | None, data.get("timestamp")),
    )


async def workflow_run(
    workflow_id: Annotated[str, Field(description="Workflow ID to execute.")],
    environment_id: Annotated[
        str | None,
        Field(description="Optional environment ID for this run."),
    ] = None,
    runtime_secrets: Annotated[
        dict[str, str] | None,
        Field(description="Runtime-only secrets. Values are never persisted or echoed back."),
    ] = None,
    resume_mode: Annotated[
        Literal["single", "all-failed"] | None,
        Field(description="Optional resume mode for failed-run retry flows."),
    ] = None,
    resume_source_run_id: Annotated[
        str | None,
        Field(description="Failed source run ID. Latest failed run is used if omitted."),
    ] = None,
    resume_start_node_ids: Annotated[
        list[str] | None,
        Field(description="Failed node IDs to restart from. Derived if omitted."),
    ] = None,
) -> WorkflowRunResponse:
    """Trigger workflow execution and return polling instructions without echoing secrets."""
    await ensure_mcp_database()
    resume: ResumeRunRequest | None = None
    if resume_mode or resume_source_run_id or resume_start_node_ids:
        if not resume_mode:
            raise ValueError(
                "resume_mode is required when resume source or start nodes are provided"
            )
        resume = ResumeRunRequest(
            mode=resume_mode,
            source_run_id=resume_source_run_id,
            start_node_ids=resume_start_node_ids or [],
        )

    request = WorkflowRunRequest(
        workflow_id=workflow_id,
        environment_id=environment_id,
        runtime_secrets=runtime_secrets or {},
        resume=resume,
    )
    try:
        result = await svc_trigger_workflow_run(
            request.workflow_id,
            environment_id=request.environment_id,
            runtime_secrets=request.runtime_secrets,
            resume=request.resume.model_dump() if request.resume else None,
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return _workflow_run_response_from_dict(result)


async def run_get_status(
    workflow_id: Annotated[str, Field(description="Workflow ID that owns the run.")],
    run_id: Annotated[str, Field(description="Run ID to poll.")],
) -> RunStatusResponse:
    """Get run status and compact node status summaries without full node payloads."""
    await ensure_mcp_database()
    request = RunGetStatusRequest(workflow_id=workflow_id, run_id=run_id)
    try:
        run = await svc_get_run(request.run_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    if run.workflowId != request.workflow_id:
        raise ValueError(f"Run {request.run_id} not found")
    return _run_to_status_response(run)


async def run_get_results(
    workflow_id: Annotated[str, Field(description="Workflow ID that owns the run.")],
    run_id: Annotated[str, Field(description="Run ID to summarize.")],
) -> RunResultsResponse:
    """Get a human-readable payload-free run results summary."""
    await ensure_mcp_database()
    request = RunGetResultsRequest(workflow_id=workflow_id, run_id=run_id)
    try:
        results = await svc_get_run_results(request.run_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    if results.get("workflowId") != request.workflow_id:
        raise ValueError(f"Run {request.run_id} not found")

    node_results = [
        _result_node_summary(cast(dict[str, Any], result))
        for result in list(results.get("nodeResults", []))
        if isinstance(result, dict)
    ]
    return RunResultsResponse(
        run_id=str(results.get("runId")),
        workflow_id=str(results.get("workflowId")),
        workflow_name=str(results.get("workflowName", "Unknown Workflow")),
        status=str(results.get("status")),
        trigger=str(results.get("trigger")),
        summary=cast(dict[str, Any], results.get("summary", {})),
        timing=cast(dict[str, Any], results.get("timing", {})),
        environment=cast(dict[str, Any] | None, results.get("environment")),
        error=cast(str | None, results.get("error")),
        failed_nodes=list(results.get("failedNodes", [])),
        failure_message=cast(str | None, results.get("failureMessage")),
        node_results=node_results,
        detail_tool="run_get_node_result",
    )


async def run_get_node_result(
    workflow_id: Annotated[str, Field(description="Workflow ID that owns the run.")],
    run_id: Annotated[str, Field(description="Run ID containing the node result.")],
    node_id: Annotated[str, Field(description="Node ID to retrieve.")],
) -> RunNodeResultResponse:
    """Fetch the full result for one node, including GridFS-backed payloads when present."""
    await ensure_mcp_database()
    request = RunGetNodeResultRequest(workflow_id=workflow_id, run_id=run_id, node_id=node_id)
    try:
        node_result = await svc_get_node_result(
            request.run_id,
            request.workflow_id,
            request.node_id,
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    secret_refs: list[str] = []
    sanitized_result = _sanitize_result_value(node_result.get("result"), secret_refs)
    return RunNodeResultResponse(
        node_id=str(node_result.get("nodeId")),
        run_id=str(node_result.get("runId")),
        status=cast(str | None, node_result.get("status")),
        timestamp=cast(str | None, node_result.get("timestamp")),
        result=sanitized_result,
        metadata=cast(dict[str, Any], node_result.get("metadata", {})),
        redacted_secret_references=secret_refs,
    )


async def run_latest_failed(
    workflow_id: Annotated[str, Field(description="Workflow ID to inspect for failed runs.")],
) -> RunLatestFailedResponse:
    """Get latest failed run metadata and failed nodes for resume flows."""
    await ensure_mcp_database()
    request = RunLatestFailedRequest(workflow_id=workflow_id)
    try:
        result = await svc_get_latest_failed_run(request.workflow_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    failed_nodes = [
        _failed_node_summary(cast(dict[str, Any], node))
        for node in list(result.get("failedNodes", []))
        if isinstance(node, dict)
    ]
    return RunLatestFailedResponse(
        has_failed_run=bool(result.get("hasFailedRun", False)),
        workflow_id=str(result.get("workflowId")),
        run_id=cast(str | None, result.get("runId")),
        failed_nodes=failed_nodes,
        failed_node_ids=list(result.get("failedNodeIds", [])),
        failed_count=int(result.get("failedCount", len(failed_nodes))),
        created_at=cast(datetime | None, result.get("createdAt")),
    )


async def run_list(
    workflow_id: Annotated[
        str | None,
        Field(description="Optional workflow ID filter."),
    ] = None,
    status_filter: Annotated[
        str | None,
        Field(
            description=(
                "Optional status filter (pending, running, completed, "
                "failed, cancelled)."
            ),
        ),
    ] = None,
    skip: Annotated[int, Field(ge=0, description="Number of runs to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum runs to return.")] = 20,
) -> RunListResponse:
    """List runs with optional workflow/status filters and pagination."""
    await ensure_mcp_database()
    request = RunListRequest(
        workflow_id=workflow_id,
        status_filter=status_filter,
        skip=skip,
        limit=limit,
    )
    runs = await svc_list_runs(
        workflow_id=request.workflow_id,
        status_filter=request.status_filter,
        skip=request.skip,
        limit=request.limit,
    )
    items = [
        RunListItem(
            run_id=str(getattr(run, "runId")),
            workflow_id=str(getattr(run, "workflowId")),
            status=str(getattr(run, "status")),
            trigger=str(getattr(run, "trigger")),
            environment_id=cast(str | None, getattr(run, "environmentId", None)),
            created_at=cast(datetime, getattr(run, "createdAt")),
            duration_ms=cast(int | None, getattr(run, "duration", None)),
            error=cast(str | None, getattr(run, "error", None)),
        )
        for run in runs
    ]
    return RunListResponse(
        runs=items,
        total=len(items),
        has_more=len(items) == request.limit,
    )


def register_run_tools(server: FastMCP) -> None:
    """Register execution and monitoring tools."""
    server.tool(
        name="workflow_run",
        description=(
            "Trigger workflow execution with optional environment, resume config, and "
            "runtime-only secrets. Secret values are never persisted or returned."
        ),
    )(workflow_run)
    server.tool(
        name="run_get_status",
        description=(
            "Poll a run and get compact node status summaries. Full node payloads are "
            "excluded; use run_get_node_result for one node when needed."
        ),
    )(run_get_status)
    server.tool(
        name="run_get_results",
        description=(
            "Get a human-readable run result summary without request/response payloads. "
            "Use run_get_node_result for full details of a single node."
        ),
    )(run_get_results)
    server.tool(
        name="run_get_node_result",
        description=(
            "Fetch the full result for one node, including GridFS-backed results. "
            "Secret-like values are redacted from the returned payload."
        ),
    )(run_get_node_result)
    server.tool(
        name="run_latest_failed",
        description="Get latest failed run metadata and failed nodes for resume workflows.",
    )(run_latest_failed)
    server.tool(
        name="run_list",
        description=(
            "List runs with optional workflow or status filters and pagination. "
            "Returns compact run metadata without full node results."
        ),
    )(run_list)
