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

import uuid
from collections.abc import AsyncGenerator

import pytest
from beanie import Document, init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ServerSelectionTimeoutError

from app.config import settings
from app.utils.soft_delete import DocumentSoftDeletedError, SoftDeleteMixin

# ── Test model ──────────────────────────────────────────────────


class SoftDeleteTestModel(SoftDeleteMixin, Document):
    """Temporary Beanie model for soft-delete tests."""

    name: str
    value: str

    class Settings:
        name = "soft_delete_test"


# ── Fixtures ────────────────────────────────────────────────────


def _mongodb_available() -> bool:
    try:
        import asyncio

        async def _check() -> bool:
            client: AsyncIOMotorClient = AsyncIOMotorClient(
                settings.MONGODB_URL, serverSelectionTimeoutMS=2000
            )
            await client.admin.command("ping")
            await client.close()
            return True

        return asyncio.get_event_loop().run_until_complete(_check())
    except (ServerSelectionTimeoutError, Exception):
        return False


requires_mongodb = pytest.mark.skipif(
    not _mongodb_available(),
    reason="MongoDB not available or unreachable",
)


@pytest.fixture(scope="module")
async def init_beanie_once() -> AsyncGenerator[None, None]:
    """Initialize Beanie with the test model (runs once per module)."""
    client: AsyncIOMotorClient = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.MONGODB_DB_NAME + "_test_soft_delete"]
    await init_beanie(database=db, document_models=[SoftDeleteTestModel])
    yield
    # Drop the test collection and close connection
    await db.drop_collection("soft_delete_test")
    client.close()


@pytest.fixture
async def sample_doc(
    init_beanie_once: None,
) -> AsyncGenerator[SoftDeleteTestModel, None]:
    """Create a fresh test document for each test."""
    doc = SoftDeleteTestModel(
        id=uuid.uuid4().hex,
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

    @requires_mongodb
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

    @requires_mongodb
    async def test_restore_clears_fields(self, sample_doc: SoftDeleteTestModel) -> None:
        """Restore clears deleted_at and deleted_by."""
        await sample_doc.soft_delete(by_user_id="user-abc")
        assert sample_doc.deleted_at is not None

        await sample_doc.restore()

        reloaded = await SoftDeleteTestModel.get(sample_doc.id)
        assert reloaded is not None
        assert reloaded.deleted_at is None
        assert reloaded.deleted_by is None

    @requires_mongodb
    async def test_purge_removes_document(self, sample_doc: SoftDeleteTestModel) -> None:
        """Purge permanently deletes the document."""
        await sample_doc.purge()

        gone = await SoftDeleteTestModel.get(sample_doc.id)
        assert gone is None

    @requires_mongodb
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

    @requires_mongodb
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

    @requires_mongodb
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

    @requires_mongodb
    async def test_raise_if_deleted_method(self, sample_doc: SoftDeleteTestModel) -> None:
        """raise_if_deleted() can be called explicitly."""
        # Should not raise on fresh doc
        sample_doc.raise_if_deleted()

        await sample_doc.soft_delete(by_user_id="user-abc")

        with pytest.raises(DocumentSoftDeletedError):
            sample_doc.raise_if_deleted()

    @requires_mongodb
    async def test_read_after_purge_returns_none(
        self,
        sample_doc: SoftDeleteTestModel,
    ) -> None:
        """Read-after-purge returns None."""
        await sample_doc.purge()
        result = await SoftDeleteTestModel.get(sample_doc.id)
        assert result is None
