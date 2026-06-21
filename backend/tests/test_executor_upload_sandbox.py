"""Tests for upload-sandbox enforcement in WorkflowExecutor._get_file_content."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from app.runner.executor import WorkflowExecutor


def _executor() -> WorkflowExecutor:
    return WorkflowExecutor(run_id="run-test", workflow_id="wf-test")


@pytest.fixture()
def sandbox_dir(tmp_path: Path) -> Path:
    """Create a temporary uploads sandbox directory."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    return uploads


@pytest.fixture()
def sandboxed_file(sandbox_dir: Path) -> Path:
    """Create a test file inside the sandbox."""
    f = sandbox_dir / "testfile.txt"
    f.write_text("hello sandbox")
    return f


def _patch_sandbox(sandbox_dir: Path) -> Any:
    """Patch settings.UPLOADS_BASE_DIR to point at *sandbox_dir*."""
    return patch(
        "app.services.upload_sandbox._get_uploads_base_dir",
        return_value=sandbox_dir.resolve(),
    )


# -----------------------------------------------------------------------
# 1. type="path" — file inside sandbox is read successfully
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_path_type_reads_file_in_sandbox(sandboxed_file: Path, sandbox_dir: Path) -> None:
    exe = _executor()
    file_ref = {
        "type": "path",
        "value": str(sandboxed_file),
        "fieldName": "upload",
        "mimeType": "text/plain",
    }

    with _patch_sandbox(sandbox_dir):
        file_bytes, field_name, mime_type = await exe._get_file_content(file_ref)

    assert file_bytes == b"hello sandbox"
    assert field_name == "upload"
    assert mime_type == "text/plain"


# -----------------------------------------------------------------------
# 2. type="path" — path outside sandbox (e.g. backend/.env) is rejected
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_path_type_rejects_outside_sandbox(sandbox_dir: Path, tmp_path: Path) -> None:
    secret_file = tmp_path / "backend_dotenv"
    secret_file.write_text("SECRET_KEY=supersecret")

    exe = _executor()
    file_ref = {
        "type": "path",
        "value": str(secret_file),
        "fieldName": "file",
        "mimeType": "application/octet-stream",
    }

    with _patch_sandbox(sandbox_dir):
        with pytest.raises(Exception, match="File access denied"):
            await exe._get_file_content(file_ref)


# -----------------------------------------------------------------------
# 3. type="variable" — variable resolving to out-of-sandbox path rejected
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_variable_type_rejects_outside_sandbox_path(
    sandbox_dir: Path, tmp_path: Path
) -> None:
    secret_file = tmp_path / "etc_passwd"
    secret_file.write_text("root:x:0:0")

    exe = _executor()
    file_ref = {
        "type": "variable",
        "value": "{{secret_path}}",
        "fieldName": "file",
        "mimeType": "application/octet-stream",
    }

    with (
        _patch_sandbox(sandbox_dir),
        patch.object(exe, "_substitute_variables", return_value=str(secret_file)),
    ):
        with pytest.raises(Exception, match="File access denied"):
            await exe._get_file_content(file_ref)


# -----------------------------------------------------------------------
# 4. type="variable" — variable resolving to in-sandbox path succeeds
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_variable_type_reads_file_in_sandbox(sandboxed_file: Path, sandbox_dir: Path) -> None:
    exe = _executor()
    file_ref = {
        "type": "variable",
        "value": "{{my_file}}",
        "fieldName": "doc",
        "mimeType": "text/plain",
    }

    with (
        _patch_sandbox(sandbox_dir),
        patch.object(exe, "_substitute_variables", return_value=str(sandboxed_file)),
    ):
        file_bytes, field_name, mime_type = await exe._get_file_content(file_ref)

    assert file_bytes == b"hello sandbox"
    assert field_name == "doc"


# -----------------------------------------------------------------------
# 5. type="path" — path traversal with ".." is rejected
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_path_type_rejects_traversal(sandbox_dir: Path) -> None:
    exe = _executor()
    file_ref = {
        "type": "path",
        "value": str(sandbox_dir) + "/../../etc/passwd",
        "fieldName": "file",
    }

    with _patch_sandbox(sandbox_dir):
        with pytest.raises(Exception, match="File access denied"):
            await exe._get_file_content(file_ref)
