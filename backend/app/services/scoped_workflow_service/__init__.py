"""
Scoped Workflow Service — workspace-scoped workflow CRUD, run, import/export, templates.

All workflow operations are scoped to a workspace. A user can only
access workflows within workspaces they have access to.
"""

from __future__ import annotations

import importlib as _importlib
import logging

logger = logging.getLogger(__name__)

# Shared dependencies — imported AFTER ``logger`` so submodules can reference
# them via the package namespace (``from . import X``). This keeps test
# monkeypatching working: ``monkeypatch.setattr(scoped_workflow_service.WorkspaceRepository, ...)``
# affects submodule lookups because they resolve names through the package.
# The ``as X`` aliases silence ruff F401 (these are intentional re-exports for
# submodules and test monkeypatching, not part of the public API).
from datetime import UTC as UTC  # noqa: E402
from datetime import datetime as datetime  # noqa: E402
from typing import Any as Any  # noqa: E402

from app.models import Run as Run  # noqa: E402
from app.models import Workflow as Workflow  # noqa: E402
from app.models import WorkflowCreate as WorkflowCreate  # noqa: E402
from app.models import WorkflowUpdate as WorkflowUpdate  # noqa: E402
from app.repositories.run_repository import (  # noqa: E402
    RunRepository as RunRepository,
)
from app.repositories.workflow_repository import (  # noqa: E402
    WorkflowRepository as WorkflowRepository,
)
from app.repositories.workspace_repository import (  # noqa: E402
    WorkspaceRepository as WorkspaceRepository,
)
from app.services.exceptions import (  # noqa: E402
    ResourceNotFoundError as ResourceNotFoundError,
)
from app.services.workspace_service import (  # noqa: E402
    _assert_workspace_access as _assert_workspace_access,
)

from ._helpers import _run_to_summary as _run_to_summary  # noqa: E402
from ._helpers import (  # noqa: E402
    _verify_workspace_and_workflow as _verify_workspace_and_workflow,
)
from ._helpers import _workflow_to_response as _workflow_to_response  # noqa: E402
from .crud import create_scoped_workflow as create_scoped_workflow  # noqa: E402
from .crud import delete_scoped_workflow as delete_scoped_workflow  # noqa: E402
from .crud import get_scoped_workflow as get_scoped_workflow  # noqa: E402
from .crud import list_scoped_workflows as list_scoped_workflows  # noqa: E402
from .crud import update_scoped_workflow as update_scoped_workflow  # noqa: E402
from .import_export import export_scoped_workflow as export_scoped_workflow  # noqa: E402
from .import_export import import_scoped_curl as import_scoped_curl  # noqa: E402
from .import_export import import_scoped_curl_dry_run as import_scoped_curl_dry_run  # noqa: E402
from .import_export import import_scoped_har as import_scoped_har  # noqa: E402
from .import_export import import_scoped_har_dry_run as import_scoped_har_dry_run  # noqa: E402
from .import_export import import_scoped_openapi as import_scoped_openapi  # noqa: E402
from .import_export import (  # noqa: E402
    import_scoped_openapi_dry_run as import_scoped_openapi_dry_run,
)
from .import_export import import_scoped_workflow as import_scoped_workflow  # noqa: E402
from .import_export import (  # noqa: E402
    import_scoped_workflow_dry_run as import_scoped_workflow_dry_run,
)
from .runs import get_scoped_latest_failed_run as get_scoped_latest_failed_run  # noqa: E402
from .runs import get_scoped_node_result as get_scoped_node_result  # noqa: E402
from .runs import get_scoped_run_status as get_scoped_run_status  # noqa: E402
from .runs import list_scoped_runs as list_scoped_runs  # noqa: E402
from .runs import trigger_scoped_run as trigger_scoped_run  # noqa: E402
from .templates import add_scoped_templates as add_scoped_templates  # noqa: E402
from .templates import clear_scoped_templates as clear_scoped_templates  # noqa: E402
from .templates import get_scoped_templates as get_scoped_templates  # noqa: E402
from .templates import replace_scoped_templates as replace_scoped_templates  # noqa: E402

__all__ = [
    "add_scoped_templates",
    "clear_scoped_templates",
    "create_scoped_workflow",
    "delete_scoped_workflow",
    "export_scoped_workflow",
    "get_scoped_latest_failed_run",
    "get_scoped_node_result",
    "get_scoped_run_status",
    "get_scoped_templates",
    "get_scoped_workflow",
    "import_scoped_curl",
    "import_scoped_curl_dry_run",
    "import_scoped_har",
    "import_scoped_har_dry_run",
    "import_scoped_openapi",
    "import_scoped_openapi_dry_run",
    "import_scoped_workflow",
    "import_scoped_workflow_dry_run",
    "list_scoped_runs",
    "list_scoped_workflows",
    "replace_scoped_templates",
    "trigger_scoped_run",
    "update_scoped_workflow",
]

_SUBMODULE_NAMES = {"crud", "runs", "import_export", "templates"}


def __getattr__(name: str):
    """Lazy-load submodules so `from scoped_workflow_service import crud` works
    without permanently polluting the package namespace."""
    if name in _SUBMODULE_NAMES:
        return _importlib.import_module(f".{name}", __name__)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    """Expose only the 23 public function names (matching the original monolith)."""
    return list(__all__)
