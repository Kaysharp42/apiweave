"""Documentation test for the CSRF middleware section in docs/SECURITY.md.

This test guards against accidental removal of the CSRF middleware
documentation that explains which requests are protected, which are
exempt, and how to add new endpoints safely.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SECURITY_MD_PATH = REPO_ROOT / "docs" / "SECURITY.md"


def test_csrf_documented_in_security_md() -> None:
    """docs/SECURITY.md must document the CSRF middleware behavior."""
    assert SECURITY_MD_PATH.is_file(), f"Expected documentation file at {SECURITY_MD_PATH}"

    content = SECURITY_MD_PATH.read_text(encoding="utf-8")

    assert "CSRF middleware" in content, "docs/SECURITY.md must contain a 'CSRF middleware' section"
    assert (
        "session cookie" in content
    ), "docs/SECURITY.md must explain the session cookie requirement"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
