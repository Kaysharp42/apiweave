"""Mixin: merge node execution logic for WorkflowExecutor."""

import asyncio
from datetime import UTC, datetime
from typing import Any


class _MergeExecutionMixin:
    async def _execute_merge(self, node: dict, edges: list, db) -> dict[str, Any]:
        """Execute merge node - combines results from multiple branches"""
        merge_strategy = node.get("config", {}).get("mergeStrategy", "all")
        conditions = node.get("config", {}).get("conditions", [])
        node_id = node["nodeId"]

        # Create a lock for this merge node if it doesn't exist
        if node_id not in self.merge_locks:
            self.merge_locks[node_id] = asyncio.Lock()

        # Check if already completed BEFORE acquiring lock (fast path)
        if node_id in self.merge_completed:
            self.logger.info(f"⏭️  Merge node {node_id} already completed, skipping")
            self.logger.info(f"⏭️  Merge node {node_id} already completed by another branch")
            # Return a marker that indicates merge was completed by another branch
            return {"mergedByOther": True, "result": self.results.get(node_id)}

        # Find predecessor nodes (incoming edges to this merge node)
        incoming_edges = [e for e in edges if e["target"] == node_id]
        predecessor_node_ids = [e["source"] for e in incoming_edges]

        # Strategy-based waiting logic
        if merge_strategy == "all":
            # Wait for ALL predecessors to complete OR fail BEFORE acquiring lock
            missing_predecessors = [
                pred_id
                for pred_id in predecessor_node_ids
                if pred_id not in self.results and pred_id not in self.failed_nodes
            ]
            if missing_predecessors:
                self.logger.info(
                    f"⏳ [ALL] Branch waiting for {len(missing_predecessors)} predecessors: {missing_predecessors}"
                )
                self.logger.info(
                    f"⏳ [ALL strategy] Branch waiting for {len(missing_predecessors)} predecessors before merge"
                )
                max_wait = 30  # seconds
                wait_interval = 0.1  # seconds
                elapsed = 0

                while missing_predecessors and elapsed < max_wait:
                    if await self._check_cancelled():
                        return {
                            "status": "cancelled",
                            "message": "Merge cancelled while waiting for predecessors",
                        }
                    await asyncio.sleep(wait_interval)
                    elapsed += wait_interval
                    missing_predecessors = [
                        pred_id
                        for pred_id in predecessor_node_ids
                        if pred_id not in self.results and pred_id not in self.failed_nodes
                    ]

                if missing_predecessors:
                    error_msg = f"Timeout waiting for predecessors: {missing_predecessors}"
                    self.logger.error(f"❌ {error_msg}")
                    raise Exception(error_msg)

                # Check if any required predecessors failed
                failed_predecessors = [
                    pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes
                ]
                if failed_predecessors:
                    error_msg = f"Cannot merge: {len(failed_predecessors)} predecessor(s) failed: {failed_predecessors}"
                    self.logger.error(f"❌ {error_msg}")
                    self.logger.error(f"❌ [ALL strategy] {error_msg}")
                    raise Exception(error_msg)

                self.logger.info("✓ All predecessors completed, proceeding to merge")
                self.logger.info(f"✓ All {len(predecessor_node_ids)} predecessors completed")
        elif merge_strategy in ["any", "first"]:
            # For ANY/FIRST: Continue as soon as at least ONE predecessor completes successfully
            # No waiting needed - first successful branch to arrive triggers merge
            completed_predecessors = [
                pred_id for pred_id in predecessor_node_ids if pred_id in self.results
            ]
            failed_predecessors = [
                pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes
            ]

            if not completed_predecessors:
                # No successful predecessors yet
                self.logger.warning(
                    f"⚠️  [ANY/FIRST] No predecessors completed successfully yet ({len(failed_predecessors)} failed)"
                )
                self.logger.error(
                    "⚠️  [ANY/FIRST strategy] No successful predecessors ready, waiting..."
                )
                # Wait for at least one successful completion
                max_wait = 30
                wait_interval = 0.1
                elapsed = 0

                while not completed_predecessors and elapsed < max_wait:
                    if await self._check_cancelled():
                        return {
                            "status": "cancelled",
                            "message": "Merge cancelled while waiting for predecessors",
                        }
                    await asyncio.sleep(wait_interval)
                    elapsed += wait_interval
                    completed_predecessors = [
                        pred_id for pred_id in predecessor_node_ids if pred_id in self.results
                    ]
                    failed_predecessors = [
                        pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes
                    ]

                    # If all branches have finished (success or failure), stop waiting
                    if len(completed_predecessors) + len(failed_predecessors) == len(
                        predecessor_node_ids
                    ):
                        break

                if not completed_predecessors:
                    error_msg = f"All {len(predecessor_node_ids)} branches failed or timed out"
                    self.logger.error(f"❌ {error_msg}")
                    self.logger.error(f"❌ [ANY/FIRST strategy] {error_msg}")
                    raise Exception(error_msg)

            self.logger.info(
                f"⚡ [{merge_strategy.upper()}] {len(completed_predecessors)}/{len(predecessor_node_ids)} predecessors completed ({len(failed_predecessors)} failed), proceeding"
            )
            self.logger.info(
                f"⚡ [{merge_strategy.upper()} strategy] Proceeding with {len(completed_predecessors)} successful branch(es), {len(failed_predecessors)} failed"
            )
        elif merge_strategy == "conditional":
            # For CONDITIONAL: Wait for all like 'all' strategy, but FAIL if any predecessor failed
            missing_predecessors = [
                pred_id for pred_id in predecessor_node_ids if pred_id not in self.results
            ]
            if missing_predecessors:
                self.logger.info(
                    f"⏳ [CONDITIONAL] Waiting for {len(missing_predecessors)} predecessors"
                )
                self.logger.info(
                    "⏳ [CONDITIONAL strategy] Waiting for all branches to evaluate conditions"
                )
                max_wait = 30
                wait_interval = 0.1
                elapsed = 0

                while missing_predecessors and elapsed < max_wait:
                    if await self._check_cancelled():
                        return {
                            "status": "cancelled",
                            "message": "Merge cancelled while waiting for predecessors",
                        }
                    await asyncio.sleep(wait_interval)
                    elapsed += wait_interval
                    missing_predecessors = [
                        pred_id for pred_id in predecessor_node_ids if pred_id not in self.results
                    ]

                if missing_predecessors:
                    error_msg = f"Timeout waiting for predecessors: {missing_predecessors}"
                    self.logger.error(f"❌ {error_msg}")
                    raise Exception(error_msg)

            # Check if any predecessor FAILED - conditional merge should fail if ANY input failed
            failed_predecessors = [
                pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes
            ]
            if failed_predecessors:
                error_msg = f"Cannot merge: {len(failed_predecessors)} predecessor(s) failed: {failed_predecessors}"
                self.logger.error(f"❌ {error_msg}")
                self.logger.error(f"❌ [CONDITIONAL strategy] {error_msg}")
                raise Exception(error_msg)

        # Now acquire lock to execute merge logic
        async with self.merge_locks[node_id]:
            # Double-check if completed (another branch may have finished while we waited)
            if node_id in self.merge_completed:
                self.logger.info(f"⏭️  Merge node {node_id} completed by another branch")
                self.logger.info(f"⏭️  Merge node {node_id} completed by another branch")
                # Return marker to prevent downstream execution from this branch
                return {"mergedByOther": True, "result": self.results.get(node_id)}

            self.logger.info(
                f"🔀 Merge node {node_id} executing with {len(predecessor_node_ids)} predecessors"
            )
            self.logger.info(
                f"🔀 Merge node {node_id} has {len(predecessor_node_ids)} predecessors: {predecessor_node_ids}"
            )
            # Get only the predecessor results (not ALL results)
            # For each predecessor, find the nearest data-producing ancestor
            all_predecessor_results = []
            failed_results = []  # Track which predecessors have error status

            for pred_id in predecessor_node_ids:
                # Find the actual data-producing node (skip delay, assertion, etc.)
                data_node_id = self._find_data_producing_ancestor(pred_id, edges, {})

                if data_node_id in self.results:
                    result = self.results[data_node_id]
                    # Only include if it's a data-producing node
                    if result.get("type") == "http-request":
                        # Check if this result has an error status
                        if result.get("status") == "error":
                            failed_results.append((data_node_id, result))
                            self.logger.warning(
                                f"   Branch from {pred_id} → data node {data_node_id} FAILED (status: error)"
                            )
                            self.logger.error(
                                f"   ❌ Branch from {pred_id} → data node {data_node_id} FAILED (error result)"
                            )
                        else:
                            all_predecessor_results.append((data_node_id, result))
                            self.logger.info(
                                f"   Branch from {pred_id} → data node: {data_node_id}"
                            )
                            self.logger.info(
                                f"   ✓ Branch from {pred_id} → data node: {data_node_id}"
                            )
                    else:
                        self.logger.warning(
                            f"   Branch from {pred_id} → no data node found (type: {result.get('type')})"
                        )
                else:
                    self.logger.warning(f"   Branch from {pred_id} → no data node found")

            # For 'all' and 'conditional' strategies, reject if ANY branch failed
            if merge_strategy in ["all", "conditional"] and failed_results:
                failed_node_ids = [nid for nid, _ in failed_results]
                error_msg = (
                    f"Cannot merge: {len(failed_results)} branch(es) failed: {failed_node_ids}"
                )
                self.logger.error(f"❌ {error_msg}")
                self.logger.error(f"❌ [{merge_strategy.upper()} strategy] {error_msg}")
                self.merge_completed[node_id] = True
                raise Exception(error_msg)

            # Apply strategy-specific filtering
            if merge_strategy == "first":
                # FIRST: Use only the first completed branch (earliest by completion time)
                if all_predecessor_results:
                    # Find the branch with earliest completion
                    first_branch = min(
                        all_predecessor_results,
                        key=lambda x: (
                            x[1].get("duration", 0) if x[1].get("duration") else float("inf")
                        ),
                    )
                    predecessor_results = [first_branch]
                    self.logger.info(f"🏃 [FIRST] Selected fastest branch: {first_branch[0]}")
                    self.logger.info(f"🏃 [FIRST strategy] Using fastest branch: {first_branch[0]}")
                else:
                    predecessor_results = []

            elif merge_strategy == "any":
                # ANY: Use all completed branches (may be subset if not all completed yet)
                predecessor_results = all_predecessor_results
                self.logger.info(f"⚡ [ANY] Using {len(predecessor_results)} completed branch(es)")
                self.logger.info(
                    f"⚡ [ANY strategy] Using {len(predecessor_results)} completed branch(es)"
                )
            else:
                # ALL or CONDITIONAL: Use all branches
                predecessor_results = all_predecessor_results

            branch_count = len(predecessor_results)

            # Create a mapping of branch index to node info for user reference
            branch_info = []
            for idx, (pred_node_id, result) in enumerate(predecessor_results):
                branch_info.append(
                    {
                        "index": idx,
                        "nodeId": pred_node_id,
                        "label": result.get("label", pred_node_id),
                        "url": result.get("url", "N/A"),
                        "statusCode": result.get("statusCode", "N/A"),
                    }
                )

            # For conditional merge, filter branches based on conditions
            if merge_strategy == "conditional" and conditions:
                condition_logic = node.get("config", {}).get(
                    "conditionLogic", "OR"
                )  # Default to OR for backward compatibility
                merged_branches = []
                failed_branches = []  # Track branches that failed conditions

                self.logger.info(f"🎯 Evaluating conditions with {condition_logic} logic")
                self.logger.info(
                    f"🎯 Evaluating {len(conditions)} condition(s) with {condition_logic} logic"
                )
                # Track which branches have conditions defined
                set(cond.get("branchIndex", 0) for cond in conditions)

                # Evaluate each branch against all conditions
                for branch_idx, (pred_node_id, branch_result) in enumerate(predecessor_results):
                    branch_matches = []
                    has_conditions = False
                    failed_condition_details = []

                    for cond_idx, condition in enumerate(conditions):
                        branch_index = condition.get("branchIndex", 0)
                        field = condition.get("field", "statusCode")
                        operator = condition.get("operator", "equals")
                        expected_value = condition.get("value", "")

                        # Only evaluate conditions for this specific branch
                        if branch_index == branch_idx:
                            has_conditions = True

                            # Substitute variables in field (supports {{prev[N]...}} and {{variables...}})
                            field = self._substitute_variables(str(field))

                            # Substitute variables in expected value (supports {{prev[N]...}} and {{variables...}})
                            expected_value = self._substitute_variables(str(expected_value))

                            # Extract the actual value from the branch result
                            actual_value = self._get_nested_value(branch_result, field)

                            # Evaluate the condition
                            matches = self._compare_values(actual_value, operator, expected_value)
                            branch_matches.append(matches)

                            if matches:
                                self.logger.info(
                                    f"  ✓ Branch {branch_idx} ({pred_node_id}) matched condition {cond_idx + 1}: {field} {operator} {expected_value}"
                                )
                                self.logger.info(
                                    f"  ✓ Branch {branch_idx} ({pred_node_id}) matched: {field} {operator} {expected_value}"
                                )
                            else:
                                self.logger.info(
                                    f"  ✗ Branch {branch_idx} ({pred_node_id}) did NOT match condition {cond_idx + 1}: {field} {operator} {expected_value} (got {actual_value})"
                                )
                                self.logger.info(
                                    f"  ✗ Branch {branch_idx} ({pred_node_id}) did NOT match: {field} {operator} {expected_value} (got {actual_value})"
                                )
                                failed_condition_details.append(
                                    {
                                        "field": field,
                                        "operator": operator,
                                        "expected": expected_value,
                                        "actual": actual_value,
                                    }
                                )

                    # Decide if branch should be merged based on logic
                    if has_conditions:
                        # This branch has conditions - evaluate them
                        if condition_logic == "AND":
                            # AND: All conditions for this branch must match
                            if all(branch_matches):
                                merged_branches.append(branch_idx)
                                self.logger.info(
                                    f"  ✅ Branch {branch_idx} PASSED (matched ALL conditions)"
                                )
                                self.logger.info(
                                    f"  ✅ Branch {branch_idx} PASSED (matched ALL conditions)"
                                )
                            else:
                                failed_branches.append(
                                    {
                                        "index": branch_idx,
                                        "nodeId": pred_node_id,
                                        "logic": "AND",
                                        "failures": failed_condition_details,
                                    }
                                )
                                self.logger.info(
                                    f"  ❌ Branch {branch_idx} FAILED (did not match ALL conditions)"
                                )
                                self.logger.error(
                                    f"  ❌ Branch {branch_idx} FAILED (did not match ALL conditions)"
                                )
                        else:  # OR
                            # OR: At least one condition for this branch must match
                            if any(branch_matches):
                                merged_branches.append(branch_idx)
                                self.logger.info(
                                    f"  ✅ Branch {branch_idx} PASSED (matched at least ONE condition)"
                                )
                                self.logger.info(
                                    f"  ✅ Branch {branch_idx} PASSED (matched at least ONE condition)"
                                )
                            else:
                                failed_branches.append(
                                    {
                                        "index": branch_idx,
                                        "nodeId": pred_node_id,
                                        "logic": "OR",
                                        "failures": failed_condition_details,
                                    }
                                )
                                self.logger.info(
                                    f"  ❌ Branch {branch_idx} FAILED (did not match ANY conditions)"
                                )
                                self.logger.error(
                                    f"  ❌ Branch {branch_idx} FAILED (did not match ANY conditions)"
                                )
                    else:
                        # This branch has NO conditions - include it by default
                        merged_branches.append(branch_idx)
                        self.logger.info(f"  ✅ Branch {branch_idx} PASSED (no conditions defined)")
                        self.logger.info(f"  ✅ Branch {branch_idx} PASSED (no conditions defined)")
                len(merged_branches)
                failed_count = len(failed_branches)

                # If ANY branch failed conditions, the merge FAILS (like an assertion)
                if failed_count > 0:
                    self.logger.error(
                        f"❌ Conditional merge FAILED: {failed_count} branch(es) did not meet conditions"
                    )
                    self.logger.error(
                        f"❌ Conditional merge FAILED: {failed_count}/{branch_count} branch(es) did not meet conditions"
                    )
                    # Build detailed error message
                    error_details = []
                    for failure in failed_branches:
                        error_details.append(f"Branch {failure['index']} ({failure['nodeId']})")
                        for fail_cond in failure["failures"]:
                            error_details.append(
                                f"  - {fail_cond['field']} {fail_cond['operator']} {fail_cond['expected']} (got {fail_cond['actual']})"
                            )

                    error_message = (
                        f"Conditional merge failed: {failed_count} branch(es) did not match conditions:\n"
                        + "\n".join(error_details)
                    )

                    # Mark as completed but with error
                    self.merge_completed[node_id] = True

                    # Raise exception to fail the workflow (unless continueOnFail)
                    raise Exception(error_message)

                self.logger.info(
                    f"✅ Conditional merge PASSED: All {branch_count} branches matched conditions using {condition_logic} logic"
                )
                # Store ALL branch results (not filtered, since all passed)
                self.branch_results[node_id] = predecessor_results

                # Diagnostic log: show what branch_results contains for this merge
                try:
                    self.logger.debug(
                        f"[DIAG] merge {node_id} stored branch_results keys={list(self.branch_results.keys())}"
                    )
                    self.logger.debug(
                        f"[DIAG] merge {node_id} branch_result_ids={[nid for nid, _ in predecessor_results]}"
                    )
                    self.logger.info(
                        f"[DIAG] merge {node_id} -> stored branches: {[nid for nid, _ in predecessor_results]}"
                    )
                except Exception:
                    pass

                # Mark merge as completed
                self.merge_completed[node_id] = True

                return {
                    "status": "success",
                    "message": f"All {branch_count} branches passed conditions using {condition_logic} logic",
                    "mergeStrategy": merge_strategy,
                    "conditionLogic": condition_logic,
                    "branchCount": branch_count,
                    "totalBranches": branch_count,
                    "branches": branch_info,  # All branches included
                    "passedBranches": list(range(branch_count)),
                    "conditionsEvaluated": len(conditions),
                    "mergedAt": datetime.now(UTC).isoformat(),
                }

            self.logger.info(
                f"🔀 Merge node executed with strategy '{merge_strategy}': {branch_count} branches merged"
            )
            # Store branch results for this merge node (for downstream nodes to use in prev[N])
            self.branch_results[node_id] = predecessor_results

            # Mark merge as completed
            self.merge_completed[node_id] = True

            # Add warning if using ANY/FIRST with multiple predecessors
            warning = None
            if merge_strategy in ["any", "first"] and len(predecessor_node_ids) > branch_count:
                warning = f"⚠️ Using '{merge_strategy}' strategy: Only {branch_count} of {len(predecessor_node_ids)} branch(es) available. Downstream nodes using prev[N] may fail if N >= {branch_count}."
                self.logger.info(warning)
            result = {
                "status": "success",
                "message": f"Merged {branch_count} branches using '{merge_strategy}' strategy",
                "mergeStrategy": merge_strategy,
                "branchCount": branch_count,
                "branches": branch_info,  # NEW: Include branch info for reference
                "mergedAt": datetime.now(UTC).isoformat(),
            }

            if warning:
                result["warning"] = warning
            return result
