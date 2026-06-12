"""
Unit tests for backend/app/services/upload_sandbox.py

Every test monkeypatches ``_get_uploads_base_dir`` so the real config is
never touched.
"""

import os
from pathlib import Path

import pytest

from app.services.upload_sandbox import (
    MAX_UPLOAD_SIZE_BYTES,
    UploadSandboxError,
    resolve_upload_path,
    validate_within_sandbox,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def sandbox_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a temporary uploads directory and patch the sandbox to use it."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(
        "app.services.upload_sandbox._get_uploads_base_dir",
        lambda: uploads,
    )
    return uploads


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolveUploadPath:
    """Tests for resolve_upload_path()."""

    def test_in_sandbox_file_accepted(self, sandbox_dir: Path) -> None:
        """A file inside the sandbox resolves without error."""
        allowed = sandbox_dir / "allowed.txt"
        allowed.write_text("hello")

        resolved = resolve_upload_path(str(allowed))
        assert resolved == allowed.resolve()

    def test_absolute_outside_sandbox_rejected(
        self, sandbox_dir: Path, tmp_path: Path
    ) -> None:
        """An absolute path outside the sandbox is rejected.

        Uses the real backend/.env path when it exists, otherwise any file
        outside the sandbox directory.
        """
        # Try the real backend/.env first (as specified in the task).
        backend_env = (
            Path(__file__).resolve().parent.parent / ".env"
        )
        if backend_env.exists():
            outside_path = backend_env
        else:
            # Fallback: create a file outside the sandbox.
            outside_path = tmp_path / "secret.txt"
            outside_path.write_text("SECRET")

        with pytest.raises(UploadSandboxError, match="outside the uploads sandbox"):
            resolve_upload_path(str(outside_path))

    def test_dotdot_traversal_rejected(self, sandbox_dir: Path) -> None:
        """``..`` segments are rejected before path resolution."""
        with pytest.raises(UploadSandboxError, match="[Tt]raversal"):
            resolve_upload_path("../etc/passwd")

    def test_url_encoded_traversal_rejected(
        self, sandbox_dir: Path
    ) -> None:
        """URL-encoded traversal (``%2e%2e%2f``) is treated as a literal
        filename — it must NOT decode and escape the sandbox.

        Since no file literally named ``%2e%2e%2f`` exists, this should
        raise an error (file-not-found or sandbox violation).
        """
        with pytest.raises(UploadSandboxError):
            resolve_upload_path("%2e%2e%2fetc%2fpasswd")

    def test_missing_file_when_strict(self, sandbox_dir: Path) -> None:
        """``must_exist=True`` (default) raises for non-existent files."""
        ghost = sandbox_dir / "does_not_exist.txt"
        with pytest.raises(UploadSandboxError, match="[Nn]ot found"):
            resolve_upload_path(str(ghost), must_exist=True)

    def test_size_limit_enforced(self, sandbox_dir: Path) -> None:
        """A file exceeding 50 MB is rejected."""
        big = sandbox_dir / "huge.bin"
        # Create a sparse file of 51 MB — instant on most filesystems.
        target_size = MAX_UPLOAD_SIZE_BYTES + 1 * 1024 * 1024  # 51 MB
        fd = os.open(str(big), os.O_CREAT | os.O_WRONLY)
        try:
            os.ftruncate(fd, target_size)
        finally:
            os.close(fd)

        with pytest.raises(UploadSandboxError, match="[Tt]oo large"):
            resolve_upload_path(str(big))

    def test_null_byte_rejected(self, sandbox_dir: Path) -> None:
        """Paths containing NUL bytes are rejected."""
        with pytest.raises(UploadSandboxError, match="NUL"):
            resolve_upload_path("file\x00.txt")

    def test_symlink_outside_rejected(
        self, sandbox_dir: Path, tmp_path: Path
    ) -> None:
        """A symlink inside the sandbox that points outside is rejected."""
        outside_file = tmp_path / "outside.txt"
        outside_file.write_text("secret")

        link = sandbox_dir / "escape_link"
        try:
            link.symlink_to(outside_file)
        except OSError:
            pytest.skip("Cannot create symlinks in this environment")

        with pytest.raises(UploadSandboxError, match="outside the uploads sandbox"):
            resolve_upload_path(str(link))


class TestValidateWithinSandbox:
    """Tests for the lower-level validate_within_sandbox()."""

    def test_path_inside_passes(self, sandbox_dir: Path) -> None:
        inside = (sandbox_dir / "ok.txt").resolve()
        # Should not raise.
        validate_within_sandbox(inside)

    def test_path_outside_raises(self, sandbox_dir: Path, tmp_path: Path) -> None:
        outside = (tmp_path / "nope.txt").resolve()
        with pytest.raises(UploadSandboxError):
            validate_within_sandbox(outside)
