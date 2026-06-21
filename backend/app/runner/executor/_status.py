"""Mixin: node status updates and run failure for WorkflowExecutor."""

import json
import time
from datetime import UTC, datetime
from typing import Any

from app.repositories import RunRepository


class _StatusMixin:
    """Node status persistence and run failure handling."""

    async def _update_node_status(self, db, node_id: str, status: str, result: Any):
        """Update node execution status in the run"""
        from app.runner.executor import AsyncIOMotorGridFSBucket

        # Store full result - use GridFS for large results
        if result:
            try:
                # NEW: Mask secrets in result before storing
                if self.secrets:
                    result = self._mask_result_secrets(result)

                # Calculate result size
                result_str = json.dumps(result)
                size_bytes = len(result_str.encode("utf-8"))
                size_mb = size_bytes / (1024 * 1024)

                # If result is larger than 14MB, store in GridFS instead of regular collection
                if size_mb > 14:
                    self.logger.info(
                        f"📦 Large result detected ({size_mb:.2f} MB), storing in GridFS..."
                    )
                    # Store in GridFS
                    gridfs_bucket = AsyncIOMotorGridFSBucket(db)
                    file_id = await gridfs_bucket.upload_from_stream(
                        filename=f"{self.run_id}_{node_id}_result.json",
                        source=result_str.encode("utf-8"),
                        metadata={
                            "runId": self.run_id,
                            "nodeId": node_id,
                            "status": status,
                            "timestamp": datetime.now(UTC).isoformat(),
                            "size_mb": size_mb,
                        },
                    )

                    # Store reference to GridFS file with metadata inside result dict
                    gridfs_meta = {
                        "stored_in_gridfs": True,
                        "gridfs_file_id": str(file_id),
                        "size_mb": size_mb,
                    }
                    result_with_meta = {**gridfs_meta, **result}
                    await db.node_results.update_one(
                        {"runId": self.run_id, "nodeId": node_id},
                        {
                            "$set": {
                                "runId": self.run_id,
                                "nodeId": node_id,
                                "status": status,
                                "result": result_with_meta,
                                "timestamp": datetime.now(UTC).isoformat(),
                            }
                        },
                        upsert=True,
                    )
                    self.logger.info("Stored large result in GridFS (file_id: %s)", file_id)
                else:
                    # Store normally in node_results collection
                    await db.node_results.update_one(
                        {"runId": self.run_id, "nodeId": node_id},
                        {
                            "$set": {
                                "runId": self.run_id,
                                "nodeId": node_id,
                                "status": status,
                                "result": result,  # Full result stored here
                                "timestamp": datetime.now(UTC).isoformat(),
                            }
                        },
                        upsert=True,
                    )
            except Exception as e:
                self.logger.error(f"⚠️  Failed to store full result for {node_id}: {str(e)}")
        # Store ONLY status reference in runs document (no result data at all)
        # Full results are in node_results collection or GridFS
        try:
            await db.runs.update_one(
                {"runId": self.run_id},
                {
                    "$set": {
                        f"nodeStatuses.{node_id}": {
                            "status": status,
                            "timestamp": datetime.now(UTC).isoformat(),
                            # NO result field - fetch from node_results collection instead
                        }
                    }
                },
            )
        except Exception as e:
            self.logger.error(f"⚠️  Failed to update runs document for {node_id}: {str(e)}")
            self.logger.info("   Full result is still available in node_results collection")
            # Don't raise - the full result is safely stored in node_results

    def _create_result_summary(self, result: Any, max_preview_size: int = 500) -> Any:
        """Create a minimal lightweight summary of result for runs document (no body data)"""
        if not result or not isinstance(result, dict):
            return None  # Don't store anything for non-dict results

        # MINIMAL summary - only metadata, NO body/headers/cookies data
        summary = {
            "status": result.get("status"),
            "statusCode": result.get("statusCode"),
            "duration": result.get("duration"),
        }

        # Add size indicators instead of actual data
        if "body" in result:
            body = result["body"]
            body_str = json.dumps(body) if not isinstance(body, str) else body
            summary["bodySize"] = len(body_str)

        if "headers" in result and isinstance(result["headers"], dict):
            summary["headerCount"] = len(result["headers"])

        if "cookies" in result and isinstance(result["cookies"], dict):
            summary["cookieCount"] = len(result["cookies"])

        return summary

    async def _fail_run(self, error: str):
        """Mark run as failed using repository"""
        # Calculate duration if start_time is available
        duration_ms = None
        if self.start_time is not None:
            end_time = time.time()
            duration_ms = int(
                round((end_time - self.start_time) * 1000)
            )  # Convert to int milliseconds

        update_data = {
            "status": "failed",
            "completedAt": datetime.now(UTC),
            "duration": duration_ms,
            "error": error,
            "variables": self.workflow_variables,
        }

        if self.failed_nodes:
            update_data["failedNodes"] = self.failed_nodes
            update_data["failureMessage"] = (
                f"{len(self.failed_nodes)} node(s) failed during execution"
            )

        await RunRepository.update_fields(self.run_id, **update_data)
