"""Mixin: execution flow methods for WorkflowExecutor."""

import asyncio
import json

from app.repositories import RunRepository
from app.runner.executor._stop_branch import _StopBranch


class _ExecutionMixin:
    """Execution flow: hydrate resume, execute from node, branch, and node dispatch."""

    async def _hydrate_resume_context(self, db, nodes: dict, edges: list):
        """Hydrate execution context from a previous run for resume support."""
        from app.runner.executor import AsyncIOMotorGridFSBucket

        source_run = await RunRepository.get_by_id(self.resume_from_run_id)
        if not source_run or source_run.workflowId != self.workflow_id:
            raise Exception("Invalid resume source run")

        # Build resume lineage so repeated failed resumes can still hydrate from
        # earlier attempts where context/results were available.
        lineage = []
        seen_run_ids = set()
        current = source_run
        while (
            current and current.workflowId == self.workflow_id and current.runId not in seen_run_ids
        ):
            lineage.append(current)
            seen_run_ids.add(current.runId)
            parent_run_id = getattr(current, "resumeFromRunId", None)
            if not parent_run_id:
                break
            current = await RunRepository.get_by_id(parent_run_id)

        # Process from oldest -> newest so newer attempts can override values.
        lineage.reverse()

        for run_doc in lineage:
            if run_doc.variables:
                self.workflow_variables.update(run_doc.variables)

        ordered_node_ids = []
        result_cache = {}
        gridfs_bucket = AsyncIOMotorGridFSBucket(db)

        for run_doc in lineage:
            failed_nodes = set(run_doc.failedNodes or [])
            statuses = run_doc.nodeStatuses or {}

            status_items = sorted(
                statuses.items(),
                key=lambda item: item[1].get("timestamp") or "",
            )

            for node_id, _status_meta in status_items:
                if node_id in failed_nodes:
                    continue

                stored = await db.node_results.find_one({"runId": run_doc.runId, "nodeId": node_id})
                if not stored:
                    continue

                result = stored.get("result")
                if stored.get("stored_in_gridfs") and stored.get("gridfs_file_id"):
                    try:
                        from bson import ObjectId

                        file_id = ObjectId(stored.get("gridfs_file_id"))
                        stream = await gridfs_bucket.open_download_stream(file_id)
                        data = await stream.read()
                        result = json.loads(data.decode("utf-8"))
                    except Exception as read_error:
                        self.logger.warning(
                            f"Failed to read GridFS result for {node_id}: {read_error}"
                        )
                        continue

                if not isinstance(result, dict):
                    continue

                node_type = nodes.get(node_id, {}).get("type")
                if node_type:
                    result["type"] = node_type

                if node_id not in result_cache:
                    ordered_node_ids.append(node_id)
                result_cache[node_id] = result

        # Preserve ordering for non-indexed prev references.
        for node_id in ordered_node_ids:
            self.results[node_id] = result_cache[node_id]

        # Rebuild merge branch contexts from hydrated results.
        for node in nodes.values():
            if node.get("type") != "merge":
                continue

            merge_node_id = node.get("nodeId")
            incoming_edges = [edge for edge in edges if edge.get("target") == merge_node_id]
            predecessor_results = []

            for edge in incoming_edges:
                predecessor_id = edge.get("source")
                data_node_id = self._find_data_producing_ancestor(predecessor_id, edges, nodes)
                result = self.results.get(data_node_id)
                if isinstance(result, dict) and result.get("type") == "http-request":
                    predecessor_results.append((data_node_id, result))

            if predecessor_results:
                self.branch_results[merge_node_id] = predecessor_results

        self.logger.info(
            "Resume context hydrated from run %s: lineageDepth=%d, results=%d, mergeContexts=%d",
            self.resume_from_run_id,
            len(lineage),
            len(self.results),
            len(self.branch_results),
        )

    async def _execute_from_node(self, node_id: str, nodes: dict, edges: list, db):
        """Execute starting from a specific node"""
        node = nodes.get(node_id)
        if not node:
            return

        if await self._check_cancelled():
            return

        self.logger.info(f"\n{'=' * 60}")
        self.logger.info(f"Executing node: {node_id} ({node.get('type', 'unknown')})")
        self.logger.info(f"{'=' * 60}")

        # Set branch context before executing this node
        # If the previous node was a merge, use its merged branch results
        incoming_edges = [e for e in edges if e["target"] == node_id]
        if incoming_edges:
            # Check if any predecessor is a merge node
            for edge in incoming_edges:
                pred_id = edge["source"]
                if pred_id in self.branch_results:
                    # This node's predecessor is a merge node
                    # IMPORTANT: Only set branch context if THIS node is branching (multiple outgoing edges)
                    # If this node is linear (single outgoing edge), clear the context
                    next_edges_from_node = [e for e in edges if e["source"] == node_id]

                    if len(next_edges_from_node) > 1:
                        # This node will branch - use the merge node's branch results as context
                        self.current_branch_context = self.branch_results[pred_id]
                        branch_node_ids = [nid for nid, _ in self.current_branch_context]
                        self.logger.info(f"📍 Setting branch context for {node_id}")
                        self.logger.info(f"   Source: merge node {pred_id}")
                        self.logger.info(f"   Branches: {branch_node_ids}")
                        self.logger.info(
                            f"📍 Setting branch context for {node_id}: {len(self.current_branch_context)} branches from merge {pred_id}"
                        )
                    else:
                        # This node is linear (single edge out) - clear branch context
                        # The merge has been handled, now execute linearly
                        self.current_branch_context = []
                        self.logger.info(
                            f"🔀 Clearing branch context for linear node {node_id} after merge {pred_id}"
                        )
                        self.logger.info(
                            f"🔀 Clearing branch context after merge - executing {node_id} linearly"
                        )
                    break

        # Skip start node execution
        if node["type"] != "start":
            try:
                node_exec_result = await self._execute_node(node, edges, db)
                # If node execution returned a signal to not continue downstream, stop here
                if (
                    isinstance(node_exec_result, dict)
                    and node_exec_result.get("shouldContinue") is False
                ):
                    self.logger.info(f"➡️  Node {node_id} signalled to stop downstream execution")
                    return
            except _StopBranch:
                # Always re-raise _StopBranch (intentional stop from continue_on_fail=False)
                raise
            except Exception as e:
                # Mark as failure
                self.has_failures = True
                if node_id not in self.failed_nodes:
                    self.failed_nodes.append(node_id)

                # Capture first error message
                if not self.first_error_message:
                    self.first_error_message = str(e)

                # If continue_on_fail is False, re-raise the exception to stop the workflow
                if not self.continue_on_fail:
                    raise
                # If continue_on_fail is True, log the error and continue
                self.logger.error(
                    f"⚠️  Node {node_id} failed but continuing due to 'continueOnFail' setting: {str(e)}"
                )
        # Find next nodes (outgoing edges from this node)
        next_edges = [e for e in edges if e["source"] == node_id]

        if not next_edges:
            return  # No more nodes to execute

        # Assertion node routing: filter edges by assertionOutcome → sourceHandle
        if node["type"] == "assertion" and node_id in self.results:
            assertion_result = self.results[node_id]
            outcome = assertion_result.get("assertionOutcome", "pass")  # 'pass' or 'fail'

            # Separate edges with sourceHandle from legacy edges (no sourceHandle)
            handle_edges = [e for e in next_edges if e.get("sourceHandle") in ("pass", "fail")]
            legacy_edges = [e for e in next_edges if not e.get("sourceHandle")]

            if handle_edges:
                # New dual-output mode: route to matching handle only
                matching = [e for e in handle_edges if e.get("sourceHandle") == outcome]
                if matching:
                    next_edges = matching
                    self.logger.info(
                        f"🔀 Assertion {node_id} outcome='{outcome}' → routing to {len(matching)} edge(s)"
                    )
                    self.logger.info(
                        f"🔀 Assertion {node_id} outcome='{outcome}' → routing to {len(matching)} edge(s)"
                    )
                else:
                    # No matching handle edge — no downstream path for this outcome
                    self.logger.info(
                        f"🔀 Assertion {node_id} outcome='{outcome}' — no '{outcome}' edge connected, stopping branch"
                    )
                    self.logger.info(
                        f"🔀 Assertion {node_id} outcome='{outcome}' — no '{outcome}' edge connected"
                    )
                    # If assertions failed and there's no fail path, still mark as failure
                    if outcome == "fail":
                        self.has_failures = True
                        if node_id not in self.failed_nodes:
                            self.failed_nodes.append(node_id)
                    return
            elif legacy_edges:
                # Backward compatibility: old assertion nodes with single handle
                # Fail = raise exception (original behavior)
                if outcome == "fail":
                    error_msg = assertion_result.get("message", "Assertion failed")
                    self.has_failures = True
                    if node_id not in self.failed_nodes:
                        self.failed_nodes.append(node_id)
                    if not self.continue_on_fail:
                        raise Exception(error_msg)
                    self.logger.error(
                        f"⚠️  Assertion {node_id} failed (legacy mode) but continuing: {error_msg}"
                    )
                next_edges = legacy_edges

        # If multiple edges (branching), execute in parallel
        if len(next_edges) > 1:
            self.logger.info(
                f"🌳 Branching detected from node {node_id}: {len(next_edges)} branches"
            )
            self.logger.info(
                f"🌳 Branching detected from node {node_id}: {len(next_edges)} branches"
            )
            # Only clear branch context if NOT branching from a merge node
            # Branches from a merge should inherit the merge's branch context
            if node["type"] != "merge":
                self.current_branch_context = []
                self.logger.info(
                    f"   Cleared branch context - starting fresh branches from {node['type']}"
                )
                self.logger.info(
                    f"   Cleared branch context - starting fresh branches from {node['type']}"
                )
            else:
                branch_node_ids = [nid for nid, _ in self.current_branch_context]
                self.logger.info(f"   Keeping branch context from merge node: {branch_node_ids}")
                self.logger.info(
                    f"   Keeping branch context from merge node ({len(self.current_branch_context)} branches)"
                )
            # Create tasks for parallel execution
            tasks = []
            for edge in next_edges:
                next_node_id = edge["target"]
                next_node = nodes.get(next_node_id)

                # Skip end nodes in branching
                if next_node and next_node["type"] != "end":
                    tasks.append(self._execute_branch(next_node_id, nodes, edges, db))

            # Execute all branches in parallel - allow independent failures
            if tasks:
                # Use return_exceptions=True to let branches fail independently
                results = await asyncio.gather(*tasks, return_exceptions=True)

                # Check results and identify failed branches
                failed_branches = []
                for i, result in enumerate(results):
                    if isinstance(result, Exception):
                        failed_branches.append(i)
                        branch_edge = next_edges[i]
                        branch_node_id = branch_edge["target"]
                        self.logger.warning(
                            f"⚠️  Branch {i} (starting at {branch_node_id}) failed: {str(result)}"
                        )
                        self.logger.error(
                            f"⚠️  Branch {i} (starting at {branch_node_id}) failed: {str(result)}"
                        )
                        # Mark as failure but don't stop other branches
                        self.has_failures = True
                        if branch_node_id not in self.failed_nodes:
                            self.failed_nodes.append(branch_node_id)

                        # Capture first error message
                        if not self.first_error_message:
                            self.first_error_message = str(result)

                # Only raise exception if ALL branches failed and continueOnFail is False
                if failed_branches and len(failed_branches) == len(tasks):
                    error_msg = f"All {len(tasks)} branches failed"
                    self.logger.error(error_msg)
                    self.logger.error(f"❌ {error_msg}")
                    if not self.continue_on_fail:
                        raise Exception(error_msg)
                elif failed_branches:
                    success_count = len(tasks) - len(failed_branches)
                    self.logger.info(
                        f"✅ {success_count}/{len(tasks)} branches succeeded, {len(failed_branches)} failed"
                    )
                    self.logger.info(
                        f"✅ {success_count}/{len(tasks)} branches succeeded, {len(failed_branches)} failed"
                    )
        else:
            # Single edge - sequential execution (original behavior)
            edge = next_edges[0]
            next_node_id = edge["target"]
            next_node = nodes.get(next_node_id)

            # Skip end node
            if next_node and next_node["type"] != "end":
                try:
                    await self._execute_from_node(next_node_id, nodes, edges, db)
                except _StopBranch:
                    # Always re-raise _StopBranch (intentional stop from continue_on_fail=False)
                    raise
                except Exception as e:
                    # Mark as failure
                    self.has_failures = True
                    if next_node_id not in self.failed_nodes:
                        self.failed_nodes.append(next_node_id)

                    # Capture first error message
                    if not self.first_error_message:
                        self.first_error_message = str(e)

                    # If continue_on_fail is False, re-raise the exception to stop the workflow
                    if not self.continue_on_fail:
                        raise
                    # If continue_on_fail is True, log the error and continue
                    self.logger.error(
                        f"⚠️  Node {next_node_id} failed but continuing due to 'continueOnFail' setting: {str(e)}"
                    )

    async def _execute_branch(self, node_id: str, nodes: dict, edges: list, db):
        """Execute a branch (for parallel execution)"""
        self.logger.info(f"🔀 Executing branch starting from node {node_id}")
        await self._execute_from_node(node_id, nodes, edges, db)

    async def _execute_node(self, node: dict, edges: list, db):
        """Execute a single node"""
        node_id = node["nodeId"]
        node_type = node["type"]

        self.logger.info(f"🔄 Executing node: {node_id} ({node_type})")
        # Update node status to running
        await self._update_node_status(db, node_id, "running", None)

        execution_status = None  # Track if result was successfully stored
        try:
            if node_type == "http-request":
                # Diagnostic logging: capture branch context and branch_results at time of HTTP execution
                try:
                    self.logger.debug(
                        f"[DIAG] Executing HTTP node {node_id}. current_branch_context size={len(self.current_branch_context)}"
                    )
                    self.logger.debug(
                        f"[DIAG] current_branch_context IDs={[nid for nid, _ in self.current_branch_context]}"
                    )
                    self.logger.debug(
                        f"[DIAG] branch_results keys={list(self.branch_results.keys())}"
                    )
                    self.logger.info(
                        f"[DIAG] HTTP {node_id} - branch_context={len(self.current_branch_context)} keys={list(self.branch_results.keys())}"
                    )
                except Exception:
                    # Ensure diagnostics never break execution
                    pass
                result = await self._execute_http_request(node)
            elif node_type == "delay":
                result = await self._execute_delay(node)
            elif node_type == "assertion":
                result = await self._execute_assertion(node)
            elif node_type == "merge":
                result = await self._execute_merge(node, edges, db)
            else:
                result = {"status": "skipped", "message": f"Unknown node type: {node_type}"}

            # Determine the execution status based on the result
            execution_status = result.get("status", "success")

            # Map result status to execution status
            if execution_status in ["client_error", "server_error", "error"]:
                execution_status = "error"
                # Mark as failure
                self.has_failures = True
                if node_id not in self.failed_nodes:
                    self.failed_nodes.append(node_id)
                if result.get("statusCode"):
                    self.logger.error(
                        f"⚠️  HTTP request failed: {node_id} returned status code {result.get('statusCode')}"
                    )
                else:
                    self.logger.error(
                        f"⚠️  Node failed: {node_id} - {result.get('error', 'Unknown error')}"
                    )
            elif execution_status == "redirect":
                execution_status = "warning"
            elif execution_status == "failed" and node_type == "assertion":
                # Assertion failure — keep "error" UI status but do NOT raise.
                # The routing logic in _execute_from_node will handle pass/fail branching.
                execution_status = "error"
                self.logger.info(f"⚠️  Assertion {node_id} has failures — routing will decide path")
                self.logger.error(f"⚠️  Assertion {node_id} has failures — routing will decide path")
            elif execution_status == "success":
                execution_status = "success"
            else:
                execution_status = "success"  # Default for other statuses

            # Later branches arriving at an already-completed merge must NOT overwrite its status —
            # the first branch wrote the authoritative success/failure that drives the UI highlight.
            if isinstance(result, dict) and result.get("mergedByOther"):
                return {"shouldContinue": False}

            # Update node status with full result (MUST happen BEFORE raising exception)
            await self._update_node_status(db, node_id, execution_status, result)

            # Store result with node type for filtering later
            result["type"] = node_type  # Add node type to result
            self.results[node_id] = result

            # Handle failures based on continue_on_fail setting
            # If continue_on_fail is False, stop execution on any error
            # If continue_on_fail is True, allow failures to continue (for merge node evaluation)
            # Assertion nodes are exempt — their pass/fail routing is handled in _execute_from_node
            if (
                execution_status == "error"
                and node_type != "assertion"
                and not self.continue_on_fail
            ):
                error_msg = result.get("error", f"Node {node_id} failed")
                if result.get("statusCode"):
                    error_msg = (
                        f"HTTP {result.get('statusCode')}: {result.get('url', 'unknown URL')}"
                    )
                # Mark as failure before raising
                self.has_failures = True
                if node_id not in self.failed_nodes:
                    self.failed_nodes.append(node_id)
                # Log that we're stopping this branch
                self.logger.error(
                    f"🛑 Stopping branch at {node_id} due to failure (continue_on_fail=False)"
                )
                self.logger.error(f"🛑 Stopping branch at {node_id}: {error_msg}")
                # Raise a specific exception type that won't be caught by our error handler
                raise _StopBranch(error_msg)

        except _StopBranch:
            # Re-raise _StopBranch (intentional stop due to continue_on_fail=False)
            raise
        except Exception as e:
            # For errors that occur during node execution (not HTTP status code errors)
            # store error message and re-raise
            if node_type == "http-request":
                # HTTP requests return error results, shouldn't raise exceptions
                # If we get here, it's an unexpected error
                error = {"error": str(e), "status": "error"}
                await self._update_node_status(db, node_id, "error", error)
                self.results[node_id] = error
                self.failed_nodes.append(node_id)
                # Don't re-raise - allow execution to continue to downstream nodes
                self.logger.error(f"❌ HTTP request {node_id} had unexpected error: {str(e)}")
                return {"shouldContinue": True}
            else:
                # For other types of errors, store error message and re-raise
                error = {"error": str(e), "status": "error"}
                await self._update_node_status(db, node_id, "error", error)
                self.results[node_id] = error
                self.failed_nodes.append(node_id)
                raise

        # Normal completion -> allow downstream execution
        return {"shouldContinue": True}
