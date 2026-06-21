"""
Webhook routes package — combines management (CRUD) and execution sub-routers.

Re-exports every name that tests or other modules patch via ``app.routes.webhooks.<name>``
so that the package split is transparent to callers.
"""

from app.config import settings  # noqa: F401
from app.idempotency import get_idempotency_entry, store_idempotency_entry  # noqa: F401
from app.middleware.webhook_auth import resolve_webhook_actor  # noqa: F401
from app.models import Run, WebhookLog  # noqa: F401
from app.repositories import (  # noqa: F401
    CollectionRepository,
    CollectionRunRepository,
    RunRepository,
    WebhookRepository,
    WorkflowRepository,
)
from app.routes.webhooks._router import router as router
from app.routes.webhooks.collection_execution import (  # noqa: F401
    execute_collection_webhook,
)
from app.routes.webhooks.management import (  # noqa: F401
    create_webhook,
    delete_webhook,
    get_webhook,
    get_webhook_logs,
    list_collection_webhooks,
    list_workflow_webhooks,
    regenerate_webhook_token,
    require_webhook_owner_or_admin,
    update_webhook,
)
from app.routes.webhooks.validation import (  # noqa: F401
    _get_protection,
    _require_hmac_when_configured,
)
from app.routes.webhooks.workflow_execution import (  # noqa: F401
    execute_workflow_webhook,
)
from app.runner.executor import WorkflowExecutor  # noqa: F401
from app.services import audit_service  # noqa: F401
from app.services.environment_protection_service import (  # noqa: F401
    bypass_protection,
    check_protection_and_maybe_gate,
)
from app.services.webhook_runner import (  # noqa: F401
    QueueFull,
    WebhookDelivery,
    webhook_runner,
)
