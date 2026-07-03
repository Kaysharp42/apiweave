"""Smoke tests for Beanie document models against in-memory mongomock.

Verifies the core documents (Workflow, Run, Environment, Project/Collection)
insert and query back correctly, and that Literal fields reject invalid values.
"""

import uuid
from datetime import UTC, datetime

import mongomock
import pytest
from app.models import Environment, Node, Project, Run, Workflow
from beanie import init_beanie
from mongomock_motor import AsyncMongoMockClient

# Beanie calls list_collection_names(authorizedCollections=..., nameOnly=...);
# mongomock's signature rejects those kwargs. Swallow extras (test-only shim).
_orig_list_collection_names = mongomock.database.Database.list_collection_names


def _list_collection_names(self, *args, **kwargs):  # noqa: ANN001, ANN202
    return _orig_list_collection_names(self)


mongomock.database.Database.list_collection_names = _list_collection_names

_MODELS = [Workflow, Run, Environment, Project]


@pytest.fixture
async def setup_db():
    """Init in-memory Beanie for the document models under test."""
    client = AsyncMongoMockClient()
    await init_beanie(database=client["beanie_docs_test"], document_models=_MODELS)
    yield
    client.close()


class TestWorkflowDocument:
    @pytest.mark.asyncio
    async def test_create_workflow(self, setup_db):
        workflow_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        workflow = Workflow(
            workflowId=workflow_id,
            name="Test Workflow",
            description="A test workflow for Beanie",
            nodes=[Node(nodeId="start_1", type="start", position={"x": 100, "y": 100})],
            edges=[],
            variables={},
            createdAt=now,
            updatedAt=now,
        )
        await workflow.insert()

        found = await Workflow.find_one(Workflow.workflowId == workflow_id)

        assert found is not None
        assert found.name == "Test Workflow"
        assert len(found.nodes) == 1
        assert found.nodes[0].type == "start"

        await found.delete()


class TestRunDocument:
    @pytest.mark.asyncio
    async def test_create_run(self, setup_db):
        run_id = str(uuid.uuid4())
        workflow_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        run = Run(
            runId=run_id,
            workflowId=workflow_id,
            status="pending",
            trigger="manual",
            createdAt=now,
        )
        await run.insert()

        found = await Run.find_one(Run.runId == run_id)

        assert found is not None
        assert found.workflowId == workflow_id
        assert found.status == "pending"
        assert found.trigger == "manual"

        await found.delete()

    def test_run_status_enum(self):
        """Run status must be one of the Literal enum values."""
        with pytest.raises(ValueError):
            Run(
                runId=str(uuid.uuid4()),
                workflowId=str(uuid.uuid4()),
                status="invalid_status",  # type: ignore[arg-type]
                trigger="manual",
                createdAt=datetime.now(UTC),
            )


class TestEnvironmentDocument:
    @pytest.mark.asyncio
    async def test_create_environment(self, setup_db):
        environment_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        env = Environment(
            environmentId=environment_id,
            name="Test Environment",
            variables={"API_URL": "https://api.example.com", "API_KEY": "test-key"},
            secrets={"DB_PASSWORD": "secret123"},
            createdAt=now,
            updatedAt=now,
        )
        await env.insert()

        found = await Environment.find_one(Environment.environmentId == environment_id)

        assert found is not None
        assert found.name == "Test Environment"
        assert found.variables["API_URL"] == "https://api.example.com"
        assert found.secrets["DB_PASSWORD"] == "secret123"

        await found.delete()


class TestCollectionDocument:
    @pytest.mark.asyncio
    async def test_create_collection(self, setup_db):
        collection_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        collection = Project(
            collectionId=collection_id,
            name="Test Collection",
            description="A test collection",
            color="#FF6B6B",
            createdAt=now,
            updatedAt=now,
        )
        await collection.insert()

        found = await Project.find_one(Project.collectionId == collection_id)

        assert found is not None
        assert found.name == "Test Collection"
        assert found.color == "#FF6B6B"

        await found.delete()
