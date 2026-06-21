"""Mixin: variable substitution and key-value parsing methods for WorkflowExecutor."""

import re
from typing import Any

from app.runner.dynamic_functions import DynamicFunctions


class _VariablesMixin:
    """Variable substitution, key-value parsing, and nested value access."""

    def _substitute_variables(self, text: str, *, allow_secrets: bool = True) -> str:
        """Replace {{variable}} placeholders with actual values from context.

        Parameters
        ----------
        text:
            The template string containing ``{{variable}}`` placeholders.
        allow_secrets:
            When ``False``, any ``{{secrets.*}}`` placeholder raises
            :class:`ValueError` instead of being resolved.  Use this for
            URL / query / path contexts where secret leakage is forbidden.
        """
        if not text:
            return text

        self.logger.debug(f"Substituting variables in: {text}")
        self.logger.debug(
            f"Current branch context: {[(nid, 'result') for nid, _ in self.current_branch_context]}"
        )
        self.logger.debug(f"All results: {list(self.results.keys())}")

        def replacer(match) -> str:
            var_path = match.group(1)
            self.logger.debug("  Processing variable: {{var_path}}")

            if not allow_secrets and re.match(r"\s*secrets\.", var_path):
                self.logger.warning("Blocked {{secrets.*}} substitution in URL/query/path context")
                raise ValueError("Secret substitution not allowed in URL/query/path contexts")

            # Check if it's a function call: functionName(params)
            func_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$", var_path.strip())
            if func_match:
                func_name = func_match.group(1)
                params = func_match.group(2).strip()

                func = DynamicFunctions.get_function(func_name)
                if func:
                    try:
                        if params:
                            # Parse parameters - handle string literals and numbers
                            # Simple parameter parsing (can be enhanced for complex cases)
                            param_list = []
                            current_param = ""
                            in_quotes = False
                            for char in params:
                                if char == '"' and (not current_param or current_param[-1] != "\\"):
                                    in_quotes = not in_quotes
                                elif char == "," and not in_quotes:
                                    param_list.append(current_param.strip().strip('"'))
                                    current_param = ""
                                    continue
                                current_param += char
                            if current_param:
                                param_list.append(current_param.strip().strip('"'))

                            result = func(*param_list) if param_list else func()
                        else:
                            result = func()

                        self.logger.info(f"✅ Function call: {func_name}({params}) -> {result}")
                        return str(result)
                    except Exception as e:
                        self.logger.warning(f"❌ Error calling {func_name}({params}): {e}")
                        return str(match.group(0))  # Return original if function call fails
                # If function not found, treat it as a variable

            # Handle prev.response.body.token, prev[0].response.body.data, variables.token, env.baseUrl, etc.
            try:
                if var_path.startswith("secrets."):
                    # NEW: Access secrets from environment
                    path_parts = var_path.split(".")[1:]  # Remove 'secrets'
                    value = self.secrets

                    for part in path_parts:
                        # Handle array indexing: data[0], items[1], etc.
                        array_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part)
                        if array_match:
                            key = array_match.group(1)
                            index = int(array_match.group(2))
                            if isinstance(value, dict):
                                value = value.get(key)
                            if isinstance(value, list) and 0 <= index < len(value):
                                value = value[index]
                            else:
                                return str(match.group(0))  # Return original if not found
                        elif isinstance(value, dict):
                            value = value.get(part)
                        else:
                            return str(match.group(0))  # Return original if not found

                    self.logger.debug(
                        f"✓ Substituted secret: {{{{secrets.{'.'.join(path_parts)}}}}}"
                    )
                    return str(value) if value is not None else str(match.group(0))

                elif var_path.startswith("env."):
                    # Access environment variables
                    path_parts = var_path.split(".")[1:]  # Remove 'env'
                    value = self.environment_variables

                    self.logger.debug(f"Looking up env variable: {var_path}")
                    self.logger.debug(
                        f"Available env vars: {list(self.environment_variables.keys())}"
                    )

                    for part in path_parts:
                        # Handle array indexing: data[0], items[1], etc.
                        array_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part)
                        if array_match:
                            key = array_match.group(1)
                            index = int(array_match.group(2))
                            if isinstance(value, dict):
                                value = value.get(key)
                            if isinstance(value, list) and 0 <= index < len(value):
                                value = value[index]
                            else:
                                self.logger.warning(
                                    f"env.{'.'.join(path_parts)} not found (array access failed)"
                                )
                                return str(match.group(0))  # Return original if not found
                        elif isinstance(value, dict):
                            value = value.get(part)
                            if value is None:
                                self.logger.warning(
                                    f"env.{'.'.join(path_parts)} not found (key '{part}' missing)"
                                )
                        else:
                            self.logger.warning(
                                f"env.{'.'.join(path_parts)} not found (not a dict)"
                            )
                            return str(match.group(0))  # Return original if not found

                    if value is not None:
                        safe_value_repr = self._mask_secrets(str(value))
                        self.logger.debug(
                            f"✓ Substituted env variable: {{{{env.{'.'.join(path_parts)}}}}} -> {safe_value_repr}"
                        )
                        return str(value)
                    else:
                        self.logger.warning(f"env.{'.'.join(path_parts)} is None")
                        return str(match.group(0))

                elif var_path.startswith("variables."):
                    # Access workflow variables
                    path_parts = var_path.split(".")[1:]  # Remove 'variables'
                    value = self.workflow_variables

                    for part in path_parts:
                        # Handle array indexing: data[0], items[1], etc.
                        array_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part)
                        if array_match:
                            key = array_match.group(1)
                            index = int(array_match.group(2))
                            if isinstance(value, dict):
                                value = value.get(key)
                            if isinstance(value, list) and 0 <= index < len(value):
                                value = value[index]
                            else:
                                return str(match.group(0))  # Return original if not found
                        elif isinstance(value, dict):
                            value = value.get(part)
                        else:
                            return str(match.group(0))  # Return original if not found

                    return str(value) if value is not None else str(match.group(0))

                elif var_path.startswith("prev"):
                    # Handle prev[0].response.body or prev.response.body
                    # Check if it's indexed: prev[0], prev[1], etc.
                    branch_index_match = re.match(r"^prev\[(\d+)\]\.(.+)$", var_path)

                    if branch_index_match:
                        # Indexed access: prev[0].response.body
                        branch_index = int(branch_index_match.group(1))
                        path_after_index = branch_index_match.group(2)

                        self.logger.debug(
                            f"    Indexed prev access: prev[{branch_index}].{path_after_index}"
                        )

                        # Use branch context if available (from merge node), otherwise use all results
                        if self.current_branch_context:
                            # We're executing after a merge - use the merged branch results
                            self.logger.info(
                                f"🔍 Looking up prev[{branch_index}] from branch context ({len(self.current_branch_context)} branches)"
                            )
                            self.logger.info(
                                f"🔍 Looking up prev[{branch_index}] from branch context ({len(self.current_branch_context)} branches)"
                            )
                            if 0 <= branch_index < len(self.current_branch_context):
                                node_id, prev_result = self.current_branch_context[branch_index]
                                self.logger.info(f"   ✓ Found branch {branch_index}: {node_id}")
                                self.logger.info(f"   ✓ Found branch {branch_index}: {node_id}")
                                self.logger.debug(
                                    f"   Result keys: {prev_result.keys() if isinstance(prev_result, dict) else type(prev_result)}"
                                )
                                path_parts = path_after_index.split(".")

                                value = prev_result
                                for part in path_parts:
                                    self.logger.debug(
                                        f"     Accessing part: {part}, current value type: {type(value)}"
                                    )
                                    # Handle array indexing: data[0], items[1], etc.
                                    array_match = re.match(
                                        r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part
                                    )
                                    if array_match:
                                        key = array_match.group(1)
                                        index = int(array_match.group(2))
                                        self.logger.debug(f"       Array access: {key}[{index}]")
                                        # First get the key from dict, then index into array
                                        if isinstance(value, dict) and key in value:
                                            value = value.get(key)
                                            self.logger.debug(
                                                f"         Got {key}: type={type(value)}, len={len(value) if isinstance(value, list) else 'N/A'}"
                                            )
                                            if isinstance(value, list) and 0 <= index < len(value):
                                                value = value[index]
                                                self.logger.debug(
                                                    f"         Got index [{index}]: {type(value)}"
                                                )
                                            else:
                                                msg = f"{key} is not a list or index out of range"
                                                self.logger.warning(f"   ✗ {msg}")
                                                self.logger.info(f"   ✗ {msg}")
                                                return str(match.group(0))
                                        else:
                                            msg = f"Key '{key}' not found in dict"
                                            self.logger.warning(f"   ✗ {msg}")
                                            self.logger.info(f"   ✗ {msg}")
                                            return str(match.group(0))
                                    elif isinstance(value, dict):
                                        value = value.get(part)
                                    else:
                                        return str(match.group(0))

                                return str(value) if value is not None else str(match.group(0))
                            else:
                                error_msg = f"Branch index {branch_index} out of range (only {len(self.current_branch_context)} branch(es) available)"
                                self.logger.error(f"   ❌ {error_msg}")
                                self.logger.error(f"   ❌ {error_msg}")
                                self.logger.info(
                                    "   💡 TIP: Using 'any' or 'first' merge strategy? Not all branches may be available!"
                                )
                                self.logger.info(
                                    f"   💡 Available branches: {[nid for nid, _ in self.current_branch_context]}"
                                )
                                # Return the placeholder unchanged - this will likely cause an API error
                                # which is better than silently failing
                                return str(match.group(0))
                        else:
                            # No branch context - use all results (backward compatible)
                            if self.results:
                                results_list = list(self.results.values())
                                # Use forward indexing
                                if 0 <= branch_index < len(results_list):
                                    prev_result = results_list[branch_index]
                                    path_parts = path_after_index.split(".")

                                    value = prev_result
                                    for part in path_parts:
                                        # Handle array indexing: data[0], items[1], etc.
                                        array_match = re.match(
                                            r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part
                                        )
                                        if array_match:
                                            key = array_match.group(1)
                                            index = int(array_match.group(2))
                                            # First get the key from dict, then index into array
                                            if isinstance(value, dict) and key in value:
                                                value = value.get(key)
                                                if isinstance(value, list) and 0 <= index < len(
                                                    value
                                                ):
                                                    value = value[index]
                                                else:
                                                    return str(match.group(0))
                                            else:
                                                return str(match.group(0))
                                        elif isinstance(value, dict):
                                            value = value.get(part)
                                        else:
                                            return str(match.group(0))

                                    return str(value) if value is not None else str(match.group(0))
                        return str(match.group(0))

                    else:
                        # Non-indexed access: prev.response.body (backward compatible)
                        # Get the last executed node's result
                        if self.results:
                            prev_result = list(self.results.values())[-1]
                            path_parts = var_path.split(".")[1:]  # Remove 'prev'

                            value = prev_result
                            for part in path_parts:
                                # Handle array indexing: data[0], items[1], etc.
                                array_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part)
                                if array_match:
                                    key = array_match.group(1)
                                    index = int(array_match.group(2))
                                    # First get the key from dict, then index into array
                                    if isinstance(value, dict) and key in value:
                                        value = value.get(key)
                                        if isinstance(value, list) and 0 <= index < len(value):
                                            value = value[index]
                                        else:
                                            return str(
                                                match.group(0)
                                            )  # Return original if not found
                                    else:
                                        return str(match.group(0))  # Return original if not found
                                elif isinstance(value, dict):
                                    value = value.get(part)
                                else:
                                    return str(match.group(0))  # Return original if not found

                            return str(value) if value is not None else str(match.group(0))
                        return str(match.group(0))
                else:
                    # Support direct context variables
                    ctx_value = self.context.get(var_path, match.group(0))
                    return str(ctx_value)
            except Exception:
                return str(match.group(0))  # Return original if substitution fails

        return re.sub(r"\{\{([^}]+)\}\}", replacer, text)

    def _parse_key_value_pairs(self, text: str, *, allow_secrets: bool = True) -> dict[str, str]:
        """Parse key=value (or key:value) pairs (one per line) into a dictionary.

        Parameters
        ----------
        text:
            Multi-line key=value or key:value pairs.
        allow_secrets:
            When False, raises ValueError if any value contains ``{{secrets.*}}``.
            Set to False for query params and path variables (F5); True for
            headers, cookies, body, form data where secrets are legitimate.
        """
        if not text:
            return {}

        result = {}
        for line in text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue

            if "=" in line:
                key, value = line.split("=", 1)
            elif ":" in line:
                key, value = line.split(":", 1)
            else:
                continue

            result[key.strip()] = self._substitute_variables(
                value.strip(), allow_secrets=allow_secrets
            )

        return result

    def _normalize_key_value_field(
        self,
        value: Any,
        *,
        allow_secrets: bool = True,
    ) -> dict[str, str]:
        """Normalize a headers/queryParams/pathVariables/cookies field.

        Accepts either:
        - Legacy multi-line ``key=value`` string (delegates to
          :meth:`_parse_key_value_pairs`).
        - New array format: ``list[dict]`` where each dict has ``key``,
          ``value``, and optional ``active`` (defaults to True). Inactive
          rows are skipped.

        Variable substitution is applied to values in both formats.
        """
        if value is None or value == "":
            return {}

        if isinstance(value, str):
            return self._parse_key_value_pairs(value, allow_secrets=allow_secrets)

        if isinstance(value, list):
            result: dict[str, str] = {}
            for entry in value:
                if not isinstance(entry, dict):
                    continue
                if not entry.get("active", True):
                    continue
                key = entry.get("key")
                if key is None:
                    continue
                raw_value = entry.get("value", "")
                if not isinstance(raw_value, str):
                    raw_value = str(raw_value)
                result[str(key)] = self._substitute_variables(
                    raw_value, allow_secrets=allow_secrets
                )
            return result

        # Unknown type — fall back to empty dict rather than crashing.
        self.logger.warning(
            "Unsupported key-value field type: %s — treating as empty",
            type(value).__name__,
        )
        return {}

    def _get_nested_value(self, obj: dict, path: str):
        """Get a nested value from an object using dot notation

        Examples:
            body.status -> obj['body']['status']
            data[0].id -> obj['data'][0]['id']
        """
        if not obj or not path:
            return None

        try:
            parts = path.split(".")
            value = obj

            for part in parts:
                # Handle array indexing: data[0], items[1], etc.
                array_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$", part)
                if array_match:
                    key = array_match.group(1)
                    index = int(array_match.group(2))
                    if isinstance(value, dict):
                        value = value.get(key)
                    if isinstance(value, list) and 0 <= index < len(value):
                        value = value[index]
                    else:
                        return None
                elif isinstance(value, dict):
                    value = value.get(part)
                else:
                    return None

                if value is None:
                    return None

            return value
        except Exception:
            return None
