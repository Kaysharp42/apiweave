"""Core WorkflowExecutor class — assembles all mixins into the final executor."""

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

from app.database import get_database
from app.repositories import EnvironmentRepository, RunRepository, WorkflowRepository
from app.runner.executor._assertion import _AssertionMixin
from app.runner.executor._execution import _ExecutionMixin
from app.runner.executor._http import _HttpMixin
from app.runner.executor._http_helpers import _HttpHelpersMixin
from app.runner.executor._merge import _MergeMixin
from app.runner.executor._merge_execution import _MergeExecutionMixin
from app.runner.executor._secrets import _SecretsMixin
from app.runner.executor._status import _StatusMixin
from app.runner.executor._variables import _VariablesMixin
from app.runner.executor.context import RunContext
from app.runner.executor.logging import setup_run_logger


class WorkflowExecutor(
    _SecretsMixin,
    _VariablesMixin,
    _HttpHelpersMixin,
    _HttpMixin,
    _AssertionMixin,
    _MergeMixin,
    _MergeExecutionMixin,
    _ExecutionMixin,
    _StatusMixin,
):
    """Executes workflows node by node"""

    def __init__(
        self,
        run_id: str,
        workflow_id: str,
        runtime_secrets: dict[str, str] | None = None,
        start_node_ids: list[str] | None = None,
        resume_from_run_id: str | None = None,
        cancel_event: asyncio.Event | None = None,
        run_context: RunContext | None = None,
    ):
        self.run_id = run_id
        self.workflow_id = workflow_id
        self.start_node_ids = start_node_ids or []
        self.resume_from_run_id = resume_from_run_id
        self.cancel_event = cancel_event or asyncio.Event()
        self.results = {}
        self.context = {}  # Stores variables and results from previous nodes
        self.workflow_variables = {}  # Workflow-level variables that persist across nodes
        self.environment_variables = {}  # Environment variables from active environment
        self.secrets = {}  # Resolved scoped secrets (plaintext at runtime only)
        self._masker: Any = (
            None  # SecretMasker for value-based masking (built after secrets resolve)
        )
        self.continue_on_fail = False  # Workflow setting: whether to continue on API failure
        self.start_time = None  # Track workflow execution start time
        self.branch_results = {}  # Track merged branch results per merge node: {merge_node_id: [(node_id, result), ...]}
        self.current_branch_context = []  # Current branch context for prev[N] variable substitution
        self.logger = setup_run_logger(run_id)  # Setup logger for this run
        self.merge_locks = {}  # Locks for merge nodes to prevent race conditions: {merge_node_id: asyncio.Lock}
        self.merge_completed = {}  # Track which merge nodes have completed: {merge_node_id: bool}
        self.has_failures = False  # Track if any node has failed during execution
        self.failed_nodes = []  # List of node IDs that failed
        self.first_error_message = None  # Store the first error message for the run

        # Wave 3: scoped run context
        self.run_context = run_context

        # Reject runtime_secrets — they are forbidden in the scoped model
        if runtime_secrets:
            raise ValueError(
                "runtime_secrets field is rejected. "
                "All secrets must be stored before runs and are resolved through "
                "the scoped Environment > Workspace > Organization chain."
            )

    def cancel(self) -> None:
        """Signal the executor to stop at the next safe point."""
        self.cancel_event.set()
        self.logger.info("Cancellation requested for run %s", self.run_id)

    async def _check_cancelled(self) -> bool:
        """Check if cancellation has been requested. Returns True if cancelled."""
        if self.cancel_event.is_set():
            self.logger.info("Run %s cancelled at checkpoint", self.run_id)
            return True
        return False

    async def execute(self):
        """Execute the workflow using Beanie repositories (SQL injection safe)"""
        db = get_database()  # Still needed for GridFS and node_results

        self.logger.info(f"Starting execution for workflow {self.workflow_id}")

        # Get workflow and run using repositories (type-safe)
        workflow_doc = await WorkflowRepository.get_by_id(self.workflow_id)
        if not workflow_doc:
            self.logger.error(f"Workflow {self.workflow_id} not found")
            raise Exception(f"Workflow {self.workflow_id} not found")

        run_doc = await RunRepository.get_by_id(self.run_id)
        if not run_doc:
            self.logger.error(f"Run {self.run_id} not found")
            raise Exception(f"Run {self.run_id} not found")

        self.logger.info(f"Workflow loaded: {workflow_doc.name}")

        # Convert Beanie Documents to dicts for backward compatibility with existing execution logic
        workflow = workflow_doc.model_dump(by_alias=True)
        run = run_doc.model_dump(by_alias=True)

        # Initialize workflow variables from the workflow definition
        self.workflow_variables = (
            workflow.get("variables", {}).copy() if workflow.get("variables") else {}
        )
        self.logger.debug(f"Initialized workflow variables: {self.workflow_variables}")

        # Build node/edge map early (used for resume context hydration)
        nodes = {node["nodeId"]: node for node in workflow["nodes"]}
        edges = workflow["edges"]

        # Load environment variables from the run's specified environment
        environment_id = run.get("environmentId") or run.get("selectedEnvironmentId")
        if self.run_context and self.run_context.environment_id:
            environment_id = self.run_context.environment_id

        if environment_id:
            environment_doc = await EnvironmentRepository.get_by_id(environment_id)
            if environment_doc:
                self.environment_variables = (
                    dict(environment_doc.variables) if environment_doc.variables else {}
                )
                self.secrets = await EnvironmentRepository.get_decrypted_secrets(environment_id)
                self._rebuild_masker()
                self.logger.info(
                    f"Loaded environment: {environment_doc.name} (ID: {environment_id}) with {len(self.environment_variables)} variables and {len(self.secrets)} secrets"
                )
                self.logger.debug(f"Environment variables: {self.environment_variables}")
            else:
                self.logger.warning(
                    f"Environment {environment_id} not found, continuing without environment variables"
                )
        else:
            self.logger.info("No environment specified for this run")

        # Wave 3: resolve scoped secrets through the override chain
        # Environment > Workspace > Organization
        if self.run_context:
            await self._collect_and_resolve_secrets(workflow)

        # Load workflow settings
        settings = workflow.get("settings", {})
        self.continue_on_fail = settings.get("continueOnFail", False)

        # Track start time for duration calculation
        self.start_time = time.time()

        # Optional resume context hydration from a previous failed run
        if self.resume_from_run_id:
            await self._hydrate_resume_context(db, nodes, edges)

        # Update run status to running using repository
        await RunRepository.update_status(self.run_id, "running")

        # Resolve entry node(s)
        entry_node_ids = [node_id for node_id in self.start_node_ids if node_id in nodes]
        if not entry_node_ids:
            start_node = next((n for n in workflow["nodes"] if n["type"] == "start"), None)
            if not start_node:
                await self._fail_run("No start node found")
                return
            entry_node_ids = [start_node["nodeId"]]

        try:
            # Check for cancellation before starting execution
            if await self._check_cancelled():
                await RunRepository.update_status(self.run_id, "cancelled")
                return

            # Execute from one or more entry nodes
            if len(entry_node_ids) == 1:
                await self._execute_from_node(entry_node_ids[0], nodes, edges, db)
            else:
                tasks = [
                    self._execute_from_node(node_id, nodes, edges, db) for node_id in entry_node_ids
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for result in results:
                    if isinstance(result, Exception):
                        self.has_failures = True
                        if not self.first_error_message:
                            self.first_error_message = str(result)
                        if not self.continue_on_fail:
                            raise result

            # Calculate total run duration
            end_time = time.time()
            duration_ms = int(
                round((end_time - self.start_time) * 1000)
            )  # Convert to int milliseconds

            # Determine final status based on failures
            final_status = "failed" if self.has_failures else "completed"

            # Check if run was cancelled during execution — do not overwrite
            run_doc = await RunRepository.get_by_id(self.run_id)
            if run_doc and run_doc.status == "cancelled":
                self.logger.info(
                    "Run %s was cancelled during execution, skipping status update", self.run_id
                )
                return

            # Mark run as completed using repository
            try:
                update_data = {
                    "status": final_status,
                    "completedAt": datetime.now(UTC),
                    "duration": duration_ms,
                    "variables": self.workflow_variables,
                }

                # Add failed nodes info if there were failures
                if self.has_failures:
                    update_data["failedNodes"] = self.failed_nodes
                    update_data["failureMessage"] = (
                        f"{len(self.failed_nodes)} node(s) failed during execution"
                    )
                    # Add error message from first failed node
                    if self.first_error_message:
                        update_data["error"] = self.first_error_message

                await RunRepository.update_fields(self.run_id, **update_data)

                if self.has_failures:
                    self.logger.error(
                        f"⚠️  Workflow completed with failures: {len(self.failed_nodes)} node(s) failed"
                    )
                    for node_id in self.failed_nodes:
                        self.logger.info(f"   - {node_id}")
            except Exception as update_error:
                self.logger.error(f"⚠️  Failed to update run completion status: {str(update_error)}")
                self.logger.info("   Run completed, but status update failed")
                # Don't fail the run just because status update failed

        except Exception as e:
            # Only fail if actual execution error (not document size issues)
            if "document too large" not in str(e).lower():
                await self._fail_run(str(e))
            else:
                self.logger.error(f"⚠️  Run completed but encountered document size issue: {str(e)}")
                self.logger.info("   All results are safely stored in node_results collection")
