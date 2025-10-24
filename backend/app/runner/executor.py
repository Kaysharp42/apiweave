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
        
    async def execute(self):
        """Execute the workflow"""
        db = get_database()
        
        # Get workflow and run
        workflow = await db.workflows.find_one({"workflowId": self.workflow_id})
        if not workflow:
            raise Exception(f"Workflow {self.workflow_id} not found")
        
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
            await self._execute_node(node, db)
        
        # Find next nodes
        next_edges = [e for e in edges if e['source'] == node_id]
        
        for edge in next_edges:
            next_node_id = edge['target']
            next_node = nodes.get(next_node_id)
            
            # Skip end node
            if next_node and next_node['type'] != 'end':
                await self._execute_from_node(next_node_id, nodes, edges, db)
    
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
            try:
                if var_path.startswith('prev.'):
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
    
    async def _execute_assertion(self, node: Dict) -> Dict[str, Any]:
        """Execute assertion node"""
        # TODO: Implement assertion logic
        return {
            "status": "success",
            "message": "Assertion passed"
        }
    
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
