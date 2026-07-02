"""
Tests for SoftDeleteMixin.

Covers:
  - soft_delete sets deleted_at and deleted_by
  - restore clears deleted_at and deleted_by
  - purge permanently removes the document
  - save() raises DocumentSoftDeletedError on soft-deleted document
  - insert() raises DocumentSoftDeletedError on already-deleted document
  - read-after-purge returns None
"""

from collections.abc import AsyncGenerator

import mongomock
import pytest
from app.utils.soft_delete import DocumentSoftDeletedError, SoftDeleteMixin
from beanie import Document, init_beanie
from mongomock_motor import AsyncMongoMockClient

# Beanie calls list_collection_names(authorizedCollections=..., nameOnly=...);
# mongomock's signature rejects those kwargs. Swallow extras (test-only shim).
_orig_list_collection_names = mongomock.database.Database.list_collection_names


def _list_collection_names(self, *args, **kwargs):  # noqa: ANN001, ANN202
    return _orig_list_collection_names(self)


mongomock.database.Database.list_collection_names = _list_collection_names

# ── Test model ──────────────────────────────────────────────────


class SoftDeleteTestModel(SoftDeleteMixin, Document):
    """Temporary Beanie model for soft-delete tests."""

    name: str
    value: str

    class Settings:
        name = "soft_delete_test"


# ── Fixtures ────────────────────────────────────────────────────


@pytest.fixture(scope="module")
async def init_beanie_once() -> AsyncGenerator[None, None]:
    """Initialize Beanie with the test model against in-memory mongomock."""
    client = AsyncMongoMockClient()
    db = client["soft_delete_test_db"]
    await init_beanie(database=db, document_models=[SoftDeleteTestModel])
    yield
    client.close()


@pytest.fixture
async def sample_doc(
    init_beanie_once: None,
) -> AsyncGenerator[SoftDeleteTestModel, None]:
    """Create a fresh test document for each test."""
    doc = SoftDeleteTestModel(
        name="test-resource",
        value="some-value",
    )
    await doc.insert()
    yield doc
    # Hard cleanup after test
    try:
        await doc.purge()
    except Exception:
        pass


# ── Tests ───────────────────────────────────────────────────────


class TestSoftDeleteMixin:
    """Tests for the SoftDeleteMixin lifecycle."""

    async def test_soft_delete_sets_fields(self, sample_doc: SoftDeleteTestModel) -> None:
        """Soft-deleting sets deleted_at and deleted_by."""
        assert sample_doc.deleted_at is None
        assert sample_doc.deleted_by is None

        await sample_doc.soft_delete(by_user_id="user-abc")

        # Reload from DB
        reloaded = await SoftDeleteTestModel.get(sample_doc.id)
        assert reloaded is not None
        assert reloaded.deleted_at is not None
        assert reloaded.deleted_by == "user-abc"

    async def test_restore_clears_fields(self, sample_doc: SoftDeleteTestModel) -> None:
        """Restore clears deleted_at and deleted_by."""
        await sample_doc.soft_delete(by_user_id="user-abc")
        assert sample_doc.deleted_at is not None

        await sample_doc.restore()

        reloaded = await SoftDeleteTestModel.get(sample_doc.id)
        assert reloaded is not None
        assert reloaded.deleted_at is None
        assert reloaded.deleted_by is None

    async def test_purge_removes_document(self, sample_doc: SoftDeleteTestModel) -> None:
        """Purge permanently deletes the document."""
        await sample_doc.purge()

        gone = await SoftDeleteTestModel.get(sample_doc.id)
        assert gone is None

    async def test_save_raises_on_deleted_document(
        self,
        sample_doc: SoftDeleteTestModel,
    ) -> None:
        """save() raises DocumentSoftDeletedError for soft-deleted documents."""
        await sample_doc.soft_delete(by_user_id="user-abc")

        with pytest.raises(DocumentSoftDeletedError) as exc_info:
            sample_doc.name = "updated-name"
            await sample_doc.save()

        assert "Cannot modify soft-deleted" in str(exc_info.value)

    async def test_insert_raises_on_deleted_document(
        self,
        sample_doc: SoftDeleteTestModel,
    ) -> None:
        """insert() raises DocumentSoftDeletedError if document is already soft-deleted."""
        # Insert a fresh doc, soft-delete it, try inserting it again
        await sample_doc.soft_delete(by_user_id="user-abc")

        with pytest.raises(DocumentSoftDeletedError) as exc_info:
            doc2 = SoftDeleteTestModel(
                id=sample_doc.id,
                name="attempt-reinsert",
                value="should-fail",
                deleted_at=sample_doc.deleted_at,
                deleted_by=sample_doc.deleted_by,
            )
            await doc2.insert()

        assert "Cannot modify soft-deleted" in str(exc_info.value)

    async def test_read_after_restore_succeeds(
        self,
        sample_doc: SoftDeleteTestModel,
    ) -> None:
        """After restore, the document can be read and written again."""
        await sample_doc.soft_delete(by_user_id="user-abc")
        await sample_doc.restore()

        sample_doc.name = "updated-after-restore"
        await sample_doc.save()

        reloaded = await SoftDeleteTestModel.get(sample_doc.id)
        assert reloaded is not None
        assert reloaded.name == "updated-after-restore"
        assert reloaded.deleted_at is None

    async def test_raise_if_deleted_method(self, sample_doc: SoftDeleteTestModel) -> None:
        """raise_if_deleted() can be called explicitly."""
        # Should not raise on fresh doc
        sample_doc.raise_if_deleted()

        await sample_doc.soft_delete(by_user_id="user-abc")

        with pytest.raises(DocumentSoftDeletedError):
            sample_doc.raise_if_deleted()

    async def test_read_after_purge_returns_none(
        self,
        sample_doc: SoftDeleteTestModel,
    ) -> None:
        """Read-after-purge returns None."""
        await sample_doc.purge()
        result = await SoftDeleteTestModel.get(sample_doc.id)
        assert result is None
