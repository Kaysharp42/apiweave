"""
Test Beanie document models to verify they work correctly
"""

import uuid

import pytest
from pymongo.errors import ServerSelectionTimeoutError

from app.database import close_db, connect_db
from app.models import Collection, Environment, Run, Workflow


@pytest.fixture(scope="function")
async def setup_db():
    """Setup database connection before each test (fixes event loop issues)"""
    await connect_db()
    yield
    await close_db()


def _mongodb_available():
    """Check if MongoDB is reachable"""
    try:
        import asyncio

        from motor.motor_asyncio import AsyncIOMotorClient

        from app.config import settings

        async def _check():
            client = AsyncIOMotorClient(settings.MONGODB_URL, serverSelectionTimeoutMS=2000)
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


class TestWorkflowDocument:
    """Test Workflow document operations"""

    @requires_mongodb
    async def test_create_workflow(self, setup_db):
        """Test creating a workflow document"""
        workflow_id = str(uuid.uuid4())

        workflow = Workflow(
            workflow_id=workflow_id,
            name="Test Workflow",
            description="A test workflow for Beanie",
            nodes=[
                {"id": "start_1", "type": "start", "position": {"x": 100, "y": 100}, "data": {}}
            ],
            edges=[],
            variables={},
            settings={"continueOnFail": False},
        )

        # Insert workflow
        await workflow.insert()

        # Query it back
        found = await Workflow.find_one(Workflow.workflow_id == workflow_id)

        assert found is not None
        assert found.name == "Test Workflow"
        assert len(found.nodes) == 1
        assert found.nodes[0]["type"] == "start"

        # Cleanup
        await found.delete()

    @requires_mongodb
    async def test_workflow_tag_validation(self, setup_db):
        """Test workflow tag validation (max 10 tags)"""
        with pytest.raises(ValueError):
            Workflow(
                workflow_id=str(uuid.uuid4()),
                name="Test Workflow",
                tags=[
                    "tag1",
                    "tag2",
                    "tag3",
                    "tag4",
                    "tag5",
                    "tag6",
                    "tag7",
                    "tag8",
                    "tag9",
                    "tag10",
                    "tag11",
                ],  # 11 tags
            )


class TestRunDocument:
    """Test Run document operations"""

    @requires_mongodb
    async def test_create_run(self, setup_db):
        """Test creating a run document"""
        run_id = str(uuid.uuid4())
        workflow_id = str(uuid.uuid4())

        run = Run(run_id=run_id, workflow_id=workflow_id, status="pending", trigger="manual")

        await run.insert()

        # Query it back
        found = await Run.find_one(Run.run_id == run_id)

        assert found is not None
        assert found.workflow_id == workflow_id
        assert found.status == "pending"
        assert found.trigger == "manual"

        # Cleanup
        await found.delete()

    @requires_mongodb
    async def test_run_status_enum(self, setup_db):
        """Test run status must be one of the enum values"""
        with pytest.raises(ValueError):
            Run(
                run_id=str(uuid.uuid4()),
                workflow_id=str(uuid.uuid4()),
                status="invalid_status",  # Invalid
                trigger="manual",
            )


class TestEnvironmentDocument:
    """Test Environment document operations"""

    @requires_mongodb
    async def test_create_environment(self, setup_db):
        """Test creating an environment document"""
        environment_id = str(uuid.uuid4())

        env = Environment(
            environment_id=environment_id,
            name="Test Environment",
            variables={"API_URL": "https://api.example.com", "API_KEY": "test-key"},
            secrets={"DB_PASSWORD": "secret123"},
        )

        await env.insert()

        # Query it back
        found = await Environment.find_one(Environment.environment_id == environment_id)

        assert found is not None
        assert found.name == "Test Environment"
        assert found.variables["API_URL"] == "https://api.example.com"
        assert found.secrets["DB_PASSWORD"] == "secret123"

        # Test to_dict with secret hiding
        env_dict = found.to_dict(include_secrets=False)
        assert env_dict["secrets"]["DB_PASSWORD"] == "***HIDDEN***"

        # Cleanup
        await found.delete()


class TestCollectionDocument:
    """Test Collection document operations"""

    @requires_mongodb
    async def test_create_collection(self, setup_db):
        """Test creating a collection document"""
        collection_id = str(uuid.uuid4())

        collection = Collection(
            collection_id=collection_id,
            name="Test Collection",
            description="A test collection",
            tags=["api", "testing"],
            icon="folder",
            color="#FF6B6B",
        )

        await collection.insert()

        # Query it back
        found = await Collection.find_one(Collection.collection_id == collection_id)

        assert found is not None
        assert found.name == "Test Collection"
        assert found.color == "#FF6B6B"
        assert "api" in found.tags

        # Cleanup
        await found.delete()

    @requires_mongodb
    async def test_collection_color_validation(self, setup_db):
        """Test collection color must be valid hex"""
        with pytest.raises(ValueError):
            Collection(
                collection_id=str(uuid.uuid4()),
                name="Test Collection",
                color="invalid",  # Not a valid hex color
            )
