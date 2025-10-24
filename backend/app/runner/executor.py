"""
Workflow executor - runs workflows step by step
"""
import asyncio
import aiohttp
import re
import json
from datetime import datetime, UTC
from typing import Dict, Any, List
from urllib.parse import urlencode

from app.database import get_database


class WorkflowExecutor:
    """Executes workflows node by node"""
    
    def __init__(self, run_id: str, workflow_id: str):
        self.run_id = run_id
        self.workflow_id = workflow_id
        self.results = {}
        self.context = {}  # Stores variables and results from previous nodes
        self.workflow_variables = {}  # Workflow-level variables that persist across nodes
        self.continue_on_fail = False  # Workflow setting: whether to continue on API failure
        
    async def execute(self):
        """Execute the workflow"""
        db = get_database()
        
        # Get workflow and run
        workflow = await db.workflows.find_one({"workflowId": self.workflow_id})
        if not workflow:
            raise Exception(f"Workflow {self.workflow_id} not found")
        
        # Initialize workflow variables from the workflow definition
        self.workflow_variables = workflow.get('variables', {}).copy() if workflow.get('variables') else {}
        
        # Load workflow settings
        settings = workflow.get('settings', {})
        self.continue_on_fail = settings.get('continueOnFail', False)
        
        # Update run status to running
        await db.runs.update_one(
            {"runId": self.run_id},
            {
                "$set": {
                    "status": "running",
                    "startedAt": datetime.now(UTC),
                    "nodeStatuses": {}
                }
            }
        )
        
        # Execute nodes in order (starting from 'start' node)
        nodes = {node['nodeId']: node for node in workflow['nodes']}
        edges = workflow['edges']
        
        # Find start node
        start_node = next((n for n in workflow['nodes'] if n['type'] == 'start'), None)
        if not start_node:
            await self._fail_run("No start node found")
            return
        
        try:
            # Execute from start node
            await self._execute_from_node(start_node['nodeId'], nodes, edges, db)
            
            # Mark run as completed
            await db.runs.update_one(
                {"runId": self.run_id},
                {
                    "$set": {
                        "status": "completed",
                        "completedAt": datetime.now(UTC),
                        "results": list(self.results.values())
                    }
                }
            )
            
        except Exception as e:
            await self._fail_run(str(e))
    
    async def _execute_from_node(self, node_id: str, nodes: Dict, edges: List, db):
        """Execute starting from a specific node"""
        node = nodes.get(node_id)
        if not node:
            return
        
        # Skip start node execution
        if node['type'] != 'start':
            try:
                await self._execute_node(node, db)
            except Exception as e:
                # If continue_on_fail is False, re-raise the exception to stop the workflow
                if not self.continue_on_fail:
                    raise
                # If continue_on_fail is True, log the error and continue
                print(f"⚠️  Node {node_id} failed but continuing due to 'continueOnFail' setting: {str(e)}")
        
        # Find next nodes
        next_edges = [e for e in edges if e['source'] == node_id]
        
        for edge in next_edges:
            next_node_id = edge['target']
            next_node = nodes.get(next_node_id)
            
            # Skip end node
            if next_node and next_node['type'] != 'end':
                try:
                    await self._execute_from_node(next_node_id, nodes, edges, db)
                except Exception as e:
                    # If continue_on_fail is False, re-raise the exception to stop the workflow
                    if not self.continue_on_fail:
                        raise
                    # If continue_on_fail is True, log the error and continue
                    print(f"⚠️  Node {next_node_id} failed but continuing due to 'continueOnFail' setting: {str(e)}")
    
    async def _execute_node(self, node: Dict, db):
        """Execute a single node"""
        node_id = node['nodeId']
        node_type = node['type']
        
        print(f"🔄 Executing node: {node_id} ({node_type})")
        
        # Update node status to running
        await self._update_node_status(db, node_id, "running", None)
        
        try:
            if node_type == 'http-request':
                result = await self._execute_http_request(node)
            elif node_type == 'delay':
                result = await self._execute_delay(node)
            elif node_type == 'assertion':
                result = await self._execute_assertion(node)
            else:
                result = {"status": "skipped", "message": f"Unknown node type: {node_type}"}
            
            # Determine the execution status based on the result
            execution_status = result.get("status", "success")
            
            # Map result status to execution status
            if execution_status in ["client_error", "server_error"]:
                execution_status = "error"
            elif execution_status == "redirect":
                execution_status = "warning"
            elif execution_status == "success":
                execution_status = "success"
            else:
                execution_status = "success"  # Default for other statuses
            
            # Update node status
            await self._update_node_status(db, node_id, execution_status, result)
            self.results[node_id] = result
            
            # Don't fail the workflow for HTTP errors, just mark the node
            # (user might expect 4xx/5xx responses in their tests)
            
        except Exception as e:
            error = {"error": str(e), "status": "error"}
            await self._update_node_status(db, node_id, "error", error)
            raise
    
    def _substitute_variables(self, text: str) -> str:
        """Replace {{variable}} placeholders with actual values from context"""
        if not text:
            return text
        
        def replacer(match) -> str:
            var_path = match.group(1)
            # Handle prev.response.body.token, prev.response.cookies.session, etc.
            # Also handle variables.token, variables.referenceToken, etc.
            try:
                if var_path.startswith('variables.'):
                    # Access workflow variables
                    path_parts = var_path.split('.')[1:]  # Remove 'variables'
                    value = self.workflow_variables
                    
                    for part in path_parts:
                        # Handle array indexing: data[0], items[1], etc.
                        array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
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
                
                elif var_path.startswith('prev.'):
                    # Get the last executed node's result
                    if self.results:
                        prev_result = list(self.results.values())[-1]
                        path_parts = var_path.split('.')[1:]  # Remove 'prev'
                        
                        value = prev_result
                        for part in path_parts:
                            # Handle array indexing: data[0], items[1], etc.
                            array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
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
                    return str(match.group(0))
                else:
                    # Support direct context variables
                    ctx_value = self.context.get(var_path, match.group(0))
                    return str(ctx_value)
            except Exception:
                return str(match.group(0))  # Return original if substitution fails
        
        return re.sub(r'\{\{([^}]+)\}\}', replacer, text)
    
    def _parse_key_value_pairs(self, text: str) -> Dict[str, str]:
        """Parse key=value pairs (one per line) into a dictionary"""
        if not text:
            return {}
        
        result = {}
        for line in text.strip().split('\n'):
            line = line.strip()
            if not line or '=' not in line:
                continue
            
            key, value = line.split('=', 1)
            result[key.strip()] = self._substitute_variables(value.strip())
        
        return result
    
    def _extract_variables(self, extractors: Dict[str, str], response: Dict):
        """Extract variables from HTTP response using JSONPath-like syntax"""
        for var_name, var_path in extractors.items():
            try:
                # Navigate the response using dot notation
                # e.g., "body.data[0].city" -> response['body']['data'][0]['city']
                value = self._get_nested_value(response, var_path)
                
                if value is not None:
                    self.workflow_variables[var_name] = value
                    print(f"✅ Extracted variable: {var_name} = {value}")
                else:
                    print(f"⚠️  Extracted variable {var_name} is None from path: {var_path}")
            except Exception as e:
                print(f"❌ Error extracting variable {var_name} from {var_path}: {str(e)}")
    
    async def _execute_http_request(self, node: Dict) -> Dict[str, Any]:
        """Execute HTTP request node"""
        config = node.get('config', {})
        method = config.get('method', 'GET')
        url = config.get('url', '')
        headers_text = config.get('headers', '')
        body = config.get('body', '')
        timeout = config.get('timeout', 30)
        query_params_text = config.get('queryParams', '')
        path_variables_text = config.get('pathVariables', '')
        cookies_text = config.get('cookies', '')
        
        if not url:
            raise Exception("URL is required for HTTP request")
        
        # Substitute variables in URL
        url = self._substitute_variables(url)
        
        # Handle path variables (e.g., /users/:userId -> /users/123)
        path_variables = self._parse_key_value_pairs(path_variables_text)
        for var_name, var_value in path_variables.items():
            url = url.replace(f':{var_name}', var_value)
        
        # Handle query parameters
        query_params = self._parse_key_value_pairs(query_params_text)
        if query_params:
            separator = '&' if '?' in url else '?'
            url = f"{url}{separator}{urlencode(query_params)}"
        
        # Parse headers
        headers = self._parse_key_value_pairs(headers_text)
        
        # Parse cookies and add to headers
        cookies = self._parse_key_value_pairs(cookies_text)
        if cookies:
            cookie_header = '; '.join([f"{k}={v}" for k, v in cookies.items()])
            headers['Cookie'] = cookie_header
        
        # Substitute variables in body
        if body:
            body = self._substitute_variables(body)
        
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method=method,
                url=url,
                headers=headers,
                data=body if method != 'GET' else None,
                timeout=aiohttp.ClientTimeout(total=timeout)
            ) as response:
                response_text = await response.text()
                status_code = response.status
                
                # Try to parse response as JSON
                try:
                    response_body = json.loads(response_text)
                except:
                    response_body = response_text
                
                # Extract cookies from response
                response_cookies = {}
                if 'Set-Cookie' in response.headers:
                    cookie_header = response.headers.get('Set-Cookie', '')
                    for cookie in cookie_header.split(';'):
                        if '=' in cookie:
                            k, v = cookie.split('=', 1)
                            response_cookies[k.strip()] = v.strip()
                
                # Determine status based on HTTP status code
                if status_code >= 200 and status_code < 300:
                    status = "success"
                elif status_code >= 300 and status_code < 400:
                    status = "redirect"
                elif status_code >= 400 and status_code < 500:
                    status = "client_error"
                elif status_code >= 500:
                    status = "server_error"
                else:
                    status = "unknown"
                
                # Structure response for easy variable access
                result = {
                    "status": status,
                    "statusCode": status_code,
                    "headers": dict(response.headers),
                    "body": response_body,  # Parsed JSON or raw text
                    "cookies": response_cookies,
                    "method": method,
                    "url": url
                }
                
                # Store in context with 'response' wrapper for easy access
                result['response'] = {
                    "body": response_body,
                    "headers": dict(response.headers),
                    "cookies": response_cookies,
                    "statusCode": status_code
                }
                
                # Extract variables if configured
                extractors = config.get('extractors', {})
                if extractors:
                    self._extract_variables(extractors, result)
                
                return result
    
    async def _execute_delay(self, node: Dict) -> Dict[str, Any]:
        """Execute delay node"""
        config = node.get('config', {})
        duration = config.get('duration', 1000) / 1000  # Convert ms to seconds
        
        await asyncio.sleep(duration)
        
        return {
            "status": "success",
            "duration": duration,
            "message": f"Delayed for {duration} seconds"
        }
    
    def _get_nested_value(self, obj: Dict, path: str):
        """Get a nested value from an object using dot notation
        
        Examples:
            body.status -> obj['body']['status']
            data[0].id -> obj['data'][0]['id']
        """
        if not obj or not path:
            return None
        
        try:
            parts = path.split('.')
            value = obj
            
            for part in parts:
                # Handle array indexing: data[0], items[1], etc.
                array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
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
    
        """Extract values from response and store as workflow variables
        
        extractors format: {
            "token": "response.body.token",
            "userId": "response.body.user.id",
            "sessionId": "response.cookies.session",
            "contentType": "response.headers.content-type"
        }
        """
        for var_name, var_path in extractors.items():
            try:
                # Navigate through the response to get the value
                parts = var_path.split('.')
                value = response
                
                for part in parts:
                    # Handle array indexing: data[0], items[1], etc.
                    array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
                    if array_match:
                        key = array_match.group(1)
                        index = int(array_match.group(2))
                        if isinstance(value, dict):
                            value = value.get(key)
                        if isinstance(value, list) and 0 <= index < len(value):
                            value = value[index]
                        else:
                            print(f"⚠️  Cannot extract {var_path}: index out of range")
                            continue
                    elif isinstance(value, dict):
                        value = value.get(part)
                    else:
                        print(f"⚠️  Cannot extract {var_path}: {part} not found")
                        break
                
                # Store the extracted value
                if value is not None:
                    self.workflow_variables[var_name] = value
                    print(f"✅ Extracted variable: {var_name} = {value}")
                else:
                    print(f"⚠️  Extracted variable {var_name} is None")
            except Exception as e:
                print(f"❌ Error extracting variable {var_name} from {var_path}: {str(e)}")
    
    async def _execute_assertion(self, node: Dict) -> Dict[str, Any]:
        """Execute assertion node - validates all assertions"""
        assertions = node.get('config', {}).get('assertions', [])
        
        if not assertions:
            return {
                "status": "success",
                "message": "No assertions configured",
                "assertions": []
            }
        
        failed_assertions = []
        passed_assertions = []
        
        for idx, assertion in enumerate(assertions):
            try:
                result = self._evaluate_assertion(assertion)
                if result['passed']:
                    passed_assertions.append({
                        "index": idx,
                        "assertion": assertion,
                        "message": result['message']
                    })
                else:
                    failed_assertions.append({
                        "index": idx,
                        "assertion": assertion,
                        "message": result['message']
                    })
            except Exception as e:
                failed_assertions.append({
                    "index": idx,
                    "assertion": assertion,
                    "message": f"Error evaluating assertion: {str(e)}"
                })
        
        # If any assertion failed, the entire assertion node fails
        if failed_assertions:
            raise Exception(f"Assertion failed: {len(failed_assertions)}/{len(assertions)} assertions failed")
        
        return {
            "status": "success",
            "message": f"All {len(assertions)} assertions passed",
            "assertions": passed_assertions
        }
    
    def _evaluate_assertion(self, assertion: Dict) -> Dict[str, Any]:
        """Evaluate a single assertion"""
        source = assertion.get('source', 'prev')
        path = assertion.get('path', '')
        operator = assertion.get('operator', 'equals')
        expected_value = assertion.get('expectedValue', '')
        
        # Get the actual value based on source
        if source == 'prev':
            actual_value = self._get_nested_value(self.context, path)
        elif source == 'variables':
            actual_value = self.workflow_variables.get(path)
        elif source == 'status':
            # For status, use the last HTTP response status
            last_result = list(self.results.values())[-1] if self.results else {}
            actual_value = last_result.get('statusCode')
        elif source == 'cookies':
            # Get cookies from last HTTP response
            last_result = list(self.results.values())[-1] if self.results else {}
            cookies = last_result.get('cookies', {})
            actual_value = cookies.get(path)
        elif source == 'headers':
            # Get headers from last HTTP response
            last_result = list(self.results.values())[-1] if self.results else {}
            headers = last_result.get('headers', {})
            actual_value = headers.get(path)
        else:
            return {"passed": False, "message": f"Unknown source: {source}"}
        
        # Evaluate based on operator
        try:
            passed = self._compare_values(actual_value, operator, expected_value)
            message = f"{source}.{path if source != 'status' else 'code'} {operator} {expected_value}: {actual_value}"
            return {"passed": passed, "message": message}
        except Exception as e:
            return {"passed": False, "message": f"Comparison error: {str(e)}"}
    
    def _compare_values(self, actual, operator: str, expected: str) -> bool:
        """Compare actual and expected values based on operator"""
        if operator == 'exists':
            return actual is not None
        elif operator == 'notExists':
            return actual is None
        
        # Convert expected to appropriate type
        # Try to parse as number
        try:
            expected_num = float(expected) if '.' in str(expected) else int(expected)
            actual_num = float(actual) if isinstance(actual, (int, float)) else float(str(actual))
        except (ValueError, TypeError):
            expected_num = None
            actual_num = None
        
        actual_str = str(actual) if actual is not None else ''
        expected_str = str(expected)
        
        if operator == 'equals':
            # Try numeric comparison first
            if expected_num is not None and actual_num is not None:
                return actual_num == expected_num
            return actual_str == expected_str
        
        elif operator == 'notEquals':
            if expected_num is not None and actual_num is not None:
                return actual_num != expected_num
            return actual_str != expected_str
        
        elif operator == 'contains':
            return expected_str in actual_str
        
        elif operator == 'notContains':
            return expected_str not in actual_str
        
        elif operator == 'gt':
            if expected_num is None or actual_num is None:
                return False
            return actual_num > expected_num
        
        elif operator == 'gte':
            if expected_num is None or actual_num is None:
                return False
            return actual_num >= expected_num
        
        elif operator == 'lt':
            if expected_num is None or actual_num is None:
                return False
            return actual_num < expected_num
        
        elif operator == 'lte':
            if expected_num is None or actual_num is None:
                return False
            return actual_num <= expected_num
        
        else:
            raise Exception(f"Unknown operator: {operator}")
    
    async def _update_node_status(self, db, node_id: str, status: str, result: Any):
        """Update node execution status in the run"""
        await db.runs.update_one(
            {"runId": self.run_id},
            {
                "$set": {
                    f"nodeStatuses.{node_id}": {
                        "status": status,
                        "result": result,
                        "timestamp": datetime.now(UTC).isoformat()
                    }
                }
            }
        )
    
    async def _fail_run(self, error: str):
        """Mark run as failed"""
        db = get_database()
        await db.runs.update_one(
            {"runId": self.run_id},
            {
                "$set": {
                    "status": "failed",
                    "completedAt": datetime.now(UTC),
                    "error": error
                }
            }
        )
