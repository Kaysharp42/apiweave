"""
Workflow executor - runs workflows step by step
"""
import asyncio
import aiohttp
import re
import json
import time
import logging
from pathlib import Path
from datetime import datetime, UTC
from typing import Dict, Any, List
from urllib.parse import urlencode
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.database import get_database

# Setup logging
LOGS_DIR = Path(__file__).parent.parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)

def setup_run_logger(run_id: str):
    """Create a logger for a specific workflow run"""
    logger = logging.getLogger(f"run_{run_id}")
    logger.setLevel(logging.DEBUG)
    
    # Remove existing handlers
    logger.handlers = []
    
    # File handler for this run
    log_file = LOGS_DIR / f"run_{run_id}.log"
    file_handler = logging.FileHandler(log_file, mode='w', encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    
    # Formatter
    formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(formatter)
    
    logger.addHandler(file_handler)
    logger.info(f"=" * 80)
    logger.info(f"Workflow Run Started: {run_id}")
    logger.info(f"=" * 80)
    
    return logger


class WorkflowExecutor:
    """Executes workflows node by node"""
    
    def __init__(self, run_id: str, workflow_id: str):
        self.run_id = run_id
        self.workflow_id = workflow_id
        self.results = {}
        self.context = {}  # Stores variables and results from previous nodes
        self.workflow_variables = {}  # Workflow-level variables that persist across nodes
        self.continue_on_fail = False  # Workflow setting: whether to continue on API failure
        self.start_time = None  # Track workflow execution start time
        self.branch_results = {}  # Track merged branch results per merge node: {merge_node_id: [(node_id, result), ...]}
        self.current_branch_context = []  # Current branch context for prev[N] variable substitution
        self.logger = setup_run_logger(run_id)  # Setup logger for this run
        self.merge_locks = {}  # Locks for merge nodes to prevent race conditions: {merge_node_id: asyncio.Lock}
        self.merge_completed = {}  # Track which merge nodes have completed: {merge_node_id: bool}
        
    async def execute(self):
        """Execute the workflow"""
        db = get_database()
        
        self.logger.info(f"Starting execution for workflow {self.workflow_id}")
        
        # Get workflow and run
        workflow = await db.workflows.find_one({"workflowId": self.workflow_id})
        if not workflow:
            self.logger.error(f"Workflow {self.workflow_id} not found")
            raise Exception(f"Workflow {self.workflow_id} not found")
        
        self.logger.info(f"Workflow loaded: {workflow.get('name', 'Unnamed')}")
        
        # Initialize workflow variables from the workflow definition
        self.workflow_variables = workflow.get('variables', {}).copy() if workflow.get('variables') else {}
        self.logger.debug(f"Initialized workflow variables: {self.workflow_variables}")

        
        # Load workflow settings
        settings = workflow.get('settings', {})
        self.continue_on_fail = settings.get('continueOnFail', False)
        
        # Track start time for duration calculation
        self.start_time = time.time()
        
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
            
            # Calculate total run duration
            end_time = time.time()
            duration_ms = round((end_time - self.start_time) * 1000, 2)
            
            # Mark run as completed (don't store results array - too large)
            try:
                await db.runs.update_one(
                    {"runId": self.run_id},
                    {
                        "$set": {
                            "status": "completed",
                            "completedAt": datetime.now(UTC),
                            "duration": duration_ms
                            # Removed "results" field - fetch from node_results instead
                        }
                    }
                )
            except Exception as update_error:
                print(f"⚠️  Failed to update run completion status: {str(update_error)}")
                print(f"   Run completed successfully, but status update failed")
                # Don't fail the run just because status update failed
            
        except Exception as e:
            # Only fail if actual execution error (not document size issues)
            if "document too large" not in str(e).lower():
                await self._fail_run(str(e))
            else:
                print(f"⚠️  Run completed but encountered document size issue: {str(e)}")
                print(f"   All results are safely stored in node_results collection")
    
    async def _execute_from_node(self, node_id: str, nodes: Dict, edges: List, db):
        """Execute starting from a specific node"""
        node = nodes.get(node_id)
        if not node:
            return
        
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"Executing node: {node_id} ({node.get('type', 'unknown')})")
        self.logger.info(f"{'='*60}")
        
        # Set branch context before executing this node
        # If the previous node was a merge, use its merged branch results
        incoming_edges = [e for e in edges if e['target'] == node_id]
        if incoming_edges:
            # Check if any predecessor is a merge node
            for edge in incoming_edges:
                pred_id = edge['source']
                if pred_id in self.branch_results:
                    # This node's predecessor is a merge node - use its branch results as context
                    self.current_branch_context = self.branch_results[pred_id]
                    branch_node_ids = [nid for nid, _ in self.current_branch_context]
                    self.logger.info(f"📍 Setting branch context for {node_id}")
                    self.logger.info(f"   Source: merge node {pred_id}")
                    self.logger.info(f"   Branches: {branch_node_ids}")
                    print(f"📍 Setting branch context for {node_id}: {len(self.current_branch_context)} branches from merge {pred_id}")
                    break
        
        # Skip start node execution
        if node['type'] != 'start':
            try:
                await self._execute_node(node, edges, db)
            except Exception as e:
                # If continue_on_fail is False, re-raise the exception to stop the workflow
                if not self.continue_on_fail:
                    raise
                # If continue_on_fail is True, log the error and continue
                print(f"⚠️  Node {node_id} failed but continuing due to 'continueOnFail' setting: {str(e)}")
        
        # Find next nodes (outgoing edges from this node)
        next_edges = [e for e in edges if e['source'] == node_id]
        
        if not next_edges:
            return  # No more nodes to execute
        
        # If multiple edges (branching), execute in parallel
        if len(next_edges) > 1:
            self.logger.info(f"🌳 Branching detected from node {node_id}: {len(next_edges)} branches")
            print(f"🌳 Branching detected from node {node_id}: {len(next_edges)} branches")
            
            # Only clear branch context if NOT branching from a merge node
            # Branches from a merge should inherit the merge's branch context
            if node['type'] != 'merge':
                self.current_branch_context = []
                self.logger.info(f"   Cleared branch context - starting fresh branches from {node['type']}")
                print(f"   Cleared branch context - starting fresh branches from {node['type']}")
            else:
                branch_node_ids = [nid for nid, _ in self.current_branch_context]
                self.logger.info(f"   Keeping branch context from merge node: {branch_node_ids}")
                print(f"   Keeping branch context from merge node ({len(self.current_branch_context)} branches)")

            
            # Create tasks for parallel execution
            tasks = []
            for edge in next_edges:
                next_node_id = edge['target']
                next_node = nodes.get(next_node_id)
                
                # Skip end nodes in branching
                if next_node and next_node['type'] != 'end':
                    tasks.append(self._execute_branch(next_node_id, nodes, edges, db))
            
            # Execute all branches in parallel
            if tasks:
                try:
                    await asyncio.gather(*tasks, return_exceptions=False)
                except Exception as e:
                    # If continue_on_fail is False, re-raise
                    if not self.continue_on_fail:
                        raise
                    print(f"⚠️  Branch execution failed but continuing: {str(e)}")
        
        else:
            # Single edge - sequential execution (original behavior)
            edge = next_edges[0]
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
    
    async def _execute_branch(self, node_id: str, nodes: Dict, edges: List, db):
        """Execute a branch (for parallel execution)"""
        print(f"🔀 Executing branch starting from node {node_id}")
        await self._execute_from_node(node_id, nodes, edges, db)
    
    async def _execute_node(self, node: Dict, edges: List, db):
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
            elif node_type == 'merge':
                result = await self._execute_merge(node, edges, db)
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
        
        self.logger.debug(f"Substituting variables in: {text}")
        self.logger.debug(f"Current branch context: {[(nid, 'result') for nid, _ in self.current_branch_context]}")
        self.logger.debug(f"All results: {list(self.results.keys())}")
        
        def replacer(match) -> str:
            var_path = match.group(1)
            self.logger.debug(f"  Processing variable: {{{{var_path}}}}")
            # Handle prev.response.body.token, prev[0].response.body.data, variables.token, etc.
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
                
                elif var_path.startswith('prev'):
                    # Handle prev[0].response.body or prev.response.body
                    # Check if it's indexed: prev[0], prev[1], etc.
                    branch_index_match = re.match(r'^prev\[(\d+)\]\.(.+)$', var_path)
                    
                    if branch_index_match:
                        # Indexed access: prev[0].response.body
                        branch_index = int(branch_index_match.group(1))
                        path_after_index = branch_index_match.group(2)
                        
                        self.logger.debug(f"    Indexed prev access: prev[{branch_index}].{path_after_index}")
                        
                        # Use branch context if available (from merge node), otherwise use all results
                        if self.current_branch_context:
                            # We're executing after a merge - use the merged branch results
                            self.logger.info(f"🔍 Looking up prev[{branch_index}] from branch context ({len(self.current_branch_context)} branches)")
                            print(f"🔍 Looking up prev[{branch_index}] from branch context ({len(self.current_branch_context)} branches)")
                            if 0 <= branch_index < len(self.current_branch_context):
                                node_id, prev_result = self.current_branch_context[branch_index]
                                self.logger.info(f"   ✓ Found branch {branch_index}: {node_id}")
                                print(f"   ✓ Found branch {branch_index}: {node_id}")
                                self.logger.debug(f"   Result keys: {prev_result.keys() if isinstance(prev_result, dict) else type(prev_result)}")
                                path_parts = path_after_index.split('.')
                                
                                value = prev_result
                                for part in path_parts:
                                    self.logger.debug(f"     Accessing part: {part}, current value type: {type(value)}")
                                    # Handle array indexing: data[0], items[1], etc.
                                    array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
                                    if array_match:
                                        key = array_match.group(1)
                                        index = int(array_match.group(2))
                                        self.logger.debug(f"       Array access: {key}[{index}]")
                                        # First get the key from dict, then index into array
                                        if isinstance(value, dict) and key in value:
                                            value = value.get(key)
                                            self.logger.debug(f"         Got {key}: type={type(value)}, len={len(value) if isinstance(value, list) else 'N/A'}")
                                            if isinstance(value, list) and 0 <= index < len(value):
                                                value = value[index]
                                                self.logger.debug(f"         Got index [{index}]: {type(value)}")
                                            else:
                                                msg = f"{key} is not a list or index out of range"
                                                self.logger.warning(f"   ✗ {msg}")
                                                print(f"   ✗ {msg}")
                                                return str(match.group(0))
                                        else:
                                            msg = f"Key '{key}' not found in dict"
                                            self.logger.warning(f"   ✗ {msg}")
                                            print(f"   ✗ {msg}")
                                            return str(match.group(0))
                                    elif isinstance(value, dict):
                                        value = value.get(part)
                                    else:
                                        return str(match.group(0))
                                
                                return str(value) if value is not None else str(match.group(0))
                            else:
                                print(f"   ✗ Branch index {branch_index} out of range (only {len(self.current_branch_context)} branches)")
                                return str(match.group(0))
                        else:
                            # No branch context - use all results (backward compatible)
                            if self.results:
                                results_list = list(self.results.values())
                                # Use forward indexing
                                if 0 <= branch_index < len(results_list):
                                    prev_result = results_list[branch_index]
                                    path_parts = path_after_index.split('.')
                                    
                                    value = prev_result
                                    for part in path_parts:
                                        # Handle array indexing: data[0], items[1], etc.
                                        array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
                                        if array_match:
                                            key = array_match.group(1)
                                            index = int(array_match.group(2))
                                            # First get the key from dict, then index into array
                                            if isinstance(value, dict) and key in value:
                                                value = value.get(key)
                                                if isinstance(value, list) and 0 <= index < len(value):
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
                            path_parts = var_path.split('.')[1:]  # Remove 'prev'
                            
                            value = prev_result
                            for part in path_parts:
                                # Handle array indexing: data[0], items[1], etc.
                                array_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$', part)
                                if array_match:
                                    key = array_match.group(1)
                                    index = int(array_match.group(2))
                                    # First get the key from dict, then index into array
                                    if isinstance(value, dict) and key in value:
                                        value = value.get(key)
                                        if isinstance(value, list) and 0 <= index < len(value):
                                            value = value[index]
                                        else:
                                            return str(match.group(0))  # Return original if not found
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
        import time
        
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
        
        # Start timing
        start_time = time.time()
        
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
                
                # End timing
                end_time = time.time()
                duration_ms = round((end_time - start_time) * 1000, 2)  # Convert to milliseconds
                
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
                    "duration": duration_ms,  # Request duration in milliseconds
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
    
    async def _execute_merge(self, node: Dict, edges: List, db) -> Dict[str, Any]:
        """Execute merge node - combines results from multiple branches"""
        merge_strategy = node.get('config', {}).get('mergeStrategy', 'all')
        conditions = node.get('config', {}).get('conditions', [])
        node_id = node['nodeId']
        
        # Create a lock for this merge node if it doesn't exist
        if node_id not in self.merge_locks:
            self.merge_locks[node_id] = asyncio.Lock()
        
        # Check if already completed BEFORE acquiring lock (fast path)
        if node_id in self.merge_completed:
            self.logger.info(f"⏭️  Merge node {node_id} already completed, skipping")
            print(f"⏭️  Merge node {node_id} already completed by another branch")
            return self.results[node_id]
        
        # Find predecessor nodes (incoming edges to this merge node)
        incoming_edges = [e for e in edges if e['target'] == node_id]
        predecessor_node_ids = [e['source'] for e in incoming_edges]
        
        # Wait for all predecessors to complete BEFORE acquiring lock
        # This prevents deadlock where first branch holds lock while waiting for second branch
        missing_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id not in self.results]
        if missing_predecessors:
            self.logger.info(f"⏳ Branch waiting for {len(missing_predecessors)} predecessors: {missing_predecessors}")
            print(f"⏳ Branch waiting for {len(missing_predecessors)} predecessors before merge")
            
            # Wait for missing predecessors with timeout
            max_wait = 30  # seconds
            wait_interval = 0.1  # seconds
            elapsed = 0
            
            while missing_predecessors and elapsed < max_wait:
                await asyncio.sleep(wait_interval)
                elapsed += wait_interval
                missing_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id not in self.results]
            
            if missing_predecessors:
                error_msg = f"Timeout waiting for predecessors: {missing_predecessors}"
                self.logger.error(f"❌ {error_msg}")
                raise Exception(error_msg)
            
            self.logger.info(f"✓ All predecessors completed, proceeding to merge")
            print(f"✓ All {len(predecessor_node_ids)} predecessors completed")
        
        # Now acquire lock to execute merge logic
        async with self.merge_locks[node_id]:
            # Double-check if completed (another branch may have finished while we waited)
            if node_id in self.merge_completed:
                self.logger.info(f"⏭️  Merge node {node_id} completed by another branch")
                print(f"⏭️  Merge node {node_id} completed by another branch")
                return self.results[node_id]
            
            self.logger.info(f"🔀 Merge node {node_id} executing with {len(predecessor_node_ids)} predecessors")
            print(f"🔀 Merge node {node_id} has {len(predecessor_node_ids)} predecessors: {predecessor_node_ids}")
            
            # Get only the predecessor results (not ALL results)
            predecessor_results = []
            for pred_id in predecessor_node_ids:
                if pred_id in self.results:
                    predecessor_results.append((pred_id, self.results[pred_id]))
            
            branch_count = len(predecessor_results)
            
            # Create a mapping of branch index to node info for user reference
            branch_info = []
            for idx, (pred_node_id, result) in enumerate(predecessor_results):
                branch_info.append({
                    "index": idx,
                    "nodeId": pred_node_id,
                    "label": result.get('label', pred_node_id),
                    "url": result.get('url', 'N/A'),
                    "statusCode": result.get('statusCode', 'N/A')
                })
            
            # For conditional merge, filter branches based on conditions
            if merge_strategy == 'conditional' and conditions:
                merged_branches = []
                
                for condition in conditions:
                    branch_index = condition.get('branchIndex', 0)
                    field = condition.get('field', 'statusCode')
                    operator = condition.get('operator', 'equals')
                    expected_value = condition.get('value', '')
                    
                    # Get the branch result using forward indexing
                    if 0 <= branch_index < len(predecessor_results):
                        pred_node_id, branch_result = predecessor_results[branch_index]  # FIXED: Forward indexing
                        
                        # Extract the actual value from the branch result
                        actual_value = self._get_nested_value(branch_result, field)
                        
                        # Evaluate the condition
                        if self._compare_values(actual_value, operator, expected_value):
                            merged_branches.append(branch_index)
                            print(f"  ✓ Branch {branch_index} ({pred_node_id}) matched condition: {field} {operator} {expected_value}")
                        else:
                            print(f"  ✗ Branch {branch_index} ({pred_node_id}) did not match: {field} {operator} {expected_value} (got {actual_value})")
                
                merged_count = len(set(merged_branches))  # Unique branches
                print(f"🔀 Conditional merge: {merged_count}/{branch_count} branches matched conditions")
                
                # Store branch results for this merge node (for downstream nodes to use in prev[N])
                self.branch_results[node_id] = predecessor_results
                
                # Mark merge as completed
                self.merge_completed[node_id] = True
                
                return {
                    "status": "success",
                    "message": f"Conditionally merged {merged_count} of {branch_count} branches",
                    "mergeStrategy": merge_strategy,
                    "branchCount": branch_count,
                    "branches": branch_info,  # NEW: Include branch info for reference
                    "mergedBranches": sorted(list(set(merged_branches))),
                    "conditionsEvaluated": len(conditions),
                    "mergedAt": datetime.now(UTC).isoformat()
                }
            
            print(f"🔀 Merge node executed with strategy '{merge_strategy}': {branch_count} branches merged")
            
            # Store branch results for this merge node (for downstream nodes to use in prev[N])
            self.branch_results[node_id] = predecessor_results
            
            # Mark merge as completed
            self.merge_completed[node_id] = True
            
            return {
                "status": "success",
                "message": f"Merged {branch_count} branches using '{merge_strategy}' strategy",
                "mergeStrategy": merge_strategy,
                "branchCount": branch_count,
                "branches": branch_info,  # NEW: Include branch info for reference
                "mergedAt": datetime.now(UTC).isoformat()
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
        # Store full result - use GridFS for large results
        if result:
            try:
                # Calculate result size
                result_str = json.dumps(result)
                size_bytes = len(result_str.encode('utf-8'))
                size_mb = size_bytes / (1024 * 1024)
                
                # If result is larger than 14MB, store in GridFS instead of regular collection
                if size_mb > 14:
                    print(f"📦 Large result detected ({size_mb:.2f} MB), storing in GridFS...")
                    
                    # Store in GridFS
                    gridfs_bucket = AsyncIOMotorGridFSBucket(db)
                    file_id = await gridfs_bucket.upload_from_stream(
                        filename=f"{self.run_id}_{node_id}_result.json",
                        source=result_str.encode('utf-8'),
                        metadata={
                            "runId": self.run_id,
                            "nodeId": node_id,
                            "status": status,
                            "timestamp": datetime.now(UTC).isoformat(),
                            "size_mb": size_mb
                        }
                    )
                    
                    # Store reference to GridFS file
                    await db.node_results.update_one(
                        {"runId": self.run_id, "nodeId": node_id},
                        {
                            "$set": {
                                "runId": self.run_id,
                                "nodeId": node_id,
                                "status": status,
                                "gridfs_file_id": str(file_id),
                                "size_mb": size_mb,
                                "stored_in_gridfs": True,
                                "timestamp": datetime.now(UTC).isoformat()
                            }
                        },
                        upsert=True
                    )
                    print(f"✓ Stored large result in GridFS (file_id: {file_id})")
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
                                "size_mb": size_mb,
                                "stored_in_gridfs": False,
                                "timestamp": datetime.now(UTC).isoformat()
                            }
                        },
                        upsert=True
                    )
            except Exception as e:
                print(f"⚠️  Failed to store full result for {node_id}: {str(e)}")
        
        # Store ONLY status reference in runs document (no result data at all)
        # Full results are in node_results collection or GridFS
        try:
            await db.runs.update_one(
                {"runId": self.run_id},
                {
                    "$set": {
                        f"nodeStatuses.{node_id}": {
                            "status": status,
                            "timestamp": datetime.now(UTC).isoformat()
                            # NO result field - fetch from node_results collection instead
                        }
                    }
                }
            )
        except Exception as e:
            print(f"⚠️  Failed to update runs document for {node_id}: {str(e)}")
            print(f"   Full result is still available in node_results collection")
            # Don't raise - the full result is safely stored in node_results
    
    def _create_result_summary(self, result: Any, max_preview_size: int = 500) -> Any:
        """Create a minimal lightweight summary of result for runs document (no body data)"""
        if not result or not isinstance(result, dict):
            return None  # Don't store anything for non-dict results
        
        # MINIMAL summary - only metadata, NO body/headers/cookies data
        summary = {
            'status': result.get('status'),
            'statusCode': result.get('statusCode'),
            'duration': result.get('duration')
        }
        
        # Add size indicators instead of actual data
        if 'body' in result:
            body = result['body']
            body_str = json.dumps(body) if not isinstance(body, str) else body
            summary['bodySize'] = len(body_str)
        
        if 'headers' in result and isinstance(result['headers'], dict):
            summary['headerCount'] = len(result['headers'])
        
        if 'cookies' in result and isinstance(result['cookies'], dict):
            summary['cookieCount'] = len(result['cookies'])
        
        return summary
    
    async def _fail_run(self, error: str):
        """Mark run as failed"""
        db = get_database()
        
        # Calculate duration if start_time is available
        duration_ms = None
        if self.start_time is not None:
            end_time = time.time()
            duration_ms = round((end_time - self.start_time) * 1000, 2)
        
        await db.runs.update_one(
            {"runId": self.run_id},
            {
                "$set": {
                    "status": "failed",
                    "completedAt": datetime.now(UTC),
                    "duration": duration_ms,
                    "error": error
                }
            }
        )
