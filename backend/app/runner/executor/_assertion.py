"""Mixin: assertion, delay, and comparison methods for WorkflowExecutor."""

import asyncio
from typing import Any


class _AssertionMixin:
    """Assertion evaluation, delay execution, and value comparison."""

    async def _execute_delay(self, node: dict) -> dict[str, Any]:
        """Execute delay node"""
        config = node.get("config", {})
        duration = config.get("duration", 1000) / 1000  # Convert ms to seconds

        try:
            await asyncio.wait_for(self.cancel_event.wait(), timeout=duration)
            return {"status": "cancelled", "duration": duration, "message": "Delay cancelled"}
        except TimeoutError:
            pass

        return {
            "status": "success",
            "duration": duration,
            "message": f"Delayed for {duration} seconds",
        }

    async def _execute_assertion(self, node: dict) -> dict[str, Any]:
        """Execute assertion node - validates all assertions.

        Returns a result dict with 'assertionOutcome' = 'pass' or 'fail'.
        Does NOT raise on failure — the executor routes to the appropriate
        downstream edge based on the outcome and the edge's sourceHandle.
        """
        assertions = node.get("config", {}).get("assertions", [])

        if not assertions:
            return {
                "status": "success",
                "assertionOutcome": "pass",
                "message": "No assertions configured",
                "assertions": [],
                "passedCount": 0,
                "failedCount": 0,
                "totalCount": 0,
            }

        failed_assertions = []
        passed_assertions = []

        for idx, assertion in enumerate(assertions):
            try:
                result = self._evaluate_assertion(assertion)
                if result["passed"]:
                    passed_assertions.append(
                        {"index": idx, "assertion": assertion, "message": result["message"]}
                    )
                else:
                    failed_assertions.append(
                        {"index": idx, "assertion": assertion, "message": result["message"]}
                    )
            except Exception as e:
                failed_assertions.append(
                    {
                        "index": idx,
                        "assertion": assertion,
                        "message": f"Error evaluating assertion: {str(e)}",
                    }
                )

        outcome = "fail" if failed_assertions else "pass"

        if failed_assertions:
            failed_details = []
            for fa in failed_assertions:
                failed_details.append(f"Assertion {fa['index'] + 1}: {fa['message']}")

            message = (
                f"Assertion failed: {len(failed_assertions)}/{len(assertions)} assertions failed\n"
                + "\n".join(failed_details)
            )

            return {
                "status": "failed",
                "assertionOutcome": outcome,
                "message": message,
                "passedCount": len(passed_assertions),
                "failedCount": len(failed_assertions),
                "totalCount": len(assertions),
                "passed": passed_assertions,
                "failed": failed_assertions,
            }

        return {
            "status": "success",
            "assertionOutcome": outcome,
            "message": f"All {len(assertions)} assertions passed",
            "assertions": passed_assertions,
            "passedCount": len(passed_assertions),
            "failedCount": 0,
            "totalCount": len(assertions),
        }

    def _evaluate_assertion(self, assertion: dict) -> dict[str, Any]:
        """Evaluate a single assertion"""
        source = assertion.get("source", "prev")
        path = assertion.get("path", "")
        operator = assertion.get("operator", "equals")
        expected_value = assertion.get("expectedValue", "")

        # Get the actual value based on source
        if source == "prev":
            # Get the last HTTP request result (skip non-data nodes like delay, assertion, merge)
            last_result = None
            for result in reversed(list(self.results.values())):
                # Only consider HTTP request nodes
                if result.get("type") == "http-request":
                    last_result = result
                    break

            if not last_result:
                self.logger.error("❌ Assertion: No previous HTTP request found for 'prev' source")
                return {"passed": False, "message": "No previous HTTP request result found"}

            # Path should be relative to result (e.g., "body.data[0].code" not "response.body.data[0].code")
            # Remove "response." prefix if present for backward compatibility
            clean_path = path
            if path.startswith("response."):
                clean_path = path[9:]  # Remove "response." prefix
                self.logger.info(f"🔧 Assertion: Cleaned path '{path}' to '{clean_path}'")

            actual_value = self._get_nested_value(last_result, clean_path)
            self.logger.debug(f"🔍 Assertion: source=prev, path={clean_path}, value={actual_value}")
        elif source == "variables":
            actual_value = self.workflow_variables.get(path)
            self.logger.debug(f"🔍 Assertion: source=variables, path={path}, value={actual_value}")
        elif source == "status":
            # For status, use the last HTTP response status
            last_result = list(self.results.values())[-1] if self.results else {}
            actual_value = last_result.get("statusCode")
            self.logger.debug(f"🔍 Assertion: source=status, value={actual_value}")
        elif source == "cookies":
            # Get cookies from last HTTP response
            last_result = list(self.results.values())[-1] if self.results else {}
            cookies = last_result.get("cookies", {})
            actual_value = cookies.get(path)
            self.logger.debug(f"🔍 Assertion: source=cookies, path={path}, value={actual_value}")
        elif source == "headers":
            # Get headers from last HTTP response
            last_result = list(self.results.values())[-1] if self.results else {}
            headers = last_result.get("headers", {})
            actual_value = headers.get(path)
            self.logger.debug(f"🔍 Assertion: source=headers, path={path}, value={actual_value}")
        else:
            return {"passed": False, "message": f"Unknown source: {source}"}

        # Evaluate based on operator
        try:
            passed = self._compare_values(actual_value, operator, expected_value)
            message = f"{source}.{path if source != 'status' else 'code'} {operator} {expected_value}: {actual_value}"
            self.logger.info(f"{'✅' if passed else '❌'} Assertion: {message}")
            return {"passed": passed, "message": message}
        except Exception as e:
            return {"passed": False, "message": f"Comparison error: {str(e)}"}

    def _compare_values(self, actual, operator: str, expected: str) -> bool:
        """Compare actual and expected values based on operator"""
        if operator == "exists":
            return actual is not None
        elif operator == "notExists":
            return actual is None

        # Handle 'count' operator - get length of arrays/lists/dicts/strings
        if operator == "count":
            try:
                if isinstance(actual, (list, dict, str)):
                    actual_count = len(actual)
                else:
                    # Try to convert to number if it's a single value
                    actual_count = int(actual) if actual is not None else 0

                expected_count = int(expected) if expected else 0
                return actual_count == expected_count
            except (ValueError, TypeError):
                return False

        # For other operators with count values, convert collections to count first.
        # Do not auto-convert strings here; string assertions should compare string values,
        # not their length.
        is_collection = isinstance(actual, (list, dict))
        if is_collection and operator in ["gt", "gte", "lt", "lte", "equals", "notEquals"]:
            try:
                actual = len(actual)
            except:
                pass

        # Convert expected to appropriate type
        # Try to parse as number
        try:
            expected_num = float(expected) if "." in str(expected) else int(expected)
            actual_num = float(actual) if isinstance(actual, (int, float)) else float(str(actual))
        except (ValueError, TypeError):
            expected_num = None
            actual_num = None

        actual_str = str(actual) if actual is not None else ""
        expected_str = str(expected)

        if operator == "equals":
            # Try numeric comparison first
            if expected_num is not None and actual_num is not None:
                return actual_num == expected_num
            return actual_str == expected_str

        elif operator == "notEquals":
            if expected_num is not None and actual_num is not None:
                return actual_num != expected_num
            return actual_str != expected_str

        elif operator == "contains":
            return expected_str in actual_str

        elif operator == "notContains":
            return expected_str not in actual_str

        elif operator == "gt":
            if expected_num is None or actual_num is None:
                return False
            return actual_num > expected_num

        elif operator == "gte":
            if expected_num is None or actual_num is None:
                return False
            return actual_num >= expected_num

        elif operator == "lt":
            if expected_num is None or actual_num is None:
                return False
            return actual_num < expected_num

        elif operator == "lte":
            if expected_num is None or actual_num is None:
                return False
            return actual_num <= expected_num

        else:
            raise Exception(f"Unknown operator: {operator}")
