"""
Scoped Environment routes package — combines user, org, and workspace sub-routers.

Re-exports every name that tests or other modules patch via
``app.routes.scoped_environments.<name>`` so that the package split is
transparent to callers.
"""

# Import submodules to register their routes on the shared router.
# Order matches the original monolithic file for consistent route matching.
from app.routes.scoped_environments import (
    org_environments as org_environments,
)
from app.routes.scoped_environments import (
    user_environments as user_environments,
)
from app.routes.scoped_environments import (
    workspace_environments as workspace_environments,
)

# Re-export the shared router so ``from app.routes.scoped_environments import router`` works.
from app.routes.scoped_environments._router import router as router
from app.routes.scoped_environments.org_environments import (
    create_org_environment as create_org_environment,
)
from app.routes.scoped_environments.org_environments import (
    delete_org_environment as delete_org_environment,
)
from app.routes.scoped_environments.org_environments import (
    get_org_environment as get_org_environment,
)
from app.routes.scoped_environments.org_environments import (
    list_org_environments as list_org_environments,
)
from app.routes.scoped_environments.org_environments import (
    list_org_envs_for_workspace as list_org_envs_for_workspace,
)
from app.routes.scoped_environments.org_environments import (
    set_org_env_allowed_workspaces as set_org_env_allowed_workspaces,
)
from app.routes.scoped_environments.org_environments import (
    update_org_environment as update_org_environment,
)
from app.routes.scoped_environments.user_environments import (
    _handle_service_error as _handle_service_error,
)
from app.routes.scoped_environments.user_environments import (
    create_user_environment as create_user_environment,
)
from app.routes.scoped_environments.user_environments import (
    delete_user_environment as delete_user_environment,
)
from app.routes.scoped_environments.user_environments import (
    get_user_environment as get_user_environment,
)
from app.routes.scoped_environments.user_environments import (
    list_user_environments as list_user_environments,
)
from app.routes.scoped_environments.user_environments import (
    update_user_environment as update_user_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    create_workspace_environment as create_workspace_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    delete_environment_protection as delete_environment_protection,
)
from app.routes.scoped_environments.workspace_environments import (
    delete_workspace_environment as delete_workspace_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    duplicate_workspace_environment as duplicate_workspace_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    get_environment_protection as get_environment_protection,
)
from app.routes.scoped_environments.workspace_environments import (
    get_workspace_default_environment as get_workspace_default_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    get_workspace_environment as get_workspace_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    list_all_accessible_environments as list_all_accessible_environments,
)
from app.routes.scoped_environments.workspace_environments import (
    list_workspace_environments as list_workspace_environments,
)
from app.routes.scoped_environments.workspace_environments import (
    resolve_run_environment as resolve_run_environment,
)
from app.routes.scoped_environments.workspace_environments import (
    update_environment_protection as update_environment_protection,
)
from app.routes.scoped_environments.workspace_environments import (
    update_workspace_environment as update_workspace_environment,
)

# Re-export service module so that ``mock.patch("app.routes.scoped_environments.svc")``
# continues to work after the package split.
from app.services import scoped_environment_service as scoped_environment_service

# Backward-compatible alias: original module exposed this as ``svc``.
svc = scoped_environment_service
