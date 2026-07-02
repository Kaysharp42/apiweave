"""Documentation test for the CSRF section in docs/operations/security.md.

This test guards against accidental removal of the CSRF protection
documentation that explains which requests are protected, which are
exempt, and how the session-cookie double-submit check works.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SECURITY_MD_PATH = REPO_ROOT / "docs" / "operations" / "security.md"


def test_csrf_documented_in_security_md() -> None:
    """docs/operations/security.md must document the CSRF protection behavior."""
    assert SECURITY_MD_PATH.is_file(), f"Expected documentation file at {SECURITY_MD_PATH}"

    content = SECURITY_MD_PATH.read_text(encoding="utf-8")

    assert "CSRF" in content, "docs/operations/security.md must contain a CSRF section"
    assert (
        "session cookie" in content
    ), "docs/operations/security.md must explain the session cookie requirement"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
