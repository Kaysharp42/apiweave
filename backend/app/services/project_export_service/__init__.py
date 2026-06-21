"""
Project Export/Import Service — schema v2 for .awecollection files.

Schema v2 uses Project terminology and includes secret *references* only.
Secret definitions, ciphertext, plaintext values, and private keys are
NEVER serialized into the export bundle.

Import flow validates secret references against the target workspace and
returns warnings for any missing references.
"""

# Repository imports MUST come first — submodules use `from . import X`
# inside functions to enable test patching at the package level.
from app.repositories.project_repository import ProjectRepository as ProjectRepository
from app.repositories.scoped_environment_repository import (
    ScopedEnvironmentRepository as ScopedEnvironmentRepository,
)
from app.repositories.secret_repository import SecretRepository as SecretRepository
from app.repositories.workflow_repository import WorkflowRepository as WorkflowRepository
from app.repositories.workspace_repository import WorkspaceRepository as WorkspaceRepository

from .constants import _FORBIDDEN_EXPORT_KEYS as _FORBIDDEN_EXPORT_KEYS
from .constants import _SECRET_REF_RE as _SECRET_REF_RE
from .constants import SCHEMA_VERSION as SCHEMA_VERSION
from .export import _collect_refs as _collect_refs
from .export import _collect_refs_from_config as _collect_refs_from_config
from .export import _sanitize_variables_for_export as _sanitize_variables_for_export
from .export import export_project_v2 as export_project_v2
from .import_ import _check_secret_exists as _check_secret_exists
from .import_ import dry_run_import_v2 as dry_run_import_v2
from .import_ import import_project_v2 as import_project_v2
from .secrets import _extract_secret_refs_from_string as _extract_secret_refs_from_string
from .secrets import _extract_secret_refs_from_struct as _extract_secret_refs_from_struct
from .secrets import _sanitize_export_value as _sanitize_export_value
from .validation import _check_no_secret_values as _check_no_secret_values
from .validation import _validate_bundle_structure as _validate_bundle_structure
