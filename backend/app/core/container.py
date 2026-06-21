from dependency_injector import containers, providers

from app.repositories.audit_repository import AuditRepository
from app.repositories.auth_repositories import (
    ApprovedDomainRepository,
    InviteRepository,
    ProviderIdentityRepository,
    SessionRepository,
    UserRepository,
)
from app.repositories.collection_repository import CollectionRepository
from app.repositories.collection_run_repository import CollectionRunRepository
from app.repositories.environment_repository import EnvironmentRepository
from app.repositories.org_invite_repository import OrgInviteRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.run_repository import RunRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.repositories.secret_repository import SecretBindingRepository, SecretRepository
from app.repositories.service_token_repository import ServiceTokenRepository
from app.repositories.team_permission_grant_repository import TeamPermissionGrantRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.webhook_repository import WebhookRepository
from app.repositories.workflow_repository import WorkflowRepository
from app.repositories.workspace_repository import WorkspaceRepository


class Container(containers.DeclarativeContainer):
    """Dependency injection container for APIWeave.

    Provides singleton instances of repositories and services.
    Use with FastAPI's Depends() for clean dependency injection.
    """

    wiring_config = containers.WiringConfiguration(
        modules=[
            "app.routes.runs",
            "app.routes.webhooks",
            "app.routes.secrets",
            "app.routes.service_tokens",
            "app.routes.workspaces",
            "app.routes.scoped_environments",
        ],
    )

    # Repositories (stateless singletons)
    workflow_repository = providers.Singleton(WorkflowRepository)
    run_repository = providers.Singleton(RunRepository)
    collection_repository = providers.Singleton(CollectionRepository)
    collection_run_repository = providers.Singleton(CollectionRunRepository)
    environment_repository = providers.Singleton(EnvironmentRepository)
    scoped_environment_repository = providers.Singleton(ScopedEnvironmentRepository)
    secret_repository = providers.Singleton(SecretRepository)
    secret_binding_repository = providers.Singleton(SecretBindingRepository)
    service_token_repository = providers.Singleton(ServiceTokenRepository)
    webhook_repository = providers.Singleton(WebhookRepository)
    workspace_repository = providers.Singleton(WorkspaceRepository)
    project_repository = providers.Singleton(ProjectRepository)
    organization_repository = providers.Singleton(OrganizationRepository)
    audit_repository = providers.Singleton(AuditRepository)

    # Auth repositories
    user_repository = providers.Singleton(UserRepository)
    session_repository = providers.Singleton(SessionRepository)
    invite_repository = providers.Singleton(InviteRepository)
    approved_domain_repository = providers.Singleton(ApprovedDomainRepository)
    provider_identity_repository = providers.Singleton(ProviderIdentityRepository)

    # Team repositories
    team_repository = providers.Singleton(TeamRepository)
    team_permission_grant_repository = providers.Singleton(TeamPermissionGrantRepository)
    org_invite_repository = providers.Singleton(OrgInviteRepository)
