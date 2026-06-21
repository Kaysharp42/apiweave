"""Mixin: secret resolution and masking methods for WorkflowExecutor."""

import re
from typing import Any

from app.runner.executor.context import RunContext


class _SecretsMixin:
    """Secret resolution and masking methods."""

    async def _collect_and_resolve_secrets(self, workflow: dict) -> None:
        """Scan workflow for secret references and resolve them through the chain."""
        if not self.run_context:
            return

        from app.repositories.secret_repository import SecretRepository
        from app.services.audit_resolver_helper import resolve_secret_with_audit
        from app.services.scoped_secret_resolver import resolve_secret

        ctx = self.run_context
        needed_names = self._scan_secret_refs(workflow)
        if not needed_names:
            self.logger.info("No {{secrets.*}} references found in workflow")
            return

        resolved: dict[str, str] = {}

        for secret_name in needed_names:
            plaintext = await self._resolve_single_secret(
                secret_name,
                ctx,
                SecretRepository,
                resolve_secret,
                resolve_secret_with_audit,
            )
            if plaintext is not None:
                resolved[secret_name] = plaintext

        self.secrets.update(resolved)
        self.logger.info(
            "Resolved %d/%d scoped secret(s) for run %s",
            len(resolved),
            len(needed_names),
            self.run_id,
        )

    def _scan_secret_refs(self, workflow: dict) -> set[str]:
        """Scan workflow nodes and edges for {{secrets.NAME}} patterns."""
        names: set[str] = set()
        pattern = re.compile(r"\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

        for node in workflow.get("nodes", []):
            config = node.get("config") or {}
            for value in self._iter_config_values(config):
                if isinstance(value, str):
                    names.update(pattern.findall(value))

        return names

    def _iter_config_values(self, obj: Any) -> list[Any]:
        """Recursively collect all string values from a config dict."""
        values: list[Any] = []
        if isinstance(obj, str):
            values.append(obj)
        elif isinstance(obj, dict):
            for v in obj.values():
                values.extend(self._iter_config_values(v))
        elif isinstance(obj, list):
            for item in obj:
                values.extend(self._iter_config_values(item))
        return values

    async def _resolve_single_secret(
        self,
        name: str,
        ctx: "RunContext",
        secret_repo: type,
        resolver_fn: Any,
        audit_fn: Any,
    ) -> str | None:
        """Resolve a single secret through the override chain.

        Returns the plaintext value or None if not found in any scope.
        """
        chain = self._build_scope_chain(ctx)

        for scope_type, scope_id in chain:
            secret_doc = await secret_repo.get_by_scope_and_name(scope_type, scope_id, name)
            if secret_doc is None:
                continue

            try:
                plaintext = await resolver_fn(
                    scope_type=scope_type,
                    scope_id=scope_id,
                    ciphertext_b64=secret_doc.ciphertext,
                    key_id=secret_doc.keyId,
                )
            except Exception as exc:
                self.logger.error(
                    "Failed to decrypt secret %s at scope %s:%s: %s",
                    name,
                    scope_type,
                    scope_id,
                    exc,
                )
                raise

            # Audit the resolution (fail-closed)
            audit_scope = (
                "environment"
                if scope_type == "environment"
                else ("workspace" if scope_type == "workspace" else "org")
            )
            try:
                await audit_fn(
                    actor=ctx.actor_type,  # type: ignore[arg-type]
                    actor_id=ctx.actor_id,
                    scope=audit_scope,  # type: ignore[arg-type]
                    scope_id=scope_id,
                    run_id=self.run_id,
                    node_id="executor",
                    secret_name=name,
                    key_id=secret_doc.keyId,
                    resolved_value=plaintext,
                    resource_id=secret_doc.secretId,
                )
            except Exception:
                # Fail closed — do not use the secret if audit fails
                self.logger.error(
                    "Audit write failed for secret %s resolution — failing closed",
                    name,
                )
                raise

            self.logger.info(
                "Resolved secret %s from scope %s:%s",
                name,
                scope_type,
                scope_id,
            )
            return plaintext

        self.logger.warning("Secret %s not found in any scope", name)
        return None

    def _build_scope_chain(self, ctx: "RunContext") -> list[tuple[str, str]]:
        """Build the override chain: Environment > Workspace > Organization."""
        chain: list[tuple[str, str]] = []

        # 1. Environment scope (highest priority)
        if ctx.environment_id:
            chain.append(("environment", ctx.environment_id))

        # 2. Workspace scope
        if ctx.workspace_id:
            chain.append(("workspace", ctx.workspace_id))

        # 3. Organization scope (lowest priority)
        if ctx.org_id:
            chain.append(("organization", ctx.org_id))

        return chain

    def _rebuild_masker(self) -> None:
        """Rebuild the SecretMasker from current resolved secrets."""
        from app.services.secret_utils import SecretMasker

        self._masker = SecretMasker(self.secrets)

    def _ensure_masker(self) -> None:
        """Lazily build masker if secrets exist but masker hasn't been built."""
        if self._masker is None and self.secrets:
            self._rebuild_masker()

    def _mask_result_secrets(self, obj: Any) -> Any:
        """Mask resolved secret values in result objects (value-based only)."""
        self._ensure_masker()
        if self._masker and self._masker.has_secrets:
            return self._masker.mask_struct(obj)
        return obj

    def _mask_secrets(self, text: str) -> str:
        """Mask resolved secret values in log text (value-based only)."""
        if not text or not isinstance(text, str):
            return text
        self._ensure_masker()
        if self._masker and self._masker.has_secrets:
            return self._masker.mask_text(text)
        return text
