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
        self.environment_variables = {}  # Environment variables from active environment
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
        
    async def execute(self):
        """Execute the workflow"""
        db = get_database()
        
        self.logger.info(f"Starting execution for workflow {self.workflow_id}")
        
        # Get workflow and run
        workflow = await db.workflows.find_one({"workflowId": self.workflow_id})
        if not workflow:
            self.logger.error(f"Workflow {self.workflow_id} not found")
            raise Exception(f"Workflow {self.workflow_id} not found")
        
        run = await db.runs.find_one({"runId": self.run_id})
        if not run:
            self.logger.error(f"Run {self.run_id} not found")
            raise Exception(f"Run {self.run_id} not found")
        
        self.logger.info(f"Workflow loaded: {workflow.get('name', 'Unnamed')}")
        
        # Initialize workflow variables from the workflow definition
        self.workflow_variables = workflow.get('variables', {}).copy() if workflow.get('variables') else {}
        self.logger.debug(f"Initialized workflow variables: {self.workflow_variables}")
        
        # Load environment variables from the run's specified environment
        environment_id = run.get('environmentId')
        if environment_id:
            environment = await db.environments.find_one({"environmentId": environment_id})
            if environment:
                self.environment_variables = environment.get('variables', {}).copy()
                self.logger.info(f"Loaded environment: {environment.get('name')} (ID: {environment_id}) with {len(self.environment_variables)} variables")
            else:
                self.logger.warning(f"Environment {environment_id} not found, continuing without environment variables")
        else:
            self.logger.info("No environment specified for this run")

        
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
            
            # Determine final status based on failures
            final_status = "failed" if self.has_failures else "completed"
            
            # Mark run as completed (don't store results array - too large)
            try:
                update_data = {
                    "status": final_status,
                    "completedAt": datetime.now(UTC),
                    "duration": duration_ms
                }
                
                # Add failed nodes info if there were failures
                if self.has_failures:
                    update_data["failedNodes"] = self.failed_nodes
                    update_data["failureMessage"] = f"{len(self.failed_nodes)} node(s) failed during execution"
                    # Add error message from first failed node
                    if self.first_error_message:
                        update_data["error"] = self.first_error_message
                
                await db.runs.update_one(
                    {"runId": self.run_id},
                    {
                        "$set": update_data
                    }
                )
                
                if self.has_failures:
                    print(f"⚠️  Workflow completed with failures: {len(self.failed_nodes)} node(s) failed")
                    for node_id in self.failed_nodes:
                        print(f"   - {node_id}")
                        
            except Exception as update_error:
                print(f"⚠️  Failed to update run completion status: {str(update_error)}")
                print(f"   Run completed, but status update failed")
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
            except StopIteration:
                # Always re-raise StopIteration (intentional stop from continue_on_fail=False)
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
                        branch_node_id = branch_edge['target']
                        self.logger.warning(f"⚠️  Branch {i} (starting at {branch_node_id}) failed: {str(result)}")
                        print(f"⚠️  Branch {i} (starting at {branch_node_id}) failed: {str(result)}")
                        
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
                    print(f"❌ {error_msg}")
                    if not self.continue_on_fail:
                        raise Exception(error_msg)
                elif failed_branches:
                    success_count = len(tasks) - len(failed_branches)
                    self.logger.info(f"✅ {success_count}/{len(tasks)} branches succeeded, {len(failed_branches)} failed")
                    print(f"✅ {success_count}/{len(tasks)} branches succeeded, {len(failed_branches)} failed")

        
        else:
            # Single edge - sequential execution (original behavior)
            edge = next_edges[0]
            next_node_id = edge['target']
            next_node = nodes.get(next_node_id)
            
            # Skip end node
            if next_node and next_node['type'] != 'end':
                try:
                    await self._execute_from_node(next_node_id, nodes, edges, db)
                except StopIteration:
                    # Always re-raise StopIteration (intentional stop from continue_on_fail=False)
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
        
        execution_status = None  # Track if result was successfully stored
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
            if execution_status in ["client_error", "server_error", "error"]:
                execution_status = "error"
                # Mark as failure
                self.has_failures = True
                if node_id not in self.failed_nodes:
                    self.failed_nodes.append(node_id)
                if result.get('statusCode'):
                    print(f"⚠️  HTTP request failed: {node_id} returned status code {result.get('statusCode')}")
                else:
                    print(f"⚠️  Node failed: {node_id} - {result.get('error', 'Unknown error')}")
            elif execution_status == "redirect":
                execution_status = "warning"
            elif execution_status == "success":
                execution_status = "success"
            else:
                execution_status = "success"  # Default for other statuses
            
            # Update node status with full result (MUST happen BEFORE raising exception)
            await self._update_node_status(db, node_id, execution_status, result)
            
            # Store result with node type for filtering later
            result['type'] = node_type  # Add node type to result
            self.results[node_id] = result
            
            # Handle failures based on continue_on_fail setting
            # If continue_on_fail is False, stop execution on any error
            # If continue_on_fail is True, allow failures to continue (for merge node evaluation)
            if execution_status == "error" and not self.continue_on_fail:
                error_msg = result.get('error', f"Node {node_id} failed")
                if result.get('statusCode'):
                    error_msg = f"HTTP {result.get('statusCode')}: {result.get('url', 'unknown URL')}"
                # Mark as failure before raising
                self.has_failures = True
                if node_id not in self.failed_nodes:
                    self.failed_nodes.append(node_id)
                # Log that we're stopping this branch
                print(f"🛑 Stopping branch at {node_id} due to failure (continue_on_fail=False)")
                self.logger.error(f"🛑 Stopping branch at {node_id}: {error_msg}")
                # Raise a specific exception type that won't be caught by our error handler
                raise StopIteration(error_msg)  # Use StopIteration to signal intentional stop


            
        except StopIteration:
            # Re-raise StopIteration (intentional stop due to continue_on_fail=False)
            raise
        except Exception as e:
            # For errors that occur during node execution (not HTTP status code errors)
            # store error message and re-raise
            if node_type == 'http-request':
                # HTTP requests return error results, shouldn't raise exceptions
                # If we get here, it's an unexpected error
                error = {"error": str(e), "status": "error"}
                await self._update_node_status(db, node_id, "error", error)
                self.results[node_id] = error
                self.failed_nodes.append(node_id)
                # Don't re-raise - allow execution to continue to downstream nodes
                self.logger.error(f"❌ HTTP request {node_id} had unexpected error: {str(e)}")
            else:
                # For other types of errors, store error message and re-raise
                error = {"error": str(e), "status": "error"}
                await self._update_node_status(db, node_id, "error", error)
                self.results[node_id] = error
                self.failed_nodes.append(node_id)
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
            # Handle prev.response.body.token, prev[0].response.body.data, variables.token, env.baseUrl, etc.
            try:
                if var_path.startswith('env.'):
                    # Access environment variables
                    path_parts = var_path.split('.')[1:]  # Remove 'env'
                    value = self.environment_variables
                    
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
                
                elif var_path.startswith('variables.'):
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
                                error_msg = f"Branch index {branch_index} out of range (only {len(self.current_branch_context)} branch(es) available)"
                                self.logger.error(f"   ❌ {error_msg}")
                                print(f"   ❌ {error_msg}")
                                print(f"   💡 TIP: Using 'any' or 'first' merge strategy? Not all branches may be available!")
                                print(f"   💡 Available branches: {[nid for nid, _ in self.current_branch_context]}")
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
        
        try:
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
        except Exception as e:
            # Network error or other request failure
            # Return an error result that can be handled downstream
            error_msg = str(e)
            self.logger.error(f"HTTP request failed for {url}: {error_msg}")
            print(f"❌ HTTP request error: {error_msg}")
            
            return {
                "status": "error",
                "error": error_msg,
                "method": method,
                "url": url,
                "duration": round((time.time() - start_time) * 1000, 2)
            }

    
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
            # Build detailed error message with failed assertion details
            failed_details = []
            for fa in failed_assertions:
                failed_details.append(f"Assertion {fa['index'] + 1}: {fa['message']}")
            
            error_msg = f"Assertion failed: {len(failed_assertions)}/{len(assertions)} assertions failed\n" + "\n".join(failed_details)
            
            # Create result with both passed and failed info before raising
            result_with_details = {
                "status": "failed",
                "message": error_msg,
                "passedCount": len(passed_assertions),
                "failedCount": len(failed_assertions),
                "totalCount": len(assertions),
                "passed": passed_assertions,
                "failed": failed_assertions
            }
            
            # Store this in results temporarily so it can be accessed
            raise Exception(f"Assertion failed: {len(failed_assertions)}/{len(assertions)} assertions failed")
        
        return {
            "status": "success",
            "message": f"All {len(assertions)} assertions passed",
            "assertions": passed_assertions,
            "passedCount": len(passed_assertions),
            "failedCount": 0,
            "totalCount": len(assertions)
        }
    
    def _find_data_producing_ancestor(self, node_id: str, edges: List, nodes: Dict, visited = None) -> str:
        """
        Recursively find the nearest data-producing ancestor node.
        Skips non-data nodes like delay, assertion, start, end, merge.
        """
        if visited is None:
            visited = set()
        
        # Prevent infinite loops
        if node_id in visited:
            return node_id
        visited.add(node_id)
        
        # Check if current node is in results (it has executed)
        if node_id not in self.results:
            return node_id
        
        result = self.results[node_id]
        node_type = result.get('type', 'unknown')
        
        # Data-producing nodes: http-request
        # Non-data nodes: delay, assertion, start, end, merge
        DATA_PRODUCING_TYPES = ['http-request']
        
        if node_type in DATA_PRODUCING_TYPES:
            return node_id
        
        # For non-data nodes, find their predecessor
        incoming_edges = [e for e in edges if e['target'] == node_id]
        if not incoming_edges:
            return node_id
        
        # For nodes with single predecessor, recurse
        if len(incoming_edges) == 1:
            pred_id = incoming_edges[0]['source']
            return self._find_data_producing_ancestor(pred_id, edges, nodes, visited)
        
        # For merge nodes with multiple predecessors, return the node itself
        # (merge should be handled separately)
        return node_id
    
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
        
        # Strategy-based waiting logic
        if merge_strategy == 'all':
            # Wait for ALL predecessors to complete OR fail BEFORE acquiring lock
            missing_predecessors = [pred_id for pred_id in predecessor_node_ids 
                                   if pred_id not in self.results and pred_id not in self.failed_nodes]
            if missing_predecessors:
                self.logger.info(f"⏳ [ALL] Branch waiting for {len(missing_predecessors)} predecessors: {missing_predecessors}")
                print(f"⏳ [ALL strategy] Branch waiting for {len(missing_predecessors)} predecessors before merge")
                
                max_wait = 30  # seconds
                wait_interval = 0.1  # seconds
                elapsed = 0
                
                while missing_predecessors and elapsed < max_wait:
                    await asyncio.sleep(wait_interval)
                    elapsed += wait_interval
                    missing_predecessors = [pred_id for pred_id in predecessor_node_ids 
                                          if pred_id not in self.results and pred_id not in self.failed_nodes]
                
                if missing_predecessors:
                    error_msg = f"Timeout waiting for predecessors: {missing_predecessors}"
                    self.logger.error(f"❌ {error_msg}")
                    raise Exception(error_msg)
                
                # Check if any required predecessors failed
                failed_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes]
                if failed_predecessors:
                    error_msg = f"Cannot merge: {len(failed_predecessors)} predecessor(s) failed: {failed_predecessors}"
                    self.logger.error(f"❌ {error_msg}")
                    print(f"❌ [ALL strategy] {error_msg}")
                    raise Exception(error_msg)
                
                self.logger.info(f"✓ All predecessors completed, proceeding to merge")
                print(f"✓ All {len(predecessor_node_ids)} predecessors completed")
        
        elif merge_strategy in ['any', 'first']:
            # For ANY/FIRST: Continue as soon as at least ONE predecessor completes successfully
            # No waiting needed - first successful branch to arrive triggers merge
            completed_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id in self.results]
            failed_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes]
            
            if not completed_predecessors:
                # No successful predecessors yet
                self.logger.warning(f"⚠️  [ANY/FIRST] No predecessors completed successfully yet ({len(failed_predecessors)} failed)")
                print(f"⚠️  [ANY/FIRST strategy] No successful predecessors ready, waiting...")
                
                # Wait for at least one successful completion
                max_wait = 30
                wait_interval = 0.1
                elapsed = 0
                
                while not completed_predecessors and elapsed < max_wait:
                    await asyncio.sleep(wait_interval)
                    elapsed += wait_interval
                    completed_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id in self.results]
                    failed_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes]
                    
                    # If all branches have finished (success or failure), stop waiting
                    if len(completed_predecessors) + len(failed_predecessors) == len(predecessor_node_ids):
                        break
                
                if not completed_predecessors:
                    error_msg = f"All {len(predecessor_node_ids)} branches failed or timed out"
                    self.logger.error(f"❌ {error_msg}")
                    print(f"❌ [ANY/FIRST strategy] {error_msg}")
                    raise Exception(error_msg)
            
            self.logger.info(f"⚡ [{merge_strategy.upper()}] {len(completed_predecessors)}/{len(predecessor_node_ids)} predecessors completed ({len(failed_predecessors)} failed), proceeding")
            print(f"⚡ [{merge_strategy.upper()} strategy] Proceeding with {len(completed_predecessors)} successful branch(es), {len(failed_predecessors)} failed")
        
        elif merge_strategy == 'conditional':
            # For CONDITIONAL: Wait for all like 'all' strategy, but FAIL if any predecessor failed
            missing_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id not in self.results]
            if missing_predecessors:
                self.logger.info(f"⏳ [CONDITIONAL] Waiting for {len(missing_predecessors)} predecessors")
                print(f"⏳ [CONDITIONAL strategy] Waiting for all branches to evaluate conditions")
                
                max_wait = 30
                wait_interval = 0.1
                elapsed = 0
                
                while missing_predecessors and elapsed < max_wait:
                    await asyncio.sleep(wait_interval)
                    elapsed += wait_interval
                    missing_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id not in self.results]
                
                if missing_predecessors:
                    error_msg = f"Timeout waiting for predecessors: {missing_predecessors}"
                    self.logger.error(f"❌ {error_msg}")
                    raise Exception(error_msg)
            
            # Check if any predecessor FAILED - conditional merge should fail if ANY input failed
            failed_predecessors = [pred_id for pred_id in predecessor_node_ids if pred_id in self.failed_nodes]
            if failed_predecessors:
                error_msg = f"Cannot merge: {len(failed_predecessors)} predecessor(s) failed: {failed_predecessors}"
                self.logger.error(f"❌ {error_msg}")
                print(f"❌ [CONDITIONAL strategy] {error_msg}")
                raise Exception(error_msg)
        
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
            # For each predecessor, find the nearest data-producing ancestor
            all_predecessor_results = []
            failed_results = []  # Track which predecessors have error status
            
            for pred_id in predecessor_node_ids:
                # Find the actual data-producing node (skip delay, assertion, etc.)
                data_node_id = self._find_data_producing_ancestor(pred_id, edges, {})
                
                if data_node_id in self.results:
                    result = self.results[data_node_id]
                    # Only include if it's a data-producing node
                    if result.get('type') == 'http-request':
                        # Check if this result has an error status
                        if result.get('status') == 'error':
                            failed_results.append((data_node_id, result))
                            self.logger.warning(f"   Branch from {pred_id} → data node {data_node_id} FAILED (status: error)")
                            print(f"   ❌ Branch from {pred_id} → data node {data_node_id} FAILED (error result)")
                        else:
                            all_predecessor_results.append((data_node_id, result))
                            self.logger.info(f"   Branch from {pred_id} → data node: {data_node_id}")
                            print(f"   ✓ Branch from {pred_id} → data node: {data_node_id}")
                    else:
                        self.logger.warning(f"   Branch from {pred_id} → no data node found (type: {result.get('type')})")
                else:
                    self.logger.warning(f"   Branch from {pred_id} → no data node found")
            
            # For 'all' and 'conditional' strategies, reject if ANY branch failed
            if merge_strategy in ['all', 'conditional'] and failed_results:
                failed_node_ids = [nid for nid, _ in failed_results]
                error_msg = f"Cannot merge: {len(failed_results)} branch(es) failed: {failed_node_ids}"
                self.logger.error(f"❌ {error_msg}")
                print(f"❌ [{merge_strategy.upper()} strategy] {error_msg}")
                self.merge_completed[node_id] = True
                raise Exception(error_msg)
            
            # Apply strategy-specific filtering
            if merge_strategy == 'first':
                # FIRST: Use only the first completed branch (earliest by completion time)
                if all_predecessor_results:
                    # Find the branch with earliest completion
                    first_branch = min(all_predecessor_results, 
                                     key=lambda x: x[1].get('duration', 0) if x[1].get('duration') else float('inf'))
                    predecessor_results = [first_branch]
                    self.logger.info(f"🏃 [FIRST] Selected fastest branch: {first_branch[0]}")
                    print(f"🏃 [FIRST strategy] Using fastest branch: {first_branch[0]}")
                else:
                    predecessor_results = []
            
            elif merge_strategy == 'any':
                # ANY: Use all completed branches (may be subset if not all completed yet)
                predecessor_results = all_predecessor_results
                self.logger.info(f"⚡ [ANY] Using {len(predecessor_results)} completed branch(es)")
                print(f"⚡ [ANY strategy] Using {len(predecessor_results)} completed branch(es)")
            
            else:
                # ALL or CONDITIONAL: Use all branches
                predecessor_results = all_predecessor_results
            
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
                condition_logic = node.get('config', {}).get('conditionLogic', 'OR')  # Default to OR for backward compatibility
                merged_branches = []
                failed_branches = []  # Track branches that failed conditions
                
                self.logger.info(f"🎯 Evaluating conditions with {condition_logic} logic")
                print(f"🎯 Evaluating {len(conditions)} condition(s) with {condition_logic} logic")
                
                # Track which branches have conditions defined
                branches_with_conditions = set(cond.get('branchIndex', 0) for cond in conditions)
                
                # Evaluate each branch against all conditions
                for branch_idx, (pred_node_id, branch_result) in enumerate(predecessor_results):
                    branch_matches = []
                    has_conditions = False
                    failed_condition_details = []
                    
                    for cond_idx, condition in enumerate(conditions):
                        branch_index = condition.get('branchIndex', 0)
                        field = condition.get('field', 'statusCode')
                        operator = condition.get('operator', 'equals')
                        expected_value = condition.get('value', '')
                        
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
                                self.logger.info(f"  ✓ Branch {branch_idx} ({pred_node_id}) matched condition {cond_idx + 1}: {field} {operator} {expected_value}")
                                print(f"  ✓ Branch {branch_idx} ({pred_node_id}) matched: {field} {operator} {expected_value}")
                            else:
                                self.logger.info(f"  ✗ Branch {branch_idx} ({pred_node_id}) did NOT match condition {cond_idx + 1}: {field} {operator} {expected_value} (got {actual_value})")
                                print(f"  ✗ Branch {branch_idx} ({pred_node_id}) did NOT match: {field} {operator} {expected_value} (got {actual_value})")
                                failed_condition_details.append({
                                    'field': field,
                                    'operator': operator,
                                    'expected': expected_value,
                                    'actual': actual_value
                                })
                    
                    # Decide if branch should be merged based on logic
                    if has_conditions:
                        # This branch has conditions - evaluate them
                        if condition_logic == 'AND':
                            # AND: All conditions for this branch must match
                            if all(branch_matches):
                                merged_branches.append(branch_idx)
                                self.logger.info(f"  ✅ Branch {branch_idx} PASSED (matched ALL conditions)")
                                print(f"  ✅ Branch {branch_idx} PASSED (matched ALL conditions)")
                            else:
                                failed_branches.append({
                                    'index': branch_idx,
                                    'nodeId': pred_node_id,
                                    'logic': 'AND',
                                    'failures': failed_condition_details
                                })
                                self.logger.info(f"  ❌ Branch {branch_idx} FAILED (did not match ALL conditions)")
                                print(f"  ❌ Branch {branch_idx} FAILED (did not match ALL conditions)")
                        else:  # OR
                            # OR: At least one condition for this branch must match
                            if any(branch_matches):
                                merged_branches.append(branch_idx)
                                self.logger.info(f"  ✅ Branch {branch_idx} PASSED (matched at least ONE condition)")
                                print(f"  ✅ Branch {branch_idx} PASSED (matched at least ONE condition)")
                            else:
                                failed_branches.append({
                                    'index': branch_idx,
                                    'nodeId': pred_node_id,
                                    'logic': 'OR',
                                    'failures': failed_condition_details
                                })
                                self.logger.info(f"  ❌ Branch {branch_idx} FAILED (did not match ANY conditions)")
                                print(f"  ❌ Branch {branch_idx} FAILED (did not match ANY conditions)")
                    else:
                        # This branch has NO conditions - include it by default
                        merged_branches.append(branch_idx)
                        self.logger.info(f"  ✅ Branch {branch_idx} PASSED (no conditions defined)")
                        print(f"  ✅ Branch {branch_idx} PASSED (no conditions defined)")
                
                merged_count = len(merged_branches)
                failed_count = len(failed_branches)
                
                # If ANY branch failed conditions, the merge FAILS (like an assertion)
                if failed_count > 0:
                    self.logger.error(f"❌ Conditional merge FAILED: {failed_count} branch(es) did not meet conditions")
                    print(f"❌ Conditional merge FAILED: {failed_count}/{branch_count} branch(es) did not meet conditions")
                    
                    # Build detailed error message
                    error_details = []
                    for failure in failed_branches:
                        error_details.append(f"Branch {failure['index']} ({failure['nodeId']})")
                        for fail_cond in failure['failures']:
                            error_details.append(f"  - {fail_cond['field']} {fail_cond['operator']} {fail_cond['expected']} (got {fail_cond['actual']})")
                    
                    error_message = f"Conditional merge failed: {failed_count} branch(es) did not match conditions:\n" + "\n".join(error_details)
                    
                    # Mark as completed but with error
                    self.merge_completed[node_id] = True
                    
                    # Raise exception to fail the workflow (unless continueOnFail)
                    raise Exception(error_message)
                
                print(f"✅ Conditional merge PASSED: All {branch_count} branches matched conditions using {condition_logic} logic")
                
                # Store ALL branch results (not filtered, since all passed)
                self.branch_results[node_id] = predecessor_results
                
                # Mark merge as completed
                self.merge_completed[node_id] = True
                
                print(f"✅ Conditional merge PASSED: All {branch_count} branches matched conditions using {condition_logic} logic")
                
                # Store ALL branch results (not filtered, since all passed)
                self.branch_results[node_id] = predecessor_results
                
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
                    "mergedAt": datetime.now(UTC).isoformat()
                }
            
            print(f"🔀 Merge node executed with strategy '{merge_strategy}': {branch_count} branches merged")
            
            # Store branch results for this merge node (for downstream nodes to use in prev[N])
            self.branch_results[node_id] = predecessor_results
            
            # Mark merge as completed
            self.merge_completed[node_id] = True
            
            # Add warning if using ANY/FIRST with multiple predecessors
            warning = None
            if merge_strategy in ['any', 'first'] and len(predecessor_node_ids) > branch_count:
                warning = f"⚠️ Using '{merge_strategy}' strategy: Only {branch_count} of {len(predecessor_node_ids)} branch(es) available. Downstream nodes using prev[N] may fail if N >= {branch_count}."
                print(warning)
            
            result = {
                "status": "success",
                "message": f"Merged {branch_count} branches using '{merge_strategy}' strategy",
                "mergeStrategy": merge_strategy,
                "branchCount": branch_count,
                "branches": branch_info,  # NEW: Include branch info for reference
                "mergedAt": datetime.now(UTC).isoformat()
            }
            
            if warning:
                result["warning"] = warning
            
            return result
    
    def _evaluate_assertion(self, assertion: Dict) -> Dict[str, Any]:
        """Evaluate a single assertion"""
        source = assertion.get('source', 'prev')
        path = assertion.get('path', '')
        operator = assertion.get('operator', 'equals')
        expected_value = assertion.get('expectedValue', '')
        
        # Get the actual value based on source
        if source == 'prev':
            # Get the last HTTP request result (skip non-data nodes like delay, assertion, merge)
            last_result = None
            for result in reversed(list(self.results.values())):
                # Only consider HTTP request nodes
                if result.get('type') == 'http-request':
                    last_result = result
                    break
            
            if not last_result:
                self.logger.error(f"❌ Assertion: No previous HTTP request found for 'prev' source")
                return {"passed": False, "message": "No previous HTTP request result found"}
            
            # Path should be relative to result (e.g., "body.data[0].code" not "response.body.data[0].code")
            # Remove "response." prefix if present for backward compatibility
            clean_path = path
            if path.startswith('response.'):
                clean_path = path[9:]  # Remove "response." prefix
                self.logger.info(f"🔧 Assertion: Cleaned path '{path}' to '{clean_path}'")
            
            actual_value = self._get_nested_value(last_result, clean_path)
            self.logger.debug(f"🔍 Assertion: source=prev, path={clean_path}, value={actual_value}")
        elif source == 'variables':
            actual_value = self.workflow_variables.get(path)
            self.logger.debug(f"🔍 Assertion: source=variables, path={path}, value={actual_value}")
        elif source == 'status':
            # For status, use the last HTTP response status
            last_result = list(self.results.values())[-1] if self.results else {}
            actual_value = last_result.get('statusCode')
            self.logger.debug(f"🔍 Assertion: source=status, value={actual_value}")
        elif source == 'cookies':
            # Get cookies from last HTTP response
            last_result = list(self.results.values())[-1] if self.results else {}
            cookies = last_result.get('cookies', {})
            actual_value = cookies.get(path)
            self.logger.debug(f"🔍 Assertion: source=cookies, path={path}, value={actual_value}")
        elif source == 'headers':
            # Get headers from last HTTP response
            last_result = list(self.results.values())[-1] if self.results else {}
            headers = last_result.get('headers', {})
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
        if operator == 'exists':
            return actual is not None
        elif operator == 'notExists':
            return actual is None
        
        # Handle 'count' operator - get length of arrays/lists/dicts/strings
        if operator == 'count':
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
        
        # For other operators with count values, convert list to count first
        # Check if we should use count (if actual is a list and operator expects numeric comparison)
        is_list = isinstance(actual, (list, dict, str))
        if is_list and operator in ['gt', 'gte', 'lt', 'lte', 'equals', 'notEquals']:
            try:
                actual = len(actual)
            except:
                pass
        
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
