"""
Soft-delete mixin for Beanie Document models.

Provides a reusable pattern for resources that need logical deletion
with recovery (restore) and hard-deletion (purge) semantics.

Usage::

    class MyModel(SoftDeleteMixin, Document):
        ...

    doc = await MyModel.get(...)
    await doc.soft_delete(by_user_id="user-123")
    await doc.restore()
    await doc.purge()  # hard delete
"""

from datetime import UTC, datetime


class DocumentSoftDeletedError(Exception):
    """Raised when attempting to write to a soft-deleted document."""

    def __init__(self, document_id: str, collection: str) -> None:
        self.document_id = document_id
        self.collection = collection
        super().__init__(
            f"Cannot modify soft-deleted {collection} document "
            f"(id={document_id}). Restore it first or use purge()."
        )


class SoftDeleteMixin:
    """Mixin that adds soft-delete fields and lifecycle methods.

    Mixin classes must be placed *before* ``Document`` in the MRO so that
    ``save()`` and ``insert()`` overrides work correctly::

        class MyModel(SoftDeleteMixin, Document):
            ...
    """

    deleted_at: datetime | None = None
    deleted_by: str | None = None

    async def soft_delete(self, by_user_id: str) -> None:
        """Mark this document as soft-deleted.

        Sets ``deleted_at`` and ``deleted_by`` fields and persists the change.
        Subsequent ``save()`` or ``insert()`` calls will raise
        ``DocumentSoftDeletedError`` until ``restore()`` is called.
        """
        self.deleted_at = datetime.now(UTC)
        self.deleted_by = by_user_id
        await self.save()

    async def restore(self) -> None:
        """Restore a previously soft-deleted document.

        Clears ``deleted_at`` and ``deleted_by`` so normal writes resume.
        """
        self.deleted_at = None
        self.deleted_by = None
        await self.save()

    async def purge(self) -> None:
        """Permanently remove this document from the database.

        This is a true hard-delete. The document cannot be recovered.
        """
        await self.delete()  # type: ignore[attr-defined]

    def raise_if_deleted(self) -> None:
        """Check whether this document is soft-deleted and raise if so.

        Call this in repository methods before performing writes on models
        that use the mixin to enforce the soft-delete guard.
        """
        if self.deleted_at is not None:
            raise DocumentSoftDeletedError(
                document_id=str(getattr(self, "id", "unknown")),
                collection=str(getattr(self, "get_collection_name", lambda: "unknown")()),
            )

    async def save(self, *args: object, **kwargs: object) -> None:
        """Override save to reject writes on soft-deleted documents.

        Calls ``raise_if_deleted()`` before delegating to the parent
        ``Document.save()``.
        """
        self.raise_if_deleted()
        return await super().save(*args, **kwargs)  # type: ignore[misc, no-any-return]

    async def insert(self, *args: object, **kwargs: object) -> None:
        """Override insert to reject writes on soft-deleted documents.

        Calls ``raise_if_deleted()`` before delegating to the parent
        ``Document.insert()``.
        """
        self.raise_if_deleted()
        return await super().insert(*args, **kwargs)  # type: ignore[misc, no-any-return]
