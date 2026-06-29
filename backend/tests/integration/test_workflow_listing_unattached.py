"""P3.7-A: the default workspace workflow listing excludes project-attached
workflows (collectionId set); they appear only under their project listing."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.models import Workflow
from app.repositories.workflow_repository import WorkflowRepository
from beanie import init_beanie
from mongomock_motor import AsyncMongoMockClient

_T = datetime(2026, 6, 29, tzinfo=UTC)


def _wf(workflow_id: str, *, collection_id: str | None) -> Workflow:
    return Workflow(
        workflowId=workflow_id,
        name=workflow_id,
        workspaceId="ws-1",
        collectionId=collection_id,
        nodes=[],
        edges=[],
        variables={},
        createdAt=_T,
        updatedAt=_T,
    )


@pytest.fixture
async def db():
    client = AsyncMongoMockClient()
    await init_beanie(database=client["wf_listing_test"], document_models=[Workflow])


async def test_default_listing_excludes_project_attached(db):
    await _wf("free-1", collection_id=None).insert()
    await _wf("free-2", collection_id=None).insert()
    await _wf("attached-1", collection_id="proj-1").insert()

    unattached, total = await WorkflowRepository.list_by_workspace("ws-1")
    assert total == 2
    assert {w.workflowId for w in unattached} == {"free-1", "free-2"}

    in_project, proj_total = await WorkflowRepository.list_by_workspace_and_project(
        "ws-1", "proj-1"
    )
    assert proj_total == 1
    assert {w.workflowId for w in in_project} == {"attached-1"}
