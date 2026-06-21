"""
Workspace routes package — combines CRUD, members, projects, workflows, runs, and import sub-routers.

Re-exports every name that tests or other modules patch via ``app.routes.workspaces.<name>``
so that the package split is transparent to callers.
"""

# Import submodules to register their routes on the shared router.
# Order matches the original monolithic file for consistent route matching.
from app.routes.workspaces import (  # noqa: F401
    imports,
    members,
    projects,
    runs,
    workflows,
    workspaces,
)

# Re-export the shared router so ``from app.routes.workspaces import router`` works.
from app.routes.workspaces._router import router as router

# Re-export route handler functions for backward compatibility (tests may patch these).
from app.routes.workspaces.imports import (  # noqa: F401
    import_curl,
    import_curl_dry_run,
    import_har,
    import_har_dry_run,
    import_openapi,
    import_openapi_dry_run,
    import_openapi_from_url,
    import_workflow,
    import_workflow_dry_run,
)

# Re-export request models for backward compatibility.
from app.routes.workspaces.members import (  # noqa: F401  # noqa: F401
    CollaboratorAddRequest,
    MemberAddRequest,
    MemberRoleUpdateRequest,
    add_collaborator,
    add_member,
    list_collaborators,
    list_members,
    remove_collaborator,
    remove_member,
    update_member_role,
)
from app.routes.workspaces.projects import (  # noqa: F401  # noqa: F401
    ProjectCreateRequest,
    ProjectUpdateRequest,
    assign_workflow_to_project,
    create_project,
    delete_project,
    get_project,
    list_projects,
    remove_workflow_from_project,
    update_project,
)
from app.routes.workspaces.runs import (  # noqa: F401
    get_latest_failed_run,
    get_node_result,
    get_run_status,
    list_workflow_runs,
    list_workspace_runs,
    trigger_workflow_run,
)
from app.routes.workspaces.workflows import (  # noqa: F401
    _get_verified_workspace,
    add_workflow_templates,
    clear_workflow_templates,
    create_workflow,
    delete_workflow,
    export_workflow,
    get_workflow,
    get_workflow_templates,
    list_workflows,
    replace_workflow_templates,
    update_workflow,
)
from app.routes.workspaces.workspaces import (  # noqa: F401  # noqa: F401
    WorkspaceCreateRequest,
    WorkspaceUpdateRequest,
    create_workspace,
    delete_workspace,
    get_workspace,
    list_workspaces,
    restore_workspace,
    update_workspace,
    workspaces_healthz,
)

# Re-export service modules so that ``mock.patch("app.routes.workspaces.workspace_service.X")``
# continues to work after the package split (tests patch service functions via this path).
from app.services import project_service as project_service
from app.services import scoped_workflow_service as scoped_workflow_service
from app.services import workspace_service as workspace_service
