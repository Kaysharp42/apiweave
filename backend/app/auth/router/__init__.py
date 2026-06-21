"""Auth router package — backward-compatible public surface.

The original ``app/auth/router.py`` was split into this package.  Every name
that was previously accessible as ``app.auth.router.<name>`` is re-exported
here so that existing imports (including test monkey-patches) keep working.
"""

from __future__ import annotations

import logging

# IMPORTANT: ``settings`` must be bound *before* any submodule import because
# ``_helpers._SettingsProxy`` resolves it from this namespace at call time.
from app.config import settings as settings
from app.repositories.auth_repositories import (
    ApprovedDomainRepository as ApprovedDomainRepository,
)
from app.repositories.auth_repositories import (
    DeletedUserRepository as DeletedUserRepository,
)
from app.repositories.auth_repositories import (
    InviteRepository as InviteRepository,
)
from app.repositories.auth_repositories import (
    OAuthStateRepository as OAuthStateRepository,
)
from app.repositories.auth_repositories import (
    ProviderIdentityRepository as ProviderIdentityRepository,
)
from app.repositories.auth_repositories import (
    SessionRepository as SessionRepository,
)
from app.repositories.auth_repositories import (
    UserRepository as UserRepository,
)
from app.services.bootstrap import ensure_personal_workspace as ensure_personal_workspace

# Importing the submodules triggers route registration on the shared *router*.
from . import _domains as _domains
from . import _helpers as _helpers
from . import _invites as _invites
from . import _oauth as _oauth
from . import _providers as _providers
from . import _session as _session

# -- Re-export every public name from the original router.py ----------------
from ._domains import (
    AddDomainRequest as AddDomainRequest,
)
from ._domains import (
    ApprovedDomainResponse as ApprovedDomainResponse,
)
from ._domains import (
    add_approved_domain as add_approved_domain,
)
from ._domains import (
    list_approved_domains as list_approved_domains,
)
from ._domains import (
    remove_approved_domain as remove_approved_domain,
)
from ._helpers import (
    _constant_time_match as _constant_time_match,
)
from ._helpers import (
    _create_or_link_user as _create_or_link_user,
)
from ._helpers import (
    _create_session as _create_session,
)
from ._helpers import (
    _email_domain as _email_domain,
)
from ._helpers import (
    _frontend_login_error as _frontend_login_error,
)
from ._helpers import (
    _frontend_url as _frontend_url,
)
from ._helpers import (
    _is_domain_approved as _is_domain_approved,
)
from ._helpers import (
    _reconcile_orphan_invite as _reconcile_orphan_invite,
)
from ._helpers import (
    _redirect_uri as _redirect_uri,
)
from ._helpers import (
    _session_hash as _session_hash,
)
from ._helpers import (
    _user_response as _user_response,
)
from ._helpers import (
    _validate_nonce as _validate_nonce,
)
from ._helpers import (
    enforce_approved_domain as enforce_approved_domain,
)
from ._invites import (
    CreateInviteRequest as CreateInviteRequest,
)
from ._invites import (
    CreateInviteResponse as CreateInviteResponse,
)
from ._invites import (
    create_invite as create_invite,
)
from ._invites import (
    list_invites as list_invites,
)
from ._oauth import (
    logout as logout,
)
from ._oauth import (
    oauth_callback as oauth_callback,
)
from ._oauth import (
    oauth_login as oauth_login,
)
from ._oauth import (
    signout as signout,
)
from ._providers import (
    deployment_mode as deployment_mode,
)
from ._providers import (
    list_providers as list_providers,
)
from ._router import (
    CSRF_COOKIE_NAME as CSRF_COOKIE_NAME,
)
from ._router import (
    SESSION_COOKIE_NAME as SESSION_COOKIE_NAME,
)
from ._router import (
    SESSION_MAX_AGE_SECONDS as SESSION_MAX_AGE_SECONDS,
)
from ._router import (
    router as router,
)
from ._session import (
    csrf_token as csrf_token,
)
from ._session import (
    me as me,
)
from ._session import (
    touch_session as touch_session,
)

logger = logging.getLogger(__name__)
